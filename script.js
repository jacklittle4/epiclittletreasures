const contactForm = document.querySelector(".contact-form");
const formStatus = document.querySelector(".form-status");
const itemSelect = document.querySelector("#item");
const messageField = document.querySelector("#message");
const productTargets = document.querySelectorAll("[data-products]");
const checkoutTarget = document.querySelector("[data-checkout]");
const workshopTargets = document.querySelectorAll("[data-workshops]");
const bundleTiersTarget = document.querySelector("[data-bundle-tiers]");
const promoTarget = document.querySelector("[data-promo]");
const liveTarget = document.querySelector("[data-live]");

const fallbackCatalog = {
  shop: {
    email: "xoxodragonfly@gmail.com",
    cashApp: "https://cash.app/$xoxodragonfly",
    venmo: "https://venmo.com/StephanieDavis1",
    tiktok: "https://www.tiktok.com/@stephanie.davis015",
  },
  products: [],
};

const getCatalog = async () => {
  try {
    const response = await fetch("products.json", { cache: "no-store" });
    if (!response.ok) {
      return fallbackCatalog;
    }
    return response.json();
  } catch {
    return fallbackCatalog;
  }
};

const slugify = (value = "") =>
  String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const productKey = (product) => product.id || slugify(product.name || "");
const productInquiryUrl = (product) => `contact.html?item=${encodeURIComponent(productKey(product))}`;
const productCheckoutUrl = (product) => `checkout.html?item=${encodeURIComponent(productKey(product))}`;
const isFixedPrice = (price = "") => price.trim().startsWith("$");
const isBundle = (product = {}) => String(product.category || "").toLowerCase() === "live bundles";
// Strip dangerous URL schemes (javascript:/data:/vbscript:) from any link/image
// value that comes out of products.json, while still allowing normal relative
// paths ("assets/x.jpeg") and http(s)/mailto/tel links.
const safeUrl = (url = "") => {
  const value = String(url).replace(/[\x00-\x20\x7f]/g, "").trim();
  return /^(javascript|data|vbscript):/i.test(value) ? "" : value;
};
const productLabel = (product) => `${product.name} - ${product.price}`;

/* ---- Cart (browser-side, no account) ------------------------------------ */
const CART_KEY = "elt-cart-v1";
// Endpoint that creates the Stripe Checkout Session (Cloudflare Worker).
const CHECKOUT_ENDPOINT = "/api/create-checkout";
const priceToCents = (price = "") => {
  const match = String(price).match(/(\d+(?:\.\d{1,2})?)/);
  return match ? Math.round(parseFloat(match[1]) * 100) : 0;
};
const formatCents = (cents) => `$${(cents / 100).toFixed(2)}`;
const getCart = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(CART_KEY) || "[]");
    return Array.isArray(raw) ? raw.filter((e) => e && e.id && e.qty > 0) : [];
  } catch {
    return [];
  }
};
const saveCart = (cart) => {
  try {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
  } catch {
    /* private mode / storage full — cart just won't persist */
  }
  updateCartUi();
};
const cartCount = () => getCart().reduce((sum, e) => sum + e.qty, 0);
const addToCart = (id, qty = 1) => {
  const cart = getCart();
  const existing = cart.find((e) => e.id === id);
  if (existing) existing.qty += qty;
  else cart.push({ id, qty });
  saveCart(cart);
};
const setCartQty = (id, qty) => {
  let cart = getCart();
  if (qty <= 0) cart = cart.filter((e) => e.id !== id);
  else {
    const entry = cart.find((e) => e.id === id);
    if (entry) entry.qty = qty;
  }
  saveCart(cart);
};
// Resolve stored cart entries against the catalog — unknown ids are dropped and
// prices always come from the catalog, never from stored/client data.
const cartLines = (catalog) => {
  const products = Array.isArray(catalog.products) ? catalog.products : [];
  return getCart()
    .map((entry) => {
      const product = products.find((p) => productKey(p) === entry.id);
      if (!product) return null;
      const unitCents = priceToCents(product.price);
      return { id: entry.id, qty: entry.qty, product, unitCents, lineCents: unitCents * entry.qty };
    })
    .filter(Boolean);
};
const cartTotalCents = (catalog) => cartLines(catalog).reduce((sum, line) => sum + line.lineCents, 0);

const bundlePullCount = (product = {}) => {
  const match = String(product.name || "").match(/(\d+)\s*pulls?/i);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
};
const bundleTierLabel = (product = {}) => {
  const match = String(product.name || "").match(/(\d+)\s*pulls?/i);
  return match ? `${match[1]} pulls` : product.name || "";
};
const statusLabels = {
  available: "Available",
  "sold-out": "Sold out",
  "custom-order": "Custom order",
};

const normalizeStatus = (product) => {
  if (product.status) {
    return product.status;
  }
  return product.available ? "available" : "sold-out";
};

