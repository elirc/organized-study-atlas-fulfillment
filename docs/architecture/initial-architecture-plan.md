# Initial Architecture Plan: Atlas Fulfillment

## Product Goal

Atlas Fulfillment is an operations platform for a warehouse or ecommerce business. The first version should teach realistic business software design: inventory availability, stock reservations, purchasing, sales orders, fulfillment, returns, low-stock alerts, audit trails, and admin dashboards.

The system is intentionally built as a modular monolith. That means the code runs as one deployable application, but the codebase is organized around domain boundaries so it can grow without becoming a single tangled CRUD app.

## Initial Scope

The initial build includes:

- Products, SKUs, suppliers, warehouses, and inventory counts
- Purchase orders and sales orders
- Stock reservations that reduce available-to-promise inventory
- Shipments and returns data
- Low-stock alert detection
- Admin dashboard metrics
- Background reconciliation worker shape
- Domain events, outbox records, and audit adjustment models in the schema
- Frontend operations screens for dashboard, inventory, orders, purchasing, fulfillment, alerts, and admin

## Tech Stack

- TypeScript for all application code
- React + Vite for the frontend
- Express for the backend API
- Prisma + SQLite for the first database layer
- Zod for request validation
- Vitest for domain and API tests
- tsx for local TypeScript scripts and server execution

SQLite is used so the project is easy to run locally. The schema is written to preserve concepts that would translate cleanly to PostgreSQL later: tenant ownership, explicit IDs, unique constraints, status fields, event/outbox tables, and timestamped audit records.

## Module Boundaries

### Catalog

Owns products and SKUs. Other modules refer to SKU IDs, but catalog owns SKU metadata such as SKU code, barcode, dimensions, product relationship, and active/inactive state.

### Warehouse

Owns warehouses, inventory balances, inventory adjustments, transfer planning, and low-stock calculations. It is the source for on-hand, reserved, available, reorder point, and safety stock values.

### Purchasing

Owns suppliers and purchase orders. Receiving inventory should eventually create inventory adjustments and domain events.

### Orders

Owns sales orders, order lines, reservations, cancellation rules, and status transitions.

### Fulfillment

Owns shipments and returns. It depends on orders and warehouse inventory, but it should not own product metadata.

### Platform

Owns tenancy, users, roles, audit events, domain events, outbox messages, notifications, health checks, and worker orchestration.

## Data Consistency Rules

Inventory systems are dangerous because a simple update can create business damage. The first version keeps these rules explicit:

- Available quantity is `onHand - reserved`.
- A reservation must fail if requested quantity is greater than available quantity.
- Reserving stock increments `reserved`, not `onHand`.
- Shipping reserved stock decrements both `onHand` and `reserved`.
- Returns increase `onHand` after inspection or restock.
- Every inventory mutation should be explainable through an adjustment, order, shipment, return, or reconciliation record.

## API Shape

The first backend is intentionally small:

- `GET /api/health`
- `GET /api/dashboard`
- `GET /api/inventory`
- `GET /api/orders`
- `GET /api/purchase-orders`
- `GET /api/shipments`
- `GET /api/alerts/low-stock`
- `POST /api/orders/:orderId/reserve`
- `POST /api/worker/reconcile`

The backend is the source of truth for inventory math and authorization-ready workflow rules. The frontend can show/hide actions later, but backend modules must still enforce rules.

## Frontend Shape

The frontend is an operations console, not a marketing page. It should be dense, scannable, and useful for repeated work:

- Left navigation by operational area
- Dashboard metrics and exception queues
- Inventory table with availability math
- Sales order queue with reservation status
- Purchase order and shipment panels
- Low-stock alerts and background job output

## Testing Strategy

The first tests focus on domain rules because they are high-risk:

- Reservation succeeds only when available inventory is sufficient.
- Reservation failure returns a useful reason.
- Shipping reserved stock updates on-hand and reserved quantities correctly.
- Low-stock alerts trigger from reorder point and safety stock rules.
- API health and dashboard endpoints can be exercised without a browser.

## Build Journal

This document was created before implementation to set boundaries. The most important lesson is that architecture starts with ownership: which module owns a concept, which modules may reference it, and which rules must never be duplicated casually.

## Plan versus code (checked against this snapshot)

The plan above was written before implementation. This section records what the code in this repository actually does, item by item. Nothing here was run; it comes from reading the files named.

### Initial scope

