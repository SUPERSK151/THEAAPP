// Diamond Health — order emails
// Sends through Resend (https://resend.com) using Node's built-in fetch, so there is nothing to install.
// Settings (Render → Environment):
//   RESEND_API_KEY  your Resend API key. If it's missing, emails are printed to the log instead of sent.
//   MAIL_FROM       sender, e.g.  Diamond Health <orders@diamondhealth.co.za>
//   SHOP_EMAIL      where new-order alerts go (one address, or several separated by commas)
//   EFT_DETAILS     bank details shown to customers who pay by EFT. Use \n for new lines.
//   SITE_URL        e.g. https://diamondhealth.co.za

const MAIL_FROM = process.env.MAIL_FROM || 'Diamond Health <orders@diamondhealth.co.za>';
const SHOP_EMAIL = (process.env.SHOP_EMAIL || '').split(',').map(s => s.trim()).filter(Boolean);
const EFT_DETAILS = (process.env.EFT_DETAILS || '').replace(/\\n/g, '\n').trim();
const SITE_URL = (process.env.SITE_URL || 'https://diamondhealth.co.za').replace(/\/$/, '');

const PAYMENT_LABELS = {
  eft: 'EFT / bank transfer',
  card_on_delivery: 'Card on delivery',
};

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rand = cents => 'R' + (cents / 100).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function sendMail({ to, subject, html, text, replyTo }) {
  if (!to || (Array.isArray(to) && !to.length)) return;
  if (!process.env.RESEND_API_KEY) {
    console.log(`[email not sent: RESEND_API_KEY not set] To: ${[].concat(to).join(', ')} | ${subject}\n${text}\n`);
    return;
  }
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: MAIL_FROM, to: [].concat(to), subject, html, text, ...(replyTo ? { reply_to: replyTo } : {}) }),
  });
  if (!r.ok) throw new Error(`Email to ${to} failed (${r.status}): ${await r.text()}`);
}

// ---------- Layout ----------
function layout(title, body) {
  return `<!doctype html><html><body style="margin:0;background:#eef2f1;font-family:Helvetica,Arial,sans-serif;color:#10263a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f1;padding:32px 12px">
<tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;background:#ffffff;border:1px solid #d6dfdd">
    <tr><td style="padding:28px 32px;border-bottom:1px solid #a8834c;text-align:center">
      <div style="font-family:Georgia,'Times New Roman',serif;font-size:26px;letter-spacing:1px;color:#10263a">Diamond Health</div>
    </td></tr>
    <tr><td style="padding:32px">
      <h1 style="font-family:Georgia,'Times New Roman',serif;font-weight:normal;font-size:24px;margin:0 0 16px">${esc(title)}</h1>
      ${body}
    </td></tr>
    <tr><td style="padding:20px 32px;background:#10263a;color:#cfe6df;font-size:12px;text-align:center">
      Diamond Health · <a href="${SITE_URL}" style="color:#cfe6df">${esc(SITE_URL.replace(/^https?:\/\//, ''))}</a>
    </td></tr>
  </table>
</td></tr></table></body></html>`;
}

function itemsTable(order) {
  const rows = order.items.map(i => `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #d6dfdd">${esc(i.name)} <span style="color:#6b7f8e">× ${i.quantity}</span></td>
      <td style="padding:10px 0;border-bottom:1px solid #d6dfdd;text-align:right;white-space:nowrap">${rand(i.unit_price_cents * i.quantity)}</td>
    </tr>`).join('');
  const sum = (label, val, bold) => `<tr><td style="padding:6px 0;${bold ? 'font-weight:bold;font-size:16px' : 'color:#3d5568'}">${label}</td>
    <td style="padding:6px 0;text-align:right;${bold ? 'font-weight:bold;font-size:16px' : 'color:#3d5568'}">${val}</td></tr>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;margin:8px 0 20px">
    ${rows}
    ${sum('Subtotal', rand(order.subtotal_cents))}
    ${sum('Delivery', order.delivery_cents ? rand(order.delivery_cents) : 'Free')}
    ${sum('Total', rand(order.total_cents), true)}
  </table>`;
}

const textItems = order => order.items.map(i => `  ${i.name} x ${i.quantity}  ${rand(i.unit_price_cents * i.quantity)}`).join('\n') +
  `\n  Subtotal ${rand(order.subtotal_cents)}\n  Delivery ${order.delivery_cents ? rand(order.delivery_cents) : 'Free'}\n  Total ${rand(order.total_cents)}`;

