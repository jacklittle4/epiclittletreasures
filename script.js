const contactForm = document.querySelector(".contact-form");
const formStatus = document.querySelector(".form-status");
const itemSelect = document.querySelector("#item");
const messageField = document.querySelector("#message");
const productTargets = document.querySelectorAll("[data-products]");
const checkoutTarget = document.querySelector("[data-checkout]");
const workshopTargets = document.querySelectorAll("[data-workshops]");
const bundleTiersTarget = document.querySelector("[data-bundle-tiers]");

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
const productLabel = (product) => `${product.name} - ${product.price}`;
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
  const gallery = Array.isArray(product.gallery) ? product.gallery : [];
  const image = gallery[0] || product.image;
  const galleryPreview = gallery.length > 1
    ? `<div class="product-gallery" aria-label="More photos">${gallery.slice(1, 4).map((photo) => `<img src="${photo}" alt="${product.alt || product.name}" loading="lazy" />`).join("")}</div>`
    : "";
  const detail = mode === "list" ? `<p class="product-detail">${product.details || ""}</p>${galleryPreview}` : "";
  const priceTag = product.price ? `<span class="price-tag">${product.price}</span>` : "";

  return `
    <article class="product-card" id="${product.id}">
      <a class="product-photo" href="${canBuyNow ? productCheckoutUrl(product) : productInquiryUrl(product)}">
        <img src="${image}" alt="${product.alt || product.name}" loading="lazy" />
        <span class="status-badge status-${status}">${statusLabels[status] || "Ask first"}</span>
        ${priceTag}
      </a>
      <div class="product-body">
        <div class="product-topline">
          <span>${product.category || "Handmade"}</span>
        </div>
        <h3>${product.name}</h3>
        <p>${product.summary || ""}</p>
        ${detail}
        <div class="product-meta-line">${availability}</div>
        <div class="buy-links">
          ${
            canBuyNow
              ? `<a class="buy-now-link" href="${productCheckoutUrl(product)}">Buy now</a>`
              : `<a class="buy-now-link" href="${productInquiryUrl(product)}">${status === "sold-out" ? "Ask next batch" : "Start request"}</a>`
          }
          <a href="${productInquiryUrl(product)}">Ask a question</a>
          <a href="${fallbackCatalog.shop.tiktok}">Watch on TikTok</a>
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
      ? products.filter((product) => product.featured && normalizeStatus(product) === "available")
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
    .map((product) => `<article><span>${bundleTierLabel(product)}</span><strong>${product.price || ""}</strong></article>`)
    .join("");
  const note = bundleTiersTarget.querySelector(".bundle-note");
  if (note) {
    note.insertAdjacentHTML("beforebegin", tiles);
  } else {
    bundleTiersTarget.insertAdjacentHTML("afterbegin", tiles);
  }
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
  const note = `Payment note: ${productLabel(product)}`;

  checkoutTarget.innerHTML = `
    <article class="checkout-card checkout-detail">
      <div class="checkout-product">
        <img src="${(Array.isArray(product.gallery) && product.gallery[0]) || product.image}" alt="${product.alt || product.name}" />
        <div>
          <p class="eyebrow">${product.category || "Handmade"}</p>
          <h2>${product.name}</h2>
          <p>${product.summary || ""}</p>
          <strong class="checkout-price">${product.price || "Message for price"}</strong>
        </div>
      </div>
      ${
        fixedPrice && status === "available"
          ? `
            <div class="payment-panel">
              <p class="eyebrow">Pay now</p>
              <h3>Use Cash App or Venmo, then include the item name in the note.</h3>
              <div class="payment-actions">
                <a class="button button-primary" href="${shop.cashApp}" target="_blank" rel="noopener">Pay with Cash App</a>
                <a class="button button-secondary" href="${shop.venmo}" target="_blank" rel="noopener">Pay with Venmo</a>
              </div>
              <p class="checkout-note">${note}</p>
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
          `
      }
      <ol class="checkout-steps">
        <li><strong>1. Pay the listed amount.</strong> Open Cash App or Venmo in a new tab.</li>
        <li><strong>2. Add the product name.</strong> Put "${product.name}" in the payment note.</li>
        <li><strong>3. Send shipping details.</strong> Use the contact page if the owner needs an address or follow-up details.</li>
      </ol>
      <p class="checkout-disclaimer">
        Handmade and live-sale pieces can move quickly. If a one-of-a-kind item was already claimed,
        Stephanie can follow up with a refund, swap, or custom option.
      </p>
      <form class="contact-form checkout-followup" action="https://formsubmit.co/${shop.email}" method="POST">
        <input type="hidden" name="_subject" value="Epic Little Treasures checkout follow-up" />
        <input type="hidden" name="_template" value="table" />
        <input type="hidden" name="_captcha" value="false" />
        <input type="hidden" name="_next" value="https://www.epiclittletreasures.com/thank-you.html" />
        <input type="hidden" name="item" value="${productLabel(product)}" />
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
      const label = productLabel(product);
      return `<option value="${label}" data-product-id="${productKey(product)}">${label}</option>`;
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
    .map((entry) => `<span>${entry}</span>`)
    .join("");
  const signup = workshop.signupUrl
    ? `<a class="button button-primary" href="${workshop.signupUrl}">Save my spot</a>`
    : "";

  return `
    <article class="workshop-card${status === "past" ? " is-past" : ""}">
      ${badge}
      <div class="workshop-body">
        <span class="workshop-tag">${status === "past" ? "Past session" : "Upcoming class"}</span>
        <h3>${workshop.title || "Teaching session"}</h3>
        <div class="workshop-meta">${meta}</div>
        <p>${workshop.description || ""}</p>
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

getCatalog().then((catalog) => {
  renderProducts(catalog);
  renderBundleTiers(catalog);
  renderCheckout(catalog);
  populateContactItems(catalog);
});

if (workshopTargets.length) {
  getWorkshops().then(renderWorkshops);
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
