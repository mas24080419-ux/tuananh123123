# Frontend structure

Each page has an HTML document, a page script, and page styles in `api/public`.
Scripts remain classic scripts at the end of the body; their original execution order is unchanged.

## Stylesheet order

- Admin: `admin.css` → `admin-minimal.css` → `pos-sidebar.css` → `admin-auth.css` → `mediqueue-auth.css` → `finance-charts.css`.
- Operations: `operations.css` → `admin-minimal.css` → `pos-sidebar.css` → `finance-charts.css` → `finance-app.css`.
- Core / users: page CSS → `admin-minimal.css` → `pos-sidebar.css`.
- Payment: `admin-minimal.css` → `payment.css` → `pos-sidebar.css`.
- Staff: `style.css` → `pos-sidebar.css` → `mediqueue-auth.css`.
- Guest: `style.css`; selectors prefixed with `.guest-orange` isolate customer styles from the kitchen.

`admin-minimal.css` owns the shared admin content theme, `pos-sidebar.css` owns navigation and responsive shell, `mediqueue-auth.css` owns the login screens, and `finance-charts.css` owns the financial charts.

The order is intentional: selectors with different specificity or media conditions are not interchangeable. Update the existing owning rule rather than adding another hotfix stylesheet. Do not remove `!important` globally: auth visibility, mobile overlays and existing form rules rely on it.

## Static backend

`api/static-files.js` serves explicit HTML routes and only public `.css`, `.js`, and `.svg` assets. Asset contents are memoized for the life of a deployment, compressed once, and revalidated with ETags. HTML is `no-store`; API responses retain their existing `no-store` behavior. Database, account, payment and stock modules are unchanged.

Run `cd api && npm test` for asset-route, cache, compression, exposure and script syntax checks. Visual checks should cover both login states, sidebar expanded/collapsed, mobile drawer, guest cart and order receipts. The source refactor was also checked against the pre-change cascade at widths 360, 390, 760, 1024 and 1366px; this is not a substitute for testing Safari on a physical phone.
