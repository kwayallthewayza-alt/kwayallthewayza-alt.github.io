// Business Content Studio — UI layer.
// Views: Create, Business profile, Products, Studio (editor + QC + approval), Library, Data.

import {
  CATEGORY_TEMPLATES, GOALS, CTA_OPTIONS, FORMATS, TONES, FONTS,
  emptyBusiness, emptyProduct, emptySpec, demoState, emptyState, loadState, saveState, isValidState,
} from './data.js';
import {
  escapeHtml as esc, uid, todayISO, formatDate, priceLine, CURRENCIES, hashString,
} from './format.js';
import {
  factLevels, runQualityChecks, summarise, classifyClaim, usableSpecs, usableInclusions, availabilityLabel,
} from './truth.js';
import { buildStrategy, buildCopy, buildCaptions, CAPTION_PLATFORMS } from './strategy.js';
import { renderCreative, LAYOUTS, loadImage } from './render.js';

const PACK_FORMATS = ['square', 'portrait', 'story', 'landscape'];
const CONTENT_TYPES = {
  advert: { label: 'Advertisement', desc: 'A single poster or promotion', formats: ['square'] },
  campaign: { label: 'Social campaign pack', desc: 'Square, portrait, story and landscape versions', formats: PACK_FORMATS },
  sheet: { label: 'Product sheet / flyer', desc: 'Features and specifications for print', formats: ['flyer'] },
  video: { label: 'Video campaign', desc: 'Scripts and short-form video — Phase 2', formats: [], disabled: true },
};

const app = document.getElementById('app');
let state = loadState();
let firstVisit = false;
if (!state) {
  state = demoState();
  firstVisit = true;
}

// ---------- helpers

