# Chairside

Staff scheduling, leave, attendance and licence compliance for multi-location dental practices.
ASP.NET Core 10 + SQL Server + Angular 21. Multi-tenant: every clinic is isolated by SQL Server row-level security.

## Run it locally

Needs .NET 10 SDK, Node 22, and a SQL Server 2019+ instance (the connection strings point at `localhost\MSSQLSERVER01`; change them in
`src/DentalStaff.Api/appsettings.Development.json` and `database/DentalStaff.DbMigrator/appsettings.json`).

```bash
dotnet run --project database/DentalStaff.DbMigrator
dotnet run --project src/DentalStaff.Api --launch-profile http
cd web && npx npm@11 install
npx ng serve
```

Open http://localhost:4200. Choose a demo role (Owner, Practice manager, Hygienist, Receptionist) or create your own clinic.
The API seeds the demo clinic "Bright Smiles Dental" on start when `Demo:Enabled` is true (Development only).
The global npm 10.9.2 fails on this project with an `edgesOut` error, so use `npx npm@11 install`.

## Tests

```bash
dotnet test
```

```bash
cd web && npx ng test --watch=false
```

End-to-end API suite (182 checks: roles matrix, every feature, tenant isolation, security). Run it against a freshly seeded
database with the API running; it changes the demo data, so reset the database afterwards (drop `DentalStaff_Dev`, run the migrator, restart the API).

```bash
node tests/e2e/api-smoke.mjs
```

## Where things are

| Path | What |
|---|---|
| `database/DentalStaff.DbMigrator/Scripts` | Schema, row-level security (0003) and audit triggers (0004). The only place schema changes |
| `src/DentalStaff.Domain/Rules` | Schedule checks, leave day counting, calendar and US holidays (unit tested) |
| `src/DentalStaff.Application/Features` | Use cases: auth, schedule, leave, attendance, staff, clinic settings, dashboard |
| `src/DentalStaff.Api` | Thin controllers, cookie auth, CSRF header check, rate limiting, error mapping |
| `web/src/app` | Angular app: `core` (API, session, formatting), `shared/ui.ts`, `features/*` |
| `docs/PRODUCT-SPEC.md` | Strategy, design system, blueprint, delivery report, go-to-market and roadmap |
| `docs/decisions.md` | Decisions that override the original brief |
