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

// Short addresses people type (or hear on a TikTok live) -> the real page.
const SHORTCUTS = {
  "/shop": "/treasures",
  "/bundles": "/treasures",
  "/store": "/treasures",
  "/classes": "/workshops",
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const shortcut = SHORTCUTS[url.pathname.toLowerCase().replace(/\/+$/, "")];
    if (shortcut) return Response.redirect(new URL(shortcut, url.origin).toString(), 301);
    if (url.pathname === "/api/create-checkout") {
      if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
      return createCheckout(request, env);
    }
    if (url.pathname.startsWith("/api/admin/")) {
      return admin(request, env, url);
    }
    if (url.pathname === "/api/order-notify") {
      if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
      return orderNotify(request, env);
    }
    // Internal links use page.html; serve those directly instead of letting the
    // asset layer bounce them to /page (saves a round-trip on every tap).
    if (request.method === "GET" && url.pathname.endsWith(".html")) {
      const clean = new URL(url);
      clean.pathname = url.pathname.replace(/(^|\/)index\.html$/, "$1").replace(/\.html$/, "");
      return env.ASSETS.fetch(new Request(clean.toString(), request));
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
    subject: `New paid order${total ? " — " + total : ""} (Epic Little Treasures)`,
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

  const sent = await sendShopEmail(env, fields);
  return json({ ok: sent.ok, reason: sent.ok ? "sent" : "email-rejected", detail: sent.body }, 200);
}

// Sends an email to the shop via Web3Forms (server-friendly: uses an access key,
// no browser-origin requirement, reliable at shop volume). Reads the response
// body since a rejected send still returns HTTP 200 with success:false.
async function sendShopEmail(env, fields) {
  if (!env.WEB3FORMS_KEY) return { ok: false, status: 0, body: "WEB3FORMS_KEY not set" };
  try {
    const r = await fetch("https://api.web3forms.com/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ access_key: env.WEB3FORMS_KEY, from_name: "Epic Little Treasures", ...fields }),
    });
    const body = await r.text();
    let ok = false;
    try {
      const s = JSON.parse(body).success;
      ok = s === true || s === "true";
    } catch {
      /* non-JSON response = not accepted */
    }
    return { ok, status: r.status, body: body.slice(0, 300) };
  } catch (e) {
    return { ok: false, status: 0, body: String(e).slice(0, 300) };
  }
}

/* ------------------------------------------------------------------------
 * Shop editor API (/manage). Stephanie signs in with one passcode; the Worker
 * saves to GitHub with a token only it holds, so she never needs a GitHub
 * account. Secrets (Cloudflare → Settings → Variables and Secrets):
 *   ADMIN_PASSCODE  — the passcode she types (spaces/caps/dashes ignored)
 *   GITHUB_TOKEN    — fine-grained token, this repo only, Contents: read+write
 * Changing ADMIN_PASSCODE signs every device out.
 * --------------------------------------------------------------------- */

const REPO = "jacklittle4/epiclittletreasures";
const BRANCH = "main";
const EDITABLE_FILES = ["products.json", "workshops.json", "live.json"];
const PHOTO_TYPES = ["jpg", "jpeg", "png", "webp"];
const SESSION_DAYS = 120;
const MAX_JSON_BYTES = 200 * 1024;
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const enc = new TextEncoder();

const normalizePasscode = (s = "") => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const sha256Hex = async (s) => toHex(await crypto.subtle.digest("SHA-256", enc.encode(s)));
async function hmacHex(secret, msg) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toHex(await crypto.subtle.sign("HMAC", key, enc.encode(msg)));
}
function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function utf8ToBase64(str) {
  const bytes = enc.encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
const base64ToUtf8 = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, "")), (c) => c.charCodeAt(0)));

async function makeSession(env) {
  const exp = Date.now() + SESSION_DAYS * 864e5;
  return `${exp}.${await hmacHex(env.ADMIN_PASSCODE, "elt-admin:" + exp)}`;
}
async function validSession(request, env) {
  const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const [exp, sig] = token.split(".");
  if (!exp || !sig || !(Number(exp) > Date.now())) return false;
  return safeEqual(sig, await hmacHex(env.ADMIN_PASSCODE, "elt-admin:" + exp));
}

function github(env, path, init = {}) {
  return fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "epiclittletreasures-editor",
      ...(init.headers || {}),
    },
  });
}
async function readRepoJson(env, path) {
  const r = await github(env, `${path}?ref=${BRANCH}`);
  if (!r.ok) throw new Error(`Could not load ${path} (${r.status})`);
  const j = await r.json();
  return { sha: j.sha, data: JSON.parse(base64ToUtf8(j.content)) };
}

