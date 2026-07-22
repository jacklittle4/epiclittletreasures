/**
 * Epic Little Treasures — Cloudflare Worker
 *
 * Serves the static site (via the ASSETS binding) and adds ONE API route,
 * POST /api/create-checkout, which builds a Stripe Checkout Session for the
 * bundle cart and returns its URL for the browser to redirect to.
 *
 * SECURITY:
 *  - Prices and product names are looked up from products.json on the server,
 *    never trusted from the client. The client only sends {id, qty}.
 *  - The Stripe secret key lives ONLY as an encrypted Worker secret
 *    (STRIPE_SECRET_KEY). It is never in this file or in git.
 *
 * Setup steps are in WORKER_SETUP.md.
 */

const ORIGIN = "https://www.epiclittletreasures.com";
const MAX_QTY_PER_ITEM = 20;
const SHOP_EMAIL = "xoxodragonfly@gmail.com";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/create-checkout") {
      if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
      return createCheckout(request, env);
    }
    if (url.pathname === "/api/order-notify") {
      if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
      return orderNotify(request, env);
    }
    if (url.pathname === "/api/debug-email") {
      const sent = await sendShopEmail({
        _subject: "Worker debug email test (Epic Little Treasures)",
        message: "Sent from the Cloudflare Worker to test server-side delivery.",
      });
      return json(sent);
    }
    // Everything else is the static site.
    return env.ASSETS.fetch(request);
  },
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

const priceToCents = (price = "") => {
  const match = String(price).match(/(\d+(?:\.\d{1,2})?)/);
  return match ? Math.round(parseFloat(match[1]) * 100) : 0;
};

const keyOf = (product) =>
  product.id ||
  String(product.name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

async function createCheckout(request, env) {
  if (!env.STRIPE_SECRET_KEY) {
    return json({ error: "Checkout is not configured yet." }, 503);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "Bad request." }, 400);
  }

  const items = Array.isArray(payload.items) ? payload.items : [];
  const answers = payload.answers && typeof payload.answers === "object" ? payload.answers : {};
  if (!items.length) return json({ error: "Your cart is empty." }, 400);

  // Authoritative catalog — prices always come from here. Read it through the
  // ASSETS binding (not a public fetch) to avoid a self-subrequest to our own
  // zone, which Cloudflare rejects.
  let catalog;
  try {
    const res = await env.ASSETS.fetch(new Request(`${ORIGIN}/products.json`));
    catalog = await res.json();
  } catch {
    return json({ error: "Could not load the catalog." }, 502);
  }
  const products = Array.isArray(catalog.products) ? catalog.products : [];

  const lineItems = [];
  for (const entry of items) {
    const qty = Math.max(1, Math.min(MAX_QTY_PER_ITEM, parseInt(entry && entry.qty, 10) || 0));
    const product = products.find((p) => keyOf(p) === (entry && entry.id));
    if (!product) continue;
    const isBundle = String(product.category || "").toLowerCase() === "live bundles";
    const cents = priceToCents(product.price);
    const available = product.status ? product.status === "available" : product.available !== false;
    if (!isBundle || !cents || !available) continue;
    lineItems.push({ name: product.name, cents, qty });
  }
  if (!lineItems.length) return json({ error: "No purchasable items in cart." }, 400);

  const form = new URLSearchParams();
  form.set("mode", "payment");
  form.set("success_url", `${ORIGIN}/thank-you.html?order=success&session_id={CHECKOUT_SESSION_ID}`);
  form.set("cancel_url", `${ORIGIN}/cart.html`);
  form.set("shipping_address_collection[allowed_countries][0]", "US");
  form.set("phone_number_collection[enabled]", "true");
  // Leaving payment_method_types unset lets Stripe show every method enabled in
  // the dashboard (card, Klarna, Affirm, Cash App Pay, etc.).
  lineItems.forEach((li, i) => {
    form.set(`line_items[${i}][price_data][currency]`, "usd");
    form.set(`line_items[${i}][price_data][product_data][name]`, li.name);
    form.set(`line_items[${i}][price_data][unit_amount]`, String(li.cents));
    form.set(`line_items[${i}][quantity]`, String(li.qty));
  });
  const meta = {
    order_items: lineItems.map((li) => `${li.qty}x ${li.name}`).join(", "),
    favorite_color: answers.favorite_color,
    theme: answers.theme,
    reads: answers.reads,
    sarcastic: answers.sarcastic,
  };
  Object.entries(meta).forEach(([k, v]) => {
    if (v) form.set(`metadata[${k}]`, String(v).slice(0, 480));
  });

  let session;
  try {
    const stripeRes = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    });
    session = await stripeRes.json();
    if (!stripeRes.ok || !session.url) {
      return json({ error: (session.error && session.error.message) || "Could not start checkout." }, 502);
    }
  } catch {
    return json({ error: "Could not reach the payment processor." }, 502);
  }

  return json({ url: session.url });
}

