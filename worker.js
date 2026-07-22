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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/create-checkout") {
      if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
      return createCheckout(request, env);
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

  // Authoritative catalog — prices always come from here.
  let catalog;
  try {
    const res = await fetch(`${ORIGIN}/products.json`, { cf: { cacheTtl: 60 } });
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
  form.set("success_url", `${ORIGIN}/thank-you.html?order=success`);
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
