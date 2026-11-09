// Diamond Health storefront
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const rand = c => 'R' + (c / 100).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const DELIVERY = 9900, FREE_FROM = 50000;

let products = [];
let me = null;
let activeCat = 'All';
let cart = load();

function load() { try { return JSON.parse(localStorage.getItem('dh_cart')) || {}; } catch { return {}; } }
function save() { try { localStorage.setItem('dh_cart', JSON.stringify(cart)); } catch {} }

async function api(path, opts = {}) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 2600);
}

// ---------- Category icons (used when a product has no image) ----------
const ICONS = {
  'Vitamins & Supplements': '<rect x="14" y="22" width="36" height="20" rx="10" fill="#0f766e"/><rect x="32" y="22" width="18" height="20" rx="0" fill="#5eead4"/><rect x="14" y="22" width="36" height="20" rx="10" fill="none" stroke="#0f766e" stroke-width="3"/>',
  'Pain & Fever': '<circle cx="32" cy="32" r="18" fill="#fff" stroke="#0f766e" stroke-width="3"/><path d="M18 32h28" stroke="#0f766e" stroke-width="3"/>',
  'Cold & Flu': '<path d="M32 12v40M14 22l36 20M50 22L14 42" stroke="#0f766e" stroke-width="3.5" stroke-linecap="round"/>',
  'Skin Care': '<rect x="22" y="20" width="20" height="32" rx="5" fill="#fff" stroke="#0f766e" stroke-width="3"/><rect x="26" y="12" width="12" height="8" rx="2" fill="#0f766e"/>',
  'Baby & Mom': '<circle cx="32" cy="28" r="12" fill="#fff" stroke="#0f766e" stroke-width="3"/><path d="M20 52c2-8 22-8 24 0" stroke="#0f766e" stroke-width="3" fill="none"/>',
  'Medical Devices': '<path d="M10 34h12l5-12 8 22 5-10h14" stroke="#0f766e" stroke-width="3.5" fill="none" stroke-linejoin="round"/>',
  'First Aid': '<rect x="12" y="18" width="40" height="30" rx="5" fill="#fff" stroke="#0f766e" stroke-width="3"/><path d="M28 26h8v4h4v8h-4v4h-8v-4h-4v-8h4z" fill="#0f766e"/>',
  'Prescription': '<rect x="16" y="12" width="32" height="40" rx="4" fill="#fff" stroke="#0f766e" stroke-width="3"/><text x="32" y="40" font-size="16" font-weight="700" text-anchor="middle" fill="#0f766e" font-family="sans-serif">Rx</text>',
};
const icon = cat => `<svg viewBox="0 0 64 64" aria-hidden="true">${ICONS[cat] || ICONS['First Aid']}</svg>`;

