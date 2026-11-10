# Diamond Health — diamondhealth.co.za

Online health shop: product catalogue, cart, checkout, and a customer database where shoppers register and save their personal and delivery details.

No packages to install — it runs on Node.js 22.5 or newer using Node's built-in SQLite.

## Run it in VS Code

1. Install [Node.js](https://nodejs.org) (version 22 LTS or newer).
2. Open this folder in VS Code (**File → Open Folder…**).
3. Open the terminal (**Terminal → New Terminal**) and run:

   ```
   npm start
   ```

4. Open http://localhost:3000 in your browser.

Or press **F5** to run it with the debugger ("Run Diamond Health").

## Adding your products

Edit **`products.json`**. Each product looks like:

```json
{ "id": 15, "sku": "ABC-123", "name": "Product name", "brand": "Brand", "category": "Vitamins & Supplements",
  "description": "Short description", "price": 99.99, "stock": 25, "requires_prescription": false,
  "image": "/img/products/abc-123.jpg" }
```

- `id` must be unique and should never be reused.
- `price` is in Rand.
- Put product photos in `public/img/products/` and set `image` to its path. With no image, a category icon is shown.
- `requires_prescription: true` shows the product as "Prescription only" — it can't be added to the cart.
- Restart the server after editing; the catalogue reloads on start. Removing a product from the file hides it from the shop.

## Order emails

When a customer places an order, two emails go out: a confirmation to the customer (with EFT banking details and a payment reference like `DH12`), and a new-order alert to the shop. Emails are sent through [Resend](https://resend.com) — no packages needed.

Set these in Render → your service → **Environment**:

| Variable | Example |
|---|---|
| `RESEND_API_KEY` | `re_xxxxxxxx` (from resend.com → API Keys) |
| `MAIL_FROM` | `Diamond Health <orders@diamondhealth.co.za>` |
| `SHOP_EMAIL` | `orders@yourshop.co.za` (comma-separate for more than one) |
| `EFT_DETAILS` | `FNB · Diamond Health (Pty) Ltd\nAccount 62000000000 · Branch 250655` (`\n` = new line) |
| `SITE_URL` | `https://diamondhealth.co.za` |

Without `RESEND_API_KEY` (e.g. on your own computer) the emails are printed in the terminal instead of sent. A failed email never stops an order from going through; check the Render logs if one goes missing.

## Customer database

Stored in `data/diamondhealth.db` (SQLite, created automatically). Tables: `customers`, `sessions`, `products`, `orders`, `order_items`.

Customers can: create an account (with POPIA consent), sign in, edit name/phone/date of birth/delivery address, opt in or out of marketing, view their orders, and delete their personal details.

Passwords are hashed (scrypt). The database is in `.gitignore` so customer data never ends up on GitHub.

### Viewing customers and orders (admin)

Start the server with an admin key:

```
ADMIN_KEY=choose-a-long-secret npm start          # macOS / Linux
$env:ADMIN_KEY="choose-a-long-secret"; npm start  # Windows PowerShell
```

Then:

```
curl -H "x-admin-key: choose-a-long-secret" http://localhost:3000/api/admin/customers
curl -H "x-admin-key: choose-a-long-secret" http://localhost:3000/api/admin/orders
```

You can also open `data/diamondhealth.db` with the free "SQLite Viewer" extension in VS Code.

## Before going live

- **Pharmacy licensing:** selling medicines online in South Africa requires a pharmacy registered with the SA Pharmacy Council, and Schedule 2+ medicines have dispensing rules. The site blocks prescription items from checkout; confirm the rest with your responsible pharmacist.
- **POPIA:** complete `public/privacy.html` (Information Officer details) and have it reviewed.
- **Payments:** checkout currently records EFT / card-on-delivery orders. Add a gateway such as PayFast, Yoco, Peach Payments or Ozow for online card payments.
- **Hosting:** needs a host that runs Node.js (e.g. Render, Railway, a VPS, or Afrihost/Hetzner cloud server) with persistent disk for the database, plus HTTPS. Point `diamondhealth.co.za` DNS at it.
- **Emails:** order confirmation emails aren't wired up yet.

## Project layout

```
server.js          Web server, API and database
products.json      Your product list
public/            Website (HTML, CSS, JS, images)
  index.html       Shop, cart, checkout, account
  privacy.html     POPIA privacy notice
  app.js           Storefront logic
  styles.css       Styling
data/              Customer database (created on first run, not committed)
```