function persist() {
  const err = saveState(state);
  if (err) toast(err, 6000);
}
let persistTimer;
function persistSoon() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(persist, 300);
}
function biz() {
  return state.businesses.find((b) => b.id === state.activeBusinessId) || state.businesses[0];
}
function productsOfBiz() {
  return state.products.filter((p) => p.businessId === biz().id);
}
function getProduct(id) {
  return state.products.find((p) => p.id === id);
}
let toastTimer;
function toast(msg, ms = 2600) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), ms);
}
function go(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}
/** In-page confirmation (browser confirm() dialogs are blocked in some embedded viewers). */
function ask(message, okLabel = 'Yes, continue') {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop';
    wrap.innerHTML = `<div class="modal" role="alertdialog" aria-modal="true" aria-labelledby="ask-msg">
      <p id="ask-msg"></p><div class="row" style="justify-content:flex-end">
      <button class="btn" data-ans="no">Cancel</button><button class="btn primary" data-ans="yes"></button></div></div>`;
    wrap.querySelector('#ask-msg').textContent = message;
    wrap.querySelector('[data-ans="yes"]').textContent = okLabel;
    const done = (v) => { wrap.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') done(false); };
    wrap.addEventListener('click', (e) => {
      if (e.target === wrap || e.target.dataset.ans === 'no') done(false);
      else if (e.target.dataset.ans === 'yes') done(true);
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(wrap);
    wrap.querySelector('[data-ans="no"]').focus();
  });
}
function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
}
function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  const target = keys.reduce((o, k) => o[k], obj);
  target[last] = value;
}
function opts(map, selected) {
  return Object.entries(map)
    .map(([v, l]) => `<option value="${esc(v)}"${v === selected ? ' selected' : ''}>${esc(typeof l === 'string' ? l : l.label)}</option>`)
    .join('');
}
function slug(s) {
  return String(s || 'creative').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'creative';
}
function download(filename, blobOrUrl) {
  const a = document.createElement('a');
  a.href = typeof blobOrUrl === 'string' ? blobOrUrl : URL.createObjectURL(blobOrUrl);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  if (typeof blobOrUrl !== 'string') setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** Read an uploaded image, downscale it, and return {src, width, height}. */
function readImage(file, maxSide = 1800, mime = 'image/jpeg') {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) return reject(new Error('Not an image file.'));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read file.'));
    reader.onload = async () => {
      const img = await loadImage(reader.result);
      if (!img) return reject(new Error('Could not open image.'));
      const w0 = img.naturalWidth;
      const h0 = img.naturalHeight;
      const s = Math.min(1, maxSide / Math.max(w0, h0));
      const c = document.createElement('canvas');
      c.width = Math.round(w0 * s);
      c.height = Math.round(h0 * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      resolve({ src: c.toDataURL(mime, 0.86), width: c.width, height: c.height });
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Generic two-way binding: inputs with data-bind="path" update `root`.
 * data-lines turns a textarea into an array of non-empty lines.
 */
function bindForm(container, root, onChange) {
  container.addEventListener('input', (e) => {
    const el = e.target;
    const path = el.dataset.bind;
    if (!path) return;
    let value;
    if (el.type === 'checkbox') value = el.checked;
    else if (el.dataset.lines !== undefined) value = el.value.split('\n').map((s) => s.trim()).filter(Boolean);
    else if (el.type === 'number') value = el.value === '' ? '' : Number(el.value);
    else value = el.value;
    setPath(root, path, value);
    // Ticking "confirmed" stamps the confirmation date.
    if (el.type === 'checkbox' && path.endsWith('.confirmed')) {
      const base = path.slice(0, -'.confirmed'.length);
      const holder = getPath(root, base);
      if (holder && 'confirmedAt' in holder) holder.confirmedAt = value ? todayISO() : '';
    }
    onChange(path, el, e);
  });
}

// ---------- sidebar

function renderSidebar(routeName) {
  document.querySelectorAll('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === routeName));
  const sw = document.getElementById('biz-switch');
  sw.innerHTML = `
    <label class="field small"><span>Active business</span>
      <select id="biz-select">${state.businesses.map((b) => `<option value="${esc(b.id)}"${b.id === biz().id ? ' selected' : ''}>${esc(b.name || 'Unnamed business')}</option>`).join('')}
        <option value="__new">+ Add another business…</option>
      </select>
    </label>`;
  sw.querySelector('#biz-select').onchange = (e) => {
    if (e.target.value === '__new') {
      const b = emptyBusiness();
      b.name = 'New business';
      state.businesses.push(b);
      state.activeBusinessId = b.id;
      persist();
      go('#/business');
    } else {
      state.activeBusinessId = e.target.value;
      persist();
      route();
    }
  };
}

// ---------- router

function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  const name = parts[0] || 'create';
  renderSidebar(name === 'studio' ? 'library' : name);
  window.scrollTo(0, 0);
  switch (name) {
    case 'business': return viewBusiness();
    case 'products': return parts[1] ? viewProductEditor(parts[1]) : viewProducts();
    case 'studio': return viewStudio(parts[1]);
    case 'library': return viewLibrary();
    case 'data': return viewData();
    default: return viewCreate();
  }
}
window.addEventListener('hashchange', route);

// ---------- Create

const wizard = { type: 'advert', productId: '', goal: '', ctaId: 'whatsapp', audience: '', message: '', useOffer: true };

function readiness(product) {
  const l = factLevels(product, biz());
  return `<span class="badge pass" title="Verified facts">✔ ${l.verified.length}</span>
          <span class="badge warn" title="Needs review">! ${l.review.length}</span>
          <span class="badge fail" title="Missing">? ${l.missing.length}</span>`;
}

function viewCreate() {
  const b = biz();
  const products = productsOfBiz();
  if (!wizard.goal) wizard.goal = b.goal || 'enquiries';
  if (!products.some((p) => p.id === wizard.productId)) wizard.productId = products[0]?.id || '';
  const profileGaps = [!b.name && 'business name', !(b.phone || b.whatsapp || b.email) && 'contact details', !b.logo && 'logo'].filter(Boolean);

  app.innerHTML = `
    ${firstVisit ? `<div class="notice info"><strong>Welcome!</strong> We've loaded a <em>demo</em> business and a barge boat product so you can try the studio. The demo contact details are placeholders. Replace them under <a href="#/business">Business profile</a>, or start fresh from <a href="#/data">Data &amp; backup</a>.</div>` : ''}
    <div class="page-head"><div><h1>Create marketing content</h1>
      <p class="muted">Uses your saved brand, approved product facts and the goal you choose. Nothing is invented. Missing facts are flagged and left out.</p></div></div>
    ${profileGaps.length ? `<div class="notice">Your business profile is missing: ${esc(profileGaps.join(', '))}. <a href="#/business">Complete it</a> so it appears on every design.</div>` : ''}

    <div class="card"><div class="step"><div class="step-num">1</div><div style="flex:1">
      <h2>What do you want to create?</h2>
      <div class="tiles" id="type-tiles">
        ${Object.entries(CONTENT_TYPES).map(([id, t]) => `<button type="button" class="tile${wizard.type === id ? ' selected' : ''}" data-type="${id}" ${t.disabled ? 'disabled' : ''}><strong>${esc(t.label)}</strong><span class="muted">${esc(t.desc)}</span></button>`).join('')}
      </div></div></div></div>

    <div class="card"><div class="step"><div class="step-num">2</div><div style="flex:1">
      <h2>Select a product</h2>
      ${products.length ? `<div class="tiles" id="product-tiles">
        ${products.map((p) => `<button type="button" class="tile${wizard.productId === p.id ? ' selected' : ''}" data-product="${esc(p.id)}">
          <strong>${esc(p.name || 'Unnamed product')}</strong>
          <span class="muted">${esc(priceLine(p.price) || 'No price')}</span>
          <div class="row" style="margin-top:.4rem">${readiness(p)}</div></button>`).join('')}
      </div>` : `<div class="empty">No products yet. <a class="btn primary" href="#/products/new">Add your first product</a></div>`}
    </div></div></div>

    <div class="card"><div class="step"><div class="step-num">3</div><div style="flex:1">
      <h2>Choose the campaign goal</h2>
      <div class="tiles" id="goal-tiles">
        ${Object.entries(GOALS).map(([id, g]) => `<button type="button" class="tile${wizard.goal === id ? ' selected' : ''}" data-goal="${id}"><strong>${esc(g.label)}</strong></button>`).join('')}
      </div>
      <details style="margin-top:1rem"><summary>Optional: audience, call to action and message</summary>
        <div class="grid grid-2" style="margin-top:.75rem">
          <label class="field"><span>Call to action</span><select id="w-cta">${CTA_OPTIONS.map((o) => `<option value="${o.id}"${o.id === wizard.ctaId ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select></label>
          <label class="field"><span>Audience for this campaign</span><input type="text" id="w-audience" value="${esc(wizard.audience)}" placeholder="${esc(b.audience || 'e.g. families, lodge owners')}"><small>Leave blank to use the business profile audience.</small></label>
          <label class="field"><span>Main message (optional)</span><input type="text" id="w-message" value="${esc(wizard.message)}" placeholder="Leave blank and the strategist will choose"><small>Will still be checked for unsupported claims.</small></label>
          <label class="field"><span>&nbsp;</span><label class="check"><input type="checkbox" id="w-offer" ${wizard.useOffer ? 'checked' : ''}> Feature the product's active offer (if any)</label></label>
        </div>
      </details>
    </div></div></div>

    <div class="card"><div class="step"><div class="step-num">✓</div><div style="flex:1">
      <h2>AI prepares the campaign</h2>
      <p class="muted">You'll get a strategy brief, headline options, an editable design, platform captions and a quality report to review before approval and export.</p>
      <button class="btn primary big" id="prepare" ${products.length ? '' : 'disabled'}>Prepare campaign →</button>
    </div></div></div>`;

  app.querySelectorAll('[data-type]').forEach((el) => (el.onclick = () => { wizard.type = el.dataset.type; viewCreate(); }));
  app.querySelectorAll('[data-product]').forEach((el) => (el.onclick = () => { wizard.productId = el.dataset.product; viewCreate(); }));
  app.querySelectorAll('[data-goal]').forEach((el) => (el.onclick = () => { wizard.goal = el.dataset.goal; viewCreate(); }));
  const sync = () => {
    wizard.ctaId = app.querySelector('#w-cta').value;
    wizard.audience = app.querySelector('#w-audience').value;
    wizard.message = app.querySelector('#w-message').value;
    wizard.useOffer = app.querySelector('#w-offer').checked;
  };
  app.querySelectorAll('#w-cta,#w-audience,#w-message,#w-offer').forEach((el) => el.addEventListener('input', sync));
  const prep = app.querySelector('#prepare');
  if (prep) prep.onclick = () => {
    sync();
    firstVisit = false;
    const c = createCreative();
    if (c) go(`#/studio/${c.id}`);
  };
}

function createCreative() {
  const b = biz();
  const product = getProduct(wizard.productId);
  if (!product) return null;
  const type = CONTENT_TYPES[wizard.type];
  const format = type.formats[0];
  const campaign = {
    goal: wizard.goal,
    audience: wizard.audience,
    ctaId: wizard.ctaId,
    message: wizard.message.trim(),
    useOffer: wizard.useOffer,
    format,
    formats: type.formats,
    layout: format === 'flyer' ? 'sheet' : format === 'landscape' ? 'split' : 'hero',
  };
  const image = pickDefaultImage(product);
  const strategy = buildStrategy({ business: b, product, campaign });
  const copy = buildCopy({ business: b, product, campaign, strategy, image });
  const v = copy.variants[0] || { headline: product.name, subheadline: '' };
  const creative = {
    id: uid('crv'),
    businessId: b.id,
    productId: product.id,
    type: wizard.type,
    name: `${product.name} — ${GOALS[campaign.goal].label}`,
    campaign,
    texts: { headline: v.headline, subheadline: v.subheadline, bullets: copy.bullets, cta: copy.cta, finePrint: copy.finePrint },
    imageId: image?.id || '',
    colors: { ...b.colors },
    approvals: [],
    approval: null,
    versions: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  state.creatives.unshift(creative);
  persist();
  return creative;
}

function pickDefaultImage(product) {
  return (product.images || []).find((i) => i.kind === 'real') || (product.images || [])[0] || null;
}

// ---------- Business profile

function viewBusiness() {
  const b = biz();
  app.innerHTML = `
    <div class="page-head"><div><h1>Business profile</h1><p class="muted">Set up once. Reused on every design and caption. Saved automatically.</p></div>
      <div class="row">${state.businesses.length > 1 ? '<button class="btn danger" id="del-biz">Delete this business</button>' : ''}</div></div>
    <div class="grid grid-2" id="biz-form">
      <div class="card"><h2>Company details</h2>
        <label class="field"><span>Company name</span><input type="text" data-bind="name" value="${esc(b.name)}"></label>
        <label class="field"><span>Industry</span><input type="text" data-bind="industry" value="${esc(b.industry)}" placeholder="e.g. Boat sales"></label>
        <label class="field"><span>Website</span><input type="text" data-bind="website" value="${esc(b.website)}"></label>
        <label class="field"><span>Address</span><input type="text" data-bind="address" value="${esc(b.address)}"></label>
        <div class="field"><span style="font-weight:600;font-size:.85rem">Logo</span>
          <div class="row" style="margin-top:.3rem">
            ${b.logo ? `<img src="${esc(b.logo)}" alt="Logo" style="max-height:56px;max-width:160px;background:#fff;padding:4px;border-radius:6px;border:1px solid var(--border)">` : '<span class="muted small">No logo uploaded</span>'}
            <label class="btn small">Upload logo<input type="file" accept="image/*" id="logo-input" class="sr-only"></label>
            ${b.logo ? '<button class="btn small danger" id="logo-remove">Remove</button>' : ''}
          </div></div>
      </div>
      <div class="card"><h2>Contact details</h2>
        <label class="field"><span>Phone</span><input type="tel" data-bind="phone" value="${esc(b.phone)}"></label>
        <label class="field"><span>WhatsApp</span><input type="tel" data-bind="whatsapp" value="${esc(b.whatsapp)}"></label>
        <label class="field"><span>Email</span><input type="email" data-bind="email" value="${esc(b.email)}"></label>
        <label class="field"><span>Enquiry link (optional)</span><input type="url" data-bind="enquiryLink" value="${esc(b.enquiryLink)}"></label>
        <div class="row"><button class="btn small" id="confirm-contact">Confirm contact details are correct</button>
          <span class="muted small" id="contact-confirmed">${b.contactConfirmedAt ? `Last confirmed ${esc(formatDate(b.contactConfirmedAt))}` : 'Not yet confirmed'}</span></div>
      </div>
      <div class="card"><h2>Brand identity</h2>
        <div class="row" style="margin-bottom:.8rem">
          <label class="check"><input type="color" data-bind="colors.primary" value="${esc(b.colors.primary)}"> Primary</label>
          <label class="check"><input type="color" data-bind="colors.accent" value="${esc(b.colors.accent)}"> Accent</label>
          <label class="check"><input type="color" data-bind="colors.secondary" value="${esc(b.colors.secondary)}"> Light background</label>
        </div>
        <label class="field"><span>Font</span><select data-bind="font">${opts(Object.fromEntries(FONTS.map((f) => [f, f])), b.font)}</select></label>
        <label class="field"><span>Tone of voice</span><select data-bind="tone">${opts(TONES, b.tone)}</select></label>
      </div>
      <div class="card"><h2>Audience &amp; goals</h2>
        <label class="field"><span>Ideal customers</span><textarea data-bind="audience">${esc(b.audience)}</textarea><small>Who they are, what they need, why they buy.</small></label>
        <label class="field"><span>Location / reach</span><input type="text" data-bind="location" value="${esc(b.location)}"></label>
        <label class="field"><span>Default goal</span><select data-bind="goal">${opts(GOALS, b.goal)}</select></label>
      </div>
      <div class="card" style="grid-column:1/-1"><h2>Brand rules</h2>
        <div class="grid grid-3">
          <label class="field"><span>Approved claims (one per line)</span><textarea data-bind="approvedClaims" data-lines>${esc((b.approvedClaims || []).join('\n'))}</textarea><small>Claims you hold evidence for. These pass the claim check.</small></label>
          <label class="field"><span>Prohibited claims (one per line)</span><textarea data-bind="prohibitedClaims" data-lines>${esc((b.prohibitedClaims || []).join('\n'))}</textarea><small>Any design containing these is blocked.</small></label>
          <label class="field"><span>Required disclaimer</span><textarea data-bind="disclaimer">${esc(b.disclaimer)}</textarea><small>Added to the fine print of every design.</small></label>
        </div>
      </div>
    </div>`;

  const form = app.querySelector('#biz-form');
  bindForm(form, b, (path) => {
    persistSoon();
    if (path === 'name') renderSidebar('business');
  });
  app.querySelector('#confirm-contact').onclick = () => {
    b.contactConfirmedAt = todayISO();
    persist();
    app.querySelector('#contact-confirmed').textContent = `Last confirmed ${formatDate(b.contactConfirmedAt)}`;
  };
  app.querySelector('#logo-input').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const img = await readImage(f, 600, 'image/png');
      b.logo = img.src;
      persist();
      viewBusiness();
    } catch (err) {
      toast(err.message);
    }
  };
  const rm = app.querySelector('#logo-remove');
  if (rm) rm.onclick = () => { b.logo = ''; persist(); viewBusiness(); };
  const del = app.querySelector('#del-biz');
  if (del) del.onclick = async () => {
    if (!(await ask(`Delete "${b.name}" with all its products and creatives? This cannot be undone.`))) return;
    state.products = state.products.filter((p) => p.businessId !== b.id);
    state.creatives = state.creatives.filter((c) => c.businessId !== b.id);
    state.businesses = state.businesses.filter((x) => x.id !== b.id);
    state.activeBusinessId = state.businesses[0].id;
    persist();
    go('#/create');
  };
}

// ---------- Products

function viewProducts() {
  const products = productsOfBiz();
  app.innerHTML = `
    <div class="page-head"><div><h1>Products</h1><p class="muted">Verified prices, specifications, inclusions and photos. The single source of truth for every campaign.</p></div>
      <a class="btn primary" href="#/products/new">+ Add product</a></div>
    <div class="card">${products.length ? products.map((p) => {
      const img = pickDefaultImage(p);
      return `<div class="list-row">
        ${img ? `<img src="${esc(img.src)}" alt="">` : '<div class="thumb" style="width:64px;height:64px"></div>'}
        <div style="flex:1;min-width:180px"><strong>${esc(p.name || 'Unnamed product')}</strong>
          <div class="muted small">${esc(CATEGORY_TEMPLATES[p.category]?.label || p.category)} · ${esc(priceLine(p.price) || 'No price')}${p.price.confirmed ? '' : ' (unconfirmed)'} · ${esc(availabilityLabel(p.availability))}</div>
          <div class="row" style="margin-top:.3rem">${readiness(p)}</div></div>
        <div class="row">
          <button class="btn small" data-create="${esc(p.id)}">Create content</button>
          <a class="btn small" href="#/products/${esc(p.id)}">Edit</a>
          <button class="btn small" data-dup="${esc(p.id)}">Duplicate</button>
          <button class="btn small danger" data-del="${esc(p.id)}">Delete</button>
        </div></div>`;
    }).join('') : '<div class="empty">No products yet.</div>'}</div>`;

  app.querySelectorAll('[data-create]').forEach((el) => (el.onclick = () => { wizard.productId = el.dataset.create; go('#/create'); }));
  app.querySelectorAll('[data-dup]').forEach((el) => (el.onclick = () => {
    const src = getProduct(el.dataset.dup);
    const copy = JSON.parse(JSON.stringify(src));
    copy.id = uid('prd');
    copy.name = `${src.name} (copy)`;
    copy.specs.forEach((s) => (s.id = uid('spec')));
    state.products.push(copy);
    persist();
    viewProducts();
  }));
  app.querySelectorAll('[data-del]').forEach((el) => (el.onclick = async () => {
    const p = getProduct(el.dataset.del);
    const used = state.creatives.filter((c) => c.productId === p.id).length;
    if (!(await ask(`Delete "${p.name}"?${used ? ` ${used} creative(s) use it and will be deleted too.` : ''}`))) return;
    state.products = state.products.filter((x) => x.id !== p.id);
    state.creatives = state.creatives.filter((c) => c.productId !== p.id);
    persist();
    viewProducts();
  }));
}

function claimBadge(text, product) {
  const cls = classifyClaim(text, biz(), product);
  if (cls.status === 'ok') return '';
  if (cls.status === 'verified') return '<span class="badge pass">verified</span>';
  if (cls.status === 'marketing') return '<span class="badge info">marketing claim</span>';
  if (cls.status === 'prohibited') return '<span class="badge fail">prohibited</span>';
  return `<span class="badge warn" title="${esc(cls.suggest || '')}">needs evidence: ${esc(cls.type)}</span>`;
}

function viewProductEditor(id) {
  let p = getProduct(id);
  if (id === 'new' || !p) {
    p = emptyProduct(biz().id, 'general');
    p.name = 'New product';
    state.products.push(p);
    persist();
    history.replaceState(null, '', `#/products/${p.id}`);
  }
  const currencyOpts = Object.fromEntries(Object.keys(CURRENCIES).map((c) => [c, `${c} (${CURRENCIES[c].symbol})`]));

  app.innerHTML = `
    <div class="page-head"><div><a href="#/products" class="small">← Products</a><h1>${esc(p.name || 'Product')}</h1>
      <p class="muted">Tick <strong>Confirmed</strong> only for facts you have checked. Unconfirmed facts are never placed on a design.</p></div>
      <div class="row"><button class="btn primary" id="create-from">Create content for this product</button></div></div>
    <div class="grid" style="grid-template-columns:minmax(0,1fr) 320px" id="pe-grid">
      <div id="pe-form">
        <div class="card"><h2>Identity</h2><div class="grid grid-2">
          <label class="field"><span>Product name</span><input type="text" data-bind="name" value="${esc(p.name)}"></label>
          <label class="field"><span>Category</span><select data-bind="category" id="pe-category">${opts(CATEGORY_TEMPLATES, p.category)}</select></label>
          <label class="field"><span>Model</span><input type="text" data-bind="model" value="${esc(p.model)}"></label>
          <label class="field"><span>SKU</span><input type="text" data-bind="sku" value="${esc(p.sku)}"></label>
        </div></div>

        <div class="card"><h2>Pricing</h2><div class="grid grid-3">
          <label class="field"><span>Price type</span><select data-bind="price.type">${opts({ fixed: 'Fixed price', from: 'Starting from', poa: 'Price on application' }, p.price.type)}</select></label>
          <label class="field"><span>Amount</span><input type="number" min="0" step="any" data-bind="price.amount" value="${esc(p.price.amount)}"></label>
          <label class="field"><span>Currency</span><select data-bind="price.currency">${opts(currencyOpts, p.price.currency)}</select></label>
          <label class="field"><span>Deposit (optional)</span><input type="number" min="0" step="any" data-bind="price.deposit" value="${esc(p.price.deposit)}"></label>
          <label class="field"><span>Financing terms (optional)</span><input type="text" data-bind="price.financing" value="${esc(p.price.financing)}"></label>
          <label class="field"><span>Applicable fees (optional)</span><input type="text" data-bind="price.fees" value="${esc(p.price.fees)}"></label>
          <label class="field"><span>Source</span><input type="text" data-bind="price.source" value="${esc(p.price.source)}" placeholder="e.g. 2026 price list"></label>
          <label class="field"><span>Price valid until (optional)</span><input type="date" data-bind="price.validUntil" value="${esc(p.price.validUntil)}"></label>
          <label class="field"><span>&nbsp;</span><label class="check"><input type="checkbox" data-bind="price.confirmed" ${p.price.confirmed ? 'checked' : ''}> Confirmed</label>
            <small id="price-confirmed-at">${p.price.confirmedAt ? `Confirmed ${esc(formatDate(p.price.confirmedAt))}` : ''}</small></label>
        </div><p class="small muted">Displayed as: <strong id="price-preview">${esc(priceLine(p.price) || '—')}</strong></p></div>

        <div class="card"><div class="row"><h2>Specifications</h2><span class="spacer"></span>
          <button class="btn small" id="add-template">Add ${esc(CATEGORY_TEMPLATES[p.category]?.label || '')} fields</button>
          <button class="btn small" id="add-spec">+ Add row</button></div>
          <div class="table-wrap"><table><thead><tr><th>Specification</th><th>Value</th><th>Source / evidence</th><th>Confirmed</th><th></th></tr></thead><tbody>
          ${p.specs.map((s, i) => `<tr>
            <td><input type="text" data-bind="specs.${i}.label" value="${esc(s.label)}"></td>
            <td><input type="text" data-bind="specs.${i}.value" value="${esc(s.value)}"></td>
            <td><input type="text" data-bind="specs.${i}.source" value="${esc(s.source)}"></td>
            <td><input type="checkbox" data-bind="specs.${i}.confirmed" ${s.confirmed ? 'checked' : ''} aria-label="Confirmed"></td>
            <td><button class="btn small danger" data-rm-spec="${i}" aria-label="Remove">✕</button></td></tr>`).join('')}
          </tbody></table></div></div>

        <div class="card"><h2>What's included &amp; excluded</h2><div class="grid grid-2">
          <div><div class="row"><strong>Included in the price</strong><span class="spacer"></span><button class="btn small" id="add-inc">+ Add</button></div>
            ${p.included.map((inc, i) => `<div class="row" style="margin-top:.4rem"><input type="text" style="flex:1" data-bind="included.${i}.text" value="${esc(inc.text)}">
              <label class="check"><input type="checkbox" data-bind="included.${i}.confirmed" ${inc.confirmed ? 'checked' : ''}> Confirmed</label>
              <button class="btn small danger" data-rm-inc="${i}" aria-label="Remove">✕</button></div>`).join('') || '<p class="muted small">Nothing listed.</p>'}
          </div>
          <label class="field"><span>Not included (one per line)</span><textarea data-bind="excluded" data-lines>${esc(p.excluded.join('\n'))}</textarea><small>Delivery, installation, taxes, optional extras… Disclosed automatically in fine print.</small></label>
        </div></div>

        <div class="card"><h2>Condition &amp; availability</h2><div class="grid grid-3">
          <label class="field"><span>Condition</span><select data-bind="condition.value">${opts({ new: 'New', used: 'Pre-owned', refurbished: 'Refurbished', demo: 'Demo model', custom: 'Custom-built' }, p.condition.value)}</select></label>
          <label class="field"><span>&nbsp;</span><label class="check"><input type="checkbox" data-bind="condition.confirmed" ${p.condition.confirmed ? 'checked' : ''}> Condition confirmed for this item</label></label>
          <label class="field"><span>Availability</span><select data-bind="availability">${opts({ in_stock: 'In stock', made_to_order: 'Made to order', limited: 'Limited quantity', pre_order: 'Pre-order', sold_out: 'Sold out' }, p.availability)}</select></label>
        </div><label class="field"><span>Condition notes (optional)</span><input type="text" data-bind="condition.notes" value="${esc(p.condition.notes)}"></label></div>

        <div class="card"><h2>Benefits &amp; claims</h2>
          <label class="field"><span>Customer benefits (one per line)</span><textarea data-bind="benefits" data-lines id="benefits">${esc(p.benefits.join('\n'))}</textarea><small>What the product helps the customer achieve. Each line is checked for claims that need evidence.</small></label>
          <div id="benefit-badges" class="small"></div>
          <div class="row" style="margin-top:1rem"><strong>Claims</strong><span class="spacer"></span><button class="btn small" id="add-claim">+ Add claim</button></div>
          <p class="muted small">Claims like "stable &amp; safe" or "fuel efficient" need evidence. Mark a claim <em>verified</em> only with evidence recorded. <em>Marketing claim</em> is for low-risk puffery like "built to last".</p>
          ${p.claims.map((c, i) => `<div class="grid" style="grid-template-columns:1.2fr .9fr 1.2fr auto;align-items:center;margin-top:.4rem">
            <input type="text" data-bind="claims.${i}.text" value="${esc(c.text)}" aria-label="Claim">
            <select data-bind="claims.${i}.status" aria-label="Status">${opts({ needs_review: 'Needs review', verified: 'Verified (with evidence)', marketing: 'Marketing claim' }, c.status)}</select>
            <input type="text" data-bind="claims.${i}.evidence" value="${esc(c.evidence)}" placeholder="Evidence / source" aria-label="Evidence">
            <button class="btn small danger" data-rm-claim="${i}" aria-label="Remove">✕</button></div>`).join('')}
        </div>

        <div class="card"><h2>Images</h2>
          <p class="muted small">Use real photographs of the actual product wherever accuracy matters. Images marked <em>illustrative</em> are labelled on every design.</p>
          <label class="btn" id="drop" style="border-style:dashed;width:100%;padding:1.2rem">Drop photos here or click to upload<input type="file" accept="image/*" multiple id="img-input" class="sr-only"></label>
          <div class="img-grid" style="margin-top:.75rem">${p.images.map((img, i) => `<div class="img-card">
            <img class="thumb" src="${esc(img.src)}" alt="${esc(img.name || 'Product image')}">
            <select data-bind="images.${i}.kind" style="margin-top:.4rem">${opts({ real: 'Real product photo', illustrative: 'Illustrative / stock' }, img.kind)}</select>
            <div class="row small muted" style="margin-top:.3rem">${esc(img.width)}×${esc(img.height)}<span class="spacer"></span><button class="btn small danger" data-rm-img="${i}">Remove</button></div></div>`).join('')}</div>
        </div>

        <div class="card"><h2>Purchase &amp; offer</h2>
          <label class="field"><span>How customers buy / enquire</span><textarea data-bind="purchaseProcess">${esc(p.purchaseProcess)}</textarea></label>
          <div class="grid grid-2">
            <label class="field"><span>Offer title (optional)</span><input type="text" data-bind="offer.title" value="${esc(p.offer.title)}" placeholder="e.g. Winter special: free canopy"></label>
            <label class="field"><span>Offer conditions</span><input type="text" data-bind="offer.conditions" value="${esc(p.offer.conditions)}"></label>
            <label class="field"><span>Offer start</span><input type="date" data-bind="offer.start" value="${esc(p.offer.start)}"></label>
            <label class="field"><span>Offer end</span><input type="date" data-bind="offer.end" value="${esc(p.offer.end)}"><small>Expired offers are never reused.</small></label>
          </div></div>
      </div>
      <div><div class="card" style="position:sticky;top:1rem" id="readiness"></div></div>
    </div>`;

  const grid = app.querySelector('#pe-grid');
  if (window.matchMedia('(max-width: 1000px)').matches) grid.style.gridTemplateColumns = '1fr';

  const renderReadiness = () => {
    const l = factLevels(p, biz());
    const li = (arr, kind) => arr.map((f) => `<li><strong>${esc(f.label)}</strong>${f.value ? `: ${esc(f.value)}` : ''}${f.why ? `<br><span class="muted small">${esc(f.why)}</span>` : ''}</li>`).join('') || `<li class="muted">None</li>`;
    app.querySelector('#readiness').innerHTML = `<h2>Fact readiness</h2>
      <p><span class="badge pass">Verified ${l.verified.length}</span> Used automatically</p><ul class="facts small">${li(l.verified)}</ul>
      <p><span class="badge warn">Needs review ${l.review.length}</span> Left out until confirmed</p><ul class="facts small">${li(l.review)}</ul>
      <p><span class="badge fail">Missing ${l.missing.length}</span></p><ul class="facts small">${li(l.missing)}</ul>`;
    app.querySelector('#price-preview').textContent = priceLine(p.price) || '—';
    app.querySelector('#price-confirmed-at').textContent = p.price.confirmedAt ? `Confirmed ${formatDate(p.price.confirmedAt)}` : '';
    app.querySelector('#benefit-badges').innerHTML = p.benefits.map((b) => {
      const badge = claimBadge(b, p);
      return badge ? `<div>${badge} ${esc(b)}</div>` : '';
    }).join('');
  };
  renderReadiness();

  bindForm(app.querySelector('#pe-form'), p, (path) => {
    p.updatedAt = todayISO();
    persistSoon();
    renderReadiness();
    if (path === 'category') viewProductEditor(p.id);
  });

  const rerender = () => { persist(); viewProductEditor(p.id); };
  app.querySelector('#create-from').onclick = () => { wizard.productId = p.id; go('#/create'); };
  app.querySelector('#add-spec').onclick = () => { p.specs.push(emptySpec('')); rerender(); };
  app.querySelector('#add-template').onclick = () => {
    const have = new Set(p.specs.map((s) => s.label.toLowerCase()));
    for (const label of CATEGORY_TEMPLATES[p.category]?.specs || []) if (!have.has(label.toLowerCase())) p.specs.push(emptySpec(label));
    rerender();
  };
  app.querySelector('#add-inc').onclick = () => { p.included.push({ text: '', confirmed: false }); rerender(); };
  app.querySelector('#add-claim').onclick = () => { p.claims.push({ text: '', status: 'needs_review', evidence: '' }); rerender(); };
  app.querySelectorAll('[data-rm-spec]').forEach((el) => (el.onclick = () => { p.specs.splice(+el.dataset.rmSpec, 1); rerender(); }));
  app.querySelectorAll('[data-rm-inc]').forEach((el) => (el.onclick = () => { p.included.splice(+el.dataset.rmInc, 1); rerender(); }));
  app.querySelectorAll('[data-rm-claim]').forEach((el) => (el.onclick = () => { p.claims.splice(+el.dataset.rmClaim, 1); rerender(); }));
  app.querySelectorAll('[data-rm-img]').forEach((el) => (el.onclick = () => { p.images.splice(+el.dataset.rmImg, 1); rerender(); }));

  const addFiles = async (files) => {
    for (const f of files) {
      try {
        const img = await readImage(f);
        p.images.push({ id: uid('img'), src: img.src, kind: 'real', width: img.width, height: img.height, name: f.name });
      } catch (err) {
        toast(`${f.name}: ${err.message}`);
      }
    }
    rerender();
  };
  app.querySelector('#img-input').onchange = (e) => addFiles([...e.target.files]);
  const drop = app.querySelector('#drop');
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.style.background = 'var(--surface-2)'; });
  drop.addEventListener('dragleave', () => (drop.style.background = ''));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.style.background = ''; addFiles([...e.dataTransfer.files]); });
}