const productCard = (product, mode = "grid") => {
  const status = normalizeStatus(product);
  const fixedPrice = isFixedPrice(product.price || "");
  const canBuyNow = status === "available" && fixedPrice;
  const availability = canBuyNow ? "Ready for buy now" : statusLabels[status] || "Ask first";
  const alt = escapeHtml(product.alt || product.name || "");
  const gallery = Array.isArray(product.gallery) ? product.gallery : [];
  const image = escapeHtml(safeUrl(gallery[0] || product.image || "") || "assets/logo-moth.svg");
  const galleryPreview = gallery.length > 1
    ? `<div class="product-gallery" aria-label="More photos">${gallery.slice(1, 4).map((photo) => `<img src="${escapeHtml(safeUrl(photo))}" alt="${alt}" loading="lazy" />`).join("")}</div>`
    : "";
  const detail = mode === "list" ? `<p class="product-detail">${escapeHtml(product.details || "")}</p>${galleryPreview}` : "";
  const priceTag = product.price ? `<span class="price-tag">${escapeHtml(product.price)}</span>` : "";

  return `
    <article class="product-card" id="${escapeHtml(productKey(product))}">
      <a class="product-photo" href="${canBuyNow ? productCheckoutUrl(product) : productInquiryUrl(product)}">
        <img src="${image}" alt="${alt}" loading="lazy" />
        <span class="status-badge status-${status}">${statusLabels[status] || "Ask first"}</span>
        ${priceTag}
      </a>
      <div class="product-body">
        <div class="product-topline">
          <span>${escapeHtml(product.category || "Handmade")}</span>
        </div>
        <h3>${escapeHtml(product.name || "")}</h3>
        <p>${escapeHtml(product.summary || "")}</p>
        ${detail}
        <div class="product-meta-line">${availability}</div>
        <div class="buy-links">
          ${
            canBuyNow
              ? `<a class="buy-now-link" href="${productCheckoutUrl(product)}">Buy now</a>`
              : `<a class="buy-now-link" href="${productInquiryUrl(product)}">${status === "sold-out" ? "Ask next batch" : "Start request"}</a>`
          }
          <a href="${productInquiryUrl(product)}">Ask a question</a>
        </div>
      </div>
    </article>
  `;
};

const renderProducts = (catalog) => {
  const products = Array.isArray(catalog.products) ? catalog.products : [];
  fallbackCatalog.shop = { ...fallbackCatalog.shop, ...(catalog.shop || {}) };

  productTargets.forEach((target) => {
    const mode = target.dataset.products;
    const limit = Number(target.dataset.limit || 0);
    const list = mode === "featured" || mode === "latest"
      ? products.filter((product) => normalizeStatus(product) === "available")
      : mode === "nonbundle"
      ? products.filter((product) => String(product.category || "").toLowerCase() !== "live bundles")
      : products;
    const rendered = (limit ? list.slice(0, limit) : list).map((product) => {
      return productCard(product, mode === "all" ? "list" : "grid");
    });

    target.innerHTML = rendered.length
      ? rendered.join("")
      : `<p class="empty-state">No products are listed yet.</p>`;
  });
};

const renderBundleTiers = (catalog) => {
  if (!bundleTiersTarget) {
    return;
  }
  const products = Array.isArray(catalog.products) ? catalog.products : [];
  const bundles = products
    .filter((product) => String(product.category || "").toLowerCase() === "live bundles")
    .sort((a, b) => bundlePullCount(a) - bundlePullCount(b));
  if (!bundles.length) {
    return;
  }
  const tiles = bundles
    .map((product) => {
      const status = normalizeStatus(product);
      const canBuyNow = status === "available" && isFixedPrice(product.price || "");
      const label = escapeHtml(bundleTierLabel(product));
      const price = escapeHtml(product.price || "");
      if (canBuyNow) {
        const id = escapeHtml(productKey(product));
        return `<div class="bundle-tier bundle-tier-buy"><span>${label}</span><strong>${price}</strong><button type="button" class="bundle-tier-add" data-add-to-cart="${id}" aria-label="Add ${label} bundle (${price}) to cart">Add to cart</button></div>`;
      }
      const cta = status === "sold-out" ? "Ask next batch" : "Ask about this";
      return `<a class="bundle-tier" href="${productInquiryUrl(product)}" aria-label="${label} bundle ${price} - ${cta}"><span>${label}</span><strong>${price}</strong><span class="bundle-tier-cta">${cta}</span></a>`;
    })
    .join("");
  const note = bundleTiersTarget.querySelector(".bundle-note");
  if (note) {
    note.insertAdjacentHTML("beforebegin", tiles);
  } else {
    bundleTiersTarget.insertAdjacentHTML("afterbegin", tiles);
  }
};

const renderPromo = (catalog) => {
  if (!promoTarget) return;
  const shop = { ...fallbackCatalog.shop, ...(catalog.shop || {}) };
  const text = (shop.promoText || "").trim();
  if (!shop.promoEnabled || !text) {
    promoTarget.hidden = true;
    return;
  }
  promoTarget.innerHTML = `<div class="promo-float-card"><span class="promo-tape" aria-hidden="true"></span><p class="promo-text">${escapeHtml(text)}</p></div>`;
  promoTarget.hidden = false;
};