// ---------- Shop ----------
function renderCategories() {
  const cats = ['All', ...new Set(products.map(p => p.category))];
  $('#categories').innerHTML = cats.map(c => `<button class="chip ${c === activeCat ? 'active' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('');
}

function renderProducts() {
  const q = $('#search').value.trim().toLowerCase();
  const list = products.filter(p => (activeCat === 'All' || p.category === activeCat) &&
    (!q || `${p.name} ${p.brand} ${p.category} ${p.description}`.toLowerCase().includes(q)));
  $('#emptyMsg').hidden = list.length > 0;
  $('#productGrid').innerHTML = list.map(p => {
    const rx = p.requires_prescription, out = p.stock <= 0;
    return `<article class="product">
      <div class="thumb">${p.image ? `<img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy">` : icon(p.category)}</div>
      <div class="info">
        <span class="cat">${esc(p.category)}</span>
        <h3>${esc(p.name)}</h3>
        <p class="desc">${esc(p.description)}</p>
        ${!rx && p.stock > 0 && p.stock <= 5 ? `<span class="stock-low">Only ${p.stock} left</span>` : ''}
        <div class="bottom">
          ${rx ? '<span class="badge">Prescription only</span>' : `<span class="price">${rand(p.price_cents)}</span>`}
          ${rx ? `<a class="btn" href="mailto:hello@diamondhealth.co.za?subject=Prescription%20enquiry">Enquire</a>`
               : `<button class="btn btn-primary" data-add="${p.id}" ${out ? 'disabled' : ''}>${out ? 'Sold out' : 'Add'}</button>`}
        </div>
      </div>
    </article>`;
  }).join('');
}

// ---------- Cart ----------
function cartLines() {
  return Object.entries(cart).map(([id, qty]) => ({ p: products.find(x => x.id == id), qty })).filter(l => l.p);
}
function totals() {
  const sub = cartLines().reduce((s, l) => s + l.p.price_cents * l.qty, 0);
  const del = sub === 0 ? 0 : sub >= FREE_FROM ? 0 : DELIVERY;
  return { sub, del, total: sub + del };
}
function renderCart() {
  const lines = cartLines();
  $('#cartCount').textContent = lines.reduce((s, l) => s + l.qty, 0);
  $('#cartItems').innerHTML = lines.length ? lines.map(({ p, qty }) => `
    <div class="line">
      <div><b>${esc(p.name)}</b><br><span class="muted small">${rand(p.price_cents)} each</span></div>
      <b>${rand(p.price_cents * qty)}</b>
      <div class="qty"><button data-dec="${p.id}" aria-label="Less">−</button><span>${qty}</span><button data-inc="${p.id}" aria-label="More">+</button></div>
      <button class="remove" data-rm="${p.id}">Remove</button>
    </div>`).join('') : '<p class="muted center" style="padding:40px 0">Your cart is empty.</p>';
  const t = totals();
  $('#cartSubtotal').textContent = rand(t.sub);
  $('#cartDelivery').textContent = t.sub === 0 ? '—' : t.del === 0 ? 'Free' : `${rand(t.del)} (free over ${rand(FREE_FROM)})`;
  $('#cartTotal').textContent = rand(t.total);
  $('#checkoutBtn').disabled = !lines.length;
}
function addToCart(id, n = 1) {
  const p = products.find(x => x.id == id); if (!p) return;
  const next = (cart[id] || 0) + n;
  if (next <= 0) delete cart[id];
  else if (next > p.stock) return toast(`Only ${p.stock} in stock.`);
  else cart[id] = next;
  save(); renderCart();
}
function openCart() { $('#cart').hidden = false; $('#overlay').hidden = false; }
function closeAll() { $('#cart').hidden = true; $('#overlay').hidden = true; $$('.modal').forEach(m => (m.hidden = true)); }

// ---------- Auth ----------
function setTab(name) {
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  $('#loginForm').hidden = name !== 'login';
  $('#registerForm').hidden = name !== 'register';
}
function openAuth(tab = 'login') { closeAll(); setTab(tab); $('#authModal').hidden = false; }
function formData(form) {
  const o = {};
  for (const el of form.elements) if (el.name) o[el.name] = el.type === 'checkbox' ? el.checked : el.value;
  return o;
}
function setMe(c) {
  me = c;
  $('#accountBtn').textContent = me ? `Hi, ${me.first_name}` : 'Sign in';
}

// ---------- Account page ----------
async function showAccount() {
  if (!me) { location.hash = '#shop'; return openAuth('login'); }
  const f = $('#profileForm');
  for (const el of f.elements) if (el.name) {
    if (el.type === 'checkbox') el.checked = !!me[el.name]; else el.value = me[el.name] ?? '';
  }
  try {
    const orders = await api('/api/me/orders');
    $('#ordersList').innerHTML = orders.length ? orders.map(o => `
      <div class="order">
        <div class="order-head"><span>Order #${o.id}</span><span>${rand(o.total_cents)}</span></div>
        <div class="small muted">${esc(o.created_at)} · <span class="status">${esc(o.status)}</span></div>
        <div class="small">${o.items.map(i => `${i.quantity} × ${esc(i.name)}`).join(', ')}</div>
      </div>`).join('') : 'No orders yet.';
  } catch {}
}

// ---------- Checkout ----------
function addressComplete() { return me && me.address_line1 && me.city && me.postal_code; }
function openCheckout() {
  if (!me) { toast('Please sign in or create an account to check out.'); return openAuth('register'); }
  closeAll();
  const t = totals();
  const addr = [me.address_line1, me.address_line2, me.suburb, me.city, me.province, me.postal_code].filter(Boolean).map(esc).join(', ');
  $('#checkoutBody').innerHTML = `
    <form id="checkoutForm" class="form">
      <div><b>Deliver to</b><br>${addressComplete() ? `${esc(me.first_name)} ${esc(me.last_name)}<br><span class="muted">${addr}</span>`
        : '<span class="msg err">Add your delivery address first.</span>'} <a href="#account" data-close>Edit</a></div>
      <label>Payment method
        <select name="payment_method">
          <option value="eft">EFT / bank transfer (details sent by email)</option>
          <option value="card_on_delivery">Card on delivery</option>
        </select>
      </label>
      <label>Notes for the pharmacy (optional)<textarea name="notes" rows="2"></textarea></label>
      <div class="sum"><span>Subtotal</span><span>${rand(t.sub)}</span></div>
      <div class="sum"><span>Delivery</span><span>${t.del ? rand(t.del) : 'Free'}</span></div>
      <div class="sum total"><span>Total</span><b>${rand(t.total)}</b></div>
      <button class="btn btn-primary btn-block" ${addressComplete() ? '' : 'disabled'}>Place order</button>
      <p class="msg" id="checkoutMsg"></p>
    </form>`;
  $('#checkoutModal').hidden = false;
  $('#checkoutForm').onsubmit = async e => {
    e.preventDefault();
    const b = formData(e.target);
    try {
      const r = await api('/api/orders', { method: 'POST', body: { ...b, items: cartLines().map(l => ({ id: l.p.id, qty: l.qty })) } });
      cart = {}; save(); renderCart();
      if (location.hash === '#account') showAccount();
      products = await api('/api/products'); renderProducts();
      $('#checkoutBody').innerHTML = `<p style="font-size:1.1rem">Thank you! Order <b>#${r.order_id}</b> (${rand(r.total_cents)}) has been placed.</p>
        <p class="muted">We'll email you payment and delivery details shortly.</p>
        <a href="#account" class="btn btn-primary" data-close>View my orders</a>`;
    } catch (err) { const m = $('#checkoutMsg'); m.textContent = err.message; m.className = 'msg err'; }
  };
}

// ---------- Routing ----------
function route() {
  const v = location.hash === '#account' ? 'account' : 'shop';
  $('#view-shop').hidden = v !== 'shop';
  $('#view-account').hidden = v !== 'account';
  if (v === 'account') showAccount();
  window.scrollTo(0, 0);
}

// ---------- Events ----------
document.addEventListener('click', e => {
  const t = e.target.closest('[data-add],[data-inc],[data-dec],[data-rm],[data-cat],[data-close],[data-tab]');
  if (!t) return;
  if (t.dataset.add) { addToCart(t.dataset.add); toast('Added to cart'); }
  if (t.dataset.inc) addToCart(t.dataset.inc, 1);
  if (t.dataset.dec) addToCart(t.dataset.dec, -1);
  if (t.dataset.rm) { delete cart[t.dataset.rm]; save(); renderCart(); }
  if (t.dataset.cat) { activeCat = t.dataset.cat; renderCategories(); renderProducts(); }
  if (t.dataset.tab) setTab(t.dataset.tab);
  if ('close' in t.dataset) closeAll();
});
$('#overlay').onclick = closeAll;
document.addEventListener('keydown', e => e.key === 'Escape' && closeAll());
$('#cartBtn').onclick = openCart;
$('#checkoutBtn').onclick = openCheckout;
$('#accountBtn').onclick = () => (me ? (location.hash = '#account') : openAuth('login'));
$('#search').oninput = () => { if (location.hash === '#account') location.hash = '#shop'; renderProducts(); };
window.addEventListener('hashchange', route);

$('#loginForm').onsubmit = async e => {
  e.preventDefault();
  try { setMe(await api('/api/login', { method: 'POST', body: formData(e.target) })); closeAll(); toast(`Welcome back, ${me.first_name}!`); e.target.reset(); }
  catch (err) { $('#loginMsg').textContent = err.message; $('#loginMsg').className = 'msg err'; }
};
$('#registerForm').onsubmit = async e => {
  e.preventDefault();
  try {
    setMe(await api('/api/register', { method: 'POST', body: formData(e.target) }));
    closeAll(); e.target.reset(); toast('Account created — add your delivery address.'); location.hash = '#account';
  } catch (err) { $('#registerMsg').textContent = err.message; $('#registerMsg').className = 'msg err'; }
};
$('#profileForm').onsubmit = async e => {
  e.preventDefault();
  const m = $('#profileMsg');
  try { setMe(await api('/api/me', { method: 'PUT', body: formData(e.target) })); m.textContent = 'Saved ✓'; m.className = 'msg ok'; }
  catch (err) { m.textContent = err.message; m.className = 'msg err'; }
};
$('#logoutBtn').onclick = async () => { await api('/api/logout', { method: 'POST' }); setMe(null); location.hash = '#shop'; toast('Signed out'); };
$('#deleteBtn').onclick = async () => {
  if (!window.confirm('Delete your personal details from Diamond Health? This cannot be undone.')) return;
  await api('/api/me', { method: 'DELETE' }); setMe(null); location.hash = '#shop'; toast('Your details have been deleted.');
};

// ---------- Start ----------
(async () => {
  try { products = await api('/api/products'); } catch { toast('Could not load products.'); }
  try { setMe(await api('/api/me')); } catch { setMe(null); }
  renderCategories(); renderProducts(); renderCart(); route();
})();
