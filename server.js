// Diamond Health — online health shop
// Zero-dependency server: Node 22+ (node:http + node:sqlite + node:crypto)
// Run:  node server.js   then open http://localhost:3000

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || ''; // set this to enable /api/admin/*
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

// ---------- Database ----------
const db = new DatabaseSync(path.join(DATA_DIR, 'diamondhealth.db'));
db.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    phone TEXT,
    date_of_birth TEXT,
    address_line1 TEXT,
    address_line2 TEXT,
    suburb TEXT,
    city TEXT,
    province TEXT,
    postal_code TEXT,
    marketing_opt_in INTEGER DEFAULT 0,
    popia_consent_at TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY,
    sku TEXT UNIQUE,
    name TEXT NOT NULL,
    brand TEXT,
    category TEXT,
    description TEXT,
    price_cents INTEGER NOT NULL,
    stock INTEGER DEFAULT 0,
    requires_prescription INTEGER DEFAULT 0,
    image TEXT,
    active INTEGER DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    status TEXT DEFAULT 'pending',
    payment_method TEXT,
    delivery_address TEXT,
    subtotal_cents INTEGER,
    delivery_cents INTEGER,
    total_cents INTEGER,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id),
    name TEXT,
    unit_price_cents INTEGER,
    quantity INTEGER
  );