const renderCheckout = (catalog) => {
  if (!checkoutTarget) {
    return;
  }

  const products = Array.isArray(catalog.products) ? catalog.products : [];
  const shop = { ...fallbackCatalog.shop, ...(catalog.shop || {}) };
  const params = new URLSearchParams(window.location.search);
  const itemId = params.get("item");
  const product = products.find((entry) => productKey(entry) === itemId);

  if (!product) {
    checkoutTarget.innerHTML = `
      <article class="checkout-card">
        <p class="eyebrow">Choose a treasure</p>
        <h2>Pick an item first, then come back here to pay.</h2>
        <p>
          Each product card has a Buy Now button for fixed-price pieces. Custom work
          should start with a quick message so the final price is clear.
        </p>
        <div class="payment-actions">
          <a class="button button-primary" href="treasures.html">Browse the shop</a>
          <a class="button button-secondary" href="contact.html">Ask a question</a>
        </div>
      </article>
    `;
    return;
  }

  const fixedPrice = isFixedPrice(product.price || "");
  const status = normalizeStatus(product);
  const canPayNow = fixedPrice && status === "available";
  // Bundles are hand-picked, so buyers answer 4 quick questions before the pay
  // options unlock. Their answers also ride along in the follow-up email below.
  const gateQuestions = canPayNow && isBundle(product);

  const name = escapeHtml(product.name || "");
  const category = escapeHtml(product.category || "Handmade");
  const summary = escapeHtml(product.summary || "");
  const priceText = escapeHtml(product.price || "Message for price");
  const alt = escapeHtml(product.alt || product.name || "");
  const image = escapeHtml(
    safeUrl((Array.isArray(product.gallery) && product.gallery[0]) || product.image || "") || "assets/logo-moth.svg"
  );
  const payLink = safeUrl(product.payLink);
  const cashApp = escapeHtml(safeUrl(shop.cashApp));
  const venmo = escapeHtml(safeUrl(shop.venmo));
  const noteText = escapeHtml(`Payment note: ${productLabel(product)}`);
  const itemValue = escapeHtml(productLabel(product));

  const payReminder = gateQuestions
    ? `<p class="checkout-note">After you pay, please send your shipping details below so Stephanie can mail your bundle &mdash; your answers go with it.</p>`
    : "";

  const paymentPanel = canPayNow
    ? `
        <div class="payment-panel">
          <p class="eyebrow">Pay now</p>
          <h3>${payLink ? "Pay by card, Klarna, or Affirm — or use Cash App / Venmo and add the item name in the note." : "Use Cash App or Venmo, then include the item name in the note."}</h3>
          <div class="payment-actions">
            ${payLink ? `<a class="button button-primary" href="${escapeHtml(payLink)}" target="_blank" rel="noopener">Pay with card, Klarna, or Affirm</a>` : ""}
            <a class="button ${payLink ? "button-secondary" : "button-primary"}" href="${cashApp}" target="_blank" rel="noopener">Pay with Cash App</a>
            <a class="button button-secondary" href="${venmo}" target="_blank" rel="noopener">Pay with Venmo</a>
          </div>
          <p class="checkout-note">${noteText}</p>
          ${payReminder}
        </div>
      `
    : `
        <div class="payment-panel">
          <p class="eyebrow">${status === "sold-out" ? "Sold out" : "Custom price"}</p>
          <h3>This item needs a quick message before payment.</h3>
          <p>${status === "sold-out" ? "This piece may already be claimed, but a similar future batch or custom option may be possible." : "Custom pieces depend on color, size, materials, and timing, so the final total should be confirmed first."}</p>
          <div class="payment-actions">
            <a class="button button-primary" href="${productInquiryUrl(product)}">Start the request</a>
          </div>
        </div>
      `;

  const questionsCard = gateQuestions
    ? `
        <div class="contact-form bundle-questions" data-bundle-questions>
          <div class="full-field bq-head">
            <p class="eyebrow">One quick step</p>
            <h3 class="form-title">Help Stephanie hand-pick your pulls</h3>
            <p class="bundle-lock-note">Answer these four questions so your bundle is personalized &mdash; then the payment options unlock.</p>
          </div>
          <p class="bundle-q-error full-field" role="alert" hidden>Please answer all four questions to unlock payment.</p>
          <label for="q-color">Favorite color
            <input id="q-color" type="text" autocomplete="off" placeholder="Sage green, dusty peach, etc." required />
          </label>
          <label for="q-theme">Theme or vibe
            <input id="q-theme" type="text" autocomplete="off" placeholder="Cottagecore, vintage botanical, dark academia..." required />
          </label>
          <label for="q-reader">Do you read?
            <select id="q-reader" required>
              <option value="">Choose one</option>
              <option>Yes, I love books</option>
              <option>Sometimes</option>
              <option>Not really</option>
            </select>
          </label>
          <label for="q-sarcasm">Are you sarcastic?
            <select id="q-sarcasm" required>
              <option value="">Choose one</option>
              <option>Very sarcastic / snarky</option>
              <option>A little</option>
              <option>Not at all, keep it sweet</option>
            </select>
          </label>
          <button type="button" class="button button-primary full-field" data-unlock-pay>Continue to payment</button>
        </div>
      `
    : "";

  const bundleFollowupFields = gateQuestions
    ? `
        <input type="hidden" name="blindbag_color" value="" />
        <input type="hidden" name="blindbag_theme" value="" />
        <input type="hidden" name="blindbag_reader" value="" />
        <input type="hidden" name="blindbag_sarcasm" value="" />
      `
    : "";

  checkoutTarget.innerHTML = `
    <article class="checkout-card checkout-detail">
      <a class="text-link checkout-back" href="treasures.html">&larr; Keep shopping</a>
      <div class="checkout-product">
        <img src="${image}" alt="${alt}" />
        <div>
          <p class="eyebrow">${category}</p>
          <h2>${name}</h2>
          <p>${summary}</p>
          <strong class="checkout-price">${priceText}</strong>
        </div>
      </div>
      ${questionsCard}
      ${gateQuestions ? `<div class="payment-locked" data-pay-panel hidden></div>` : paymentPanel}
      <form class="contact-form checkout-followup" action="https://formsubmit.co/${escapeHtml(shop.email)}" method="POST">
        <input type="hidden" name="_subject" value="Epic Little Treasures checkout follow-up" />
        <input type="hidden" name="_template" value="table" />
        <input type="hidden" name="_captcha" value="false" />
        <input type="hidden" name="_next" value="https://www.epiclittletreasures.com/thank-you.html" />
        <input type="hidden" name="item" value="${itemValue}" />
        ${bundleFollowupFields}
        <h3 class="form-title">Send shipping or pickup details</h3>
        <div>
          <label for="checkout-name">Name</label>
          <input id="checkout-name" name="name" type="text" autocomplete="name" required />
        </div>
        <div>
          <label for="checkout-email">Email</label>
          <input id="checkout-email" name="email" type="email" autocomplete="email" required />
        </div>
        <div>
          <label for="checkout-phone">Phone</label>
          <input id="checkout-phone" name="phone" type="tel" autocomplete="tel" />
        </div>
        <div>
          <label for="checkout-method">Preferred handoff</label>
          <select id="checkout-method" name="handoff">
            <option>Shipping</option>
            <option>Local pickup</option>
            <option>Ask me first</option>
          </select>
        </div>
        <div class="full-field">
          <label for="checkout-message">Address, payment note, or question</label>
          <textarea id="checkout-message" name="message" rows="5" required placeholder="Include your shipping address, payment note name, or any pickup details."></textarea>
        </div>
        <button class="button button-primary full-field" type="submit">Send follow-up details</button>
      </form>
    </article>
  `;

  if (gateQuestions) {
    wireBundleGate(checkoutTarget, product, shop, paymentPanel);
  }
};

