# Feature 003: CSV Export

## Goal

Add an operational CSV export for inventory balances.

## Impacted Areas

- `src/server/modules/platform/export.service.ts`
- `src/server/app.ts`
- Admin frontend actions

## Implementation Approach

The export service reuses the inventory read model and serializes a compact CSV. This avoids duplicating inventory availability calculations in export code.

## Design Considerations

The first export is synchronous because the dataset is tiny. At scale, exports should become background jobs with object storage links and audit records.

## Build Journal

The first CSV export was added through a shared read model. A junior developer should notice the design lesson: exports should call the same domain/application services as the UI, otherwise reports drift from what operators see on screen.

## As built (checked against this snapshot)

### How it works

- Route: `GET /api/exports/inventory.csv` (`src/server/app.ts:93-101`) sets `content-type: text/csv` and `content-disposition: attachment; filename="inventory.csv"`, guarded by `requireRole(['buyer', 'warehouse_manager', 'admin'])`.
- Service: `inventoryCsv` (`src/server/modules/platform/export.service.ts:9-28`) calls `listInventory` — the same read model the dashboard uses — and writes eight columns: `warehouse,sku,name,on_hand,reserved,available,reorder_point,health`. Rows are joined with `\n`.
- Cell escaping: `csvCell` (`:4-7`) wraps a value in double quotes, doubling inner quotes, when it contains `,` or `"`.
- UI: a plain link in the admin view (`src/App.tsx:384`), so the browser downloads it through the Vite proxy.
- Test: `tests/api.test.ts:23-28` checks status 200 and that the header row starts `warehouse,sku,name,on_hand`.

The reuse claim holds: `available` and `health` in the CSV come from `availableToPromise` and `stockHealth` via `listInventory` (`inventory.service.ts:17`, `:32`), not from separate arithmetic.

### What the build journal does not mention

1. **Line breaks are not escaped.** A value containing `\n` or `\r` is written unquoted (`csvCell` only checks `,` and `"`), which splits one record across two lines in the file.
2. **Formula injection.** Values starting with `=`, `+`, `-` or `@` are written as-is. Spreadsheet programs may evaluate such a cell as a formula when the file is opened. SKU names are data, so this is an injection path once SKUs can be edited.
3. **`safety_stock` is missing** although it drives `health` (`inventoryRules.ts:82`), so a reader of the CSV cannot reproduce why a row is `low`.
4. **No export audit.** The design note says exports at scale should get "audit records"; even this small export writes none, so there is no trace of who downloaded inventory data.
5. **The role list is wider than it reads.** Because `requireRole` uses rank, `warehouse_associate` can export too (see feature 001).
6. **The test runs as admin by default** and does not check any data row.

## Exercises

Each has a **Goal** and a **Check** you can observe.

1. **Read the export.**
   *Goal:* after seeding, download `/api/exports/inventory.csv`.
   *Check:* the file has a header plus six data rows, and the `PACK-22-GRN` row in `LAX-1` reads `on_hand` 42, `reserved` 20, `available` 22, `health` `low`.
2. **Escape properly.**
   *Goal:* make `csvCell` quote values containing `\n` or `\r`, and prefix values starting with `=`, `+`, `-` or `@` with `'`. Export `csvCell` and test it directly.
   *Check:* unit tests show `csvCell('=1+1')` returns `'=1+1`, a value containing a newline is wrapped in double quotes, and `csvCell(42)` still returns `42`.
3. **Make the CSV explain itself.**
   *Goal:* add `safety_stock` after `reorder_point`.
   *Check:* the header in the API test is updated, and for every row you can recompute `health` from the row's own columns using the rule in `inventoryRules.ts:81-97`.
4. **Audit the download.**
   *Goal:* write an `export.inventory_csv` audit row with the real actor (after feature 001's actor fix) and the row count in `metadata`.
   *Check:* after one download as `user-buyer`, `GET /api/audit-logs` as admin shows the row with `actorId: "user-buyer"` and `"rows":6` in `metadata`.
