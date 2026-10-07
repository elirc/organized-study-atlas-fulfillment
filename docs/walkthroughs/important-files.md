# Important File Walkthroughs

These walkthrough notes cover the files that carry the most architectural weight in the initial system. Line numbers refer to this snapshot. Each section ends with something to look for that the original notes did not mention.

## `prisma/schema.prisma`

Defines the relational shape of the business. Read this first when learning the project because it names the core entities: tenant, user, warehouse, supplier, product, SKU, inventory item, sales order, reservation, purchase order, shipment, return, audit log, domain event, outbox message, and notification (19 models in all, counting order lines, purchase-order lines and inventory adjustments).

Senior-level concept: the schema separates `onHand` from `reserved` (`InventoryItem`, lines 99-113). That is the heart of inventory availability. Orders reserve stock before shipment; shipment then reduces both reserved and on-hand.

Look for:

- `@@unique([warehouseId, skuId])` on `InventoryItem` (`:111`): one balance row per SKU per warehouse, which is what lets the reservation code find "the" balance.
- `Sku.skuCode` and `Sku.barcode` are unique across the whole database (`:84-85`), and `Sku` and `InventoryItem` have no `tenantId`. Tenancy stops at `Product`.
- `SalesOrderLine` (`:138-146`) has no uniqueness on `(salesOrderId, skuId)`, so an order can list the same SKU twice.
- Status fields are free strings (`SalesOrder.status`, `StockReservation.status`, ...). The valid values live only in code and seed data.
- `AuditLog.metadata` and `DomainEvent.payload` are JSON stored as `String`.

## `prisma/create-sqlite-schema.ts`

Not in the original list, but you need it to understand `npm run db:push`. It deletes `prisma/dev.db` if present (`:5-9`), opens it with Node's built-in `DatabaseSync` (`:11`), and executes hand-written SQL for every table and index. It is a second definition of the schema: change a model in `schema.prisma` without changing this file and the generated Prisma Client will disagree with the real tables.

## `prisma/seed.ts`

Creates realistic data for one tenant. This file is a teaching tool: it shows how products, SKUs, warehouses, inventory balances, sales orders, purchase orders, shipments, returns, domain events, and audit logs relate in practice.

Read it after the schema so the abstract model becomes concrete.

Look for: it starts by deleting every table's rows in child-to-parent order (`:7-25`), a real ordering lesson because reversing it would hit foreign keys. Remember the two sales orders: `so-10034` is already `allocated`; `so-10035` is `pending_reservation` for 18 green packs (`PACK-22-GRN`) in `LAX-1`, where 22 are available, so reserving it succeeds and leaves 4.

## `src/shared/inventoryRules.ts`

Contains pure business rules. It has no database, HTTP, or React dependency (no imports at all). That makes it easy to test and safe to reuse from multiple backend modules.

Important sections:

- `availableToPromise` (`:25-27`) defines available stock, clamped at zero.
- `planReservation` (`:29-60`) explains why a reservation can or cannot happen, returning one failure per bad line.
- `applyShipment` (`:69-79`) protects against shipping more than was reserved.
- `isLowStock` (`:81-83`) centralizes alert behavior: available at or below the reorder point, or on-hand at or below safety stock.

Senior-level concept: business invariants should be expressed in small, testable units. If inventory math appears in five controllers, the system will eventually drift.

Look for: `planReservation` evaluates each line on its own, so two lines for the same SKU are each compared with the full available amount. And `applyReservation`/`applyShipment` are tested but never called by the server; the real reservation write uses a Prisma `increment` instead.

## `src/server/modules/orders/orders.service.ts`

Owns sales-order reservation behavior. This is one of the most important files because it changes inventory, order state, reservations, audit logs, domain events, and outbox messages in one transaction (`reserveSalesOrder`, `:35-135`).

Read the transaction carefully. The lesson is that real business workflows often touch several tables, and they must either complete together or fail together.

Look for:

- the early returns: unknown order is `ok: false` with HTTP 200 (`:42-44`); an order already past `pending_reservation` is `ok: true` (`:46-48`);
- the failed-plan path still writes an audit row and commits (`:58-72`);
- `actorId: systemUserId` on both audit writes (`:63`, `:125`): the service never learns who called it;
- IDs built from `Date.now()` (`:61`, `:87`, `:104`, `:114`, `:123`), which collide if two writes of the same kind happen in the same millisecond.

## `src/server/modules/inventory/inventory.service.ts`

Builds inventory read models for the API and exports. It pulls together SKU, product, warehouse, and balance data (`listInventory`, `:7-35`), and derives low-stock alerts with a suggested purchase quantity of `max(2 × reorderPoint − available, safetyStock)` (`listLowStockAlerts`, `:37-60`).

Senior-level concept: read models are allowed to be shaped for UI/reporting needs, but they should still reuse shared business rules like `availableToPromise` and `stockHealth`.

Look for: `listLowStockAlerts` calls `listInventory` again, and `getDashboard` calls both (`dashboard.service.ts:9-15`), so one dashboard request loads the full inventory twice. There is no tenant filter on the query (`:8-14`).

## `src/server/app.ts`

Composes the Express app (`createApp`, `:17-122`). It is intentionally thin: route definitions call module services rather than holding business logic directly.