// ---------- Studio

const imageCache = new Map();
async function cachedImage(src) {
  if (!src) return null;
  if (!imageCache.has(src)) imageCache.set(src, await loadImage(src));
  return imageCache.get(src);
}

/** Everything derived from records (never stored as editable text). */
function derive(creative, formatOverride) {
  const business = state.businesses.find((b) => b.id === creative.businessId) || biz();
  const product = getProduct(creative.productId);
  const campaign = { ...creative.campaign, format: formatOverride || creative.campaign.format };
  const image = (product.images || []).find((i) => i.id === creative.imageId) || null;
  const strategy = buildStrategy({ business, product, campaign });
  const copy = buildCopy({ business, product, campaign, strategy, image });
  const ctaOpt = CTA_OPTIONS.find((o) => o.id === campaign.ctaId) || CTA_OPTIONS[0];
  const texts = {
    ...creative.texts,
    priceText: copy.priceText,
    contact: copy.contact,
    offer: copy.offer,
  };
  const captions = buildCaptions({ business, product, texts });
  texts.caption = captions.facebook;
  return { business, product, campaign, image, strategy, copy, texts, captions, ctaNeeds: ctaOpt.needs };
}

/** Fingerprint of everything that would be published, including the facts behind it. */
function fingerprint(creative) {
  const d = derive(creative);
  return hashString(JSON.stringify({
    texts: d.texts,
    formats: creative.campaign.formats,
    layout: creative.campaign.layout,
    colors: creative.colors,
    image: d.image ? [d.image.id, d.image.kind] : null,
    specs: usableSpecs(d.product).map((s) => [s.label, s.value]),
    inclusions: usableInclusions(d.product),
    contacts: [d.business.phone, d.business.whatsapp, d.business.email, d.business.website, d.business.disclaimer],
    logo: d.business.logo ? hashString(d.business.logo) : '',
  }));
}

