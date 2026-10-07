# Future Feature Backlog

This backlog is deliberately realistic. Each feature should get its own feature plan before implementation and a build journal after implementation.

## Phase 1: Foundation

1. Authentication shell with seeded users and session context
2. RBAC policy helpers for warehouse and admin permissions
3. Tenant isolation checks in API service boundaries
4. Audit log viewer for inventory adjustments and order actions
5. API contract documentation and health checks

## Phase 2: Inventory Depth

6. Barcode scanning UI for receiving, picking, and cycle counts
7. CSV batch import for products, SKUs, and inventory counts
8. Inventory adjustment approval workflow
9. Multi-warehouse transfer orders
10. Cycle count reconciliation jobs

## Phase 3: Orders and Fulfillment

11. Partial fulfillment and split shipments
12. Cancellation workflow that releases reservations
13. Return merchandise authorization workflow
14. Pick-pack-ship warehouse screen
15. Customer/self-service order status portal

## Phase 4: Supplier and Purchasing

16. Supplier lead time tracking
17. Purchase order receiving workflow
18. Landed cost and supplier performance reporting
19. Low-stock purchase suggestions
20. Approval workflow for large purchase orders

## Phase 5: Platform Concerns

21. Domain event outbox processor
22. Notification preferences
23. Admin settings and configurable rules
24. Reporting dashboards with export
25. Observability page with worker status and failed jobs

## Phase 6: Integrations and Quality

26. Shopify mock API integration
27. Webhook subscriptions for order and inventory changes
28. Playwright end-to-end tests for core warehouse workflows
29. CI verification workflow
30. Final system design review and maintenance guide

## Build Journal

The backlog is grouped by engineering concern, not by screen. That matters because real product work often cuts across frontend, backend, data, background jobs, and documentation. The lesson for a growing developer is to plan features by affected boundaries, not by the first button you see in the UI.

## Where each item starts from (checked against this snapshot)

Before planning any item, it helps to know what the code already has. "Schema" means a Prisma model exists; "seed" means `prisma/seed.ts` creates rows; "code" means a service or route uses it.

| # | Item | Starting point in the code |
|---|---|---|
| 1 | Auth shell | **built** as feature 001: `x-user-id` header, default admin (`src/server/modules/platform/auth.ts`) |
| 2 | RBAC helpers | **built** as `requireRole` with role ranks (`auth.ts:5-11`, `:32-44`); no per-warehouse permissions |
| 3 | Tenant isolation | not started: one constant tenant (`src/server/db.ts:5`); most queries have no tenant filter |
| 4 | Audit log viewer | **built** as feature 002 (API + admin panel); audit actor is always the admin |
| 5 | API contracts + health | partly: `GET /api/health` exists; `src/shared/apiContracts.ts` holds response types but no request schemas |
| 6-7 | Barcode UI, CSV import | schema has `Sku.barcode` (unique); no import code |
| 8 | Adjustment approvals | schema: `InventoryAdjustment`; never written |
| 9 | Transfer orders | nothing |
| 10 | Cycle count jobs | the reconciliation worker is the closest shape (`src/server/modules/worker/reconciliation.service.ts`) |
| 11 | Partial fulfillment, split shipments | schema: `Shipment` (many per order); `applyShipment` exists as a pure function (`src/shared/inventoryRules.ts:69-79`) but no route ships |
| 12 | Cancellation releasing reservations | schema: `StockReservation.status`, `expiresAt`; no release code |
| 13 | RMA workflow | schema + seed: `Return`; never read |
| 14 | Pick-pack-ship screen | `FulfillmentView` in `src/App.tsx` lists shipments and the sales-order queue; no actions |
| 15 | Customer portal | nothing |
| 16 | Supplier lead times | schema + seed: `Supplier.leadTimeDays`, `reliability`; not used in any calculation |
| 17 | PO receiving | schema: `PurchaseOrderLine.receivedQty`; only summed for display (`purchasing.service.ts:21-22`) |
| 18 | Landed cost reporting | schema: `unitCostCents` on SKU and PO lines; unused |
| 19 | Low-stock purchase suggestions | partly: `suggestedPurchaseQty` is computed per alert (`src/server/modules/inventory/inventory.service.ts:58`) |
| 20 | Large-PO approvals | nothing |
| 21 | Outbox processor | schema + writes: reservations create `DomainEvent` + `OutboxMessage` (`orders.service.ts:102-120`); nothing delivers them |
| 22 | Notification preferences | schema: `Notification`; reconciliation writes to a hard-coded user |
| 23 | Configurable rules | nothing; reservation expiry (72 h) and the suggestion formula are constants |
| 24 | Reporting + export | partly: inventory CSV (feature 003) |
| 25 | Observability page | nothing; the worker prints to stdout |
| 26-27 | Shopify mock, webhooks | `SalesOrder.channel` holds strings like `Shopify` in the seed; no integration code |
| 28-29 | Playwright, CI | none in the repo |
| 30 | Final design review | `docs/architecture/final-system-design.md` exists and now includes review findings |

## How to pick the next item

The review in `final-system-design.md` found problems that sit underneath several backlog items. Two of them are worth fixing before any Phase 2-4 work, because every later workflow will copy their pattern:

- **Pass the actor into services** (affects items 4, 8, 12, 17, 20): every mutation should record who did it.
- **Sum quantities per SKU in `planReservation`** (affects items 11 and 12): partial fulfillment and cancellation both depend on reservation math being right.

## Exercise

**Goal:** write the feature plan for item 12 (cancellation releases reservations) in the same format as `001-auth-rbac-shell.md`: Goal, Impacted Areas, Implementation Approach, Design Considerations.

**Check:** your Impacted Areas list includes `prisma/schema.prisma` (or explains why no change is needed), `src/server/modules/orders/orders.service.ts`, `src/server/app.ts` and a test file; your approach decrements `InventoryItem.reserved` and sets `StockReservation.status` in the same transaction; and it says which role may cancel and how the audit row gets the real actor.
