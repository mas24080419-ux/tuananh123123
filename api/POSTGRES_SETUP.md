# SalesHub – Persistent PostgreSQL setup

## Current state (25 October 2026)
- Code supports PostgreSQL using `pg@8.16.3`; no database has been provisioned.
- If `DATABASE_URL` is absent, the service remains **PILOT / RAM**.
- Pilot orders are **not migrated automatically**. Restarting or deploying erases them.
- Existing table QR values are derived from `SESSION_SECRET`; preserve this secret during migration.

## Activate persistent storage
1. In Render, provision a **separate, non-expiring PostgreSQL** instance for SalesHub. The paid tier must be explicitly approved by the account owner. Do not alter EnergyGuard.
2. Copy its **internal** PostgreSQL connection URI (same Render region as the SalesHub web service).
3. Open Render web service `saleshub-qr-live-pilot` → Environment → set `DATABASE_URL` to that URI.
4. Keep `STAFF_PASSWORD` and **do not rotate** `SESSION_SECRET` without a planned QR migration.
5. The backend initializes tables and seeds six tables / seven menu items in one transaction at startup from `api/schema.sql`. On DB failure, startup fails rather than returning false order confirmations.
6. Call `GET /api/health` and verify `database: "ready"`, `mode: "postgres"`, `pilot: false`. An HTTP 200 in pilot mode is *not* proof of persistence.
7. Test on two devices: create order → bếp receives via `GET /api/kds` → change status → verify order in `GET /api/history` (staff authentication required).
8. Restart/redeploy the web service and verify that the test order, statuses and history remain.
9. Schedule periodic verified PostgreSQL backups and test a restore before operating commercially.

## Safety and limitations
- New orders and order lines are inserted as one PostgreSQL transaction.
- `UNIQUE (table_id, request_id)` prevents duplicate orders from retrying.
- Order items snapshot prices and record state transitions in `dining_audit`.
- Payment status remains separate from preparation; payment capture has **not** been implemented.
- The staff interface currently uses one shared password. Add account-level RBAC, audit attribution, and operational monitoring before actual restaurant use.
- Rate limiting is currently in-process; move to shared / durable limits before operating at scale.
- Printed QR are tied to the long-lived `SESSION_SECRET`; treat that secret as sensitive, rotate only with explicit plan and new QR deployment.
