// Owner tools for Epic Little Treasures.
// Loads the live products.json + workshops.json, lets the owner edit them,
// then exports updated JSON files to download and drop back into the site.

const esc = (value = "") =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
const attr = (value = "") => esc(value).replace(/"/g, "&quot;");
const slug = (value = "") =>
  String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 50) || "item";

const PRODUCT_STATUS = [
  ["available", "Available"],
  ["sold-out", "Sold out"],
  ["custom-order", "Custom order"],
];
const WORKSHOP_STATUS = [
  ["upcoming", "Upcoming"],
  ["past", "Past"],
];

const state = {
  shop: {},
  products: [],
  workshops: [],
};

const $ = (sel) => document.querySelector(sel);
const productEditor = $("#product-editor");
const shopEditor = $("#shop-editor");
const workshopEditor = $("#workshop-editor");

const selectOptions = (pairs, current) =>
  pairs
    .map(([value, label]) => `<option value="${value}"${current === value ? " selected" : ""}>${label}</option>`)
    .join("");

/* ---------- render ---------- */

function renderShop() {
  const s = state.shop;
  const field = (key, label) => `<label>${label}<input data-shop="${key}" value="${attr(s[key])}" /></label>`;
  shopEditor.innerHTML = `
    <div class="manager-card" id="shop-card">
      <div class="manager-card-head">
        <h2>Shop details</h2>
        <span class="manager-note">used in the footer + checkout</span>
      </div>
      <div class="manager-field-grid">
        ${field("name", "Shop name")}
        ${field("email", "Email")}
        ${field("phone", "Phone (shown)")}
        ${field("phoneHref", "Phone link (+17173194692)")}
        ${field("facebook", "Facebook URL")}
        ${field("tiktok", "TikTok URL")}
        ${field("etsy", "Etsy URL")}
        ${field("cashApp", "Cash App link")}
        ${field("venmo", "Venmo link")}
      </div>
    </div>`;
}

function productCard(product, index) {
  return `
    <div class="manager-card" data-index="${index}" data-id="${attr(product.id)}">
      <div class="manager-card-head">
        <h2>${esc(product.name) || "New product"}</h2>
        <button class="text-button" data-remove="product" type="button">Remove</button>
      </div>
      <div class="manager-field-grid">
        <label>Name<input data-field="name" value="${attr(product.name)}" /></label>
        <label>Category<input data-field="category" value="${attr(product.category)}" /></label>
        <label>Price (e.g. $35 or From $45)<input data-field="price" value="${attr(product.price)}" /></label>
        <label>Photo path (assets/...)<input data-field="image" value="${attr(product.image)}" /></label>
        <label>Photo alt text<input data-field="alt" value="${attr(product.alt)}" /></label>
        <label>Status<select data-field="status">${selectOptions(PRODUCT_STATUS, product.status || "available")}</select></label>
      </div>
      <label>Short summary<textarea data-field="summary" rows="2">${esc(product.summary)}</textarea></label>
      <label>Details<textarea data-field="details" rows="2">${esc(product.details)}</textarea></label>
      <div class="manager-checks">
        <label><input type="checkbox" data-field="featured"${product.featured ? " checked" : ""} /> Show on home page</label>
      </div>
    </div>`;
}

function workshopCard(workshop, index) {
  return `
    <div class="manager-card" data-index="${index}" data-id="${attr(workshop.id)}">
      <div class="manager-card-head">
        <h2>${esc(workshop.title) || "New workshop"}</h2>
        <button class="text-button" data-remove="workshop" type="button">Remove</button>
      </div>
      <div class="manager-field-grid">
        <label>Title<input data-field="title" value="${attr(workshop.title)}" /></label>
        <label>Date<input type="date" data-field="date" value="${attr(workshop.date)}" /></label>
        <label>Time (e.g. 2:00 PM ET)<input data-field="time" value="${attr(workshop.time)}" /></label>
        <label>Location<input data-field="location" value="${attr(workshop.location)}" /></label>
        <label>Format (Online / In studio)<input data-field="format" value="${attr(workshop.format)}" /></label>
        <label>Sign-up link<input data-field="signupUrl" value="${attr(workshop.signupUrl)}" /></label>
        <label>Status<select data-field="status">${selectOptions(WORKSHOP_STATUS, workshop.status || "upcoming")}</select></label>
      </div>
      <label>Description<textarea data-field="description" rows="3">${esc(workshop.description)}</textarea></label>
    </div>`;
}

const renderProducts = () => {
  productEditor.innerHTML = state.products.map(productCard).join("") || `<p class="empty-state">No products yet. Click “Add product”.</p>`;
};
const renderWorkshops = () => {
  workshopEditor.innerHTML = state.workshops.map(workshopCard).join("") || `<p class="empty-state">No workshops yet. Click “Add workshop”.</p>`;
};

/* ---------- collect from DOM ---------- */

function collectShop() {
  const shop = { ...state.shop };
  shopEditor.querySelectorAll("[data-shop]").forEach((el) => {
    shop[el.dataset.shop] = el.value.trim();
  });
  return shop;
}