// ---------- Emails ----------
function customerEmail(order, customer) {
  const method = PAYMENT_LABELS[order.payment_method] || order.payment_method;
  const eft = order.payment_method === 'eft';
  const payHtml = eft
    ? `<div style="background:#eef2f1;border-left:3px solid #a8834c;padding:16px 18px;margin:0 0 20px;font-size:14px">
         <b>How to pay</b><br>
         ${EFT_DETAILS ? esc(EFT_DETAILS).replace(/\n/g, '<br>') + '<br>' : 'We will send our banking details shortly.<br>'}
         Please use <b>DH${order.id}</b> as your payment reference. We'll dispatch your order once payment reflects.
       </div>`
    : `<p style="font-size:14px;margin:0 0 20px">You'll pay by card when your order is delivered.</p>`;
  const payText = eft
    ? `HOW TO PAY\n${EFT_DETAILS || 'We will send our banking details shortly.'}\nReference: DH${order.id}\nWe'll dispatch once payment reflects.`
    : `You'll pay by card when your order is delivered.`;

  const html = layout(`Thank you, ${customer.first_name}`, `
    <p style="font-size:15px;margin:0 0 20px">We've received your order <b>#${order.id}</b> and our pharmacy team is getting it ready.</p>
    ${payHtml}
    ${itemsTable(order)}
    <p style="font-size:14px;margin:0 0 4px"><b>Delivering to</b></p>
    <p style="font-size:14px;color:#3d5568;margin:0 0 20px">${esc(customer.first_name)} ${esc(customer.last_name)}<br>${esc(order.delivery_address)}</p>
    <p style="font-size:14px;margin:0 0 4px"><b>Payment</b></p>
    <p style="font-size:14px;color:#3d5568;margin:0 0 24px">${esc(method)}</p>
    <a href="${SITE_URL}/#account" style="display:inline-block;background:#10263a;color:#ffffff;text-decoration:none;padding:12px 24px;font-size:14px">View my orders</a>
    <p style="font-size:13px;color:#6b7f8e;margin:24px 0 0">Questions about your order? Just reply to this email.</p>`);

  const text = `Thank you, ${customer.first_name}\n\nWe've received your order #${order.id}.\n\n${payText}\n\n${textItems(order)}\n\nDelivering to: ${customer.first_name} ${customer.last_name}, ${order.delivery_address}\nPayment: ${method}\n\nView your orders: ${SITE_URL}/#account\nQuestions? Just reply to this email.`;

  return { to: customer.email, subject: `Your Diamond Health order #${order.id}`, html, text,
    replyTo: SHOP_EMAIL[0] };
}

function shopEmail(order, customer) {
  const method = PAYMENT_LABELS[order.payment_method] || order.payment_method;
  const html = layout(`New order #${order.id}`, `
    <p style="font-size:15px;margin:0 0 20px"><b>${rand(order.total_cents)}</b> · ${esc(method)}</p>
    ${itemsTable(order)}
    <p style="font-size:14px;margin:0 0 4px"><b>Customer</b></p>
    <p style="font-size:14px;color:#3d5568;margin:0 0 20px">${esc(customer.first_name)} ${esc(customer.last_name)}<br>
      <a href="mailto:${esc(customer.email)}" style="color:#10263a">${esc(customer.email)}</a>${customer.phone ? `<br>${esc(customer.phone)}` : ''}</p>
    <p style="font-size:14px;margin:0 0 4px"><b>Deliver to</b></p>
    <p style="font-size:14px;color:#3d5568;margin:0 0 20px">${esc(order.delivery_address)}</p>
    ${order.notes ? `<p style="font-size:14px;margin:0 0 4px"><b>Customer notes</b></p>
    <p style="font-size:14px;color:#3d5568;margin:0">${esc(order.notes)}</p>` : ''}`);

  const text = `New order #${order.id}: ${rand(order.total_cents)} (${method})\n\n${textItems(order)}\n\nCustomer: ${customer.first_name} ${customer.last_name}, ${customer.email}${customer.phone ? ', ' + customer.phone : ''}\nDeliver to: ${order.delivery_address}${order.notes ? `\nNotes: ${order.notes}` : ''}`;

  return { to: SHOP_EMAIL, subject: `New order #${order.id}: ${rand(order.total_cents)} from ${customer.first_name} ${customer.last_name}`,
    html, text, replyTo: customer.email };
}

// Sends both emails. Never throws: a failed email must not break checkout.
async function sendOrderEmails(order, customer) {
  const jobs = [customerEmail(order, customer)];
  if (SHOP_EMAIL.length) jobs.push(shopEmail(order, customer));
  else console.log('SHOP_EMAIL not set: no new-order alert sent to the shop.');
  const results = await Promise.allSettled(jobs.map(sendMail));
  results.forEach(r => r.status === 'rejected' && console.error(r.reason));
}

module.exports = { sendOrderEmails };
