# Feature 002: Audit Log Viewer

## Goal

Expose recent audit log records through the API and surface them in the admin area.

## Impacted Areas

- `prisma/schema.prisma`
- `src/server/modules/platform/audit.service.ts`
- `src/server/app.ts`
- `src/App.tsx`

## Implementation Approach

The audit service reads recent audit records for the tenant, ordered newest first. The admin screen can use these records to explain worker runs, reservation attempts, seed initialization, and future inventory adjustments.

## Design Considerations

Audit logs are append-only from the application perspective. The first version stores metadata as JSON text because it keeps the schema flexible while the domain is still evolving.

## Build Journal

The app now has a real audit trail surface. A junior developer should learn that audit logs are not the same thing as application logs: audit logs explain business actions and should be queryable by tenant, actor, entity, and time.

## As built (checked against this snapshot)

### How it works

- Schema: `AuditLog` (`prisma/schema.prisma:230-242`) has `tenantId`, `actorId`, `action`, `entityType`, `entityId`, `metadata` (a JSON **string**), and `createdAt`, with an index on `(tenantId, entityType, entityId)`. `actorId` is a plain string, not a relation to `User`.
- Service: `listAuditLogs` (`src/server/modules/platform/audit.service.ts:4-10`) returns the 25 newest rows for the constant tenant `tenant-atlas`.
- Route: `GET /api/audit-logs`, admin only (`src/server/app.ts:85-91`). It returns Prisma rows as-is, so `metadata` reaches the browser as a JSON-encoded string.
- UI: `refresh` in `src/App.tsx:47-59` fetches audit logs after the dashboard; `AdminView` (`App.tsx:370-408`) lists action, entity, actor and time.

Who writes audit rows today:

| Action | Written by |
|---|---|
| `order.reservation_failed` | `orders.service.ts:59-69` |
| `order.reserved` | `orders.service.ts:121-131` |
| `worker.reconciliation_completed` | `reconciliation.service.ts:36-46` |
| seed initialization | `prisma/seed.ts` (one row, `entityType: 'tenant'`) |

The design note above mentions "future inventory adjustments"; `InventoryAdjustment` is never written, so there are no adjustment audits yet.

### What the build journal does not mention

1. **Every audit row names the admin.** All three writers hard-code `actorId: systemUserId` (`orders.service.ts:63`, `:125`; `reconciliation.service.ts:40`). The viewer shows `user-ops-admin` for actions taken by anyone. "Queryable by actor" — the lesson stated in the build journal — is not true of this data.
2. **The viewer cannot query.** There are no filters for entity, actor or time range, and no paging beyond the fixed 25 rows, although the index supports entity lookups.
3. **A non-admin breaks the whole page refresh.** `refresh` awaits `fetchAuditLogs` inside the same `try` as the dashboard (`App.tsx:49-51`). For a non-admin, the 403 makes `fetchAuditLogs` throw, the `catch` replaces the real dashboard with fallback data (`:53-55`), and the UI reports an error for data that loaded fine. Today this is hidden because the UI always runs as admin.
4. **"Append-only" is a convention.** Nothing in the schema or code prevents updates or deletes; the seed script deletes all audit rows on every run (`prisma/seed.ts:9`).
5. **IDs can collide.** IDs are `audit-<kind>-${Date.now()}`; two reservations finishing in the same millisecond collide on the primary key.

## Exercises

Each has a **Goal** and a **Check** you can observe.

1. **Read the trail.**
   *Goal:* reserve `so-10035` (see `final-system-design.md`, exercise 1), run reconciliation, then `GET /api/audit-logs`.
   *Check:* the newest rows are `worker.reconciliation_completed` (with `metadata` containing `"alerts":4`) and `order.reserved` (with `"lineCount":1`), both with `actorId` `user-ops-admin` — even if you sent `x-user-id: user-warehouse-lead`.
2. **Add filters.**
   *Goal:* accept optional `entityType`, `entityId` and `limit` (max 100) query parameters, validated with Zod like `orderIdParams` in `app.ts:15`.
   *Check:* `/api/audit-logs?entityType=sales_order&entityId=so-10035` returns only that order's rows, and `?limit=500` returns 400 with `error: "Invalid request"`.
3. **Decouple the admin panel.**
   *Goal:* load audit logs in their own `try/catch` so a 403 leaves the dashboard intact.
   *Check:* with the user switcher from feature 001's exercise 4 set to `user-buyer`, the dashboard shows real data and the audit panel shows a "not permitted" note.
4. **Parse metadata at the edge.**
   *Goal:* return `metadata` as an object (`JSON.parse` in the service, with a fallback for bad JSON) and update `AuditLogDto` in `src/shared/apiContracts.ts:94-102`.
   *Check:* the JSON response shows `"metadata": { "lineCount": 1 }`, not a quoted string, and `npm run typecheck` passes.
