/* Epic Little Treasures — bespoke, simple editor.
   Logs in with GitHub (reusing the sveltia-cms-auth worker) and saves changes
   straight to the repo via the GitHub API. Site redeploys automatically. */

const WORKER = "https://sveltia-cms-auth.aphelionsystems-dev.workers.dev";
const REPO = "jacklittle4/epiclittletreasures";
const BRANCH = "main";
const TIKTOK_LIVE = "https://www.tiktok.com/@stephanie.davis015/live";

const state = {
  token: localStorage.getItem("elt_gh_token") || null,
  files: { products: null, workshops: null, live: null },
  editing: null, // { kind: 'product'|'class', index: number|null }
};

/* ---------- tiny helpers ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (v = "") =>
  String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const attr = (v = "") => esc(v);
const slugify = (v = "") => String(v).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

let toastTimer;
function toast(msg, isError) {
  const t = $("#toast");
  t.textContent = msg;
  t.className = "show" + (isError ? " err" : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = ""), isError ? 5000 : 2800);
}

/* ---------- auth ---------- */
function setToken(tok) {
  state.token = tok;
  localStorage.setItem("elt_gh_token", tok);
}
function logout() {
  state.token = null;
  localStorage.removeItem("elt_gh_token");
  location.reload();
}
function authHeaders() {
  return { Authorization: "token " + state.token, Accept: "application/vnd.github+json" };
}

let authWindow;
function startLogin() {
  $("#login-msg").textContent = "Opening GitHub sign-in…";
  const w = 620, h = 720;
  const left = Math.max(0, (screen.width - w) / 2);
  const top = Math.max(0, (screen.height - h) / 2);
  const url = WORKER + "/auth?provider=github&scope=repo&site_id=" + encodeURIComponent(location.host);
  authWindow = window.open(url, "elt-github-auth", `width=${w},height=${h},left=${left},top=${top}`);
  window.addEventListener("message", onAuthMessage);
}
function onAuthMessage(e) {
  if (typeof e.data !== "string") return;
  if (e.data === "authorizing:github") {
    // handshake: tell the popup we're ready to receive the token
    if (authWindow) authWindow.postMessage(e.data, e.origin);
    return;
  }
  const okPrefix = "authorization:github:success:";
  const errPrefix = "authorization:github:error:";
  if (e.data.indexOf(okPrefix) === 0) {
    window.removeEventListener("message", onAuthMessage);
    try {
      const payload = JSON.parse(e.data.slice(okPrefix.length));
      setToken(payload.token);
      if (authWindow) authWindow.close();
      boot();
    } catch (err) {
      $("#login-msg").textContent = "Sign-in failed — please try again.";
    }
  } else if (e.data.indexOf(errPrefix) === 0) {
    window.removeEventListener("message", onAuthMessage);
    if (authWindow) authWindow.close();
    $("#login-msg").textContent = "Sign-in was cancelled or failed.";
  }
}

/* ---------- GitHub API ---------- */
function b64ToUtf8(b64) {
  return decodeURIComponent(escape(atob(b64.replace(/\s/g, ""))));
}
function utf8ToB64(str) {
  return btoa(unescape(encodeURIComponent(str)));
}
async function loadFile(path) {
  const r = await fetch(
    `https://api.github.com/repos/${REPO}/contents/${path}?ref=${BRANCH}&t=${Date.now()}`,
    { headers: authHeaders(), cache: "no-store" }
  );
  if (r.status === 401) { logout(); throw new Error("Signed out — please sign in again."); }
  if (!r.ok) throw new Error("Could not load " + path);
  const j = await r.json();
  return { sha: j.sha, data: JSON.parse(b64ToUtf8(j.content)) };
}
async function saveJson(path, key, message) {
  const file = state.files[key];
  const body = {
    message,
    content: utf8ToB64(JSON.stringify(file.data, null, 2) + "\n"),
    sha: file.sha,
    branch: BRANCH,
  };
  const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  if (r.status === 401) { logout(); throw new Error("Signed out."); }
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(e.message || "Save failed");
  }
  const j = await r.json();
  file.sha = j.content.sha; // keep sha fresh for the next save
}
async function uploadImage(file) {
  const dataUrl = await new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
  const base64 = String(dataUrl).split(",")[1];
  let ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!ext) ext = "jpg";
  const path = "assets/photo-" + Date.now() + "." + ext;
  const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify({ message: "Upload photo via editor", content: base64, branch: BRANCH }),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(e.message || "Photo upload failed");
  }
  return path;
}

