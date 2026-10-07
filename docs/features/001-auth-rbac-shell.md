# Feature 001: Authentication Shell and RBAC

## Goal

Add a lightweight authentication shell and role-based authorization checks so backend endpoints have a source of truth for operational permissions.

## Impacted Areas

- `src/server/app.ts`
- `src/server/modules/platform/auth.ts`
- Backend mutation endpoints such as reservation and reconciliation

## Implementation Approach

Requests may send `x-user-id`. The API resolves that user from the database and attaches an actor context to the request. If no header is sent, the seeded admin user is used so local development remains frictionless.

Role checks are enforced on backend routes. The frontend can still improve UX later, but it is not trusted as the permission boundary.

## Design Considerations

This is not production authentication. There are no passwords, OAuth flows, cookies, JWTs, or session stores yet. The point is to establish where authorization belongs and how routes should ask for permissions.

## Build Journal

Built a small auth module with request authentication and `requireRole`. Reservation and worker reconciliation mutations now require operational roles. A junior developer should learn that authorization should be close to the backend action that changes state, not only hidden behind frontend buttons.

## As built (checked against this snapshot)

### How it works

- `src/server/app.ts:26` registers `authenticateRequest` after `/api/health`, so health is public and every other route needs a resolvable user.
- `authenticateRequest` (`src/server/modules/platform/auth.ts:17-30`):
  - reads `x-user-id`, falling back to `systemUserId` (`'user-ops-admin'`, defined in `src/server/db.ts:6`) when the header is absent (`:18`);
  - looks the user up **within the constant tenant** `tenant-atlas` (`:19-21`);
  - stores the Prisma `User` on `request.actor` (`:28`).
- `requireRole(allowedRoles)` (`:32-44`) turns the list into a minimum rank using `roleRank` (`:5-11`: viewer 0, buyer 1, warehouse_associate 1, warehouse_manager 2, admin 3) and rejects lower-ranked actors with `403 { error: 'Forbidden', requiredRoles }`.
- Guarded routes: reserve (`app.ts:52`, manager+), audit logs (`:85`, admin), CSV export (`:93`, rank 1+), reconcile (`:103`, manager+).

Seeded users (`prisma/seed.ts`): `user-ops-admin` (admin), `user-warehouse-lead` (warehouse_manager), `user-buyer` (buyer). No seeded user has the `viewer` or `warehouse_associate` role.

### What the build journal does not mention

1. **The fallback user is the admin.** "Frictionless local development" means an anonymous request has full rights. A safer default is the lowest role (`viewer`) or a 401.
2. **The role list is not what is enforced.** Because `requireRole` uses the minimum rank, `requireRole(['buyer', 'warehouse_manager', 'admin'])` also admits `warehouse_associate`, and the response's `requiredRoles` field tells a rejected caller something different from the rule that was applied. If the intent is ranking, accept one minimum role; if the intent is a list, check membership (`allowedRoles.includes(role)`).
3. **Unknown roles fall to rank 0, unknown required roles to 99.** A route guarded only by a misspelled role (`requireRole(['admni'])`) gets a minimum rank of 99 and locks out everyone, admin included; a misspelled role on a user makes them a viewer. Typing roles as a union (`'viewer' | 'buyer' | ...`) would catch both at compile time.
4. **Unknown user IDs produce 500, not 401.** The `Error` passed to `next` (`auth.ts:24`) reaches the generic handler (`app.ts:117-118`).
5. **The actor stops at the route.** No service receives `request.actor`; audit rows are written with `systemUserId` (`orders.service.ts:63`, `:125`; `reconciliation.service.ts:40`). The permission check knows who you are; the audit trail does not.
6. **The frontend never sends `x-user-id`** (`src/client/api.ts`), so the UI always runs as admin and cannot demonstrate a 403.
7. **No tests.** Neither `authenticateRequest` nor `requireRole` is exercised by `tests/api.test.ts`; the CSV test passes because the default user is the admin.

## Exercises

Each has a **Goal** and a **Check** you can observe.

1. **Observe the default.**
   *Goal:* with the API running, `curl http://127.0.0.1:4000/api/audit-logs` with no headers, then with `-H "x-user-id: user-buyer"`, then with `-H "x-user-id: nobody"`.
   *Check:* 200 with audit rows; 403 with `requiredRoles: ["admin"]`; 500 with `{"error":"Internal server error"}`.
2. **Make the default safe.**
   *Goal:* return 401 when the header is missing or the user is unknown, and update `tests/api.test.ts` to send `x-user-id: user-ops-admin` where needed.
   *Check:* `curl http://127.0.0.1:4000/api/dashboard` without a header returns 401; `/api/health` still returns 200; `npm test` passes.
3. **Say what you mean in `requireRole`.**
   *Goal:* change `requireRole` to check list membership and type role names as a union.
   *Check:* a route test shows that a `warehouse_associate` user (create one in a test fixture) gets 403 from the CSV export, and misspelling a role in `app.ts` is a TypeScript error under `npm run typecheck`.
4. **Show permissions in the UI.**
   *Goal:* add a user switcher that sets `x-user-id` on every request in `src/client/api.ts`, and hide the Reserve button for roles below manager.
   *Check:* as `user-buyer`, the Reserve button is hidden — and calling the endpoint directly still returns 403, proving the backend is the boundary.
