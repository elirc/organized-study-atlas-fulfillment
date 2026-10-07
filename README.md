# Atlas Fulfillment

Atlas Fulfillment is a TypeScript operations platform for warehouse and ecommerce inventory, orders, and fulfillment.

It is built as a modular monolith for learning how realistic business software grows: domain rules, database schema, API modules, background jobs, frontend workflows, tests, and architecture documentation.

The current build is small and read-heavy: one tenant, two warehouses, a dashboard, and two state-changing operations (reserve a sales order, run low-stock reconciliation). Most of the schema — purchasing, shipments, returns, adjustments, events, outbox — is seeded and displayed but not yet driven by workflows. That makes it a good codebase to grow, and the docs below point at where.

## Commands

```bash
npm install
npm run db:generate
npm run db:push
npm run db:seed
npm run dev
npm run dev:api
npm run worker
npm test
npm run build
```

What each one does (from `package.json`):

| Command | Runs | Notes |
|---|---|---|
| `db:generate` | `prisma generate` | builds the Prisma Client from `prisma/schema.prisma` |
| `db:push` | `tsx prisma/create-sqlite-schema.ts` | **deletes** `prisma/dev.db` if it exists and recreates every table with hand-written SQL through Node's built-in `node:sqlite` (`create-sqlite-schema.ts:5-12`). Despite the name, it does not call `prisma db push`. |
| `db:seed` | `tsx prisma/seed.ts` | deletes all rows, then inserts one tenant's data |
| `dev` | `vite` | the React console; `/api` is proxied to `http://127.0.0.1:4000` (`vite.config.ts`) |
| `dev:api` | `tsx watch src/server/index.ts` | Express API on `PORT`, default 4000 |
| `worker` | `tsx src/worker/reconciliation.worker.ts` | one reconciliation pass, then exits |
| `test` | `vitest run` | domain-rule tests and API smoke tests |
| `build` | `tsc && vite build` | type-check, then bundle the frontend |

## Before the first run

- **Create `.env` with `DATABASE_URL`.** `prisma/schema.prisma` reads `env("DATABASE_URL")`, `.gitignore` excludes `.env`, and the repo ships no example file. The initializer writes the database to `prisma/dev.db`, and Prisma resolves relative SQLite paths from the schema's folder, so the matching value is:

  ```env
  DATABASE_URL="file:./dev.db"
  ```

- **Use a Node.js version that includes `node:sqlite`.** `db:push` imports `DatabaseSync` from `node:sqlite`, which only exists in recent Node releases (Node 22 and later; early 22.x releases need the `--experimental-sqlite` flag).
- **Seed before testing.** `tests/api.test.ts` calls the real database through `createApp()`. It expects seeded data (it asserts the dashboard has inventory rows), so run `db:push` and `db:seed` before `npm test`.

## API

All routes are in `src/server/app.ts`. Everything except `/api/health` passes through `authenticateRequest` (`app.ts:26`).

| Method | Path | Role check | Service |
|---|---|---|---|
| GET | `/api/health` | none (before auth) | inline |
| GET | `/api/dashboard` | none | `dashboard.service.ts` |
| GET | `/api/inventory` | none | `inventory.service.ts` |
| GET | `/api/orders` | none | `orders.service.ts` |
| POST | `/api/orders/:orderId/reserve` | `warehouse_manager`, `admin` | `orders.service.ts` |
| GET | `/api/purchase-orders` | none | `purchasing.service.ts` |
| GET | `/api/shipments` | none | `fulfillment.service.ts` |
| GET | `/api/alerts/low-stock` | none | `inventory.service.ts` |
| GET | `/api/audit-logs` | `admin` | `audit.service.ts` |
| GET | `/api/exports/inventory.csv` | `buyer`, `warehouse_manager`, `admin` (see the auth note below) | `export.service.ts` |
| POST | `/api/worker/reconcile` | `warehouse_manager`, `admin` | `reconciliation.service.ts` |

## Who you are

There is no login. `authenticateRequest` (`src/server/modules/platform/auth.ts:17-30`) reads an `x-user-id` header and, **if the header is missing, acts as the seeded admin** `user-ops-admin`. The frontend never sends the header (`src/client/api.ts`), so every browser action runs as admin. The seed creates three users: `user-ops-admin` (`admin`), `user-warehouse-lead` (`warehouse_manager`) and `user-buyer` (`buyer`).

Role checks compare *ranks*, not names: `requireRole` takes the lowest rank among the listed roles (`auth.ts:32-44`). Because `warehouse_associate` has the same rank as `buyer` (`auth.ts:5-11`), a `warehouse_associate` passes the CSV-export check even though it is not listed.

## Known gaps (verified in this snapshot)

- Requests without `x-user-id` are admin; any `x-user-id` value is trusted.
- Audit rows for reservations and reconciliation always record `user-ops-admin` as the actor, whoever made the request (`orders.service.ts:63`, `:125`; `reconciliation.service.ts:40`).
- No query filters by tenant except audit logs and notifications; the tenant ID is the constant `tenant-atlas` (`src/server/db.ts:5`).
- An order with two lines for the same SKU can over-reserve: each line is checked against the full available quantity (`src/shared/inventoryRules.ts:29-60`), and nothing in the schema stops duplicate SKU lines.
- An unknown `x-user-id` produces a 500, not a 401 (`auth.ts:23-26` passes an `Error` to the generic handler at `app.ts:111-119`).
- If the dashboard request fails, the UI swaps in hard-coded sample data that looks real; only the status line says so (`src/App.tsx:53-55`), and the "Export order queue CSV" and "Download audit trail" buttons have no handlers (`App.tsx:385-386`).

Details, line numbers and exercises for each are in the docs below.

## Important Docs

- `docs/architecture/initial-architecture-plan.md` — the plan, with a plan-versus-code status table
- `docs/architecture/architecture-journal.md` — the decision log
- `docs/architecture/final-system-design.md` — the current design, workflows and review findings
- `docs/features/000-backlog.md` — the 30-item backlog with what already exists for each
- `docs/features/001-auth-rbac-shell.md`, `002-audit-log-viewer.md`, `003-csv-export.md` — the three features built after the initial system
- `docs/walkthroughs/important-files.md` — file-by-file reading guide with line numbers

## Project Shape

- `prisma/schema.prisma` defines the relational database model (19 models).
- `prisma/create-sqlite-schema.ts` creates the same tables by hand for SQLite.
- `prisma/seed.ts` creates realistic tenant, warehouse, inventory, order, supplier, and fulfillment data.
- `src/server` contains the Express API (`app.ts`) and backend modules (`modules/<area>/*.service.ts`).
- `src/shared` contains domain types (`apiContracts.ts`) and business rules (`inventoryRules.ts`).
- `src/App.tsx` and `src/client` contain the React frontend, its API calls and its fallback data.
- `src/worker` contains the background reconciliation job entrypoint.
- `tests` contains the domain-rule and API tests.