/* ---------- rendering ---------- */
const STATUS_LABEL = { available: "Available", "sold-out": "Sold out", "custom-order": "Made to order" };

function render() {
  const products = state.files.products.data.products || [];
  const shop = state.files.products.data.shop || {};
  const classes = state.files.workshops.data.workshops || [];
  const live = state.files.live.data || {};

  $("#editor-view").innerHTML = `
    ${liveCard(live)}
    ${dealCard(shop)}
    ${listCard("product", "🛍️", "Products", "Your shop items. Tap Edit to change one, or Add a new one.", products, productItemHtml)}
    ${listCard("class", "🎀", "Classes", "Your teaching classes. Delete a class once it's over.", classes, classItemHtml)}
    <p style="text-align:center;color:var(--muted);font-size:.9rem;margin-top:30px">
      Changes go live on the website about a minute after you save.
    </p>
  `;
}

function liveCard(live) {
  const on = !!live.isLive;
  return `
    <section class="card" data-section="live">
      <h2>🔴 Live now</h2>
      <p class="sub">Flip this on when you start a TikTok LIVE, and off when you finish.</p>
      <div class="switch-row">
        <span class="switch-label">${on ? "You're live! The banner is showing." : "You're offline."}</span>
        <label class="switch">
          <input type="checkbox" id="live-toggle" ${on ? "checked" : ""} />
          <span class="track"></span>
        </label>
      </div>
    </section>`;
}

function dealCard(shop) {
  const on = !!shop.promoEnabled;
  const text = shop.promoText || "";
  return `
    <section class="card" data-section="deal">
      <h2>🎁 Homepage deal</h2>
      <p class="sub">A little announcement ribbon at the top of the home page.</p>
      <div class="switch-row">
        <span class="switch-label">Show the deal banner</span>
        <label class="switch">
          <input type="checkbox" id="deal-toggle" ${on ? "checked" : ""} />
          <span class="track"></span>
        </label>
      </div>
      <label class="field">
        <span>Deal text</span>
        <input type="text" id="deal-text" value="${attr(text)}" placeholder="5 extra envelopes FREE with every order!" />
      </label>
      <div class="form-actions">
        <button class="btn btn-primary btn-sm" data-action="save-deal">Save deal</button>
      </div>
    </section>`;
}

function listCard(kind, icon, title, sub, items, itemFn) {
  const rows = items.length
    ? items.map((it, i) => itemFn(it, i)).join("")
    : `<p class="empty">Nothing here yet. Tap “Add” to create one.</p>`;
  return `
    <section class="card" data-section="${kind}s">
      <h2>${icon} ${esc(title)}</h2>
      <p class="sub">${esc(sub)}</p>
      <div data-list="${kind}">${rows}</div>
      <div class="form-actions">
        <button class="btn btn-outline btn-block" data-action="add-${kind}">+ Add ${kind === "product" ? "product" : "class"}</button>
      </div>
    </section>`;
}