`);

// Load / refresh the product catalogue from products.json on every start
function syncProducts() {
  const list = JSON.parse(fs.readFileSync(path.join(ROOT, 'products.json'), 'utf8'));
  const upsert = db.prepare(`
    INSERT INTO products (id, sku, name, brand, category, description, price_cents, stock, requires_prescription, image, active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    ON CONFLICT(id) DO UPDATE SET sku=excluded.sku, name=excluded.name, brand=excluded.brand,
      category=excluded.category, description=excluded.description, price_cents=excluded.price_cents,
      stock=excluded.stock, requires_prescription=excluded.requires_prescription, image=excluded.image, active=1`);
  const ids = [];
  for (const p of list) {
    upsert.run(p.id, p.sku || null, p.name, p.brand || '', p.category || 'General', p.description || '',
      Math.round(Number(p.price) * 100), p.stock ?? 0, p.requires_prescription ? 1 : 0, p.image || '');
    ids.push(p.id);
  }
  if (ids.length) db.exec(`UPDATE products SET active = 0 WHERE id NOT IN (${ids.map(Number).join(',')})`);
  console.log(`Loaded ${ids.length} products from products.json`);
}
syncProducts();

// ---------- Helpers ----------
const DELIVERY_FEE_CENTS = 9900;          // R99 delivery
const FREE_DELIVERY_FROM_CENTS = 50000;   // free over R500

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pw, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function checkPassword(pw, stored) {
  const [salt, hash] = stored.split(':');
  const test = crypto.scryptSync(pw, salt, 64);
  return crypto.timingSafeEqual(test, Buffer.from(hash, 'hex'));
}
function send(res, status, data, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(data));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', c => { raw += c; if (raw.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error('Invalid JSON')); } });
  });
}
function cookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').filter(Boolean)
    .map(c => c.trim().split('=').map(decodeURIComponent)));
}
function currentCustomer(req) {
  const token = cookies(req).dh_session;
  if (!token) return null;
  const row = db.prepare(`SELECT c.* FROM sessions s JOIN customers c ON c.id = s.customer_id
                          WHERE s.token = ? AND s.expires_at > datetime('now')`).get(token);
  return row || null;
}
function publicCustomer(c) {
  const { password_hash, ...rest } = c;
  return rest;
}
function startSession(res, customerId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare(`INSERT INTO sessions (token, customer_id, expires_at) VALUES (?, ?, datetime('now', '+30 days'))`)
    .run(token, customerId);
  return `dh_session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`;
}
const PROFILE_FIELDS = ['first_name', 'last_name', 'phone', 'date_of_birth', 'address_line1', 'address_line2',
  'suburb', 'city', 'province', 'postal_code'];
const clean = v => (v == null ? null : String(v).trim().slice(0, 200));
const isEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e || '');
const isPhone = p => !p || /^[+0-9 ()-]{9,16}$/.test(p);

// ---------- API ----------
async function api(req, res, url) {
  const route = `${req.method} ${url.pathname}`;

  if (route === 'GET /api/products') {
    const rows = db.prepare(`SELECT id, sku, name, brand, category, description, price_cents, stock,
                             requires_prescription, image FROM products WHERE active = 1 ORDER BY category, name`).all();
    return send(res, 200, rows);
  }

  if (route === 'POST /api/register') {
    const b = await readBody(req);
    const email = clean(b.email)?.toLowerCase();
    if (!isEmail(email)) return send(res, 400, { error: 'Please enter a valid email address.' });
    if (!b.password || b.password.length < 8) return send(res, 400, { error: 'Password must be at least 8 characters.' });
    if (!clean(b.first_name) || !clean(b.last_name)) return send(res, 400, { error: 'First and last name are required.' });
    if (!isPhone(b.phone)) return send(res, 400, { error: 'Please enter a valid phone number.' });
    if (!b.popia_consent) return send(res, 400, { error: 'Please accept the privacy notice to create an account.' });
    if (db.prepare('SELECT id FROM customers WHERE email = ?').get(email))
      return send(res, 409, { error: 'An account with this email already exists. Please sign in.' });
    const vals = PROFILE_FIELDS.map(f => clean(b[f]));
    const info = db.prepare(`INSERT INTO customers (email, password_hash, ${PROFILE_FIELDS.join(', ')}, marketing_opt_in, popia_consent_at)
      VALUES (?, ?, ${PROFILE_FIELDS.map(() => '?').join(', ')}, ?, datetime('now'))`)
      .run(email, hashPassword(b.password), ...vals, b.marketing_opt_in ? 1 : 0);
    const cookie = startSession(res, info.lastInsertRowid);
    const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(info.lastInsertRowid);
    return send(res, 201, publicCustomer(c), { 'Set-Cookie': cookie });
  }

  if (route === 'POST /api/login') {
    const b = await readBody(req);
    const c = db.prepare('SELECT * FROM customers WHERE email = ?').get(clean(b.email)?.toLowerCase() || '');
    if (!c || !checkPassword(b.password || '', c.password_hash))
      return send(res, 401, { error: 'Incorrect email or password.' });
    return send(res, 200, publicCustomer(c), { 'Set-Cookie': startSession(res, c.id) });
  }

  if (route === 'POST /api/logout') {
    const token = cookies(req).dh_session;
    if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return send(res, 200, { ok: true }, { 'Set-Cookie': 'dh_session=; Path=/; Max-Age=0' });
  }

  // ----- signed-in routes -----
  const me = currentCustomer(req);

  if (route === 'GET /api/me') {
    return me ? send(res, 200, publicCustomer(me)) : send(res, 401, { error: 'Not signed in' });
  }
  if (!me && url.pathname.startsWith('/api/me')) return send(res, 401, { error: 'Please sign in.' });
  if (!me && route === 'POST /api/orders') return send(res, 401, { error: 'Please sign in to check out.' });

  if (route === 'PUT /api/me') {
    const b = await readBody(req);
    if (!isPhone(b.phone)) return send(res, 400, { error: 'Please enter a valid phone number.' });
    const sets = PROFILE_FIELDS.filter(f => f in b);
    if (sets.length) {
      db.prepare(`UPDATE customers SET ${sets.map(f => `${f} = ?`).join(', ')}, marketing_opt_in = ?, updated_at = datetime('now') WHERE id = ?`)
        .run(...sets.map(f => clean(b[f])), b.marketing_opt_in ? 1 : 0, me.id);
    }
    return send(res, 200, publicCustomer(db.prepare('SELECT * FROM customers WHERE id = ?').get(me.id)));
  }

  if (route === 'DELETE /api/me') {
    // POPIA: customer may ask for their personal information to be deleted.
    db.prepare(`UPDATE customers SET email = 'deleted-' || id || '@deleted.local', password_hash = 'x:00',
      first_name = 'Deleted', last_name = 'Customer', phone = NULL, date_of_birth = NULL, address_line1 = NULL,
      address_line2 = NULL, suburb = NULL, city = NULL, province = NULL, postal_code = NULL, marketing_opt_in = 0
      WHERE id = ?`).run(me.id);
    db.prepare('DELETE FROM sessions WHERE customer_id = ?').run(me.id);
    return send(res, 200, { ok: true }, { 'Set-Cookie': 'dh_session=; Path=/; Max-Age=0' });
  }

  if (route === 'GET /api/me/orders') {
    const orders = db.prepare('SELECT * FROM orders WHERE customer_id = ? ORDER BY id DESC').all(me.id);
    const items = db.prepare('SELECT name, unit_price_cents, quantity FROM order_items WHERE order_id = ?');
    return send(res, 200, orders.map(o => ({ ...o, items: items.all(o.id) })));
  }

  if (route === 'POST /api/orders') {
    const b = await readBody(req);
    if (!Array.isArray(b.items) || !b.items.length) return send(res, 400, { error: 'Your cart is empty.' });
    if (!me.address_line1 || !me.city || !me.postal_code)
      return send(res, 400, { error: 'Please add a delivery address to your profile first.' });
    const getP = db.prepare('SELECT * FROM products WHERE id = ? AND active = 1');
    const lines = [];
    for (const it of b.items) {
      const p = getP.get(Number(it.id));
      const qty = Math.max(1, Math.min(20, parseInt(it.qty, 10) || 1));
      if (!p) return send(res, 400, { error: 'A product in your cart is no longer available.' });
      if (p.requires_prescription) return send(res, 400, { error: `${p.name} needs a prescription — please contact the pharmacy.` });
      if (p.stock < qty) return send(res, 400, { error: `Only ${p.stock} of ${p.name} left in stock.` });
      lines.push({ p, qty });
    }
    const subtotal = lines.reduce((s, l) => s + l.p.price_cents * l.qty, 0);
    const delivery = subtotal >= FREE_DELIVERY_FROM_CENTS ? 0 : DELIVERY_FEE_CENTS;
    const address = [me.address_line1, me.address_line2, me.suburb, me.city, me.province, me.postal_code].filter(Boolean).join(', ');
    db.exec('BEGIN');
    try {
      const o = db.prepare(`INSERT INTO orders (customer_id, payment_method, delivery_address, subtotal_cents, delivery_cents, total_cents, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(me.id, clean(b.payment_method) || 'eft', address, subtotal, delivery, subtotal + delivery, clean(b.notes));
      const addItem = db.prepare('INSERT INTO order_items (order_id, product_id, name, unit_price_cents, quantity) VALUES (?, ?, ?, ?, ?)');
      const dec = db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?');
      for (const l of lines) { addItem.run(o.lastInsertRowid, l.p.id, l.p.name, l.p.price_cents, l.qty); dec.run(l.qty, l.p.id); }
      db.exec('COMMIT');
      return send(res, 201, { order_id: Number(o.lastInsertRowid), total_cents: subtotal + delivery });
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }

  // ----- admin (requires ADMIN_KEY env + x-admin-key header) -----
  if (url.pathname.startsWith('/api/admin/')) {
    if (!ADMIN_KEY || req.headers['x-admin-key'] !== ADMIN_KEY) return send(res, 403, { error: 'Forbidden' });
    if (route === 'GET /api/admin/customers')
      return send(res, 200, db.prepare('SELECT * FROM customers ORDER BY id DESC').all().map(publicCustomer));
    if (route === 'GET /api/admin/orders')
      return send(res, 200, db.prepare(`SELECT o.*, c.first_name, c.last_name, c.email, c.phone FROM orders o
                                        JOIN customers c ON c.id = o.customer_id ORDER BY o.id DESC`).all());
  }

  return send(res, 404, { error: 'Not found' });
}

// ---------- Static files ----------
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.json': 'application/json' };

function serveStatic(req, res, url) {
  let p = decodeURIComponent(url.pathname);
  if (p === '/') p = '/index.html';
  if (!path.extname(p)) p += '.html';
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/html' }); return res.end('<h1>Page not found</h1><a href="/">Back to Diamond Health</a>'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    serveStatic(req, res, url);
  } catch (e) {
    console.error(e);
    send(res, 500, { error: 'Something went wrong. Please try again.' });
  }
}).listen(PORT, () => console.log(`Diamond Health running at http://localhost:${PORT}`));
