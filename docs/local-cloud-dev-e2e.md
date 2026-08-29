# Local E2E with the cloud development database

This setup runs the Admin and Vendor applications on the Mac while keeping
PostgreSQL and supplier media in existing cloud services. Prefer an isolated
development database. If a shared database is explicitly authorized, use only
the scoped verification script below; never run the truncating server suite.

## 1. Local-only environment file

Create `.env.development.local` at the repository root. It is ignored by git.
Provide the development values for:

```text
DATABASE_URL=<cloud development PostgreSQL URL>
PUBLIC_ORIGIN=http://127.0.0.1:5173
VENDOR_ORIGIN=http://127.0.0.1:5174
VENDOR_APP_URL=http://127.0.0.1:5174/
VENDOR_MEDIA_PROVIDER=cos
COS_REGION=ap-guangzhou
COS_BUCKET=<development bucket>
COS_ACCESS_KEY_ID=<server-only SecretId>
COS_SECRET_ACCESS_KEY=<server-only SecretKey>
COS_ENDPOINT=https://cos.ap-guangzhou.myqcloud.com
COS_PUBLIC_URL=https://<bucket>.cos.ap-guangzhou.myqcloud.com
```

The COS identity needs permission to put, read, and HEAD objects under the
`vendor/` prefix. Keep the bucket private. Its CORS policy must temporarily
allow `http://127.0.0.1:5173` and `http://127.0.0.1:5174` for `PUT`, `GET`, and
`HEAD`, including the `Content-Type` and `Range` request headers.

## 2. Apply migrations and seed a development Admin

Database utility commands do not load env files automatically. Load the file
into the current shell before migrations or seed commands:

```bash
set -a
source .env.development.local
set +a

npm run db:migrate
SEED_ADMIN_PASSWORD='<local test password, 10+ characters>' npm run seed:admin
```

Migrations are additive, but use only the development database. Do not run
`npm run test:server` against a shared development database: those integration
tests intentionally truncate order, customer, supplier, and session tables.

## 3. Start the three local processes

Terminal 1 — API (loads the development database plus local cloud-media
configuration, with development values taking precedence):

```bash
npm run api:local
```

Terminal 2 — customer/Admin application:

```bash
npm run dev
```

Terminal 3 — real-mode Vendor application:

```bash
VITE_DEMO_MODE=false \
BELOVED_API_PROXY=http://127.0.0.1:8787 \
npm --prefix apps/vendor-mobile run dev
```

Open:

- Admin login: `http://127.0.0.1:5173/gate-7f3k9x`
- Admin orders: `http://127.0.0.1:5173/bo-4q9z7m/live`
- Vendor application: `http://127.0.0.1:5174/`

If Vite selects another Vendor port, update `VENDOR_ORIGIN`, `VENDOR_APP_URL`,
and the COS CORS origin to that exact port before testing.

## 4. Manual E2E scenario

1. Create a clearly labelled test customer order.
2. In Admin → Suppliers, create/activate a test supplier and assign the order.
3. Open the invitation URL in the Vendor browser and set its password.
4. Accept the JOB and upload a small MP4 for the current task.
5. Confirm that the object key contains `vendor/<supplier>/<job>/...`.
6. Submit the update and open the matching Admin order.
7. Confirm the production state, version, video playback, and review controls.
8. Approve or request changes and verify the Vendor page receives the new
   workflow/review state after refresh.

Use a small video for the first smoke test. Test a large video only after the
small upload, HEAD verification, signed playback, and review path all pass.

## 5. Automated scoped contract verification

The repository includes a self-cleaning verification that creates a uniquely
named customer, order, and supplier; walks the supplier/customer workflow from
assignment through platform receipt; checks the Admin projection at important
handoffs; and removes its records in `finally`.

```bash
ALLOW_SCOPED_E2E=1 \
node --env-file=.env.development.local scripts/verify-supplier-order-flow.mjs
```

This script is suitable for an explicitly authorized shared database because
its deletes are limited to the random emails and public codes it created. By
contrast, `npm run test:server` truncates shared tables and must only target a
disposable local test database.
