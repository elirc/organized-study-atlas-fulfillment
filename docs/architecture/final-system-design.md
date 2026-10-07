# Current System Design

## Repo Structure

- `docs/architecture` contains architecture planning, journal entries, and system design notes.
- `docs/features` contains feature plans and build journals.
- `docs/walkthroughs` explains important files for learning.
- `prisma` contains the schema, local SQLite initializer, and seed data.
- `src/shared` contains domain rules and API contracts.
- `src/server` contains Express app composition and backend modules.
- `src/client` contains frontend API functions and fallback data.
- `src/worker` contains background job entrypoints.
- `tests` contains domain and API tests.

## Major Workflows

### Inventory Availability

Inventory availability is calculated as `onHand - reserved`, clamped at zero (`src/shared/inventoryRules.ts:25-27`). The calculation lives in `src/shared/inventoryRules.ts` so API views, exports, and future workers can share the same rule. In practice they share it through one read model: `listInventory` (`src/server/modules/inventory/inventory.service.ts:7-35`) computes `available` and `health` per row, and the dashboard, low-stock alerts, CSV export and reconciliation worker all start from that function.

`stockHealth` (`inventoryRules.ts:85-97`) returns `stockout` when nothing is available, `low` when `isLowStock` is true (available at or below the reorder point, **or** on-hand at or below safety stock, `:81-83`), and `healthy` otherwise. With the seed data, four of the six inventory rows are low: the west green pack and red bottle, and both east rows.

### Order Reservation

The reservation endpoint loads the order and warehouse balances, plans the reservation, updates reserved quantities, creates stock reservation rows, updates order status, writes an audit log, emits a domain event, and creates an outbox message in a single transaction (`src/server/modules/orders/orders.service.ts:35-135`, an interactive `db.$transaction`).

Step by step:

1. Load the order with its lines (`:37-40`). Unknown ID returns `{ ok: false, status: 'not_found' }` with HTTP 200 (`:42-44`).
2. If the order is not `pending_reservation`, return `ok: true` with its current status (`:46-48`): a second click is a no-op, not an error.
3. Load balances for the order's warehouse and SKUs (`:50-55`) and call `planReservation` (`:56`).
4. On failure, write an `order.reservation_failed` audit row and return the failures (`:58-72`). The transaction still commits, so the failed attempt is recorded.
5. On success, for each line: increment `reserved` and create a `StockReservation` that expires in 72 hours (`:74-96`).
6. Set the order to `allocated` (`:98-101`), create a `DomainEvent` and its `OutboxMessage` (`:102-120`), and write an `order.reserved` audit row (`:121-131`).

Nothing reads `StockReservation.expiresAt`, and nothing delivers `OutboxMessage` rows; both are shapes for future work.

### Reconciliation

The reconciliation worker scans low-stock alerts and creates buyer notifications. It avoids duplicating notifications if an unread one already exists (`src/server/modules/worker/reconciliation.service.ts:5-49`).

The duplicate check matches on the notification *title*, `Low stock: <skuCode>` (`:10-17`). The title has no warehouse in it, so if the same SKU is low in two warehouses, only the first produces a notification. Every notification goes to the hard-coded user `user-buyer` (`:27`). The run is not wrapped in a transaction, so two overlapping runs can both pass the check and create duplicates. It is triggered by `POST /api/worker/reconcile` or by `npm run worker`, which runs once and exits; there is no schedule.

## Design Decisions

- Modular monolith over microservices to keep learning and local development practical.
- Prisma schema as the relational source of truth.
- SQLite as the local database, with model choices that can move to PostgreSQL later.
- Shared domain rules for risky inventory math.
- Backend route guards for RBAC (`requireRole` in `src/server/modules/platform/auth.ts:32-44`, applied in `src/server/app.ts` at lines 52, 85, 93 and 103).
- Audit logs and domain events included from the beginning because they shape realistic maintenance work.

## Tradeoffs

- The auth shell is not production auth. It is a permission boundary scaffold.
- CSV export is synchronous and should become a background job for large datasets.
- Prisma migration engine failed in this environment, so `db:push` uses a local SQLite initializer while preserving the Prisma schema and client.
- The frontend is dense and useful, but future growth should split screens into more files.

## Future Improvements

- Real sessions/JWT or OAuth
- Tenant middleware on every query boundary
- Migration files instead of the local schema initializer
- Background job queue with retries
- Object storage for exports
- Playwright workflow tests
- CI verification
- More granular warehouse permissions

## What this design looks like under review

Checked against the code in this snapshot by reading it; nothing was run.

### Authentication and authorization

