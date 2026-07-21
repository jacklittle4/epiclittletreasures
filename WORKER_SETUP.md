# Cart checkout — Cloudflare Worker setup

The cart uses a tiny Cloudflare Worker (`worker.js`) to create Stripe Checkout
Sessions. This lives in the **same** Cloudflare project as the site, so there is
one deploy and no CORS. The site's static files are served through the `ASSETS`
binding; only `POST /api/create-checkout` runs custom code.

## One-time setup

1. **Create a restricted Stripe key** (Dashboard → Developers → API keys →
   *Create restricted key*). Start in **Test mode**.
   - Name: `epic-cart-worker`
   - Permission: **Checkout Sessions → Write**. Everything else *None*.
   - Copy the `rk_test_…` value.

2. **Store the key as an encrypted Worker secret** (never in git):
   ```
   npx wrangler secret put STRIPE_SECRET_KEY
   # paste the rk_test_… value when prompted
   ```

3. **Deploy** (from the repo root):
   ```
   npx wrangler deploy
   ```
   The existing GitHub → Cloudflare auto-deploy also works once `worker.js` +
   the `wrangler.toml` changes are on `main`.

## Test (test mode)

- Add bundles to the cart → Checkout → answer the 4 questions → **Pay securely**.
- Use Stripe test card `4242 4242 4242 4242`, any future expiry, any CVC/ZIP.
- On success you land on `/thank-you.html?order=success` (cart auto-clears) and
  the session's `metadata` holds the 4 answers (visible on the Stripe payment).

## Go live

- Swap the secret for a **live** `rk_live_…` restricted key (same permission),
  re-run `wrangler secret put STRIPE_SECRET_KEY`, and redeploy.
- Confirm Klarna, Affirm, and Cash App Pay are enabled in
  Stripe → Settings → Payment methods (they appear automatically at checkout).

## How prices stay safe

The browser only sends `{id, qty}`. The Worker loads `products.json`, matches
each id, and uses the **catalog price** — so a tampered client can't change the
amount. Only `Live bundles` that are available and have a `$` price are eligible.