function readCard(card, fields) {
  const out = {};
  fields.forEach((field) => {
    const el = card.querySelector(`[data-field="${field}"]`);
    if (!el) return;
    out[field] = el.type === "checkbox" ? el.checked : el.value.trim();
  });
  return out;
}

function collectProducts() {
  return [...productEditor.querySelectorAll(".manager-card")].map((card) => {
    const f = readCard(card, ["name", "category", "price", "image", "alt", "status", "summary", "details", "featured"]);
    const id = card.dataset.id || slug(f.name);
    return {
      id,
      name: f.name,
      category: f.category,
      price: f.price,
      image: f.image,
      alt: f.alt,
      summary: f.summary,
      details: f.details,
      featured: Boolean(f.featured),
      available: f.status !== "sold-out",
      status: f.status,
    };
  });
}

function collectWorkshops() {
  return [...workshopEditor.querySelectorAll(".manager-card")].map((card) => {
    const f = readCard(card, ["title", "date", "time", "location", "format", "signupUrl", "status", "description"]);
    return {
      id: card.dataset.id || slug(f.title),
      title: f.title,
      date: f.date,
      time: f.time,
      location: f.location,
      format: f.format,
      description: f.description,
      signupUrl: f.signupUrl,
      status: f.status || "upcoming",
    };
  });
}

/* ---------- output ---------- */

function showOutput(outputId, textareaId, anchorId, filename, payload) {
  const text = JSON.stringify(payload, null, 2) + "\n";
  $(`#${textareaId}`).value = text;
  const anchor = $(`#${anchorId}`);
  if (anchor.dataset.url) URL.revokeObjectURL(anchor.dataset.url);
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  anchor.href = url;
  anchor.download = filename;
  anchor.dataset.url = url;
  $(`#${outputId}`).hidden = false;
}

/* ---------- events ---------- */

document.querySelectorAll(".manager-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    const target = tab.dataset.tab;
    document.querySelectorAll(".manager-tab").forEach((t) => t.classList.toggle("is-active", t === tab));
    $("#panel-products").hidden = target !== "products";
    $("#panel-workshops").hidden = target !== "workshops";
  });
});

$("#add-product").addEventListener("click", () => {
  state.shop = collectShop();
  state.products = collectProducts();
  state.products.push({ name: "", category: "", price: "", image: "assets/shop-hero.png", alt: "", summary: "", details: "", featured: false, status: "available" });
  renderProducts();
  productEditor.lastElementChild?.scrollIntoView({ behavior: "smooth", block: "center" });
});

$("#add-workshop").addEventListener("click", () => {
  state.workshops = collectWorkshops();
  state.workshops.push({ title: "", date: "", time: "", location: "", format: "Online", description: "", signupUrl: "contact.html?item=workshop", status: "upcoming" });
  renderWorkshops();
  workshopEditor.lastElementChild?.scrollIntoView({ behavior: "smooth", block: "center" });
});

productEditor.addEventListener("click", (event) => {
  if (event.target.dataset.remove !== "product") return;
  const card = event.target.closest(".manager-card");
  const index = Number(card.dataset.index);
  state.shop = collectShop();
  state.products = collectProducts().filter((_, i) => i !== index);
  renderProducts();
});

workshopEditor.addEventListener("click", (event) => {
  if (event.target.dataset.remove !== "workshop") return;
  const card = event.target.closest(".manager-card");
  const index = Number(card.dataset.index);
  state.workshops = collectWorkshops().filter((_, i) => i !== index);
  renderWorkshops();
});

$("#gen-products").addEventListener("click", () => {
  showOutput("products-output", "products-json", "dl-products", "products.json", {
    shop: collectShop(),
    products: collectProducts(),
  });
  $("#products-output").scrollIntoView({ behavior: "smooth", block: "start" });
});

$("#gen-workshops").addEventListener("click", () => {
  showOutput("workshops-output", "workshops-json", "dl-workshops", "workshops.json", {
    workshops: collectWorkshops(),
  });
  $("#workshops-output").scrollIntoView({ behavior: "smooth", block: "start" });
});

const wireCopy = (buttonId, textareaId) => {
  $(`#${buttonId}`).addEventListener("click", async (event) => {
    const text = $(`#${textareaId}`).value;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      $(`#${textareaId}`).select();
      document.execCommand("copy");
    }
    const button = event.currentTarget;
    const original = button.textContent;
    button.textContent = "Copied!";
    setTimeout(() => (button.textContent = original), 1500);
  });
};
wireCopy("copy-products", "products-json");
wireCopy("copy-workshops", "workshops-json");

/* ---------- load ---------- */

async function loadJSON(path, fallback) {
  try {
    const response = await fetch(path, { cache: "no-store" });
    if (!response.ok) return fallback;
    return await response.json();
  } catch {
    return fallback;
  }
}

(async function init() {
  const catalog = await loadJSON("products.json", { shop: {}, products: [] });
  const workshopData = await loadJSON("workshops.json", { workshops: [] });
  state.shop = catalog.shop || {};
  state.products = Array.isArray(catalog.products) ? catalog.products : [];
  state.workshops = Array.isArray(workshopData.workshops) ? workshopData.workshops : [];
  renderShop();
  renderProducts();
  renderWorkshops();
})();