Important sections:

- `GET /api/health` is public (`:22-24`, registered before authentication).
- `authenticateRequest` runs before operational API routes (`:26`).
- Mutating routes use `requireRole` (`:52`, `:103`), and so do the audit and export reads (`:85`, `:93`).
- Error handling normalizes validation and unexpected failures (`:111-119`): Zod errors become 400 with `details`; everything else becomes 500.

Look for: only one route validates input (`orderIdParams`, `:15`, `:54`).

## `src/server/modules/platform/auth.ts`

Implements the first authentication and authorization shell. It uses seeded users and `x-user-id` for local learning.

Senior-level concept: frontend permission checks are user experience, not security. Backend route guards are the source of truth.

Look for: a missing header becomes the admin (`:18`); `requireRole` enforces a minimum *rank* (`:33`), not the listed role names; an unknown user ID leads to a 500 (`:23-26`). See `docs/features/001-auth-rbac-shell.md` for details and exercises.

## `src/server/modules/worker/reconciliation.service.ts`

Represents background job behavior. It scans low-stock conditions and creates notifications only when needed (`runReconciliation`, `:5-49`), then writes one audit row for the run.

This teaches idempotency: workers should avoid creating duplicate notifications every time they run.

Look for: the duplicate check is a check-then-create keyed by title (`:10-21`). The title contains the SKU code but not the warehouse, so the same SKU low in two warehouses yields one notification, and two overlapping runs can both pass the check. The entrypoint `src/worker/reconciliation.worker.ts` runs it once with top-level `await` and disconnects.

## `src/App.tsx`

Composes the operations UI. It keeps view state locally and calls API client functions. The file is larger than a final production screen would be (443 lines), but it still separates dashboard, inventory, orders, purchasing, fulfillment, and admin views into components.

Read it from top to bottom by workflow:

1. Data loading and refresh (`refresh`, `:47-59`; called once on mount, `:61-63`)
2. Navigation (`activeView`, from `:39`)
3. Dashboard (`DashboardView`, `:169`)
4. Inventory filtering (warehouse list and filter at `:65-73`; `InventoryView`, `:220`)
5. Order reservation (`handleReserve`, `:75-83`; `OrdersView`, `:270`)
6. Admin audit/export tools (`AdminView`, `:370-408`)

Look for: the initial state is already `fallbackDashboard` (`:40`), and a failed load puts it back (`:53-55`), so sample data is on screen both while loading and after an error; `handleReserve` and `handleReconcile` have no error handling; two admin buttons have no handlers (`:385-386`).

## `src/client/api.ts`

Centralizes frontend HTTP calls (four functions, 41 lines). As the app grows, this is where typed API clients, request headers, retries, and error normalization should live.

Look for: no request sends `x-user-id`, so the UI is always the admin; errors are reduced to a fixed message (`'Unable to reserve order.'`), discarding the server's `requiredRoles` or validation details.

## `src/client/fallbackData.ts`

Hard-coded dashboard data used before the first load and when the API is unreachable. It uses the same components as live data, so the only signal that data is fake is the status line.

## `tests/inventoryRules.test.ts`

Tests the riskiest pure business rules (six tests, `:20-49`). This test file is more important than a snapshot test because it protects real inventory behavior.

Look for: the low-stock test only exercises the reorder-point branch; the safety-stock branch of `isLowStock` and the `stockout` path of `stockHealth` are untested, and there is no test for duplicate SKU lines.

## `tests/api.test.ts`

Smoke-tests the API surface (three tests). These are not enough for a production system, but they prove the app can boot, query seeded data, and export inventory.

Look for: the tests use the real `prisma/dev.db` (no test database), so they depend on `db:push` and `db:seed` having run, and they run as the default admin. Nothing tests `POST /api/orders/:orderId/reserve`, `requireRole`, or reconciliation.

## Exercises

Each has a **Goal** and a **Check** you can observe.

1. **Follow one click.**
   *Goal:* starting from the Reserve button in `OrdersView`, list every function and file the request passes through until the database commit.
   *Check:* your list includes `handleReserve` → `reserveOrder` (`src/client/api.ts:13-21`) → Vite proxy → `authenticateRequest` → `requireRole` → the route at `app.ts:52-59` → `reserveSalesOrder` → `planReservation`, and names the five tables written on success besides `SalesOrder`: `InventoryItem`, `StockReservation`, `DomainEvent`, `OutboxMessage` and `AuditLog`.
2. **Test the transaction.**
   *Goal:* write an API test that reserves `so-10035` and then checks the inventory row, the order status, and that exactly one `StockReservation`, one `DomainEvent`, one `OutboxMessage` and one `order.reserved` audit row exist for it. Re-seed before the test so it is repeatable.
   *Check:* the test passes, and it fails if you comment out the `outboxMessage.create` call (`orders.service.ts:112-120`).
3. **Remove the double load.**
   *Goal:* make `getDashboard` compute low-stock alerts from the inventory it already loaded.
   *Check:* with Prisma query logging enabled (`new PrismaClient({ log: ['query'] })` in `src/server/db.ts`), one `GET /api/dashboard` logs one `InventoryItem` query instead of two.