/* Bundle checkout gate: require the 4 personalization answers before revealing
   the pay options. The payment panel HTML is only injected into the DOM once the
   answers are captured (so the pay links do not exist until the gate is passed).
   Answers are copied into the follow-up form (guaranteed delivery with the
   shipping address) and best-effort emailed up front. */
const wireBundleGate = (root, product, shop, paymentPanelHtml) => {
  const card = root.querySelector("[data-bundle-questions]");
  const payPanel = root.querySelector("[data-pay-panel]");
  const button = card && card.querySelector("[data-unlock-pay]");
  const errorEl = card && card.querySelector(".bundle-q-error");
  const followup = root.querySelector(".checkout-followup");
  if (!card || !payPanel || !button) {
    return;
  }

  const fields = [
    ["#q-color", "blindbag_color"],
    ["#q-theme", "blindbag_theme"],
    ["#q-reader", "blindbag_reader"],
    ["#q-sarcasm", "blindbag_sarcasm"],
  ];

  button.addEventListener("click", () => {
    const answers = fields.map(([selector, name]) => ({
      el: card.querySelector(selector),
      name,
      value: (card.querySelector(selector)?.value || "").trim(),
    }));
    const firstEmpty = answers.find((a) => !a.value);
    if (firstEmpty) {
      if (errorEl) {
        errorEl.hidden = false;
        errorEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
      firstEmpty.el?.focus();
      return;
    }
    if (errorEl) errorEl.hidden = true;

    // Carry the answers into the follow-up form so they are delivered for sure
    // alongside the shipping address (this is the guaranteed delivery path).
    answers.forEach(({ name, value }) => {
      const hidden = followup && followup.querySelector(`input[name="${name}"]`);
      if (hidden) hidden.value = value;
    });

    // Reveal payment right away — never make the buyer wait on a network call.
    // The pay links are injected only now, so they were never in the DOM before
    // the questions were answered.
    card.classList.add("is-done");
    button.textContent = "Answers saved ✓";
    card.querySelectorAll("input, select, button").forEach((el) => {
      el.disabled = true;
    });
    payPanel.innerHTML = paymentPanelHtml || "";
    payPanel.hidden = false;
    payPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });

    // Best-effort early heads-up to Stephanie, in the background with a short
    // timeout. If it fails, the follow-up form above still carries the answers.
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    if (controller) {
      setTimeout(() => controller.abort(), 6000);
    }
    fetch(`https://formsubmit.co/ajax/${shop.email}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        _subject: `Bundle pull preferences — ${product.name}`,
        item: productLabel(product),
        favorite_color: answers[0].value,
        theme: answers[1].value,
        reads: answers[2].value,
        sarcastic: answers[3].value,
      }),
      signal: controller ? controller.signal : undefined,
    }).catch(() => {
      /* offline, blocked, or timed out — follow-up form still carries answers */
    });
  });
};

const blindbagFields = document.querySelector("#blindbag-fields");
const isBlindBagValue = () => {
  if (!itemSelect) return false;
  const opt = itemSelect.selectedOptions[0];
  const cat = (opt && opt.dataset.category ? opt.dataset.category : "").toLowerCase();
  return cat === "live bundles";
};
const toggleBlindBagFields = () => {
  if (!blindbagFields) return;
  const show = isBlindBagValue();
  blindbagFields.hidden = !show;
  blindbagFields.querySelectorAll("input, select, textarea").forEach((field) => {
    field.disabled = !show;
  });
};

const populateContactItems = (catalog) => {
  if (!itemSelect) {
    return;
  }

  const products = Array.isArray(catalog.products) ? catalog.products : [];
  const current = itemSelect.value;
  const options = [
    `<option value="">Choose an item</option>`,
    ...products.map((product) => {
      const label = escapeHtml(productLabel(product));
      return `<option value="${label}" data-product-id="${escapeHtml(productKey(product))}" data-category="${escapeHtml(product.category || "")}">${label}</option>`;
    }),
    `<option value="Workshop or class">Workshop or class</option>`,
    `<option value="Not sure yet">Not sure yet</option>`,
  ];

  itemSelect.innerHTML = options.join("");

  const params = new URLSearchParams(window.location.search);
  const itemId = params.get("item");
  const selectedProduct = products.find((product) => productKey(product) === itemId);

  if (selectedProduct) {
    const selectedValue = productLabel(selectedProduct);
    itemSelect.value = selectedValue;

    if (messageField && !messageField.value) {
      messageField.value = `I am interested in the ${selectedValue}. Please let me know availability, pickup, shipping, or any details needed after payment.`;
    }
    return;
  }

  if (current) {
    itemSelect.value = current;
  }
};

const monthShort = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

const parseWorkshopDate = (iso) => {
  if (!iso) {
    return null;
  }
  const date = new Date(`${iso}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
};

const workshopCard = (workshop) => {
  const status = workshop.status || "upcoming";
  const date = parseWorkshopDate(workshop.date);
  const badge = date
    ? `<div class="workshop-date"><span class="wd-month">${monthShort[date.getMonth()]}</span><span class="wd-day">${date.getDate()}</span></div>`
    : `<div class="workshop-date"><span class="wd-month">Soon</span></div>`;
  const meta = [workshop.price, workshop.time, workshop.location || workshop.format]
    .filter(Boolean)
    .map((entry) => `<span>${escapeHtml(entry)}</span>`)
    .join("");
  const signupUrl = safeUrl(workshop.signupUrl);
  const signup = signupUrl
    ? `<a class="button button-primary" href="${escapeHtml(signupUrl)}">Save my spot</a>`
    : "";

  return `
    <article class="workshop-card${status === "past" ? " is-past" : ""}">
      ${badge}
      <div class="workshop-body">
        <span class="workshop-tag">${status === "past" ? "Past session" : "Upcoming class"}</span>
        <h3>${escapeHtml(workshop.title || "Teaching session")}</h3>
        <div class="workshop-meta">${meta}</div>
        <p>${escapeHtml(workshop.description || "")}</p>
        ${status === "past" ? "" : signup}
      </div>
    </article>
  `;
};

const renderWorkshops = (data) => {
  const all = Array.isArray(data.workshops) ? data.workshops : [];

  workshopTargets.forEach((target) => {
    const mode = target.dataset.workshops;
    const limit = Number(target.dataset.limit || 0);
    const list = mode === "upcoming"
      ? all.filter((workshop) => (workshop.status || "upcoming") !== "past")
      : all;
    const rendered = (limit ? list.slice(0, limit) : list).map(workshopCard);

    target.innerHTML = rendered.length
      ? rendered.join("")
      : `<p class="empty-state">No classes are on the calendar right now. Check back soon, or send a message to ask about the next one.</p>`;
  });
};

const escapeHtml = (value = "") =>
  String(value).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));