| Plan item | Status | Where |
|---|---|---|
| Products, SKUs, suppliers, warehouses, inventory counts | modelled, seeded, read-only | `prisma/schema.prisma` (`Product`, `Sku`, `Supplier`, `Warehouse`, `InventoryItem`); `prisma/seed.ts` |
| Purchase orders and sales orders | modelled, seeded, listed | `purchasing.service.ts`, `orders.service.ts:8-33` |
| Stock reservations that reduce available-to-promise | **built** | `orders.service.ts:35-135` |
| Shipments and returns data | shipments listed; returns seeded but never read | `fulfillment.service.ts`; no service touches `Return` |
| Low-stock alert detection | **built** | `inventory.service.ts:37-60`, rule in `inventoryRules.ts:81-83` |
| Admin dashboard metrics | **built** | `dashboard.service.ts:8-34` |
| Background reconciliation worker shape | **built** (one pass, no scheduler) | `src/worker/reconciliation.worker.ts`, `reconciliation.service.ts` |
| Domain events, outbox, audit adjustment models | events and outbox written on reservation; nothing reads or delivers outbox messages; `InventoryAdjustment` is never written | `orders.service.ts:102-120` |
| Frontend screens | dashboard, inventory, orders, purchasing, fulfillment, admin | `src/App.tsx` (views at `:169-408`) |

### Module boundaries

The plan names six modules. The code has eight service folders under `src/server/modules/`: `dashboard`, `fulfillment`, `inventory`, `orders`, `platform`, `purchasing`, `worker`, and no `catalog` or `warehouse` folder — SKU and warehouse data are read inside `inventory.service.ts` and `orders.service.ts` directly through Prisma. The boundaries are therefore folder conventions, not enforced interfaces: every service receives the whole `PrismaClient` and can query any table.

### Data consistency rules

| Rule | In code? |
|---|---|
| Available = `onHand - reserved` | yes, clamped at 0: `inventoryRules.ts:25-27` |
| Reservation fails if requested > available | yes, per line: `inventoryRules.ts:45-54`. Two lines for the same SKU are each checked against the full amount, so together they can exceed it. |
| Reserving increments `reserved`, not `onHand` | yes: `orders.service.ts:81-84` |
| Shipping decrements both | only as a pure function, `applyShipment` (`inventoryRules.ts:69-79`); no endpoint ships anything |
| Returns increase `onHand` | not implemented |
| Every mutation explainable through a record | reservations write `StockReservation`, `DomainEvent`, `OutboxMessage` and `AuditLog` rows; no `InventoryAdjustment` is ever written |

### API shape

All nine planned endpoints exist in `src/server/app.ts`. Two more were added by the feature work: `GET /api/audit-logs` (`:85-91`, feature 002) and `GET /api/exports/inventory.csv` (`:93-101`, feature 003).

### Testing strategy

| Planned test | Exists? |
|---|---|
| Reservation succeeds only when sufficient | yes — `tests/inventoryRules.test.ts:24-29` |
| Failure returns a useful reason | partly — the test checks `available`, not `reason` (`:31-36`) |
| Shipping updates both quantities | yes — `:42-44` (pure function only) |
| Low-stock triggers from reorder point and safety stock | reorder point only (`:46-48`); the safety-stock branch is untested |
| Health and dashboard without a browser | yes — `tests/api.test.ts:8-21`, plus a CSV export test (`:23-28`) |

Not tested at all: `reserveSalesOrder` (the most important transaction), `requireRole`, and the reconciliation worker.

## Exercises

Each has a **Goal** and a **Check** you can observe.

1. **Find the missing boundary.**
   *Goal:* list every Prisma model each service file queries.
   *Check:* `inventory.service.ts` reads `InventoryItem`, `Sku`, `Product` and `Warehouse` — three of which the plan assigns to the Catalog and Warehouse modules. Write one sentence on what a "catalog" module interface would have to expose so inventory could stop reading `Sku` directly.
2. **Close the duplicate-line hole.**
   *Goal:* make `planReservation` sum quantities per SKU before comparing with availability.
   *Check:* a new test with two lines `{ skuId: 'sku-pack-green', quantity: 15 }` against the test balance (22 available) returns `ok: false` with `requested: 30`; the existing tests still pass.
3. **Test the safety-stock branch.**
   *Goal:* add a test where available is above the reorder point but `onHand` is at or below safety stock.
   *Check:* for `{ onHand: 30, reserved: 0, reorderPoint: 10, safetyStock: 30 }`, `isLowStock` returns `true`; change `<=` to `<` in the second comparison and the test fails.
