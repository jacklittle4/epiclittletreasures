/* Epic Little Treasures — shop editor (/manage).
   Stephanie signs in with a passcode; the site's Worker saves each change to
   GitHub and the website redeploys about a minute later. "Sign in with GitHub"
   stays as a backup (it talks to the GitHub API directly). Edits collect in a
   working copy and only go live when she taps "Save changes" — except the
   Live switch, which saves the moment it's flipped. */

const REPO = "jacklittle4/epiclittletreasures";
const BRANCH = "main";
const OAUTH_WORKER = "https://sveltia-cms-auth.aphelionsystems-dev.workers.dev";
const TIKTOK_LIVE = "https://www.tiktok.com/@stephanie.davis015/live";
const DEFAULT_CLASS_PLACE = "Live on TikTok @stephanie.davis015";
const PATHS = { products: "products.json", workshops: "workshops.json", live: "live.json" };
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const STATUS_LABEL = { available: "Available", "sold-out": "Sold out", "custom-order": "Made to order" };

/* ---------- small helpers ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (v = "") =>
  String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const clone = (v) => JSON.parse(JSON.stringify(v));
const slugify = (v = "") => String(v).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const isBundle = (p) => String(p.category || "").toLowerCase() === "live bundles";
const statusOf = (p) => p.status || (p.available === false ? "sold-out" : "available");

let toastTimer;
function toast(msg, isError) {
  const t = $("#toast");
  t.textContent = msg;
  t.className = "show" + (isError ? " err" : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = ""), isError ? 6000 : 3200);
}

// "44.99", "$44.99", "44" -> "$44.99". Anything else ("4x", "44.9.9", "") -> null.
function normalizePrice(raw) {
  const m = String(raw).replace(/[,\s]/g, "").match(/^\$?(\d{1,4}(?:\.\d{1,2})?)$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return n >= 1 ? "$" + n.toFixed(2) : null;
}
const priceValue = (price) => parseFloat(String(price || "").replace(/[^\d.]/g, "")) || 0;

// A slipped finger ("4.99" for "44.99") is still a valid price, so double-check
// any bundle price that more than halves or doubles before it goes live.
function bigPriceChanges() {
  const before = new Map(state.saved.products.data.products.map((p) => [p.id, priceValue(p.price)]));
  return state.draft.products.products
    .filter((p) => isBundle(p) && before.get(p.id))
    .filter((p) => {
      const was = before.get(p.id);
      const now = priceValue(p.price);
      return now < was / 2 || now > was * 2;
    })
    .map((p) => {
      const was = state.saved.products.data.products.find((x) => x.id === p.id).price;
      return `• ${p.name}: ${was} → ${p.price}`;
    });
}
const priceNumber = (price) => String(price || "").replace(/^\$/, "");

function parseDate(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || "")) return null;
  const d = new Date(iso + "T00:00:00");
  return Number.isNaN(d.getTime()) ? null : d;
}
function isPastClass(c) {
  if (c.status === "past") return true;
  const d = parseDate(c.date);
  if (!d) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d < today;
}

function uniqueId(base, list) {
  const taken = new Set(list.map((x) => x.id));
  let id = base || "item-" + Date.now();
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

// Phones take huge photos; shrink to a sensible size before uploading.
async function shrinkPhoto(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, bad) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => bad(new Error("That file doesn't look like a photo. Try a JPG or PNG."));
      i.src = url;
    });
    const scale = Math.min(1, 1400 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * scale);
    c.height = Math.round(img.naturalHeight * scale);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.84);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* ---------- where saves go ---------- */