const renderLive = (data) => {
  if (!liveTarget) return;
  if (!(data && data.isLive)) {
    liveTarget.hidden = true;
    liveTarget.innerHTML = "";
    return;
  }
  const url = escapeHtml(safeUrl(data.url) || fallbackCatalog.shop.tiktok);
  liveTarget.innerHTML = `
    <a class="live-float-card" href="${url}" target="_blank" rel="noopener" aria-label="Stephanie is live on TikTok right now — watch">
      <span class="live-dot" aria-hidden="true"></span>
      <span class="live-float-text">
        <span class="live-float-tag">Live now</span>
        <span class="live-float-sub">Watch on TikTok</span>
      </span>
    </a>`;
  liveTarget.hidden = false;
};

const getLive = async () => {
  try {
    const r = await fetch("live.json", { cache: "no-store" });
    return r.ok ? r.json() : { isLive: false };
  } catch {
    return { isLive: false };
  }
};

const getWorkshops = async () => {
  try {
    const response = await fetch("workshops.json", { cache: "no-store" });
    if (!response.ok) {
      return { workshops: [] };
    }
    return response.json();
  } catch {
    return { workshops: [] };
  }
};

/* ---- Cart UI: header button + slide-out drawer + cart page -------------- */
let catalogCache = fallbackCatalog;

