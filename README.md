# Epic Little Treasures

Static storefront-style website for Epic Little Treasures.

## Preview locally

From the repository root:

```powershell
python -m http.server 4173 --bind 127.0.0.1
```

Open:

```text
http://127.0.0.1:4173/epic-little-treasures/
```

## Notes

- Product photos are generated placeholder assets for the site build and can be replaced with real shop photos later.
- The order form posts to FormSubmit using `xoxodragonfly@gmail.com`.
- First FormSubmit use may require confirmation from the email owner before messages deliver.
- Products are sold by inquiry through the form, Facebook, TikTok, email, or phone rather than a checkout cart.
- Product data lives in `products.json`.
- The owner updater is intentionally not linked or published with the customer site. Keep it local or in a private repo, then export an updated `products.json`.
- TikTok links point to `https://www.tiktok.com/@stephanie.davis015`.
