# SalesHub — Render + Neon isolated staging load test

Status: Neon staging database prepared; separate Render staging service still needs creation.

## Database (already created)
- Neon project: **SalesHub-Loadtest-Staging**, project ID `soft-mouse-63081915`
- Database: `saleshub_loadtest`, region Singapore, PostgreSQL 17
- Production SalesHub database is **not used**.
- Schema and seeds ready: 6 test tables, 2 test menu items (kitchen/bar), 2 stock items × 1000 portions, and a dedicated `loadtest_identity` guard marker.

## Create a dedicated Render Web Service
Use https://dashboard.render.com/web/new. **Do not alter the existing SalesHub web service.**

- Name: `saleshub-loadtest-staging`
- Repository: `mas24080419-ux/tuananh123123`
- Branch: `perf/load-50-100-20261028`
- Runtime: Node.js
- Region: Singapore
- Plan: Free (unless the user explicitly authorizes a paid plan)
- Build: `cd api && npm install --omit=dev --no-audit --no-fund`
- Start: `cd api && npm start`
- Auto-deploy: Off
- Expected URL: `https://saleshub-loadtest-staging.onrender.com` (confirm service URL before running)

Configure **Render Environment** (do not paste any DB URI or passwords into a GitHub commit):
- `DATABASE_URL`: **copy securely** from Neon Console → project SalesHub-Loadtest-Staging → database saleshub_loadtest → Connection Details. Select **direct** connection with SSL.
- `STAFF_PASSWORD`: unique random test-only password of 20+ characters.
- `SESSION_SECRET`: unique random value of 32+ characters.
- `PILOT_MODE`: `false`
- `SALES_STAGING`: `true`
- `NODE_ENV`: `production`

Never point the staging service at the SalesHub production Neon project.

## Safety gate
Test runner **refuses** to send any orders unless all of the following pass:
1. Host is exactly `https://saleshub-loadtest-staging.onrender.com`.
2. `GET /api/loadtest/identity` returns `isolated:true` and database `saleshub_loadtest`, verified against `loadtest_identity`.
3. `GET /api/health` says PostgreSQL is connected.
4. All 6 test QR tables and both test menu items exist and can support 150 orders.

## Run
GitHub → Actions → **SalesHub Render-Neon remote staging load** → **Run workflow** → branch `perf/load-50-100-20261028`.

Runner simulates 50 and 100 simultaneous HTTP order submissions from GitHub Actions to the real Render staging URL. It measures success, status codes, latency P50/P95/P99, and throughput. HTTP readback samples 10 orders per batch.

The operator should then verify all 150 records in staging Neon:

```sql
SELECT count(*) AS orders
FROM dining_orders o
JOIN dining_tables t ON t.id=o.table_id
WHERE t.zone='STAGING';

SELECT l.station,l.status,count(*) AS items
FROM dining_order_lines l
JOIN dining_orders o ON o.id=l.order_id
JOIN dining_tables t ON t.id=o.table_id
WHERE t.zone='STAGING'
GROUP BY l.station,l.status
ORDER BY l.station,l.status;

SELECT name,quantity
FROM inventory_items
WHERE name LIKE 'LOADTEST%';
```

Expected if every one of the 150 orders succeeds: 150 orders, 150 new kitchen items, 150 new bar items, and 850 portions remaining for each stock item.

**Limitations:** GitHub Actions clients are not real handsets. Render's Free plan cold starts and Neon 0.25 CU concurrency may affect measured latency. Multiple users sharing one IP may encounter the existing IP-based 25-orders/minute limiter. Do not claim production can sustain 100 users merely because isolated staging passes.

## Existing local benchmark
Independent local PostgreSQL runner benchmark previously passed 50/50 and 100/100 simulated orders (GitHub Actions run 40679282010); this is **not** a Render latency measurement.