const cartRowHtml = (line) => {
  const p = line.product;
  const img = escapeHtml(safeUrl((Array.isArray(p.gallery) && p.gallery[0]) || p.image || "") || "assets/logo-moth.svg");
  const name = escapeHtml(p.name || "");
  return `
    <div class="cart-row" data-cart-row>
      <img class="cart-row-img" src="${img}" alt="" />
      <div class="cart-row-main">
        <p class="cart-row-name">${name}</p>
        <p class="cart-row-price">${formatCents(line.unitCents)} each</p>
        <div class="cart-qty" role="group" aria-label="Quantity for ${name}">
          <button type="button" class="cart-qty-btn" data-cart-dec="${escapeHtml(line.id)}" aria-label="Decrease quantity">&minus;</button>
          <span class="cart-qty-num" aria-live="polite">${line.qty}</span>
          <button type="button" class="cart-qty-btn" data-cart-inc="${escapeHtml(line.id)}" aria-label="Increase quantity">+</button>
        </div>
      </div>
      <div class="cart-row-end">
        <span class="cart-row-total">${formatCents(line.lineCents)}</span>
        <button type="button" class="cart-row-remove" data-cart-remove="${escapeHtml(line.id)}" aria-label="Remove ${name}">Remove</button>
      </div>
    </div>`;
};

const renderCartDrawer = () => {
  const body = document.querySelector("[data-cart-body]");
  const foot = document.querySelector("[data-cart-foot]");
  if (!body || !foot) return;
  const lines = cartLines(catalogCache);
  if (!lines.length) {
    body.innerHTML = `<p class="cart-empty">Your cart is empty.</p>`;
    foot.innerHTML = `<a class="button button-secondary" href="treasures.html" data-cart-close>Shop the bundles</a>`;
    return;
  }
  body.innerHTML = lines.map(cartRowHtml).join("");
  foot.innerHTML = `
    <div class="cart-subtotal"><span>Subtotal</span><strong>${formatCents(cartTotalCents(catalogCache))}</strong></div>
    <p class="cart-foot-note">Free shipping included &middot; card, Klarna &amp; Affirm at checkout</p>
    <a class="button button-primary" href="cart.html">Checkout</a>
    <button type="button" class="text-link cart-keep" data-cart-close>Keep shopping</button>`;
};

const updateCartUi = () => {
  const count = cartCount();
  document.querySelectorAll("[data-cart-badge]").forEach((badge) => {
    badge.textContent = String(count);
    badge.hidden = count === 0;
  });
  if (document.querySelector("[data-cart-drawer]")) renderCartDrawer();
  if (document.querySelector("[data-cart-review]")) renderCartPage();
};

const openCart = () => {
  const drawer = document.querySelector("[data-cart-drawer]");
  const overlay = document.querySelector("[data-cart-overlay]");
  if (!drawer || !overlay) return;
  renderCartDrawer();
  overlay.hidden = false;
  drawer.hidden = false;
  drawer.setAttribute("aria-hidden", "false");
  document.body.classList.add("cart-open");
  const close = drawer.querySelector("[data-cart-close]");
  if (close && close.focus) close.focus();
};

const closeCart = () => {
  const drawer = document.querySelector("[data-cart-drawer]");
  const overlay = document.querySelector("[data-cart-overlay]");
  if (drawer) {
    drawer.hidden = true;
    drawer.setAttribute("aria-hidden", "true");
  }
  if (overlay) overlay.hidden = true;
  document.body.classList.remove("cart-open");
};

