# Dental Clinic Staff Management App

## What this is
Chairside: a multi-clinic SaaS (docs/decisions.md D6) for US dental practices, each with one or more locations. It manages staff profiles, work patterns, shift schedules with four schedule checks, leave, attendance (clock in and out), credentials, clinic settings and policies, and pay records. Version 1 includes only the features marked Must in docs/product-brief-and-feature-list.pdf.
docs/decisions.md extends and overrides the brief. Read it first.

## Stack
- API: ASP.NET Core, .NET 10, controllers, Clean Architecture
- Database: SQL Server (Azure SQL in production, US region). Schema owned by DbUp scripts, not EF migrations
- Data access: EF Core for CRUD; stored procedures or inline table-valued functions for schedule checks and reports
- Frontend: Angular 21, standalone components, signals, zoneless, OnPush, Tailwind CSS 4, PWA
- Jobs: Hangfire (SQL Server storage). Auth: ASP.NET Core Identity

## Folder structure
- src/DentalStaff.Domain: entities and business rules. References nothing
- src/DentalStaff.Application: use-case handlers, DTOs, IAppDbContext. References Domain only
- src/DentalStaff.Infrastructure: AppDbContext, EF configurations, email, jobs
- src/DentalStaff.Api: thin controllers, DI, auth, middleware
- database/DentalStaff.DbMigrator/Scripts: one numbered .sql file per change (NNNN_description.sql)
- tests/DentalStaff.Tests: xUnit
- web/: Angular app (web/src/app/core for services, one folder per feature)
- design/: tokens, design rules, hero screens, content list
- docs/: brief, decisions

## Naming
- Entities: Clinic, UserAccount, Staff, Location, JobTitle, Invitation, Shift, ShiftDefinition, StaffWorkPattern, StaffWorkPatternDay, LeaveRequest, LeavePolicy, AttendanceRecord, CredentialType, Credential, CoverageRule, ClosedDay, ClinicSetting, ScheduleOverride, PayRecord, Notification, AuditLogEntry
- Tables in PascalCase, singular, in schemas app, pay, sec, audit. C# in PascalCase. Angular files in kebab-case
- Roles: owner_admin, practice_manager, clinical_staff, reception

## Always
- Carry ClinicId on every new tenant table and add it to sec.TenantIsolationPolicy in a new script; never query across clinics
- Put business rules in Domain/Rules with a unit test; keep controllers thin
- Enforce permissions with SQL Server row-level security and ASP.NET Core authorization, never only in the UI
- Follow the roles matrix in the brief (Part 3) exactly. Check every screen as each of the four roles, at both locations
- Take clock-in and clock-out times from the database clock (SYSUTCDATETIME), never from the device
- Store instants as UTC datetime2; store shift dates and times as local DATE and TIME in the clinic time zone from app.ClinicSetting
- Read every policy value from the settings tables, never hardcode it
- Run the four schedule checks on the server, across both locations: overlap or leave, minimum staffing, expired required licence, overtime
- Count leave from published shifts, else the work pattern, minus closed days, in half-day steps (docs/decisions.md D2)
- Write every schedule change, leave decision, attendance correction, pay edit, policy change, override, and role change to the audit log through database triggers
- Return DTOs, never entities. Paginate lists. Use AsNoTracking and projection for queries. Use decimal for money
- Follow design/design-rules.md and use only theme tokens in web/src/styles.css
- Make every screen work at 360, 768, and 1280 px
- Add a new numbered SQL script for every structure change; never edit a script that has already run
- Build both sides (dotnet build, ng build) and run tests before calling a task done. Then say what changed and how to test it

## Never
- Never return pay data except to owner_admin or to the person it belongs to
- Never let a manager approve their own leave or correct their own attendance
- Never publish a schedule with an expired required licence without a logged Owner / Admin override
- Never discard unscheduled clock-in time; record it and flag it
- Never deduct short paid breaks
- Never store Social Security numbers, bank account details, or patient information
- Never put secrets in code or appsettings.json committed to Git; use user secrets locally and Key Vault in Azure
- Never delete staff records; deactivate them
- Never build features marked Should or Later unless asked
- Never change the database structure without telling me first

## Working style
- One milestone at a time (brief Part 8). Write a short plan before code
- Ask before writing code if anything in the docs is unclear
- Small changes, Git commit after each working step

## Run locally
- Database: dotnet run --project database/DentalStaff.DbMigrator
- API: dotnet run --project src/DentalStaff.Api --launch-profile http (http://localhost:5117)
- Web: cd web, then npx ng serve (http://localhost:4200, proxies /api to the API)
- Tests: dotnet test, and in web: npx ng test --watch=false
- npm: the global npm 10.9.2 fails on this project (edgesOut bug). Use npx npm@11 install
