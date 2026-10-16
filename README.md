# Epic Little Treasures

Storefront for Stephanie Davis's junk-journal bundles — https://www.epiclittletreasures.com

## How it runs

- **Hosting:** Cloudflare Workers static assets. Every push to `main` deploys automatically.
  `worker.js` serves the API routes below plus short links (`/shop`, `/bundles`, `/classes`);
  everything else is a static file. `.assetsignore` keeps repo-only files (worker, docs) unpublished.
- **Catalog:** `products.json` (bundles + other items), `workshops.json` (classes), `live.json` (the TikTok “I'm live” banner).
- **Checkout:** the cart (`cart.html`) posts to `/api/create-checkout`, which builds a Stripe Checkout session.
  Prices always come from `products.json` on the server, and only available items in the “Live bundles” category can be bought online.
  After payment, `/api/order-notify` emails the order through Web3Forms.
- **Design:** tokens at the top of `styles.css`; fonts Cormorant Garamond, EB Garamond, Dancing Script, Source Sans 3.
  Logo `assets/moth.png`; photos are compressed `.webp`.

## Shop editor (`/manage`)

A phone-friendly page where Stephanie changes prices, marks bundles sold out, adds bundles/classes/photos, and flips the Live banner.
She signs in with a passcode; the Worker commits her change to this repo, and the site redeploys about a minute later.
“Sign in with GitHub” is a backup that commits straight from the browser.

## Cloudflare secrets (Settings → Variables and Secrets)

| Name | What |
| --- | --- |
| `STRIPE_SECRET_KEY` | Stripe restricted key (Checkout Sessions write) |
| `WEB3FORMS_KEY` | Order-email access key |
| `ADMIN_PASSCODE` | Stephanie's editor passcode (a few words; case and spaces don't matter). Changing it signs every device out. |
| `GITHUB_TOKEN` | Fine-grained token, **this repo only**, Contents: read and write — lets the editor save |

## Preview locally

```bash
python3 -m http.server 8788
```

Then open http://localhost:8788/. The `/api/*` routes only run on Cloudflare.