function approvalStatus(creative) {
  if (!getProduct(creative.productId)) return { key: 'orphan', label: 'Product deleted', cls: 'fail' };
  if (!creative.approval) return { key: 'draft', label: 'Draft', cls: 'info' };
  if (creative.approval.fingerprint !== fingerprint(creative)) return { key: 'stale', label: 'Needs re-approval', cls: 'warn' };
  return { key: 'approved', label: 'Approved', cls: 'pass' };
}

async function renderTo(canvas, creative, format, { draft }) {
  const d = derive(creative, format);
  const [imgEl, logoEl] = await Promise.all([cachedImage(d.image?.src), cachedImage(d.business.logo)]);
  try {
    await document.fonts.load(`800 40px "${d.business.font}"`);
    await document.fonts.load(`500 40px "${d.business.font}"`);
  } catch { /* fonts are optional; canvas falls back to system fonts */ }
  const report = renderCreative(canvas, {
    format,
    layout: creative.campaign.layout,
    texts: d.texts,
    colors: creative.colors,
    font: d.business.font,
    image: imgEl ? { el: imgEl, kind: d.image.kind } : null,
    logo: logoEl,
    businessName: d.business.name,
    specs: usableSpecs(d.product),
    draft,
  });
  return { d, report };
}

/** Run checks for every format in the creative (a campaign pack has several). */
async function checkAll(creative) {
  const formats = creative.campaign.formats?.length ? creative.campaign.formats : [creative.campaign.format];
  const seen = new Map();
  const off = document.createElement('canvas');
  for (const f of formats) {
    const { d, report } = await renderTo(off, creative, f, { draft: false });
    const checks = runQualityChecks({
      draft: { texts: d.texts, campaign: { goal: d.campaign.goal, ctaNeeds: d.ctaNeeds }, format: f, image: d.image, renderReport: report },
      product: d.product,
      business: d.business,
    });
    for (const c of checks) {
      const perFormat = c.area === 'Legibility' && formats.length > 1;
      const msg = perFormat ? `${FORMATS[f].label.split(' — ')[0]}: ${c.message}` : c.message;
      const key = `${c.level}|${c.area}|${msg}`;
      if (!seen.has(key)) seen.set(key, { ...c, message: msg });
    }
  }
  const order = { fail: 0, warn: 1, pass: 2 };
  return [...seen.values()].sort((a, b) => order[a.level] - order[b.level]);
}