// Light shape checks so a bad save can never break the live site.
function checkShape(path, data) {
  const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
  const str = (v, max) => v === undefined || (typeof v === "string" && v.length <= max);
  const img = (v) => v === undefined || v === "" || (typeof v === "string" && /^assets\/[\w.\-]+$/.test(v));
  if (!isObj(data)) return "Data must be an object.";
  if (path === "products.json") {
    if (!Array.isArray(data.products) || !isObj(data.shop)) return "Missing products or shop.";
    for (const p of data.products) {
      if (!isObj(p) || !str(p.name, 120) || !p.name || !str(p.price, 40) || !str(p.summary, 600) || !str(p.details, 2000) || !img(p.image)) {
        return `A product has a missing or too-long field (${(p && p.name) || "unnamed"}).`;
      }
      // Bundles are sold through Stripe at exactly this price, so it must be a plain amount.
      if (String(p.category).toLowerCase() === "live bundles" && !/^\$\d{1,4}(\.\d{2})?$/.test(p.price || "")) {
        return `${p.name} needs a price like $44.99.`;
      }
    }
  } else if (path === "workshops.json") {
    if (!Array.isArray(data.workshops)) return "Missing workshops.";
    for (const w of data.workshops) {
      if (!isObj(w) || !str(w.title, 160) || !str(w.description, 2000) || !str(w.date, 10)) return "A class has a bad field.";
    }
  } else if (path === "live.json") {
    if (typeof data.isLive !== "boolean") return "isLive must be true or false.";
  }
  return null;
}

async function admin(request, env, url) {
  const route = url.pathname.slice("/api/admin/".length);
  const configured = Boolean(env.GITHUB_TOKEN && normalizePasscode(env.ADMIN_PASSCODE).length >= 8);

  if (route === "status") return json({ configured });
  if (!configured) return json({ error: "The editor login isn't set up yet." }, 503);

  if (route === "login") {
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
    const body = await request.json().catch(() => ({}));
    const given = await sha256Hex(normalizePasscode(body.passcode));
    const real = await sha256Hex(normalizePasscode(env.ADMIN_PASSCODE));
    if (!safeEqual(given, real)) {
      await sleep(900); // slow down guessing
      return json({ error: "That passcode didn't match. Try again." }, 401);
    }
    return json({ token: await makeSession(env) });
  }

  if (!(await validSession(request, env))) return json({ error: "Please sign in again." }, 401);

  if (route === "files" && request.method === "GET") {
    try {
      const [products, workshops, live] = await Promise.all(EDITABLE_FILES.map((f) => readRepoJson(env, f)));
      return json({ products, workshops, live });
    } catch (e) {
      return json({ error: e.message }, 502);
    }
  }

  if (route === "save" && request.method === "POST") {
    const body = await request.json().catch(() => null);
    if (!body || !EDITABLE_FILES.includes(body.path)) return json({ error: "That file can't be edited." }, 400);
    const problem = checkShape(body.path, body.data);
    if (problem) return json({ error: problem }, 400);
    const text = JSON.stringify(body.data, null, 2) + "\n";
    if (enc.encode(text).length > MAX_JSON_BYTES) return json({ error: "That's too much data to save." }, 400);
    const message = "Editor: " + String(body.message || "update").slice(0, 80);
    const r = await github(env, body.path, {
      method: "PUT",
      body: JSON.stringify({ message, content: utf8ToBase64(text), sha: body.sha, branch: BRANCH }),
    });
    if (r.status === 409 || r.status === 422) {
      return json({ error: "Something changed in another window. Reloading the latest version…", stale: true }, 409);
    }
    if (!r.ok) return json({ error: `Save failed (${r.status}).` }, 502);
    const j = await r.json();
    return json({ sha: j.content.sha });
  }

  if (route === "upload" && request.method === "POST") {
    const body = await request.json().catch(() => null);
    const ext = String((body && body.ext) || "").toLowerCase();
    const data = String((body && body.data) || "");
    if (!PHOTO_TYPES.includes(ext) || !/^[A-Za-z0-9+/=]+$/.test(data)) return json({ error: "That photo type isn't supported." }, 400);
    if (data.length * 0.75 > MAX_PHOTO_BYTES) return json({ error: "That photo is too large." }, 400);
    const path = `assets/photo-${Date.now()}.${ext}`;
    const r = await github(env, path, {
      method: "PUT",
      body: JSON.stringify({ message: "Editor: add photo", content: data, branch: BRANCH }),
    });
    if (!r.ok) return json({ error: `Photo upload failed (${r.status}).` }, 502);
    return json({ path });
  }

  return json({ error: "Not found" }, 404);
}