const formatAddress = (a) => {
  if (!a) return "";
  return [a.line1, a.line2, [a.city, a.state, a.postal_code].filter(Boolean).join(", "), a.country]
    .filter(Boolean)
    .join("\n");
};

/**
 * Called by the thank-you page after Stripe redirects back. Looks the session
 * up on Stripe, and ONLY if it is genuinely paid, emails Stephanie the order
 * (items, the 4 answers, and the shipping address). No signature needed: an
 * unpaid or unknown session id produces no email, and a valid paid id only ever
 * re-sends a real order.
 */
async function orderNotify(request, env) {
  if (!env.STRIPE_SECRET_KEY) return json({ ok: false }, 200);

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "Bad request." }, 400);
  }
  const sessionId = String((payload && payload.session_id) || "");
  if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) return json({ error: "Bad session." }, 400);

  let session;
  try {
    const r = await fetch(
      `https://api.stripe.com/v1/checkout/sessions/${sessionId}?expand[]=line_items`,
      { headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` } }
    );
    session = await r.json();
    if (!r.ok) return json({ ok: false }, 200);
  } catch {
    return json({ ok: false }, 200);
  }

  if (session.payment_status !== "paid") return json({ ok: false, reason: "unpaid" }, 200);

  const md = session.metadata || {};
  const cust = session.customer_details || {};
  const ship =
    session.shipping_details ||
    (session.collected_information && session.collected_information.shipping_details) ||
    {};
  const items =
    session.line_items && session.line_items.data
      ? session.line_items.data.map((li) => `${li.quantity}x ${li.description}`).join(", ")
      : md.order_items || "";
  const total = typeof session.amount_total === "number" ? `$${(session.amount_total / 100).toFixed(2)}` : "";

  const fields = {
    _subject: `New paid order${total ? " — " + total : ""} (Epic Little Treasures)`,
    _template: "table",
    _captcha: "false",
    order_total: total,
    items,
    favorite_color: md.favorite_color || "",
    theme: md.theme || "",
    do_you_read: md.reads || "",
    sarcastic: md.sarcastic || "",
    customer_name: cust.name || ship.name || "",
    customer_email: cust.email || "",
    customer_phone: cust.phone || "",
    ship_to: ship.name || "",
    shipping_address: formatAddress(ship.address),
    stripe_reference: session.payment_intent || session.id,
  };

  const sent = await sendShopEmail(fields);
  return json({ ok: sent.ok, reason: sent.ok ? "sent" : "email-rejected", detail: sent.body }, 200);
}

// Sends an email to the shop via FormSubmit. Returns whether FormSubmit actually
// accepted it (it replies 200 with {success:"false"} when it rejects, so we must
// read the body, not just trust the HTTP status).
async function sendShopEmail(fields) {
  try {
    const r = await fetch(`https://formsubmit.co/ajax/${SHOP_EMAIL}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Origin: ORIGIN,
        Referer: `${ORIGIN}/cart.html`,
      },
      body: JSON.stringify(fields),
    });
    const body = await r.text();
    let ok = false;
    try {
      ok = JSON.parse(body).success === "true";
    } catch {
      /* non-JSON response = not accepted */
    }
    return { ok, status: r.status, body: body.slice(0, 300) };
  } catch (e) {
    return { ok: false, status: 0, body: String(e).slice(0, 300) };
  }
}