function productItemHtml(p, i) {
  const status = p.status || "available";
  const thumb = p.image
    ? `<img class="thumb" src="/${esc(p.image)}" alt="" />`
    : `<span class="thumb">🖼️</span>`;
  return `
    <div class="item">
      ${thumb}
      <div class="meta">
        <div class="name">${esc(p.name || "Untitled")}</div>
        <div class="detail">${esc(p.price || "—")} · <span class="pill ${status}">${esc(STATUS_LABEL[status] || status)}</span></div>
      </div>
      <div class="row-actions">
        <button class="btn btn-ghost btn-sm" data-action="edit-product" data-i="${i}">Edit</button>
        <button class="btn btn-danger btn-sm" data-action="del-product" data-i="${i}">Remove</button>
      </div>
    </div>`;
}

function classItemHtml(c, i) {
  return `
    <div class="item">
      <span class="thumb">🗓️</span>
      <div class="meta">
        <div class="name">${esc(c.title || "Untitled class")}</div>
        <div class="detail">${esc(c.date || "no date")}${c.price ? " · " + esc(c.price) : ""}</div>
      </div>
      <div class="row-actions">
        <button class="btn btn-ghost btn-sm" data-action="edit-class" data-i="${i}">Edit</button>
        <button class="btn btn-danger btn-sm" data-action="del-class" data-i="${i}">Remove</button>
      </div>
    </div>`;
}

/* ---------- edit forms ---------- */
function productForm(p) {
  const status = p.status || "available";
  const cat = p.category || "Live bundles";
  const opt = (v, cur, label) => `<option value="${attr(v)}" ${v === cur ? "selected" : ""}>${esc(label)}</option>`;
  return `
    <div class="editform" data-form="product">
      <label class="field"><span>Name</span>
        <input type="text" data-f="name" value="${attr(p.name || "")}" placeholder="e.g. 15-pull bundle" /></label>
      <label class="field"><span>Photo</span>
        <input type="file" accept="image/*" data-f="imagefile" />
        <img class="photo-preview" data-preview src="${p.image ? "/" + attr(p.image) : ""}" alt="" ${p.image ? "" : 'style="display:none"'} />
        <input type="hidden" data-f="image" value="${attr(p.image || "")}" />
      </label>
      <div class="row-2">
        <label class="field"><span>Price</span>
          <input type="text" data-f="price" value="${attr(p.price || "")}" placeholder="$45" /></label>
        <label class="field"><span>Availability</span>
          <select data-f="status">
            ${opt("available", status, "Available")}${opt("sold-out", status, "Sold out")}${opt("custom-order", status, "Made to order")}
          </select></label>
      </div>
      <label class="field"><span>Type</span>
        <select data-f="category">
          ${opt("Live bundles", cat, "Live bundle (shows in the pull-price grid)")}${opt("Custom", cat, "Custom / other")}
        </select></label>
      <label class="field"><span>Short description</span>
        <textarea data-f="summary" placeholder="A sentence or two shown under the name.">${esc(p.summary || "")}</textarea></label>
      <label class="field"><span>Buy link — card / Klarna / Affirm <span class="hint">(optional, from Stripe)</span></span>
        <input type="text" data-f="payLink" value="${attr(p.payLink || "")}" placeholder="https://buy.stripe.com/..." /></label>
      <div class="form-actions">
        <button class="btn btn-primary" data-action="save-product">Save product</button>
        <button class="btn btn-ghost" data-action="cancel-edit">Cancel</button>
        <span class="saving" data-saving hidden>Saving…</span>
      </div>
    </div>`;
}