const initCartUi = () => {
  const header = document.querySelector(".header-inner");
  if (header && !header.querySelector(".cart-button")) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cart-button";
    button.setAttribute("data-cart-open", "");
    button.setAttribute("aria-label", "Open cart");
    button.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" d="M6 8h12l-1 11H7L6 8Zm3 0V6a3 3 0 0 1 6 0v2"/></svg><span class="cart-badge" data-cart-badge hidden>0</span>`;
    const toggle = header.querySelector(".nav-toggle");
    header.insertBefore(button, toggle || null);
  }

  if (!document.querySelector("[data-cart-drawer]")) {
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="cart-overlay" data-cart-overlay hidden></div>
      <aside class="cart-drawer" data-cart-drawer hidden aria-label="Your cart" aria-hidden="true">
        <div class="cart-drawer-head">
          <h2>Your cart</h2>
          <button type="button" class="cart-close" data-cart-close aria-label="Close cart">&times;</button>
        </div>
        <div class="cart-drawer-body" data-cart-body></div>
        <div class="cart-drawer-foot" data-cart-foot></div>
      </aside>`;
    while (wrap.firstElementChild) document.body.appendChild(wrap.firstElementChild);
  }

  document.addEventListener("click", (event) => {
    const add = event.target.closest("[data-add-to-cart]");
    if (add) {
      addToCart(add.getAttribute("data-add-to-cart"));
      openCart();
      return;
    }
    if (event.target.closest("[data-cart-open]")) {
      openCart();
      return;
    }
    if (event.target.closest("[data-cart-close]") || event.target.matches("[data-cart-overlay]")) {
      closeCart();
      return;
    }
    const inc = event.target.closest("[data-cart-inc]");
    if (inc) {
      const id = inc.getAttribute("data-cart-inc");
      const entry = getCart().find((e) => e.id === id);
      setCartQty(id, (entry ? entry.qty : 0) + 1);
      return;
    }
    const dec = event.target.closest("[data-cart-dec]");
    if (dec) {
      const id = dec.getAttribute("data-cart-dec");
      const entry = getCart().find((e) => e.id === id);
      setCartQty(id, (entry ? entry.qty : 0) - 1);
      return;
    }
    const remove = event.target.closest("[data-cart-remove]");
    if (remove) {
      setCartQty(remove.getAttribute("data-cart-remove"), 0);
      return;
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeCart();
  });

  updateCartUi();
};

/* ---- Cart checkout page (cart.html) ------------------------------------- */
const renderCartPage = () => {
  const target = document.querySelector("[data-cart-review]");
  if (!target) return;
  const shop = { ...fallbackCatalog.shop, ...(catalogCache.shop || {}) };
  const lines = cartLines(catalogCache);

  if (!lines.length) {
    target.innerHTML = `
      <article class="checkout-card">
        <p class="eyebrow">Your cart is empty</p>
        <h2>Add a bundle or two, then come back to check out.</h2>
        <div class="payment-actions">
          <a class="button button-primary" href="treasures.html">Shop the bundles</a>
        </div>
      </article>`;
    return;
  }

  const totalCents = cartTotalCents(catalogCache);
  const rows = lines
    .map(
      (line) =>
        `<div class="cart-review-row"><span>${line.qty} &times; ${escapeHtml(line.product.name)}</span><span>${formatCents(line.lineCents)}</span></div>`
    )
    .join("");

  target.innerHTML = `
    <article class="checkout-card checkout-detail">
      <a class="text-link checkout-back" href="treasures.html">&larr; Keep shopping</a>
      <div class="cart-review">
        <h2>Order summary</h2>
        ${rows}
        <div class="cart-review-row cart-review-total"><span>Total</span><strong>${formatCents(totalCents)}</strong></div>
        <p class="cart-foot-note">Free shipping included on every bundle.</p>
      </div>
      <div class="contact-form bundle-questions" data-bundle-questions>
        <div class="full-field bq-head">
          <p class="eyebrow">One quick step</p>
          <h3 class="form-title">Help Stephanie hand-pick your pulls</h3>
          <p class="bundle-lock-note">Answer these four questions for this order &mdash; then payment unlocks.</p>
        </div>
        <p class="bundle-q-error full-field" role="alert" hidden>Please answer all four questions to unlock payment.</p>
        <label for="q-color">Favorite color
          <input id="q-color" type="text" autocomplete="off" placeholder="Sage green, dusty peach, etc." required />
        </label>
        <label for="q-theme">Theme or vibe
          <input id="q-theme" type="text" autocomplete="off" placeholder="Cottagecore, vintage botanical, dark academia..." required />
        </label>
        <label for="q-reader">Do you read?
          <select id="q-reader" required>
            <option value="">Choose one</option>
            <option>Yes, I love books</option>
            <option>Sometimes</option>
            <option>Not really</option>
          </select>
        </label>
        <label for="q-sarcasm">Are you sarcastic?
          <select id="q-sarcasm" required>
            <option value="">Choose one</option>
            <option>Very sarcastic / snarky</option>
            <option>A little</option>
            <option>Not at all, keep it sweet</option>
          </select>
        </label>
        <button type="button" class="button button-primary full-field" data-cart-pay>Pay securely &mdash; card, Klarna, or Affirm</button>
        <p class="cart-pay-status full-field" role="status" aria-live="polite"></p>
      </div>
      <div class="payment-panel">
        <p class="eyebrow">Prefer Cash App or Venmo?</p>
        <h3>Pay the total above, then add "bundle order" in the note.</h3>
        <div class="payment-actions">
          <a class="button button-secondary" href="${escapeHtml(safeUrl(shop.cashApp))}" target="_blank" rel="noopener">Pay with Cash App</a>
          <a class="button button-secondary" href="${escapeHtml(safeUrl(shop.venmo))}" target="_blank" rel="noopener">Pay with Venmo</a>
        </div>
        <p class="checkout-note">If you pay by Cash App or Venmo, send your answers and shipping address through the <a class="text-link" href="contact.html">contact form</a>.</p>
      </div>
    </article>`;

  wireCartPay(target, shop);
};

const wireCartPay = (root, shop) => {
  const card = root.querySelector("[data-bundle-questions]");
  const button = root.querySelector("[data-cart-pay]");
  const errorEl = root.querySelector(".bundle-q-error");
  const status = root.querySelector(".cart-pay-status");
  if (!card || !button) return;

  button.addEventListener("click", async () => {
    const fields = ["#q-color", "#q-theme", "#q-reader", "#q-sarcasm"];
    const values = fields.map((sel) => ({ el: card.querySelector(sel), value: (card.querySelector(sel)?.value || "").trim() }));
    const firstEmpty = values.find((v) => !v.value);
    if (firstEmpty) {
      if (errorEl) {
        errorEl.hidden = false;
        errorEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
      firstEmpty.el?.focus();
      return;
    }
    if (errorEl) errorEl.hidden = true;

    const items = getCart();
    if (!items.length) {
      if (status) status.textContent = "Your cart is empty.";
      return;
    }

    button.disabled = true;
    if (status) status.textContent = "Taking you to secure checkout…";

    const answers = {
      favorite_color: values[0].value,
      theme: values[1].value,
      reads: values[2].value,
      sarcastic: values[3].value,
    };

    try {
      const response = await fetch(CHECKOUT_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items, answers }),
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data && data.url) {
        window.location.href = data.url;
        return;
      }
      throw new Error((data && data.error) || "Checkout is not available yet.");
    } catch (err) {
      button.disabled = false;
      if (status) {
        status.textContent =
          "Card checkout is being set up. For now, please use Cash App or Venmo below, or send your order through the contact form.";
      }
    }
  });
};

getCatalog().then((catalog) => {
  catalogCache = catalog;
  renderProducts(catalog);
  renderBundleTiers(catalog);
  renderPromo(catalog);
  renderCheckout(catalog);
  populateContactItems(catalog);
  toggleBlindBagFields();
  initCartUi();
});

if (workshopTargets.length) {
  getWorkshops().then(renderWorkshops);
}

if (liveTarget) {
  getLive().then(renderLive);
}

if (itemSelect) {
  itemSelect.addEventListener("change", toggleBlindBagFields);
}

/* Lively scroll-in reveal for page sections.
   Scroll-driven (works everywhere; if a section is below the fold it waits,
   and anything on screen shows immediately so content is never stuck hidden). */
(() => {
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const sections = [...document.querySelectorAll("main > section")];
  if (!sections.length) return;

  const triggerLine = () => window.innerHeight * 0.88;

  // Hide only the sections that start below the fold; reveal the rest now.
  sections.forEach((section) => {
    if (section.getBoundingClientRect().top >= triggerLine()) {
      section.classList.add("reveal");
    } else {
      section.classList.add("is-visible");
    }
  });

  let ticking = false;
  const reveal = () => {
    ticking = false;
    const line = triggerLine();
    sections.forEach((section) => {
      if (!section.classList.contains("is-visible") && section.getBoundingClientRect().top < line) {
        section.classList.add("is-visible");
      }
    });
  };
  const onScroll = () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(reveal);
    }
  };

  // Reveal on any way the visitor might move down the page (belt and suspenders).
  ["scroll", "resize", "wheel", "touchmove", "keydown"].forEach((evt) =>
    window.addEventListener(evt, onScroll, { passive: true })
  );
  reveal();
})();

/* Mobile menu toggle */
(() => {
  const toggle = document.querySelector(".nav-toggle");
  const nav = document.querySelector("#primary-nav");
  if (!toggle || !nav) return;
  toggle.addEventListener("click", () => {
    const open = nav.classList.toggle("is-open");
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
  });
  nav.addEventListener("click", (event) => {
    if (event.target.closest("a")) {
      nav.classList.remove("is-open");
      toggle.setAttribute("aria-expanded", "false");
    }
  });
})();

if (contactForm && formStatus) {
  contactForm.addEventListener("submit", () => {
    formStatus.textContent = "Sending your order inquiry...";
  });
}
