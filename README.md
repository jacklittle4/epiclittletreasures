# Epic Little Treasures

Static storefront-style website for Epic Little Treasures.

## Preview locally

From the repository root:

```powershell
python -m http.server 4173 --bind 127.0.0.1
```

Open:

```text
http://127.0.0.1:4173/
```

## Notes

- Product photos are generated placeholder assets for the site build and can be replaced with real shop photos later.
- The contact form posts to FormSubmit using `xoxodragonfly@gmail.com`.
- First FormSubmit use may require confirmation from the email owner before messages deliver.
- Products can be paid for through the static checkout page using Cash App or Venmo links, with the contact form available for questions and custom work.
- Product data lives in `products.json`.
- The owner updater is intentionally not linked or published with the customer site. Keep it local or in a private repo, then export an updated `products.json`.
- TikTok links point to `https://www.tiktok.com/@stephanie.davis015`.

## Launch checklist

- Update `products.json` for names, prices, `status` (`available`, `sold-out`, or `custom-order`), photos, alt text, and featured items.
- Replace generated images in `assets/` with real product photos when available.
- Confirm Cash App and Venmo links in `products.json`.
- Submit one test contact form and one checkout follow-up form so FormSubmit is activated.
- Review `privacy.html`, `terms.html`, `sitemap.xml`, and `robots.txt` before launch.
- If a real custom domain is purchased later, update canonical links, sitemap URLs, FormSubmit `_next` URLs, and GitHub Pages settings.
- Analytics are not installed yet. Add a real Google Analytics, Plausible, or Cloudflare Web Analytics ID only after the owner chooses one.