function snapshot(creative) {
  return JSON.stringify({ texts: creative.texts, campaign: creative.campaign, colors: creative.colors, imageId: creative.imageId });
}
function restore(creative, snap) {
  Object.assign(creative, JSON.parse(snap));
}

let studio = null; // { id, undo:[], redo:[], captionTab, typingSnap }

async function viewStudio(id) {
  const creative = state.creatives.find((c) => c.id === id);
  if (!creative) {
    app.innerHTML = '<div class="empty">Creative not found. <a href="#/library">Back to library</a></div>';
    return;
  }
  if (!getProduct(creative.productId)) {
    app.innerHTML = '<div class="empty">The product for this creative was deleted. <a href="#/library">Back to library</a></div>';
    return;
  }
  if (!studio || studio.id !== id) studio = { id, undo: [], redo: [], captionTab: 'facebook', typingSnap: null };
  const d = derive(creative);
  const isPack = (creative.campaign.formats || []).length > 1;
  const formatChoices = Object.fromEntries((isPack ? creative.campaign.formats : Object.keys(FORMATS)).map((f) => [f, FORMATS[f].label]));
  const layoutChoices = creative.campaign.format === 'flyer' ? { sheet: LAYOUTS.sheet } : { hero: LAYOUTS.hero, overlay: LAYOUTS.overlay, split: LAYOUTS.split };

  app.innerHTML = `
    <div class="page-head"><div><a href="#/library" class="small">← Library</a>
      <h1 contenteditable="plaintext-only" id="c-name" spellcheck="true" style="outline:none">${esc(creative.name)}</h1>
      <div class="row small"><span class="badge" id="status-badge"></span><span class="muted">Product: <a href="#/products/${esc(d.product.id)}">${esc(d.product.name)}</a> · ${esc(d.strategy.goalLabel)}</span></div></div>
      <div class="row">
        <button class="btn small" id="undo" title="Undo">↶ Undo</button>
        <button class="btn small" id="redo" title="Redo">↷ Redo</button>
        <button class="btn small" id="save-version">Save version</button>
      </div></div>

    <div class="studio">
      <div>
        <div class="card"><details ${creative.versions.length ? '' : 'open'}><summary>Strategy brief</summary>
          <p class="small" style="margin-top:.5rem"><strong>Objective:</strong> ${esc(d.strategy.goalLabel)}<br>
          <strong>Audience:</strong> ${esc(d.strategy.audience || 'Not specified')}<br>
          <strong>Selling angle:</strong> ${esc(d.strategy.angle.text)}</p>
          <ul class="facts small">${d.strategy.reasoning.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
          ${d.strategy.omitted.length ? `<p class="small"><strong>Left out on purpose</strong></p><ul class="facts small muted">${d.strategy.omitted.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}
        </details></div>

        <div class="card"><h3>Headline options</h3>
          ${d.copy.variants.map((v, i) => `<button class="btn variant" data-variant="${i}"><span><strong>${esc(v.headline)}</strong><br><span class="muted small">${esc(v.subheadline)}</span></span></button>`).join('')}
        </div>

        <div class="card" id="text-form"><h3>Edit wording</h3>
          <label class="field"><span>Headline</span><input type="text" data-bind="texts.headline" value="${esc(creative.texts.headline)}" spellcheck="true"></label>
          <label class="field"><span>Sub-headline</span><textarea data-bind="texts.subheadline" spellcheck="true">${esc(creative.texts.subheadline)}</textarea></label>
          <label class="field"><span>Key points (one per line)</span><textarea data-bind="texts.bullets" data-lines spellcheck="true" style="min-height:100px">${esc(creative.texts.bullets.join('\n'))}</textarea>
            <small>Spec lines ("Engine: …") and "Includes …" lines are checked against the product record.</small></label>
          <label class="field"><span>Call to action</span><input type="text" data-bind="texts.cta" value="${esc(creative.texts.cta)}"></label>
          <label class="field"><span>Contact channel</span><select id="cta-channel">${CTA_OPTIONS.map((o) => `<option value="${o.id}"${o.id === creative.campaign.ctaId ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select></label>
          <label class="field"><span>Fine print</span><textarea data-bind="texts.finePrint">${esc(creative.texts.finePrint)}</textarea>
            <button class="btn small" id="regen-fine" style="margin-top:.3rem">Regenerate from record</button></label>
          <p class="small"><strong>From the records (locked)</strong></p>
          <div class="locked"><span>Price: <strong>${esc(d.texts.priceText || 'omitted')}</strong></span><a class="small" href="#/products/${esc(d.product.id)}">Edit product</a></div>
          <div class="locked" style="margin-top:.4rem"><span>Contact: <strong>${esc(d.texts.contact || 'none')}</strong></span><a class="small" href="#/business">Edit profile</a></div>
          ${d.texts.offer ? `<div class="locked" style="margin-top:.4rem"><span>Offer: <strong>${esc(d.texts.offer)}</strong></span></div>` : ''}
        </div>
      </div>

      <div>
        <div class="card"><div class="grid grid-2">
          <label class="field"><span>Format</span><select id="fmt">${opts(formatChoices, creative.campaign.format)}</select></label>
          <label class="field"><span>Layout</span><select id="layout">${opts(layoutChoices, creative.campaign.layout)}</select></label>
          </div>
          <div class="row">
            <label class="check"><input type="color" id="col-primary" value="${esc(creative.colors.primary)}"> Primary</label>
            <label class="check"><input type="color" id="col-accent" value="${esc(creative.colors.accent)}"> Accent</label>
            <label class="check"><input type="color" id="col-secondary" value="${esc(creative.colors.secondary)}"> Light</label>
            <button class="btn small" id="brand-colors">Reset to brand colours</button>
          </div>
          ${d.product.images.length > 1 ? `<div class="row" style="margin-top:.6rem"><span class="small"><strong>Image:</strong></span>
            ${d.product.images.map((img) => `<button class="btn small${img.id === creative.imageId ? ' primary' : ''}" data-img="${esc(img.id)}" title="${esc(img.kind)}"><img src="${esc(img.src)}" alt="" style="width:34px;height:34px;object-fit:cover;border-radius:4px"></button>`).join('')}</div>` : ''}
        </div>
        <div class="canvas-wrap"><canvas id="canvas" aria-label="Design preview"></canvas></div>
        <p class="small muted" style="text-align:center">Preview. Downloads are watermarked "DRAFT" until approved.</p>

        <div class="card"><h3>Ready-to-publish copy</h3>
          <div class="tabs" id="cap-tabs">${CAPTION_PLATFORMS.map((p) => `<button data-tab="${p.id}">${esc(p.label)}</button>`).join('')}<button data-tab="faq">Enquiry replies</button></div>
          <div id="cap-body"></div>
        </div>
      </div>

      <div class="qc-col">
        <div class="card"><h3>Quality report</h3><div id="qc-summary" class="row" style="margin-bottom:.5rem"></div><ul class="qc-list" id="qc-list"><li>Checking…</li></ul></div>
        <div class="card" id="approval"></div>
        <div class="card"><h3>Export</h3><div class="row" id="export-row"></div>
          <p class="small muted" style="margin-top:.5rem">Exports use the same text as the preview, rendered from your records, not by an image generator.</p></div>
        <div class="card"><h3>Version history</h3><div id="versions"></div></div>
      </div>
    </div>`;

  const canvas = app.querySelector('#canvas');
  let checks = [];

  const refreshUndo = () => {
    app.querySelector('#undo').disabled = !studio.undo.length;
    app.querySelector('#redo').disabled = !studio.redo.length;
  };

  /** Any edit invalidates an approval. */
  const touched = () => {
    creative.updatedAt = new Date().toISOString();
    persistSoon();
  };

  let redrawSeq = 0;
  const redraw = async () => {
    const seq = ++redrawSeq;
    const { d: dd } = await renderTo(canvas, creative, creative.campaign.format, { draft: false });
    if (seq !== redrawSeq) return;
    renderCaptions(dd);
    checks = await checkAll(creative);
    if (seq !== redrawSeq) return;
    renderChecks();
    renderApproval();
    renderExport();
    renderVersions();
    const st = approvalStatus(creative);
    const badge = app.querySelector('#status-badge');
    badge.className = `badge ${st.cls}`;
    badge.textContent = st.label;
  };

  const renderCaptions = (dd) => {
    app.querySelectorAll('#cap-tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === studio.captionTab));
    const body = app.querySelector('#cap-body');
    if (studio.captionTab === 'faq') {
      body.innerHTML = dd.captions.faq.map((f) => `<p class="small"><strong>${esc(f.q)}</strong></p><div class="caption-box" style="margin-bottom:.6rem">${esc(f.a)}</div>`).join('');
    } else {
      body.innerHTML = `<div class="caption-box" id="cap-text">${esc(dd.captions[studio.captionTab])}</div>
        <div class="row" style="margin-top:.5rem"><button class="btn small" id="copy-cap">Copy</button>
        <span class="small muted">${esc(String(dd.captions[studio.captionTab]).length)} characters</span></div>`;
      body.querySelector('#copy-cap').onclick = async () => {
        try {
          await navigator.clipboard.writeText(dd.captions[studio.captionTab]);
          toast('Copied to clipboard');
        } catch {
          toast('Copy failed — select the text and copy manually.');
        }
      };
    }
  };

  const renderChecks = () => {
    const s = summarise(checks);
    app.querySelector('#qc-summary').innerHTML = `<span class="badge fail">${s.fail} must fix</span><span class="badge warn">${s.warn} to review</span><span class="badge pass">${s.pass} passed</span>`;
    const icon = { pass: '✔', warn: '!', fail: '✕' };
    app.querySelector('#qc-list').innerHTML = checks.map((c) => `<li><span class="badge ${c.level}">${icon[c.level]}</span><span><span class="qc-area">${esc(c.area)}</span>${esc(c.message)}</span></li>`).join('');
  };

  const renderApproval = () => {
    const el = app.querySelector('#approval');
    const s = summarise(checks);
    const st = approvalStatus(creative);
    if (st.key === 'approved') {
      const a = creative.approval;
      el.innerHTML = `<h3>Approval</h3><p><span class="badge pass">Approved</span></p>
        <p class="small">By <strong>${esc(a.by)}</strong> on ${esc(new Date(a.at).toLocaleString())}.<br>
        Price used: ${esc(a.data.priceText || 'none')} · Contact: ${esc(a.data.contact || 'none')}<br>
        ${a.warnings ? `${esc(a.warnings)} warning(s) acknowledged.` : 'No warnings.'}</p>
        <button class="btn small" id="revoke">Revoke approval</button>`;
      el.querySelector('#revoke').onclick = () => {
        creative.approval = null;
        persist();
        redraw();
      };
      return;
    }
    el.innerHTML = `<h3>Request approval</h3>
      ${st.key === 'stale' ? '<div class="notice small">Content or product data changed since it was approved. Review and approve again.</div>' : ''}
      ${s.fail ? `<div class="notice fail small">Fix the ${s.fail} blocking issue(s) in the quality report before this can be approved.</div>` : ''}
      <label class="field"><span>Approver name</span><input type="text" id="approver" value="${esc(localApprover())}" placeholder="Name of the person approving"></label>
      ${s.warn ? `<label class="check" style="margin-bottom:.6rem"><input type="checkbox" id="ack"> I have reviewed the ${s.warn} warning(s) and accept them</label>` : ''}
      <button class="btn primary" id="approve" ${s.fail ? 'disabled' : ''}>Approve for publishing</button>
      <p class="small muted" style="margin-top:.5rem">Automated checks flag problems; legal and compliance claims still need human judgement.</p>`;
    const btn = el.querySelector('#approve');
    btn.onclick = () => {
      const by = el.querySelector('#approver').value.trim();
      if (!by) return toast('Enter the approver name.');
      const ack = el.querySelector('#ack');
      if (ack && !ack.checked) return toast('Tick the box to confirm you reviewed the warnings.');
      try { localStorage.setItem('bcs.approver', by); } catch { /* optional convenience */ }
      const dd = derive(creative);
      const record = {
        by,
        at: new Date().toISOString(),
        fingerprint: fingerprint(creative),
        warnings: s.warn,
        warningList: checks.filter((c) => c.level === 'warn').map((c) => `${c.area}: ${c.message}`),
        data: {
          priceText: dd.texts.priceText,
          priceSource: dd.product.price.source,
          priceConfirmedAt: dd.product.price.confirmedAt,
          contact: dd.texts.contact,
          specs: usableSpecs(dd.product).map((x) => `${x.label}: ${x.value}`),
          inclusions: usableInclusions(dd.product),
          image: dd.image ? `${dd.image.name || dd.image.id} (${dd.image.kind})` : 'none',
        },
      };
      creative.approval = record;
      creative.approvals.unshift(record);
      saveVersion('Approved by ' + by);
      persist();
      toast('Approved. Downloads are now unwatermarked.');
      redraw();
    };
  };

  const renderExport = () => {
    const approved = approvalStatus(creative).key === 'approved';
    const row = app.querySelector('#export-row');
    const formats = creative.campaign.formats?.length > 1 ? creative.campaign.formats : null;
    row.innerHTML = `<button class="btn ${approved ? 'primary' : ''}" id="dl-one">${approved ? 'Download PNG' : 'Download draft PNG'}</button>
      ${formats ? `<button class="btn" id="dl-all">${approved ? 'Download all sizes' : 'Download all (draft)'}</button>` : ''}
      <button class="btn" id="dl-copy">Download captions (.txt)</button>`;
    const dl = async (format) => {
      const c = document.createElement('canvas');
      await renderTo(c, creative, format, { draft: !approved });
      await new Promise((res) => c.toBlob((blob) => { download(`${slug(creative.name)}-${format}${approved ? '' : '-DRAFT'}.png`, blob); res(); }, 'image/png'));
    };
    row.querySelector('#dl-one').onclick = () => dl(creative.campaign.format);
    if (formats) row.querySelector('#dl-all').onclick = async () => { for (const f of formats) await dl(f); };
    row.querySelector('#dl-copy').onclick = () => {
      const dd = derive(creative);
      const txt = [
        `${creative.name}`,
        `Status: ${approvalStatus(creative).label}${creative.approval ? ` (by ${creative.approval.by}, ${creative.approval.at})` : ''}`,
        '',
        ...CAPTION_PLATFORMS.flatMap((p) => [`===== ${p.label} =====`, dd.captions[p.id], '']),
        '===== Enquiry replies =====',
        ...dd.captions.faq.flatMap((f) => [`Q: ${f.q}`, `A: ${f.a}`, '']),
      ].join('\n');
      download(`${slug(creative.name)}-captions.txt`, new Blob([txt], { type: 'text/plain' }));
    };
  };

  const saveVersion = (label) => {
    creative.versions.unshift({ at: new Date().toISOString(), label, snap: snapshot(creative) });
    creative.versions = creative.versions.slice(0, 25);
  };

  const renderVersions = () => {
    const el = app.querySelector('#versions');
    el.innerHTML = creative.versions.length
      ? creative.versions.map((v, i) => `<div class="list-row" style="padding:.4rem 0"><div style="flex:1"><strong class="small">${esc(v.label)}</strong><div class="muted small">${esc(new Date(v.at).toLocaleString())}</div></div><button class="btn small" data-restore="${i}">Restore</button></div>`).join('')
      : '<p class="muted small">No saved versions yet.</p>';
    el.querySelectorAll('[data-restore]').forEach((b) => (b.onclick = () => {
      commit(() => restore(creative, creative.versions[+b.dataset.restore].snap), true);
      toast('Version restored');
    }));
  };

  /** Apply a change with undo support. `full` re-renders the whole studio. */
  const commit = (mutate, full = false) => {
    studio.undo.push(snapshot(creative));
    studio.redo = [];
    mutate();
    touched();
    if (full) viewStudio(id);
    else { refreshUndo(); redraw(); }
  };

  // Text edits: live preview, one undo step per field focus.
  const form = app.querySelector('#text-form');
  form.addEventListener('focusin', () => (studio.typingSnap = snapshot(creative)));
  bindForm(form, creative, () => {
    if (studio.typingSnap) {
      studio.undo.push(studio.typingSnap);
      studio.redo = [];
      studio.typingSnap = null;
      refreshUndo();
    }
    touched();
    redraw();
  });

  app.querySelector('#c-name').addEventListener('input', (e) => {
    creative.name = e.target.textContent.trim() || 'Untitled creative';
    persistSoon();
  });
  app.querySelectorAll('[data-variant]').forEach((b) => (b.onclick = () => commit(() => {
    const v = d.copy.variants[+b.dataset.variant];
    creative.texts.headline = v.headline;
    creative.texts.subheadline = v.subheadline;
  }, true)));
  app.querySelector('#cta-channel').onchange = (e) => commit(() => {
    creative.campaign.ctaId = e.target.value;
    creative.texts.cta = CTA_OPTIONS.find((o) => o.id === e.target.value).label;
  }, true);
  app.querySelector('#regen-fine').onclick = () => commit(() => {
    creative.texts.finePrint = derive(creative).copy.finePrint;
  }, true);
  app.querySelector('#fmt').onchange = (e) => commit(() => {
    creative.campaign.format = e.target.value;
    if (e.target.value === 'flyer') creative.campaign.layout = 'sheet';
    else if (creative.campaign.layout === 'sheet') creative.campaign.layout = 'hero';
  }, true);
  app.querySelector('#layout').onchange = (e) => commit(() => (creative.campaign.layout = e.target.value));
  for (const k of ['primary', 'accent', 'secondary']) {
    const input = app.querySelector(`#col-${k}`);
    input.addEventListener('focus', () => (studio.typingSnap = snapshot(creative)));
    input.addEventListener('input', () => {
      if (studio.typingSnap) { studio.undo.push(studio.typingSnap); studio.redo = []; studio.typingSnap = null; refreshUndo(); }
      creative.colors[k] = input.value;
      touched();
      redraw();
    });
  }
  app.querySelector('#brand-colors').onclick = () => commit(() => (creative.colors = { ...d.business.colors }), true);
  app.querySelectorAll('[data-img]').forEach((b) => (b.onclick = () => commit(() => {
    creative.imageId = b.dataset.img;
    creative.texts.finePrint = derive(creative).copy.finePrint;
  }, true)));
  app.querySelector('#undo').onclick = () => {
    if (!studio.undo.length) return;
    studio.redo.push(snapshot(creative));
    restore(creative, studio.undo.pop());
    touched();
    viewStudio(id);
  };
  app.querySelector('#redo').onclick = () => {
    if (!studio.redo.length) return;
    studio.undo.push(snapshot(creative));
    restore(creative, studio.redo.pop());
    touched();
    viewStudio(id);
  };
  app.querySelector('#save-version').onclick = () => {
    saveVersion('Manual save');
    persist();
    renderVersions();
    toast('Version saved');
  };
  app.querySelectorAll('#cap-tabs button').forEach((b) => (b.onclick = () => {
    studio.captionTab = b.dataset.tab;
    renderCaptions(derive(creative));
  }));

  refreshUndo();
  await redraw();
}

function localApprover() {
  try {
    return localStorage.getItem('bcs.approver') || '';
  } catch {
    return '';
  }
}

// ---------- Library

function viewLibrary() {
  const items = state.creatives.filter((c) => c.businessId === biz().id);
  app.innerHTML = `
    <div class="page-head"><div><h1>Library &amp; approvals</h1><p class="muted">Every creative, its approval status and the product data each approval used.</p></div>
      <a class="btn primary" href="#/create">+ Create content</a></div>
    <div class="card">${items.length ? items.map((c) => {
      const st = approvalStatus(c);
      const p = getProduct(c.productId);
      return `<div class="list-row">
        <canvas data-thumb="${esc(c.id)}" width="64" height="64" style="width:64px;height:64px;border-radius:8px;border:1px solid var(--border)"></canvas>
        <div style="flex:1;min-width:200px"><strong>${esc(c.name)}</strong>
          <div class="small muted">${esc(CONTENT_TYPES[c.type]?.label || '')} · ${esc(p ? p.name : 'deleted product')} · updated ${esc(new Date(c.updatedAt).toLocaleDateString())}</div>
          <div class="row" style="margin-top:.3rem"><span class="badge ${st.cls}">${esc(st.label)}</span>
            ${c.approvals.length ? `<details class="small"><summary>${c.approvals.length} approval record(s)</summary>${c.approvals.map((a) => `<div style="margin:.4rem 0 .6rem;padding-left:.6rem;border-left:3px solid var(--border)">
              <strong>${esc(a.by)}</strong> · ${esc(new Date(a.at).toLocaleString())}<br>
              Price: ${esc(a.data.priceText || 'none')}${a.data.priceSource ? ` (source: ${esc(a.data.priceSource)})` : ''}<br>
              Contact: ${esc(a.data.contact || 'none')}<br>
              Specs: ${esc(a.data.specs.join('; ') || 'none')}<br>
              Image: ${esc(a.data.image)}<br>
              Warnings accepted: ${esc(a.warnings)}</div>`).join('')}</details>` : ''}
          </div></div>
        <div class="row"><a class="btn small" href="#/studio/${esc(c.id)}">Open</a>
          <button class="btn small" data-dup="${esc(c.id)}">Duplicate</button>
          <button class="btn small danger" data-del="${esc(c.id)}">Delete</button></div></div>`;
    }).join('') : '<div class="empty">Nothing yet. <a href="#/create">Create your first campaign</a>.</div>'}</div>`;

  app.querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => {
    const c = state.creatives.find((x) => x.id === b.dataset.del);
    if (!(await ask(`Delete "${c.name}" and its approval history?`))) return;
    state.creatives = state.creatives.filter((x) => x.id !== c.id);
    persist();
    viewLibrary();
  }));
  app.querySelectorAll('[data-dup]').forEach((b) => (b.onclick = () => {
    const src = state.creatives.find((x) => x.id === b.dataset.dup);
    const copy = JSON.parse(JSON.stringify(src));
    Object.assign(copy, { id: uid('crv'), name: `${src.name} (copy)`, approval: null, approvals: [], versions: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    state.creatives.unshift(copy);
    persist();
    viewLibrary();
  }));
  // Thumbnails
  (async () => {
    for (const el of app.querySelectorAll('[data-thumb]')) {
      const c = state.creatives.find((x) => x.id === el.dataset.thumb);
      if (!c || !getProduct(c.productId)) continue;
      const off = document.createElement('canvas');
      await renderTo(off, c, c.campaign.format, { draft: false });
      const ctx = el.getContext('2d');
      const s = Math.max(64 / off.width, 64 / off.height);
      ctx.drawImage(off, (64 - off.width * s) / 2, (64 - off.height * s) / 2, off.width * s, off.height * s);
    }
  })();
}

// ---------- Data

function viewData() {
  let bytes = 0;
  try { bytes = (localStorage.getItem('business-content-studio.v1') || '').length; } catch { /* ignore */ }
  app.innerHTML = `
    <div class="page-head"><div><h1>Data &amp; backup</h1>
      <p class="muted">This prototype keeps everything in this browser only. Nothing is uploaded. Export a backup regularly, especially before clearing browser data.</p></div></div>
    <div class="grid grid-2">
      <div class="card"><h2>Backup</h2><p class="small muted">Stored: about ${esc((bytes / 1024).toFixed(0))} KB of a typical 5,000 KB browser limit.</p>
        <div class="row"><button class="btn primary" id="export">Export backup (.json)</button>
          <label class="btn">Import backup<input type="file" accept="application/json,.json" id="import" class="sr-only"></label></div></div>
      <div class="card"><h2>Start over</h2>
        <div class="row"><button class="btn" id="demo">Load demo data</button><button class="btn danger" id="reset">Start with an empty business</button></div>
        <p class="small muted" style="margin-top:.5rem">Both replace everything currently stored in this browser.</p></div>
    </div>
    <div class="card"><h2>About this prototype</h2>
      <p class="small">This is Phase 1 of the AI Business Content &amp; Marketing Studio: brand memory, a product knowledge base with verification levels, a rule-based strategist and copywriter, a layout engine that renders exact text, automated fact/contact/claim/legibility checks, approval records and exports.</p>
      <p class="small">It runs entirely in the browser, so no AI API keys are used here. Generative AI for copy and imagery, team accounts and publishing integrations need a secure server. See <a href="https://github.com/kwayallthewayza-alt/kwayallthewayza-alt.github.io/blob/main/docs/architecture.md" rel="noopener">docs/architecture.md</a>.</p></div>`;

  app.querySelector('#export').onclick = () => {
    download(`content-studio-backup-${todayISO()}.json`, new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }));
  };
  app.querySelector('#import').onchange = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = async () => {
      try {
        const parsed = JSON.parse(r.result);
        if (!isValidState(parsed) || !parsed.businesses.length) throw new Error('invalid');
        if (!(await ask('Replace all current data with this backup?'))) return;
        state = parsed;
        if (!state.businesses.some((b) => b.id === state.activeBusinessId)) state.activeBusinessId = state.businesses[0].id;
        persist();
        toast('Backup imported');
        go('#/create');
      } catch {
        toast('That file is not a valid Content Studio backup.');
      }
    };
    r.readAsText(f);
  };
  app.querySelector('#demo').onclick = async () => {
    if (!(await ask('Replace all data with the demo business?'))) return;
    state = demoState();
    persist();
    go('#/create');
  };
  app.querySelector('#reset').onclick = async () => {
    if (!(await ask('Delete everything and start with an empty business profile?'))) return;
    state = emptyState();
    persist();
    go('#/business');
  };
}

// ---------- boot

persist();
route();
