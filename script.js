const contactForm = document.querySelector(".contact-form");
const formStatus = document.querySelector(".form-status");
const itemSelect = document.querySelector("#item");
const messageField = document.querySelector("#message");
const productTargets = document.querySelectorAll("[data-products]");
const checkoutTarget = document.querySelector("[data-checkout]");

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

const productInquiryUrl = (product) => `contact.html?item=${encodeURIComponent(product.id)}`;
const productCheckoutUrl = (product) => `checkout.html?item=${encodeURIComponent(product.id)}`;
const isFixedPrice = (price = "") => price.trim().startsWith("$");
const productLabel = (product) => `${product.name} - ${product.price}`;

const productCard = (product, mode = "grid") => {
  const fixedPrice = isFixedPrice(product.price || "");
  const canBuyNow = product.available && fixedPrice;
  const availability = canBuyNow ? "Ready for buy now" : "Ask before purchase";
  const detail = mode === "list" ? `<p class="product-detail">${product.details || ""}</p>` : "";

  return `
    <article class="product-card" id="${product.id}">
      <a class="product-photo" href="${canBuyNow ? productCheckoutUrl(product) : productInquiryUrl(product)}">
        <img src="${product.image}" alt="${product.alt || product.name}" loading="lazy" />
      </a>
      <div class="product-body">
        <div class="product-topline">
          <span>${product.category || "Handmade"}</span>
          <strong>${product.price || "Message"}</strong>
        </div>
        <h3>${product.name}</h3>
        <p>${product.summary || ""}</p>
        ${detail}
        <div class="product-meta-line">${availability}</div>
        <div class="buy-links">
          ${
            canBuyNow
              ? `<a class="buy-now-link" href="${productCheckoutUrl(product)}">Buy now</a>`
              : `<a class="buy-now-link" href="${productInquiryUrl(product)}">Start request</a>`
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
    const list = mode === "featured" ? products.filter((product) => product.featured) : products;
    const rendered = (limit ? list.slice(0, limit) : list).map((product) => {
      return productCard(product, mode === "all" ? "list" : "grid");
    });

    target.innerHTML = rendered.length
      ? rendered.join("")
      : `<p class="empty-state">No products are listed yet.</p>`;
  });
};

const renderCheckout = (catalog) => {
  if (!checkoutTarget) {
    return;
  }

  const products = Array.isArray(catalog.products) ? catalog.products : [];
  const shop = { ...fallbackCatalog.shop, ...(catalog.shop || {}) };
  const params = new URLSearchParams(window.location.search);
  const itemId = params.get("item");
  const product = products.find((entry) => entry.id === itemId);

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
  const note = `Payment note: ${productLabel(product)}`;

  checkoutTarget.innerHTML = `
    <article class="checkout-card checkout-detail">
      <div class="checkout-product">
        <img src="${product.image}" alt="${product.alt || product.name}" />
        <div>
          <p class="eyebrow">${product.category || "Handmade"}</p>
          <h2>${product.name}</h2>
          <p>${product.summary || ""}</p>
          <strong class="checkout-price">${product.price || "Message for price"}</strong>
        </div>
      </div>
      ${
        fixedPrice
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
              <p class="eyebrow">Custom price</p>
              <h3>This item needs a quick message before payment.</h3>
              <p>Custom pieces depend on color, size, materials, and timing, so the final total should be confirmed first.</p>
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
      return `<option value="${label}" data-product-id="${product.id}">${label}</option>`;
    }),
    `<option value="Not sure yet">Not sure yet</option>`,
  ];

  itemSelect.innerHTML = options.join("");

  const params = new URLSearchParams(window.location.search);
  const itemId = params.get("item");
  const selectedProduct = products.find((product) => product.id === itemId);

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

getCatalog().then((catalog) => {
  renderProducts(catalog);
  renderCheckout(catalog);
  populateContactItems(catalog);
});

if (contactForm && formStatus) {
  contactForm.addEventListener("submit", () => {
    formStatus.textContent = "Sending your order inquiry...";
  });
}
