# Decisions

Decisions that change or extend docs/product-brief-and-feature-list.pdf. Newest at the bottom.
When a decision here conflicts with the brief, this file wins.

## D1. Stack: .NET + SQL Server + Angular (replaces brief Part 7 and Part 9 stack)

| Layer | Choice |
|---|---|
| API | ASP.NET Core (.NET 10 LTS), controllers, Clean Architecture (Domain, Application, Infrastructure, Api) |
| Database | SQL Server 2022 locally, Azure SQL Database (US East) in production |
| Schema changes | Versioned SQL scripts run by DbUp (database/DentalStaff.DbMigrator/Scripts). EF Core is used for data access only, never for migrations |
| Access control | SQL Server row-level security using SESSION_CONTEXT, plus ASP.NET Core policy authorization |
| Audit log | SQL triggers writing to audit.AuditLogEntry |
| Pay history | System-versioned temporal table in the pay schema |
| Auth | ASP.NET Core Identity with email invitations |
| Background jobs | Hangfire with SQL Server storage |
| Frontend | Angular 21 (standalone, signals, zoneless), Tailwind CSS 4, PWA service worker |
| Hosting | Azure App Service (API), Azure Static Web Apps (web), Azure SQL, all in a US region |

Reason: the developer's strength is .NET and SQL Server, and the four schedule checks and the hours reports are set-based SQL work.

## D2. Work pattern: who works which shift on which weekday (new, answers "days the person would have worked")

The brief counts leave "only on days the person would have worked", but leave is usually requested before that week's schedule exists. Each staff member therefore has a work pattern defined in policy.

New entities (built in milestone 4, settings and policies):

| Entity | What it stores | Key fields |
|---|---|---|
| ShiftDefinition | A named shift type, set by the Owner / Admin | name (for example Morning, Afternoon, Full day), location (or both), start time, end time, unpaid break minutes (empty means the clinic default), active |
| StaffWorkPattern | One version of a person's regular week | staff, effective from, effective to (empty means current) |
| StaffWorkPatternDay | One weekday in that pattern | pattern, weekday, shift definition, location |

Rules:

- One shift per person per day, so a pattern has at most one row per weekday.
- A pattern change adds a new version with a new effective-from date. Old versions are kept, so leave that was already counted does not change.
- A staff member must have a work pattern before they can request leave. Setting it is part of adding a staff member.
- Only the Owner / Admin and the Practice Manager of the person's home location can edit a work pattern. Every change is written to the audit log.

How leave days are counted, for each date in the request:

1. If the person has a published shift that day, the day counts (the real schedule wins over the pattern).
2. Otherwise, if the pattern effective on that date has a row for that weekday, the day counts.
3. If the day is a closed day for that location, it does not count.
4. A half-day flag on the first or last day counts that day as 0.5.

The total is saved on the leave request as "days counted" when it is submitted, and recalculated when it is decided.

Proposed extra, not in the brief (needs approval before building): in milestone 6, a "Fill week from work patterns" action creates draft shifts from each person's pattern, skipping approved leave and closed days. This makes the 15-minute schedule target easy to meet and replaces most of "copy last week".

## D3. Licence override record (fills a gap in the 16 entities)

The brief requires a logged Owner / Admin override when publishing a schedule that contains an expired required licence, but no entity stores it.

| Entity | Key fields |
|---|---|
| ScheduleOverride | shift, credential, overridden by, reason (required), overridden at (UTC) |

The override is also written to the audit log.

## D4. Credential type and job title is many to many

A credential type can be required for several job titles, so a junction table CredentialTypeJobTitle (credential type, job title) holds the requirement.

## D5. Shifts do not cross midnight

A shift's end time must be later than its start time on the same date. Change this only if the clinic confirms overnight shifts.

## Still open (confirm with the clinic before milestone 4)

See "Decisions to confirm with the clinic" at the end of the brief. Placeholder values in the database today: location names "Location A" and "Location B", and time zone America/New_York.

## D6. Multi-clinic SaaS (2026-10-14)

The product becomes "Chairside", sold to many clinics, instead of an internal app for one clinic.

- Every tenant table carries `ClinicId` (a GUID). SQL Server row-level security (script 0003) filters and blocks rows by `SESSION_CONTEXT('ClinicId')`, which the API sets read-only on every connection.
- `UserAccount` and `Invitation` are global tables because sign-in and invitation acceptance happen before the tenant is known. Invitation tokens are stored only as SHA-256 hashes.
- Plans: Starter (1 location) and Practice (up to 3). Billing is simulated; the location limit is enforced.
- A shared demo clinic is seeded in Development; demo sign-in works only for that clinic.

## D7. Schedule checks run in C#, not a stored procedure

The four checks live in `Domain/Rules/ScheduleChecker.cs` as a pure function over one week of data (at most a few hundred rows per clinic). This keeps them unit-testable and identical for the grid, publish and leave impact. Revisit with a stored procedure only if a clinic's week grows past a few thousand shifts.

## D8. Authentication without ASP.NET Core Identity stores

Cookie authentication plus the Identity `PasswordHasher` (PBKDF2). The full Identity EF stores would own their schema, which conflicts with D1 (schema owned by DbUp scripts). The cookie is re-validated against the database on every request so deactivation and role changes apply immediately. Two-factor sign-in is on the roadmap.

## D9. Security audit before the first client test (2026-10-15)

A full security, logic and UX audit before publishing. Script 0006 adds unique indexes for the rules the app already enforced (so races cannot break them), tenant-leading indexes for row-level security, audit triggers for the remaining policy tables, `Invitation.Email`/`RevokedUtc` and `UserAccount.SecurityStamp`. In the application: invitations are bound to their address and can never take over an account; sessions are revoked by stamp on sign-out and deactivation; deactivation also removes future shifts, closes pending leave and revokes invitations; leave counts only published shifts (D2) and the annual allowance, including pending requests, is enforced; a Practice Manager cannot change a manager's credentials or attendance; times skipped by daylight saving are a field error instead of a silent shift. Rejections need a reason; staff can withdraw a pending request.