// Passcode sign-in: the site's own Worker does the GitHub work.
const passcodeBackend = {
  key: "elt_admin_token",
  get token() {
    return localStorage.getItem(this.key);
  },
  async call(route, options = {}) {
    const r = await fetch("/api/admin/" + route, {
      ...options,
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + this.token },
      cache: "no-store",
    });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) {
      signOut();
      throw new Error(j.error || "Please sign in again.");
    }
    if (!r.ok) {
      const e = new Error(j.error || "Something went wrong. Please try again.");
      e.stale = Boolean(j.stale);
      throw e;
    }
    return j;
  },
  load() {
    return this.call("files");
  },
  async save(path, data, sha, message) {
    return (await this.call("save", { method: "POST", body: JSON.stringify({ path, data, sha, message }) })).sha;
  },
  async upload(base64, ext) {
    return (await this.call("upload", { method: "POST", body: JSON.stringify({ data: base64, ext }) })).path;
  },
};

// Backup: sign in with GitHub and use the GitHub API from the browser.
const b64ToUtf8 = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, "")), (c) => c.charCodeAt(0)));
function utf8ToB64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
const githubBackend = {
  key: "elt_gh_token",
  get token() {
    return localStorage.getItem(this.key);
  },
  headers() {
    return { Authorization: "token " + this.token, Accept: "application/vnd.github+json" };
  },
  async get(path) {
    const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}?ref=${BRANCH}&t=${Date.now()}`, {
      headers: this.headers(),
      cache: "no-store",
    });
    if (r.status === 401) {
      signOut();
      throw new Error("Please sign in again.");
    }
    if (!r.ok) throw new Error("Could not load " + path);
    const j = await r.json();
    return { sha: j.sha, data: JSON.parse(b64ToUtf8(j.content)) };
  },
  async load() {
    const [products, workshops, live] = await Promise.all([this.get(PATHS.products), this.get(PATHS.workshops), this.get(PATHS.live)]);
    return { products, workshops, live };
  },
  async put(path, contentB64, sha, message) {
    const body = { message, content: contentB64, branch: BRANCH };
    if (sha) body.sha = sha;
    const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
      method: "PUT",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (r.status === 401) {
      signOut();
      throw new Error("Please sign in again.");
    }
    if (r.status === 409) {
      const e = new Error("Something changed in another window. Loading the latest version…");
      e.stale = true;
      throw e;
    }
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw new Error(j.message || "Save failed");
    }
    return r.json();
  },
  async save(path, data, sha, message) {
    return (await this.put(path, utf8ToB64(JSON.stringify(data, null, 2) + "\n"), sha, "Editor: " + message)).content.sha;
  },
  async upload(base64, ext) {
    const path = `assets/photo-${Date.now()}.${ext}`;
    await this.put(path, base64, null, "Editor: add photo");
    return path;
  },
};

/* ---------- state ---------- */
const state = {
  backend: null,
  saved: null, // { products: {sha,data}, workshops: {sha,data}, live: {sha,data} } — what's on the site
  draft: null, // { products: data, workshops: data } — her working copy
  open: null, // "p:<i>" | "c:<i>" | "new:bundle" | "new:other" | "new:class"
  newItem: null,
  priceText: {}, // what she's typed in a price box that isn't a valid price yet
  badPrices: new Set(),
  previews: {}, // uploaded photo path -> local preview (the site needs ~1 min to publish it)
  busy: false,
};

const dirtyFiles = () =>
  state.draft ? ["products", "workshops"].filter((k) => JSON.stringify(state.draft[k]) !== JSON.stringify(state.saved[k].data)) : [];
const imgSrc = (path) => state.previews[path] || "/" + path;

/* ---------- rendering ---------- */
function render() {
  const items = state.draft.products.products.map((p, i) => ({ p, i }));
  const classes = state.draft.workshops.workshops
    .map((c, i) => ({ c, i, past: isPastClass(c) }))
    .sort((a, b) => a.past - b.past || String(a.c.date || "9").localeCompare(String(b.c.date || "9")) * (a.past ? -1 : 1));
  $("#editor-view").innerHTML = [
    liveCard(),
    bundlesCard(items.filter(({ p }) => isBundle(p))),
    classesCard(classes),
    dealCard(),
    othersCard(items.filter(({ p }) => !isBundle(p))),
    helpCard(),
  ].join("");
  updateSaveBar();
}

function liveCard() {
  const on = Boolean(state.saved.live.data.isLive);
  return `
    <section class="card live ${on ? "on" : ""}">
      <div class="switch-row">
        <div class="label">${on ? "🔴 You're live!" : "Going live on TikTok?"}
          <small>${on
            ? "Your website is showing a “Watch live” button. Flip this off when you finish."
            : "Flip this on when you start a LIVE, and your website shows a “Watch live” button."}</small>
        </div>
        <label class="switch big"><input type="checkbox" id="live-toggle" ${on ? "checked" : ""} aria-label="I'm live on TikTok" /><span class="track"></span></label>
      </div>
    </section>`;
}

function thumbHtml(image, emoji) {
  return image ? `<img class="thumb" src="${esc(imgSrc(image))}" alt="" loading="lazy" />` : `<span class="thumb">${emoji}</span>`;
}

function bundlesCard(bundles) {
  return `
    <section class="card">
      <h2>Your bundles</h2>
      <p class="sub">Change a price or flip a bundle to sold out, then tap <b>Save changes</b>.</p>
      ${bundles.length ? bundles.map(({ p, i }) => productRow(p, i, true)).join("") : `<p class="empty">No bundles yet.</p>`}
      ${state.open === "new:bundle" ? newProductPanel(true) : `<button class="btn btn-outline btn-block" data-action="new" data-kind="bundle">+ Add a bundle</button>`}
    </section>`;
}

function othersCard(others) {
  return `
    <section class="card">
      <h2>Other items</h2>
      <p class="sub">Custom journals and anything that isn't a bundle.</p>
      ${others.length ? others.map(({ p, i }) => productRow(p, i, false)).join("") : `<p class="empty">Nothing here yet.</p>`}
      ${state.open === "new:other" ? newProductPanel(false) : `<button class="btn btn-outline btn-block" data-action="new" data-kind="other">+ Add another item</button>`}
    </section>`;
}

function productRow(p, i, bundle) {
  const open = state.open === "p:" + i;
  const inStock = statusOf(p) === "available";
  const controls = bundle
    ? `<div class="row-controls">
         <label class="price ${state.badPrices.has(i) ? "bad" : ""}"><span>$</span><input type="text" inputmode="decimal" autocomplete="off" data-price="${i}" value="${esc(state.priceText[i] ?? priceNumber(p.price))}" aria-label="Price for ${esc(p.name)}" /></label>
         <label class="stock"><span class="switch"><input type="checkbox" data-stock="${i}" ${inStock ? "checked" : ""} aria-label="${esc(p.name)} is in stock" /><span class="track"></span></span><span class="state ${inStock ? "" : "off"}">${inStock ? "In stock" : "Sold out"}</span></label>
       </div>`
    : `<div class="row-sub">${esc(p.price || "No price")} · ${esc(STATUS_LABEL[statusOf(p)] || statusOf(p))}</div>`;
  return `
    <div class="row ${open ? "open" : ""}">
      ${thumbHtml(p.image, "🛍️")}
      <div><div class="row-name">${esc(p.name || "Untitled")}</div>${controls}</div>
      <button class="link-btn" data-action="toggle" data-target="p:${i}" aria-expanded="${open}">${open ? "Close" : "Edit"}</button>
    </div>${open ? productPanel(p, i, bundle) : ""}`;
}

function statusSelect(attrs, current) {
  return `<select ${attrs}>${Object.entries(STATUS_LABEL)
    .map(([v, label]) => `<option value="${v}" ${v === current ? "selected" : ""}>${label}</option>`)
    .join("")}</select>`;
}

function photoField(image, key) {
  return `
    <div class="field">
      <span style="display:block;font-weight:600;margin:12px 0 5px">Photo</span>
      <div class="photo-pick">
        ${image ? `<img src="${esc(imgSrc(image))}" alt="" />` : `<span class="thumb" style="width:84px;height:84px">📷</span>`}
        <label class="btn btn-ghost">${image ? "Change photo" : "Add a photo"}<input type="file" accept="image/*" data-photo="${key}" /></label>
      </div>
    </div>`;
}

function productPanel(p, i, bundle) {
  return `
    <div class="panel">
      <label class="field"><span>Name</span><input type="text" data-edit="name" data-k="p" data-i="${i}" value="${esc(p.name || "")}" maxlength="120" /></label>
      ${bundle ? "" : `<div class="row-2">
        <label class="field"><span>Price</span><input type="text" data-edit="price" data-k="p" data-i="${i}" value="${esc(p.price || "")}" maxlength="40" /><span class="hint">Like $49.99, or “From $49.99”.</span></label>
        <label class="field"><span>Availability</span>${statusSelect(`data-edit="status" data-k="p" data-i="${i}"`, statusOf(p))}</label>
      </div>`}
      ${photoField(p.image, "p:" + i)}
      <label class="field"><span>Short description</span><textarea data-edit="summary" data-k="p" data-i="${i}" maxlength="600">${esc(p.summary || "")}</textarea></label>
      <div class="panel-actions">
        <button class="btn btn-primary grow" data-action="close">Done</button>
        <button class="btn btn-danger" data-action="remove-product" data-i="${i}">Remove</button>
      </div>
    </div>`;
}

function newProductPanel(bundle) {
  const n = state.newItem;
  return `
    <div class="panel new">
      <h3>${bundle ? "New bundle" : "New item"}</h3>
      <label class="field"><span>Name</span><input type="text" data-new="name" value="${esc(n.name)}" placeholder="${bundle ? "e.g. Junk journal bundle - 30 pulls" : "e.g. Custom wedding journal"}" maxlength="120" /></label>
      ${bundle
        ? `<label class="field"><span>Price</span><span class="price" style="display:flex"><span>$</span><input type="text" inputmode="decimal" data-new="price" value="${esc(n.price)}" placeholder="49.99" /></span></label>`
        : `<div class="row-2">
            <label class="field"><span>Price</span><input type="text" data-new="price" value="${esc(n.price)}" placeholder="From $49.99" maxlength="40" /></label>
            <label class="field"><span>Availability</span>${statusSelect('data-new="status"', n.status)}</label>
          </div>`}
      ${photoField(n.image, "new")}
      <label class="field"><span>Short description</span><textarea data-new="summary" maxlength="600" placeholder="A sentence or two about it.">${esc(n.summary)}</textarea></label>
      <div class="panel-actions">
        <button class="btn btn-primary grow" data-action="add-product" data-kind="${bundle ? "bundle" : "other"}">${bundle ? "Add bundle" : "Add item"}</button>
        <button class="btn btn-ghost" data-action="close">Cancel</button>
      </div>
    </div>`;
}

function classesCard(classes) {
  const rows = classes.length
    ? classes.map(({ c, i, past }) => classRow(c, i, past)).join("")
    : `<p class="empty">No classes yet.</p>`;
  return `
    <section class="card">
      <h2>Classes</h2>
      <p class="sub">Classes disappear from your website on their own once the date passes.</p>
      ${rows}
      ${state.open === "new:class" ? classPanel(state.newItem, null) : `<button class="btn btn-outline btn-block" data-action="new" data-kind="class">+ Add a class</button>`}
    </section>`;
}

function classRow(c, i, past) {
  const open = state.open === "c:" + i;
  const d = parseDate(c.date);
  const badge = d
    ? `<span class="date-badge"><small>${MONTHS[d.getMonth()]}</small><b>${d.getDate()}</b></span>`
    : `<span class="date-badge"><small>DATE</small><b>?</b></span>`;
  const sub = [c.time, c.price].filter(Boolean).map(esc).join(" · ");
  return `
    <div class="row ${open ? "open" : ""} ${past ? "past" : ""}">
      ${badge}
      <div><div class="row-name">${esc(c.title || "Untitled class")}${past ? `<span class="tag">Past</span>` : ""}</div><div class="row-sub">${sub || "&nbsp;"}</div></div>
      <button class="link-btn" data-action="toggle" data-target="c:${i}" aria-expanded="${open}">${open ? "Close" : "Edit"}</button>
    </div>${open ? classPanel(c, i) : ""}`;
}

function classPanel(c, i) {
  const isNew = i === null;
  const bind = (field) => (isNew ? `data-new="${field}"` : `data-edit="${field}" data-k="c" data-i="${i}"`);
  return `
    <div class="panel ${isNew ? "new" : ""}">
      ${isNew ? "<h3>New class</h3>" : ""}
      <label class="field"><span>Class name</span><input type="text" ${bind("title")} value="${esc(c.title || "")}" placeholder="e.g. Paper Bag Junk Journal" maxlength="160" /></label>
      <div class="row-2">
        <label class="field"><span>Date</span><input type="date" ${bind("date")} value="${esc(c.date || "")}" /></label>
        <label class="field"><span>Time</span><input type="text" ${bind("time")} value="${esc(c.time || "")}" placeholder="6 PM ET" maxlength="40" /></label>
      </div>
      <div class="row-2">
        <label class="field"><span>Price</span><input type="text" ${bind("price")} value="${esc(c.price || "")}" placeholder="$50" maxlength="40" /></label>
        <label class="field"><span>Where</span><input type="text" ${bind("location")} value="${esc(c.location || DEFAULT_CLASS_PLACE)}" maxlength="120" /></label>
      </div>
      <label class="field"><span>Details &amp; what to bring</span><textarea ${bind("description")} maxlength="2000" placeholder="Describe the class and list any supplies.">${esc(c.description || "")}</textarea></label>
      <div class="panel-actions">
        ${isNew
          ? `<button class="btn btn-primary grow" data-action="add-class">Add class</button><button class="btn btn-ghost" data-action="close">Cancel</button>`
          : `<button class="btn btn-primary grow" data-action="close">Done</button><button class="btn btn-danger" data-action="remove-class" data-i="${i}">Remove</button>`}
      </div>
    </div>`;
}

function dealCard() {
  const shop = state.draft.products.shop;
  return `
    <section class="card">
      <h2>Website deal</h2>
      <p class="sub">The little note in the corner of your website.</p>
      <div class="switch-row">
        <div class="label">Show the deal</div>
        <label class="switch"><input type="checkbox" data-deal-toggle ${shop.promoEnabled ? "checked" : ""} aria-label="Show the deal" /><span class="track"></span></label>
      </div>
      <label class="field"><span>Deal text</span><input type="text" data-deal-text value="${esc(shop.promoText || "")}" placeholder="5 extra envelopes FREE with every order!" maxlength="90" /></label>
    </section>`;
}

function helpCard() {
  return `
    <section class="help">
      <p>Saved changes show on your website in about a minute.</p>
      <p><a href="/" target="_blank" rel="noopener">Open your website ↗</a></p>
    </section>`;
}

function updateSaveBar() {
  const badPrice = state.badPrices.size > 0;
  $("#savebar").hidden = !dirtyFiles().length && !badPrice;
  $("#savebar .note").textContent = badPrice ? "Fix the price in red (like 44.99)" : "You have unsaved changes";
  $("#save-btn").disabled = state.busy || badPrice;
  $("#discard-btn").disabled = state.busy;
  $("#save-btn").textContent = state.busy ? "Saving…" : "Save changes";
}

/* ---------- actions ---------- */
// Someone saved from another phone or tab first: load theirs and say so plainly.
async function recoverFromStale() {
  await loadFiles().catch(() => {});
  toast("Your shop was changed somewhere else, so this is the newest version. Please make your change again.", true);
}

function setOpen(key, newItem = null) {
  state.open = key;
  state.newItem = newItem;
  render();
  if (key) {
    const panel = document.querySelector(".panel");
    if (panel) panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}

function addProduct(kind) {
  const n = state.newItem;
  const list = state.draft.products.products;
  const name = n.name.trim();
  if (!name) return toast("Please give it a name.", true);
  let price = n.price.trim();
  if (kind === "bundle") {
    price = normalizePrice(price);
    if (!price) return toast("Please enter a price, like 49.99.", true);
  }
  const status = kind === "bundle" ? "available" : n.status;
  list.push({
    id: uniqueId(slugify(name), list),
    name,
    price,
    summary: n.summary.trim(),
    details: "",
    status,
    available: status === "available",
    featured: false,
    category: kind === "bundle" ? "Live bundles" : "Custom",
    image: n.image || "",
    alt: name,
  });
  setOpen(null);
  toast("Added. Tap Save changes to put it on your website.");
}

function addClass() {
  const n = state.newItem;
  const list = state.draft.workshops.workshops;
  const title = n.title.trim();
  if (!title) return toast("Please give the class a name.", true);
  if (!parseDate(n.date)) return toast("Please pick a date for the class.", true);
  list.push({
    id: uniqueId(slugify(title), list),
    title,
    date: n.date,
    time: n.time.trim(),
    price: n.price.trim(),
    location: n.location.trim() || DEFAULT_CLASS_PLACE,
    format: "Online",
    status: "upcoming",
    signupUrl: "contact.html?item=workshop",
    description: n.description.trim(),
  });
  setOpen(null);
  toast("Class added. Tap Save changes to put it on your website.");
}

function removeAt(kind, i) {
  const list = kind === "p" ? state.draft.products.products : state.draft.workshops.workshops;
  const label = kind === "p" ? list[i].name : list[i].title;
  if (!confirm(`Remove “${label || "this"}”?\nIt comes off your website when you tap Save changes.`)) return;
  list.splice(i, 1);
  state.priceText = {};
  state.badPrices = new Set();
  setOpen(null);
}

async function saveAll() {
  if (state.badPrices.size) {
    const bad = document.querySelector(".price.bad input");
    if (bad) bad.focus();
    return toast("A price needs fixing first. Use a number like 44.99.", true);
  }
  const dirty = dirtyFiles();
  if (!dirty.length || state.busy) return;
  const big = bigPriceChanges();
  if (big.length && !confirm(`Just checking — that's a big price change:\n\n${big.join("\n")}\n\nTap OK if that's right.`)) return;
  state.busy = true;
  updateSaveBar();
  try {
    for (const k of dirty) {
      const sha = await state.backend.save(PATHS[k], state.draft[k], state.saved[k].sha, k === "products" ? "update shop" : "update classes");
      state.saved[k] = { sha, data: clone(state.draft[k]) };
    }
    state.open = null;
    state.newItem = null;
    toast("Saved! Your website updates in about a minute.");
  } catch (e) {
    if (e.stale) await recoverFromStale();
    else toast(e.message, true);
  } finally {
    state.busy = false;
    render();
  }
}

function discardAll() {
  if (!confirm("Undo all the changes you haven't saved?")) return;
  state.draft = { products: clone(state.saved.products.data), workshops: clone(state.saved.workshops.data) };
  state.priceText = {};
  state.badPrices = new Set();
  setOpen(null);
}

async function saveLive(on) {
  const toggle = $("#live-toggle");
  toggle.disabled = true;
  const live = clone(state.saved.live.data);
  live.isLive = on;
  if (!live.url) live.url = TIKTOK_LIVE;
  try {
    const sha = await state.backend.save(PATHS.live, live, state.saved.live.sha, on ? "go live" : "end live");
    state.saved.live = { sha, data: live };
    toast(on ? "You're live! Your website shows the “Watch live” button in about a minute." : "Live button turned off.");
  } catch (e) {
    if (e.stale) await recoverFromStale();
    else toast(e.message, true);
  }
  render();
}

async function addPhoto(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  const key = input.dataset.photo;
  toast("Adding your photo…");
  try {
    const dataUrl = await shrinkPhoto(file);
    const path = await state.backend.upload(dataUrl.split(",")[1], "jpg");
    state.previews[path] = dataUrl;
    if (key === "new") state.newItem.image = path;
    else state.draft.products.products[Number(key.slice(2))].image = path;
    render();
    toast("Photo added. Tap Save changes to keep it.");
  } catch (e) {
    toast(e.message || "That photo didn't upload. Please try again.", true);
  }
}

/* ---------- events ---------- */
function onClick(e) {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const { action, kind, target } = btn.dataset;
  const i = btn.dataset.i !== undefined ? Number(btn.dataset.i) : null;
  if (action === "toggle") return setOpen(state.open === target ? null : target);
  if (action === "close") return setOpen(null);
  if (action === "new") {
    const blank = kind === "class"
      ? { title: "", date: "", time: "", price: "", location: DEFAULT_CLASS_PLACE, description: "" }
      : { name: "", price: "", summary: "", image: "", status: "custom-order" };
    return setOpen("new:" + kind, blank);
  }
  if (action === "add-product") return addProduct(kind);
  if (action === "add-class") return addClass();
  if (action === "remove-product") return removeAt("p", i);
  if (action === "remove-class") return removeAt("c", i);
}

function onInput(e) {
  const el = e.target;
  if (el.dataset.price !== undefined) {
    const i = Number(el.dataset.price);
    const norm = normalizePrice(el.value);
    state.priceText[i] = el.value;
    if (norm) {
      state.draft.products.products[i].price = norm;
      state.badPrices.delete(i);
    } else {
      state.badPrices.add(i);
    }
    el.closest(".price").classList.toggle("bad", !norm);
  } else if (el.dataset.edit) {
    const list = el.dataset.k === "p" ? state.draft.products.products : state.draft.workshops.workshops;
    const item = list[Number(el.dataset.i)];
    item[el.dataset.edit] = el.value;
    if (el.dataset.edit === "status") item.available = el.value === "available";
  } else if (el.dataset.new) {
    state.newItem[el.dataset.new] = el.value;
  } else if (el.hasAttribute("data-deal-text")) {
    state.draft.products.shop.promoText = el.value;
  }
  updateSaveBar();
}

function onChange(e) {
  const el = e.target;
  if (el.id === "live-toggle") return saveLive(el.checked);
  if (el.dataset.photo !== undefined) return addPhoto(el);
  if (el.dataset.stock !== undefined) {
    const p = state.draft.products.products[Number(el.dataset.stock)];
    p.status = el.checked ? "available" : "sold-out";
    p.available = el.checked;
    const label = el.closest(".stock").querySelector(".state");
    label.textContent = el.checked ? "In stock" : "Sold out";
    label.classList.toggle("off", !el.checked);
  } else if (el.hasAttribute("data-deal-toggle")) {
    state.draft.products.shop.promoEnabled = el.checked;
  }
  updateSaveBar();
}

// Tidy a valid price when she leaves the box ("44" -> "44.00").
function onFocusOut(e) {
  const el = e.target;
  if (el.dataset.price === undefined) return;
  const i = Number(el.dataset.price);
  if (!state.badPrices.has(i)) {
    delete state.priceText[i];
    el.value = priceNumber(state.draft.products.products[i].price);
  }
}

/* ---------- sign in / out ---------- */
async function loadFiles() {
  const files = await state.backend.load();
  state.saved = files;
  state.draft = { products: clone(files.products.data), workshops: clone(files.workshops.data) };
  if (!state.draft.products.shop) state.draft.products.shop = {};
  state.priceText = {};
  state.badPrices = new Set();
  state.open = null;
  state.newItem = null;
  render();
}

async function openEditor(backend) {
  state.backend = backend;
  $("#login-view").hidden = true;
  $("#editor-view").hidden = false;
  $("#signout-btn").hidden = false;
  $("#editor-view").innerHTML = `<p class="help" style="padding:40px 0">Loading your shop…</p>`;
  try {
    await loadFiles();
  } catch (e) {
    $("#editor-view").innerHTML = `
      <section class="card">
        <h2>Couldn't load your shop</h2>
        <p class="sub">${esc(e.message || "Please check your internet connection.")}</p>
        <div class="panel-actions"><button class="btn btn-primary" onclick="location.reload()">Try again</button></div>
      </section>`;
  }
}

async function showLogin() {
  $("#login-view").hidden = false;
  $("#editor-view").hidden = true;
  $("#signout-btn").hidden = true;
  let configured = false;
  try {
    const r = await fetch("/api/admin/status", { cache: "no-store" });
    configured = r.ok && (await r.json()).configured === true;
  } catch {
    /* offline or running locally */
  }
  $("#passcode-form").hidden = !configured;
  $("#not-setup").hidden = configured;
}

async function submitPasscode(e) {
  e.preventDefault();
  const btn = $("#passcode-btn");
  btn.disabled = true;
  btn.textContent = "Checking…";
  $("#login-msg").textContent = "";
  try {
    const r = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passcode: $("#passcode").value }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.token) throw new Error(j.error || "That passcode didn't work.");
    localStorage.setItem(passcodeBackend.key, j.token);
    await openEditor(passcodeBackend);
  } catch (err) {
    $("#login-msg").textContent = err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = "Sign in";
  }
}

let authWindow;
function startGitHubLogin() {
  const w = 620, h = 720;
  const url = `${OAUTH_WORKER}/auth?provider=github&scope=repo&site_id=${encodeURIComponent(location.host)}`;
  authWindow = window.open(url, "elt-github-auth", `width=${w},height=${h},left=${Math.max(0, (screen.width - w) / 2)},top=${Math.max(0, (screen.height - h) / 2)}`);
  window.addEventListener("message", onAuthMessage);
}
function onAuthMessage(e) {
  if (typeof e.data !== "string") return;
  if (e.data === "authorizing:github") {
    if (authWindow) authWindow.postMessage(e.data, e.origin); // handshake
    return;
  }
  const ok = "authorization:github:success:";
  if (e.data.startsWith(ok)) {
    window.removeEventListener("message", onAuthMessage);
    try {
      localStorage.setItem(githubBackend.key, JSON.parse(e.data.slice(ok.length)).token);
      if (authWindow) authWindow.close();
      openEditor(githubBackend);
    } catch {
      $("#login-msg").textContent = "GitHub sign-in failed. Please try again.";
    }
  } else if (e.data.startsWith("authorization:github:error:")) {
    window.removeEventListener("message", onAuthMessage);
    if (authWindow) authWindow.close();
    $("#login-msg").textContent = "GitHub sign-in was cancelled.";
  }
}

function signOut() {
  localStorage.removeItem(passcodeBackend.key);
  localStorage.removeItem(githubBackend.key);
  state.draft = null; // don't warn about unsaved changes on the way out
  state.badPrices = new Set();
  location.reload();
}

/* ---------- start ---------- */
const editor = $("#editor-view");
editor.addEventListener("click", onClick);
editor.addEventListener("input", onInput);
editor.addEventListener("change", onChange);
editor.addEventListener("focusout", onFocusOut);
$("#save-btn").addEventListener("click", saveAll);
$("#discard-btn").addEventListener("click", discardAll);
$("#passcode-form").addEventListener("submit", submitPasscode);
$("#github-btn").addEventListener("click", startGitHubLogin);
$("#signout-btn").addEventListener("click", () => {
  if (dirtyFiles().length && !confirm("You have unsaved changes. Sign out anyway?")) return;
  signOut();
});
window.addEventListener("beforeunload", (e) => {
  if (dirtyFiles().length || state.badPrices.size) {
    e.preventDefault();
    e.returnValue = "";
  }
});

if (passcodeBackend.token) openEditor(passcodeBackend);
else if (githubBackend.token) openEditor(githubBackend);
else showLogin();