function classForm(c) {
  return `
    <div class="editform" data-form="class">
      <label class="field"><span>Class name</span>
        <input type="text" data-f="title" value="${attr(c.title || "")}" placeholder="e.g. Paper Bag Junk Journal" /></label>
      <div class="row-2">
        <label class="field"><span>Date</span>
          <input type="date" data-f="date" value="${attr(c.date || "")}" /></label>
        <label class="field"><span>Time</span>
          <input type="text" data-f="time" value="${attr(c.time || "")}" placeholder="6 PM ET" /></label>
      </div>
      <div class="row-2">
        <label class="field"><span>Price</span>
          <input type="text" data-f="price" value="${attr(c.price || "")}" placeholder="$50" /></label>
        <label class="field"><span>Where</span>
          <input type="text" data-f="location" value="${attr(c.location || "Live on TikTok @stephanie.davis015")}" /></label>
      </div>
      <label class="field"><span>Details / what to bring</span>
        <textarea data-f="description" placeholder="Describe the class and list any supplies.">${esc(c.description || "")}</textarea></label>
      <div class="form-actions">
        <button class="btn btn-primary" data-action="save-class">Save class</button>
        <button class="btn btn-ghost" data-action="cancel-edit">Cancel</button>
        <span class="saving" data-saving hidden>Saving…</span>
      </div>
    </div>`;
}

function openForm(kind, index) {
  state.editing = { kind, index };
  const isProduct = kind === "product";
  const list = isProduct ? state.files.products.data.products : state.files.workshops.data.workshops;
  const existing = index === null ? {} : list[index] || {};
  const formHtml = isProduct ? productForm(existing) : classForm(existing);
  const listEl = $(`[data-list="${kind}"]`);
  // replace the whole list area with the form for focus
  listEl.insertAdjacentHTML("beforebegin", `<div data-formwrap>${formHtml}</div>`);
  const wrap = $("[data-formwrap]");
  listEl.style.display = "none";
  wrap.scrollIntoView({ behavior: "smooth", block: "nearest" });
  const fileInput = $('[data-f="imagefile"]', wrap);
  if (fileInput) fileInput.addEventListener("change", onPhotoPick);
}
function closeForm() {
  state.editing = null;
  const wrap = $("[data-formwrap]");
  if (wrap) wrap.remove();
  render();
  wireSectionEvents();
}

async function onPhotoPick(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const wrap = $("[data-formwrap]");
  const preview = $("[data-preview]", wrap);
  toast("Uploading photo…");
  try {
    const path = await uploadImage(file);
    $('[data-f="image"]', wrap).value = path;
    preview.src = "/" + path;
    preview.style.display = "";
    toast("Photo added");
  } catch (err) {
    toast(err.message || "Photo upload failed", true);
  }
}

function readForm(wrap) {
  const out = {};
  wrap.querySelectorAll("[data-f]").forEach((el) => {
    if (el.dataset.f === "imagefile") return;
    out[el.dataset.f] = el.value.trim();
  });
  return out;
}

