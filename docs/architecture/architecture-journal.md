# Architecture Journal

## 2026-05-05: Initial Direction

The project is being rebuilt from a frontend-only workflow prototype into Atlas Fulfillment, a realistic inventory, orders, and fulfillment platform.

The first major decision is to use a modular monolith. For learning, this is more valuable than prematurely splitting services because it keeps local development simple while still forcing module boundaries. A junior developer should notice that "monolith" does not mean "all logic in one file." It means one deployable unit with clear internal ownership.

The second decision is to use Prisma with SQLite. SQLite keeps the app easy to run on one machine, while Prisma gives the project a real relational schema, generated client, migrations/push workflow, and seed process.

The third decision is to write domain rules as plain TypeScript helpers before wiring them to HTTP. This makes the important business logic testable without a server, database, or browser.

## 2026-05-05: Initial Build

The initial system now has a Prisma schema, local SQLite database initializer, seed data, Express API, React operations console, shared inventory rules, a reconciliation worker, tests, and code walkthrough documentation.

One notable tradeoff: Prisma Client generation works, but the Prisma schema engine failed during `prisma db push` in this Windows environment. To keep the project runnable, `npm run db:push` creates the SQLite schema with Node's built-in SQLite module. The Prisma schema remains the domain model source, and Prisma Client still reads/writes the database.

Feature work also started immediately after the initial build:

- Authentication/RBAC shell
- Audit log viewer
- Inventory CSV export

The learning point is that "future platform concerns" are not decorative. Even tiny versions of auth, audit, exports, events, and workers change where code belongs.

## 2026-10: Snapshot review

This repository is a single-commit snapshot, so the two entries above are the author's record; their dates and the Windows `prisma db push` failure cannot be re-verified here. What can be verified is how each decision shows up in the code today.

### Decision 1: modular monolith

One Express app (`src/server/app.ts:17-122`) mounts every route; business code lives in `src/server/modules/<area>/*.service.ts`. Each service is a set of plain functions that receive a `PrismaClient`, which keeps them easy to call from routes, the worker and tests. The cost: nothing stops a service from reading another area's tables, and several do (`dashboard.service.ts` calls four other modules' list functions; `inventory.service.ts` reads SKU and product data). "Clear internal ownership" is a convention to keep up in review.

### Decision 2: Prisma with SQLite, and the hand-written initializer

The workaround described in the second entry is real and has consequences:

- `npm run db:push` runs `prisma/create-sqlite-schema.ts`, which deletes `prisma/dev.db` and executes about 240 lines of hand-written `CREATE TABLE`/`CREATE INDEX` SQL. The Prisma schema is no longer the thing that creates the database; it is a second copy that has to be kept in step by hand.
- There are no migration files. Moving to PostgreSQL (the stated future target) means generating migrations from `schema.prisma` and checking them against what the initializer created.
- The initializer turns on `PRAGMA foreign_keys = ON` for its own connection (`create-sqlite-schema.ts:12`). In SQLite that pragma is a per-connection setting, so it says nothing about the connections the app opens later; whether those enforce foreign keys depends on the Prisma SQLite connector, which is worth checking before relying on it.

### Decision 3: domain rules as plain TypeScript

`src/shared/inventoryRules.ts` has no imports at all, and `tests/inventoryRules.test.ts` exercises it without a server or database. Of its six exported functions, the server uses four: `availableToPromise`, `isLowStock` and `stockHealth` in `inventory.service.ts`, and `planReservation` in `orders.service.ts:56`. `applyReservation` and `applyShipment` are tested but unused: the reservation transaction increments `reserved` with a Prisma `increment` instead (`orders.service.ts:81-84`), so the tested function and the production write path are different code.

### The feature work

The three features listed in the second entry all exist: `requireRole` on three mutation/export routes and the audit route, `GET /api/audit-logs`, and `GET /api/exports/inventory.csv`. Their docs in `docs/features/` now include an "As built" section with line numbers and findings.

### Open decisions this review surfaced

1. **Who is the actor?** Routes know the caller (`request.actor`), but services do not take an actor parameter, so audit rows hard-code `user-ops-admin`. Deciding how the actor flows into services is the next architecture decision, and it blocks real audit trails.
2. **Where does tenant scoping live?** Today a constant (`defaultTenantId` in `src/server/db.ts:5`) is used on some writes and two reads. The "future improvements" list in `final-system-design.md` names tenant middleware; the decision is whether services take a tenant ID argument or receive a pre-scoped client.
3. **Initializer or migrations?** Keeping two schema definitions in sync by hand is the most likely source of drift in this repo.

## Exercise

**Goal:** write the next journal entry yourself for decision 1 above ("Who is the actor?"): the options (pass `actor` to every service; use `AsyncLocalStorage`; wrap Prisma per request), the choice, and why.

**Check:** your entry names the exact lines that change (`orders.service.ts:63` and `:125`, `reconciliation.service.ts:40`, plus the call sites in `app.ts:55` and `:105`), and after you implement it, reserving SO-10035 with `x-user-id: user-warehouse-lead` produces an audit row whose `actorId` is `user-warehouse-lead`.
