const contactForm = document.querySelector(".contact-form");
const formStatus = document.querySelector(".form-status");
const itemSelect = document.querySelector("#item");
const messageField = document.querySelector("#message");
const productTargets = document.querySelectorAll("[data-products]");

const fallbackCatalog = {
  shop: {
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

const productCard = (product, mode = "grid") => {
  const availability = product.available ? "Available by inquiry" : "Ask about next batch";
  const detail = mode === "list" ? `<p class="product-detail">${product.details || ""}</p>` : "";

  return `
    <article class="product-card" id="${product.id}">
      <a class="product-photo" href="${productInquiryUrl(product)}">
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
          <a href="${productInquiryUrl(product)}">Ask about this</a>
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

const populateContactItems = (catalog) => {
  if (!itemSelect) {
    return;
  }

  const products = Array.isArray(catalog.products) ? catalog.products : [];
  const current = itemSelect.value;
  const options = [
    `<option value="">Choose an item</option>`,
    ...products.map((product) => {
      const label = `${product.name} - ${product.price}`;
      return `<option value="${label}" data-product-id="${product.id}">${label}</option>`;
    }),
    `<option value="Not sure yet">Not sure yet</option>`,
  ];

  itemSelect.innerHTML = options.join("");

  const params = new URLSearchParams(window.location.search);
  const itemId = params.get("item");
  const selectedProduct = products.find((product) => product.id === itemId);

  if (selectedProduct) {
    const selectedValue = `${selectedProduct.name} - ${selectedProduct.price}`;
    itemSelect.value = selectedValue;

    if (messageField && !messageField.value) {
      messageField.value = `I am interested in the ${selectedValue}. Please let me know availability, final price, and pickup or shipping options.`;
    }
    return;
  }

  if (current) {
    itemSelect.value = current;
  }
};

getCatalog().then((catalog) => {
  renderProducts(catalog);
  populateContactItems(catalog);
});

if (contactForm && formStatus) {
  contactForm.addEventListener("submit", () => {
    formStatus.textContent = "Sending your order inquiry...";
  });
}
