# Atlas Fulfillment

Atlas Fulfillment is a TypeScript operations platform for warehouse and ecommerce inventory, orders, and fulfillment.

It is built as a modular monolith for learning how realistic business software grows: domain rules, database schema, API modules, background jobs, frontend workflows, tests, and architecture documentation.

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

## Important Docs

- `docs/architecture/initial-architecture-plan.md`
- `docs/architecture/architecture-journal.md`
- `docs/features/000-backlog.md`
- `docs/walkthroughs/`

## Project Shape

- `prisma/schema.prisma` defines the relational database model.
- `prisma/seed.ts` creates realistic tenant, warehouse, inventory, order, supplier, and fulfillment data.
- `src/server` contains the Express API and backend modules.
- `src/shared` contains domain types and business rules.
- `src/client` contains the React frontend.
- `src/worker` contains background reconciliation jobs.
