# SalesHub — Premium Low Stock reference mapping

## Original materials (provided by the user on 2026-10-28)

1. `Văn bản đã dán (1)(1).txt` — stand-alone HTML/CSS/vanilla JavaScript prototype, 712 lines. Includes Plus Jakarta Sans, FontAwesome, alert summary, status cards, progress bars, hover interactions and example items.
2. `PremiumLowStockAlert.jsx` — React JSX + Tailwind CSS + lucide-react component pasted in conversation; same visual design presented as component.
3. `Markdown đã dán (1).md` — second standalone HTML/CSS/JavaScript copy, 714 lines. Very similar to reference #1.

Both standalone source files are also preserved unchanged in GitHub at `docs/source-reference/premium-stock-original.html` and `docs/source-reference/premium-stock-original-second.md`. The original React JSX plus both source files are bundled together in the conversation artifact `SalesHub_Premium_Stock_Source_References_20261028.zip`. The examples contain fixed demo product records (Wireless Headphones, Smart Watch, Bluetooth Speaker) and demo button behavior; they **are not** seeded into production.

## Mapping to the live SalesHub code

| Layer | File(s) | Responsibility |
|---|---|---|
| Page HTML | `api/public/inventory.html` | Premium alert, inventory directory, history and forms |
| Responsive styles | `api/public/inventory.css` | Design language adapted from HTML CSS / React Tailwind classes |
| UI logic | `api/public/inventory.js` | Real stock data, status UI, filters and form submissions |
| Read model and writes | `api/operations.js` | PostgreSQL item/movement queries and audited threshold changes |
| HTTP API / RBAC | `api/server.js` | Owner-only `/api/admin/inventory` and inventory mutations |
| Routes | `api/static-files.js` | `/admin/inventory` route and local assets |
| Sidebar | `api/public/pos-sidebar.js` | Entry to the inventory dashboard |
| Tests | `api/test/inventory-alert.test.js` | Threshold calculations, read-only query, audit and rollback |

## Data contract

`GET /api/admin/inventory` returns `items[]`, `movements[]`, and `summary`. Items are read from `inventory_items`; entries from `inventory_movements`. No sample rows are injected. `low_stock` means `quantity <= reorder_level`. `critical` means zero stock or at most 25% of a positive reorder threshold. Those labels are visual alert levels and not forecasts.

`POST /api/admin/inventory/items`, `POST /api/admin/inventory/movements`, and `PATCH /api/admin/inventory/items/:id/reorder` are owner-only. Purchase movements automatically record a finance expense in the same database transaction. The new threshold update writes an audit record in the same transaction. Current schema is reused without migrations.

## Why the production page uses vanilla JavaScript

The existing application is a zero-build Node.js static front end, **not a React application**. Rewriting unrelated screens just to mount one JSX component would add a bundler and introduce deployment/integration risk. The rendered UI and state flow are ported to HTML/CSS/JavaScript and connected directly to the existing API. The original React component is preserved in the reference ZIP for a possible future React migration.

## Design safety

- The main **Tổng quan** remains limited to financial analysis.
- Guest QR ordering, kitchen views, staff roles, float/locker rental, pricing, and customer data are unchanged.
- The new inventory UI never uses the sample product images, sample item quantities, or simulated “live” counts.
- Styles are page-scoped and media-query responsive.