/* ---------- actions ---------- */
async function saveProduct() {
  const wrap = $("[data-formwrap]");
  const vals = readForm(wrap);
  if (!vals.name) return toast("Please enter a name.", true);
  if (!vals.price) return toast("Please enter a price.", true);
  const { kind, index } = state.editing;
  const list = state.files.products.data.products;
  const base = index === null ? {} : { ...list[index] };
  const updated = { ...base, name: vals.name, image: vals.image || "", price: vals.price, status: vals.status, category: vals.category, summary: vals.summary, payLink: vals.payLink || "" };
  if (!updated.id) updated.id = slugify(vals.name) || "item-" + Date.now();
  if (index === null) list.push(updated);
  else list[index] = updated;
  await commit("products", "products.json", index === null ? "Add product" : "Update product", wrap);
}
async function saveClass() {
  const wrap = $("[data-formwrap]");
  const vals = readForm(wrap);
  if (!vals.title) return toast("Please enter a class name.", true);
  const { index } = state.editing;
  const list = state.files.workshops.data.workshops;
  const base = index === null ? { signupUrl: "contact.html?item=workshop", status: "upcoming" } : { ...list[index] };
  const updated = { ...base, title: vals.title, date: vals.date, time: vals.time, price: vals.price, location: vals.location, description: vals.description };
  if (!updated.id) updated.id = slugify(vals.title) || "class-" + Date.now();
  if (index === null) list.push(updated);
  else list[index] = updated;
  await commit("workshops", "workshops.json", index === null ? "Add class" : "Update class", wrap);
}
async function commit(key, path, message, wrap) {
  const saving = wrap ? $("[data-saving]", wrap) : null;
  if (saving) saving.hidden = false;
  try {
    await saveJson(path, key, message);
    toast("Saved! Your site updates in about a minute.");
    closeForm();
  } catch (err) {
    if (saving) saving.hidden = true;
    toast(err.message || "Save failed", true);
  }
}
async function removeItem(kind, index) {
  const isProduct = kind === "product";
  const list = isProduct ? state.files.products.data.products : state.files.workshops.data.workshops;
  const name = isProduct ? list[index] && list[index].name : list[index] && list[index].title;
  if (!confirm(`Remove “${name || "this item"}”? This can't be undone.`)) return;
  list.splice(index, 1);
  try {
    await saveJson(isProduct ? "products.json" : "workshops.json", isProduct ? "products" : "workshops", "Remove " + kind);
    toast("Removed.");
    render();
    wireSectionEvents();
  } catch (err) {
    toast(err.message || "Could not remove", true);
  }
}
async function toggleLive(on) {
  const live = state.files.live.data;
  live.isLive = on;
  if (!live.url) live.url = TIKTOK_LIVE;
  try {
    await saveJson("live.json", "live", on ? "Go live" : "End live");
    toast(on ? "You're live! Banner is showing." : "Live banner turned off.");
    render();
    wireSectionEvents();
  } catch (err) {
    toast(err.message || "Could not update", true);
    render();
    wireSectionEvents();
  }
}
async function saveDeal() {
  const shop = state.files.products.data.shop || (state.files.products.data.shop = {});
  shop.promoEnabled = $("#deal-toggle").checked;
  shop.promoText = $("#deal-text").value.trim();
  try {
    await saveJson("products.json", "products", "Update homepage deal");
    toast("Deal saved!");
  } catch (err) {
    toast(err.message || "Could not save the deal", true);
  }
}

/* ---------- events ---------- */
function wireSectionEvents() {
  const liveToggle = $("#live-toggle");
  if (liveToggle) liveToggle.addEventListener("change", (e) => toggleLive(e.target.checked));
}
function onEditorClick(e) {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const action = btn.dataset.action;
  const i = btn.dataset.i !== undefined ? Number(btn.dataset.i) : null;
  if (action === "add-product") return openForm("product", null);
  if (action === "add-class") return openForm("class", null);
  if (action === "edit-product") return openForm("product", i);
  if (action === "edit-class") return openForm("class", i);
  if (action === "cancel-edit") return closeForm();
  if (action === "save-product") return saveProduct();
  if (action === "save-class") return saveClass();
  if (action === "del-product") return removeItem("product", i);
  if (action === "del-class") return removeItem("class", i);
  if (action === "save-deal") return saveDeal();
}

/* ---------- boot ---------- */
async function boot() {
  $("#login-view").hidden = true;
  $("#editor-view").hidden = false;
  $("#logout-btn").hidden = false;
  $("#editor-view").innerHTML = `<p style="text-align:center;color:var(--muted);padding:40px">Loading your shop…</p>`;
  try {
    const [products, workshops, live] = await Promise.all([
      loadFile("products.json"),
      loadFile("workshops.json"),
      loadFile("live.json"),
    ]);
    state.files = { products, workshops, live };
    render();
    wireSectionEvents();
  } catch (err) {
    $("#editor-view").innerHTML = `<div class="card"><p>${esc(err.message || "Something went wrong loading your shop.")}</p><button class="btn btn-ghost" onclick="location.reload()">Try again</button></div>`;
  }
}

$("#login-btn").addEventListener("click", startLogin);
$("#logout-btn").addEventListener("click", logout);
$("#editor-view").addEventListener("click", onEditorClick);

if (state.token) boot();