- **Missing header means admin.** `authenticateRequest` falls back to `systemUserId` (`auth.ts:18`), so an anonymous request is the most privileged user. Any `x-user-id` value is trusted as-is.
- **Roles are ranked, not listed.** `requireRole(['buyer', 'warehouse_manager', 'admin'])` really means "rank 1 or higher" (`auth.ts:33`), which also admits `warehouse_associate`. Unknown role names get rank 0 (`:36`).
- **Read routes have no guard.** Inventory, orders, purchase orders, shipments and alerts are visible to any authenticated user (`app.ts:28-83`).
- **Unknown users cause a 500.** `authenticateRequest` passes a plain `Error` to `next` (`auth.ts:24`), and the error handler maps everything that is not a `ZodError` to 500 (`app.ts:111-119`).

### Data integrity

- **Duplicate SKU lines over-reserve.** `planReservation` checks each line separately (`inventoryRules.ts:30-57`), and `SalesOrderLine` has no unique constraint on `(salesOrderId, skuId)` (`prisma/schema.prisma:138-146`).
- **Check-then-increment.** The availability check reads balances, then increments `reserved` later in the same transaction (`orders.service.ts:50-84`). The increment itself is atomic, but the decision is based on the earlier read. On SQLite the database's single-writer locking limits what can interleave; on PostgreSQL at its default isolation level, two concurrent reservations for different orders could both pass the check and together reserve more than is available. A conditional update (`WHERE onHand - reserved >= :qty`) or row locking closes it.
- **Time-based IDs.** Audit, event, outbox, reservation and notification IDs embed `Date.now()` (for example `orders.service.ts:61`, `:87`, `:104`, `:114`, `:123`). Two writes of the same kind in the same millisecond produce the same primary key, and the second insert fails.
- **Audit actor is always the admin.** `actorId: systemUserId` is hard-coded in `orders.service.ts:63`, `:125` and `reconciliation.service.ts:40`; the service functions never receive `request.actor`.

### Multi-tenancy

`Sku.skuCode` and `Sku.barcode` are globally unique (`schema.prisma:84-85`), and `Sku` and `InventoryItem` have no `tenantId` column, so a second tenant could not reuse a SKU code. List queries do not filter by tenant (`orders.service.ts:9-15`, `inventory.service.ts:8-14`); only audit logs and notifications do, using the constant `defaultTenantId`.

### Frontend behaviour

- If `fetchDashboard` or `fetchAuditLogs` fails, `refresh` replaces the data with `fallbackDashboard` from `src/client/fallbackData.ts` (`App.tsx:53-55`). The status line says so, but every table then shows sample data that looks real.
- `handleReserve` and `handleReconcile` (`App.tsx:75-89`) have no `try/catch`; a 403 or 500 makes `reserveOrder` throw (`src/client/api.ts:16-18`) and the user sees no message.
- The "Export order queue CSV" and "Download audit trail" buttons (`App.tsx:385-386`) have no `onClick`.

### CSV export

`csvCell` (`src/server/modules/platform/export.service.ts:4-7`) quotes values that contain a comma or a double quote. It does not quote values containing line breaks, and it does not neutralise values that start with `=`, `+`, `-` or `@`, which spreadsheet programs may evaluate as formulas. SKU names come from the database, so anyone who can name a SKU could plant a formula in the export.

## Exercises

Each has a **Goal** and a **Check** you can observe.

1. **Reserve an order end to end.**
   *Goal:* after `db:push` and `db:seed`, run the API and `curl -X POST -H "x-user-id: user-warehouse-lead" http://127.0.0.1:4000/api/orders/so-10035/reserve`.
   *Check:* the response is `{ "ok": true, "status": "allocated", ... }`; `GET /api/inventory` now shows the west green pack (`PACK-22-GRN`) with `reserved` 38 and `available` 4; a second identical POST returns `ok: true` without changing the numbers.
2. **See the role ranking.**
   *Goal:* as `user-buyer`, call the reserve endpoint and the CSV export.
   *Check:* reserve returns 403 with `requiredRoles: ["warehouse_manager", "admin"]`; the export returns 200.
3. **Pass the actor through.**
   *Goal:* add an `actorId` parameter to `reserveSalesOrder` and `runReconciliation`, and pass `request.actor.id` from `app.ts`.
   *Check:* after exercise 1, `GET /api/audit-logs` (as admin) shows an `order.reserved` row with `actorId: "user-warehouse-lead"`.
4. **Make reconciliation warehouse-aware.**
   *Goal:* include the warehouse code in the duplicate check (or store `inventoryItemId` on the notification).
   *Check:* with fresh seed data, the first reconciliation run reports four alerts and creates three notifications (the seed already has an unread one for `PACK-22-GRN`); after you lower the west black pack's `onHand` below its safety stock, the next run creates one more notification even though the east black pack already has one.
5. **Harden the CSV.**
   *Goal:* quote values containing a line break, and prefix values starting with `=`, `+`, `-` or `@` with a single quote.
   *Check:* a unit test shows `csvCell('=SUM(A1)')` returns `'=SUM(A1)` and a value containing a newline comes back wrapped in double quotes.
