# SalesHub — Data Flow Architecture / Bản đồ luồng dữ liệu

## Status & scope
This is the *implemented and code-audited logical topology* of the SalesHub POS backend deployed on Render, based on `api/server.js`, `api/core.js`, `api/operations.js`, `api/area-receipts.js`, `api/lockers.js`, `api/schema.sql`, owner session code and the actual public frontend. It is **not** a clone of the reference screenshot's external dependencies.

Owner-only UI: `/admin/architecture`. Owner-only read-only API: `GET /api/admin/architecture`.

Current deployment: one Node.js service on Render with PostgreSQL configured using `DATABASE_URL`. Authentication, business modules, static assets and order processing are **one application**, not independent microservices. The database/logical audit tables are not separate deployed database services.

### Flow 1: QR ordering and kitchen
`Guest browser /t/:token` → `GET /api/menu/:token` / `POST /api/orders` → validation of table token, quantities, requestId → transaction inserts `dining_orders` and `dining_order_lines`, consumes recipe-defined inventory, updates table status and inserts `dining_audit` → commit in PostgreSQL. `GET /api/kds` returns authorized role-filtered lines; `PATCH /api/items/:id` changes valid states and writes `dining_audit`; cancellation can restore inventory.
**Delivery semantics:** the order is persisted in PostgreSQL, from which the KDS API reads. The screenshot-style arrows do not demonstrate WebSocket/event-bus or push delivery.

### Flow 2: inventory & finance
Owner → `/api/admin/inventory` and inventory mutations → `inventory_items`, `inventory_recipes`, `inventory_movements`. A purchase movement writes the corresponding `finance_entries` expense in the same transaction. A stock alert means `quantity <= reorder_level`. Owner finance and order-payment confirmation use different tables; do not interpret all payments as entries in the same ledger.

### Flow 3: floats and lockers
Staff with equipment-area access → `/api/lockers` and `/api/area/receipts` → `lockers`, `locker_rentals`, `area_receipts` and `float_receipt_details`, with the corresponding income recording rules of the existing business implementation. No customer identifiers, phone numbers or rental details are returned by the architecture monitor.

### Flow 4: authentication and audits
Owner/Staff sessions use HttpOnly signed cookies and server-side authorization. Public QR order requests instead validate a table token. Business audit data currently lives in `dining_audit` and `pos_audit` inside the same PostgreSQL database.

### External payment
Payment QR is a displayed bank transfer instruction; a human confirms the receipt of funds. **No automated bank webhooks or provider integrations are claimed.** No Redis, Cloudflare, Zalo, Telegram, DeepSeek, MinIO, queue workers, or observability vendor was inferred without source evidence.

## Live QR order pipeline (2026-10-28 upgrade)
When the owner opens `/admin/architecture`, the application provides an owner-only `GET /api/admin/architecture/live` Server-Sent Events stream and a `GET /api/admin/architecture/recent` fallback/recovery endpoint. Both require the owner session. The SSE stream polls the persisted `dining_audit` watermark approximately every 2.5 seconds and refreshes its snapshot immediately after a newly committed order or kitchen status change. It reconnects automatically; fallback uses owner-authenticated polling approximately every 5 seconds when SSE is unavailable. Streams validate the owner session periodically and are capped at five simultaneous clients.

**Recorded evidence:** New successful guest orders write `order_validated`, `inventory_checked` and `order_created` as separate `dining_audit` entries within the SAME PostgreSQL transaction that creates order lines and applies inventory rules. Those entries become visible only after COMMIT; transaction rollback discards the order and its stages. Therefore a step being displayed does not imply a timestamped network-level trace of the pre-commit handling or a live event at the exact time of each statement. `inventory_checked` means recipe/inventory logic completed; it does not prove every item consumed stock if no recipe was configured. A duplicate `requestId` does not generate duplicate events. Existing `item_status_changed` events (kitchen/bar) and `payment_confirmed` events (if present) are also displayed. Previously created orders may lack the new detailed stage entries; never backfill fictitious successes.

**Data safety:** Live results include the latest 20 orders (most recent 24h and any older unfinished orders), their order-line statuses, table names, and whitelisted audit actions only; not customer phone numbers, order notes, QR tokens, credentials or payment account details. No database schema migration or data deletion. This is an event-backed operational timeline, not a distributed system trace. Rejected requests before a transaction commits are not represented in this persisted order timeline.

**Resilience:** SSE sends committed snapshots, reconnects after outages, monitors audit changes, verifies the owner session periodically, and closes inactive subscriptions. The page pauses the stream when hidden and resumes with a database reload. Dashboard KPIs remain snapshots, separate from streaming per-order audit data.

## Monitoring currently delivered
`GET /api/admin/architecture` requires owner role, returns static verified topology plus a read-only PostgreSQL snapshot with:
- orders in last 24h;
- current kitchen items in `new`/`preparing`;
- current low-stock items;
- occupied lockers;
- finance entries in last 24h;
- administrative and order audit event counts (for future use);
- unpaid orders;
- most recent order timestamp;
- PostgreSQL query latency measured by this HTTP request.

A refresh runs only while the page is visible; it is not an availability monitoring SLA, tracing system or alert notification service. The data shows aggregate counts **as of** a check timestamp. Query failures return status `database: unavailable`, with counts null rather than invented zeroes. Query uses a 4-second timeout. Do not record DB URLs/secrets into telemetry or present raw customer tables. Full production E2E, performance/load testing and browser screenshots are not proven by CI alone.

## Next technical phase (not implemented)
Implement correlation IDs for orders and their stock/finance downstream operations, structured logs with sensitive-data filtering, PostgreSQL audit/query performance, request duration/error rate and alerting in Render. Use OpenTelemetry only after selecting a secure collector/exporter and retention policy. Keep each stage independently deployable and test row-level authorization before showing event details.

## Modified files
- `api/architecture-monitor.js`: audited topology & read-only PostgreSQL snapshots.
- `api/server.js`: owner authorization for page and API.
- `api/static-files.js`: static route registration.
- `api/public/architecture.html`, `architecture.css`, `architecture.js`: responsive explorer, flows, selected-node panel and refresh.
- `api/public/pos-sidebar.js`: admin navigation.
- `api/test/architecture-monitor.test.js`, `static-files.test.js`: topology, security and asset tests.

No migrations, financial mutations, order-status transitions or role grants were made as part of this UI build.
