# Chairside — product spec and delivery report

Depth B: specs plus a working prototype. Built on the original brief (docs/product-brief-and-feature-list.pdf), extended to a multi-clinic SaaS.

## 1. Assumptions

- Product name "Chairside"; pitch: "The staff schedule that knows who is licensed, who is off, and who is short."
- Target segment: independent US dental practices with 1–3 locations and 8–40 staff (a DSO tier comes later).
- Primary business metric: weekly active clinics that publish a schedule (activation = first week published).
- Platforms: responsive web app installable as a PWA. No native apps.
- Stack: ASP.NET Core 10, SQL Server / Azure SQL, Angular 21 (the builder's strengths; see docs/decisions.md D1).
- Monetization: per active staff member per month, two plans, 14-day trial without a card. Billing is simulated.
- Brand: created new. Tone words: calm, exact, trustworthy.
- Compliance: US only, English only, USD. No patient data (keeps the product outside HIPAA); staff and pay data follow US employment-record rules.
- Email delivery, payments and push notifications are simulated in the prototype.
- One clinic per account; a person belongs to one clinic.
- Leave balance counts annual leave per calendar year; sick and other leave are recorded but not deducted (configurable later).
- Shifts never cross midnight (decisions D5).

## 2. Strategy digest

**Personas**

| Persona | Job to be done | Pain today |
|---|---|---|
| Dana, owner-dentist (2 locations) | Know the practice is safely staffed and compliant without doing it herself | Finds out about an expired licence or a short day after the fact |
| Jordan, practice manager | Build next week in minutes and handle leave without chasing messages | Paper rosters, WhatsApp leave requests, re-checking coverage by hand |
| Grace, hygienist | See my next shift, clock in, ask for time off from my phone | Has to ask the front desk; never sure a request was seen |

**Value proposition.** Chairside checks every schedule against the four things that actually go wrong in a dental office — double bookings or leave, short-staffed days, expired licences, and overtime — before it is published, and blocks the one that is a legal risk.

**Positioning**

| Alternative | Where it falls short for dental | Chairside's angle |
|---|---|---|
| Spreadsheets and WhatsApp | No checks, no record, no phone view | Same speed, with checks and an audit trail |
| General shift tools (Deputy, When I Work, Homebase) | Built for retail and hospitality; licence tracking is generic and does not stop publishing | Licence requirements per job title that block publishing, with a logged owner override |
| Practice-management software (Dentrix, Open Dental) | Built around patients; staff scheduling is an afterthought | Staff-only, no patient data, so no HIPAA burden and a fast setup |

**Success metrics.** North star: clinics publishing at least one week per week. Supporting: time from sign-up to first published week (target under 30 minutes); share of leave requests decided inside the app within 48 hours; credentials renewed before expiry (target 100% of those warned).

**MVP scope** (built): sign-up and demo, roles, staff with work patterns and credentials, weekly schedule with four checks, licence block with override, fill from patterns, publish, my day with clock in/out, leave with day counting and inbox, attendance review and corrections, settings (policies, coverage, closed days, locations), simulated plan and billing, data export, audit log, notifications.
**Later**: pay and compensation (brief milestone 9), hours reports, 30-day reminder emails, shift swaps, push notifications, CSV/PDF export, account deletion, admin console.

## 3. Experience architecture

**Route map**

| Route | Who | Purpose |
|---|---|---|
| `/login`, `/signup`, `/invite/:token` | Public | Sign in (with demo roles), create a clinic, accept an invitation |
| `/today` | Owner, Practice Manager | Who is working, leave to decide, credentials, clock-ins to review, setup checklist |
| `/my` | Everyone | Clock in/out, upcoming shifts, recent hours (phone first) |
| `/schedule` | Everyone (edit: managers of that location) | Weekly grid / phone day view, chart check, publish |
| `/leave` | Everyone; inbox for managers | Request with live day count, balance, decisions with staffing impact |
| `/attendance` | Managers | Week of clock records, flags, corrections, unscheduled confirmations |
| `/staff`, `/staff/:id` | Directory: everyone (scoped); edit: managers | Profile, work pattern, credentials, invite, deactivate |
| `/settings` | Owner | Policies, minimum staffing, closed days, locations, plan, export |
| `/audit` | Owner | Every change, with before and after values |

**Core journeys (verified in the browser, see section 5)**

1. Owner signs up → clinic created with defaults (job titles, shift types, licence types, US holidays, weekday minimums) → Today shows a four-step checklist.
2. Manager opens Schedule → Fill from work patterns → chart check shows issues → edits a shift (validation inline) → publishes; if a required licence is expired, the owner overrides with a logged reason.
3. Staff opens My day → clocks in at a chosen location (server time) → clocks out.
4. Staff requests leave → sees days counted (closed days and days off excluded) and balance → manager sees staffing impact and overlaps → approves with a comment → staff is notified.
5. Manager reviews a missed clock-out or unscheduled clock-in → corrects or confirms → the change is in the audit log.

**States.** Every data view has a skeleton loading state shaped like the content, an empty state that says what the screen is for and what to do next, an error state with Try again, and success toasts announced in an `aria-live` region. Pages a role cannot use are not in its navigation, and their routes redirect (guards) while the API returns 403.

## 4. Design system

**Metaphor: the operatory chart.** The ruled paper of a dental chart: 1px rules, readings in tabular monospace, and charting notation for every status — a symbol plus a word (✓ Valid, ◐ Pending, ! Expiring, ✕ Expired). Draft shifts are hatched like an unconfirmed chart entry. Page titles use a soft editorial serif so the product reads like a well-kept clinical record rather than a generic dashboard.

**Typography** (self-hosted latin subsets in `web/public/fonts`, Inter and Fraunces preloaded, OFL licensed):
Fraunces (page titles and big numbers), Inter (interface and body), JetBrains Mono (times and counts, tabular figures).
Scale: page title 28px, section 17px, body 15px, small 14px, label 12px uppercase.

**Colour tokens** (contrast computed with a script, WCAG formula; all pairs pass):

| Token | Light | Dark (tuned, not inverted) | Check |
|---|---|---|---|
| bg / surface / raised | #F6F5F1 / #FFFFFF / #FBFAF7 | #0F151A / #161F26 / #1A242C | — |
| ink | #1B2530 | #E6EBEE | 15.5:1 / 13.9:1 on surface |
| muted | #56616C | #9BA8B3 | 6.3:1 / 6.9:1 |
| accent (sterile teal) | #0D6963 | #56C7B8 | text on accent 6.5:1 / 8.1:1 |
| warn / block / ok on their soft fills | #7A4A00 / #9E2418 / #1D6637 | #F3BC66 / #FF8F80 / #74D597 | 6.0–8.9:1 |
| control border | #8C939A | #66737F | 3.1:1 / 3.4:1 (UI minimum 3:1) |
| job colours: dentist, hygienist, assistant, reception, manager, owner | #3B4FB8, #0B6A8A, #8A4B00, #7A3B8F, #475467, #A3324F | #A9B5FF, #7FD3F0, #F5BE7A, #E0A9F2, #B9C3CF, #FF9DB5 | text on soft fill 5.3–9.0:1; stripe on surface ≥ 6.1:1 |

Job colour is always shown next to the job title text, never on its own.

**Shape and depth.** Radius 8px controls, 14px cards, pill badges. Two shadow levels (resting, raised) on top of 1px borders.
**Motion.** 150ms / 200ms / 420ms tokens with one ease-out curve: page entrance, hover lift, sheet rise on phones, clock-in pulse and check draw. All collapse to 0ms under `prefers-reduced-motion`.
**Icons.** Lucide only, 1.75 stroke, decorative (aria-hidden) with the name on the control.
**Components.** Logo mark (a molar with a check), avatar with job colour, button (primary, default, quiet, danger, icon), field with linked error, segmented control, badge, alert, table in a scroll region, sheet (centred dialog on desktop, bottom sheet on phones, focus restored), page header with eyebrow, skeleton shimmer, toast with Undo.
**Signature screens.** Weekly schedule (job-coloured shifts, hours bar per person, coverage heat row, live chart check, drag to move with Undo, day timeline with a now line); My day (live clinic clock, large round clock button with a shift-progress ring and elapsed timer); sign-in (brand panel with a live product preview).
**Navigation.** Desktop sidebar with icons; on phones a top app bar plus a bottom tab bar (four most-used places and More).

## 5. Technical blueprint

**Stack and why.** ASP.NET Core 10 controllers over Clean Architecture (Domain → Application → Infrastructure → Api); SQL Server because tenant isolation, audit and history are database features there (row-level security, triggers, temporal tables later); Angular 21 standalone + signals + zoneless for a typed, structured SPA; Tailwind 4 for token-driven styling; DbUp for versioned SQL. Dependencies added and why: `dbup-sqlserver` (versioned scripts the SQL developer owns), `Microsoft.Extensions.Identity.Core` (PBKDF2 password hasher instead of hand-rolled crypto), Tailwind (tokens to utilities). No MediatR or AutoMapper: both are now commercially licensed and not needed at this size.

**Data model** (all tenant tables carry `ClinicId`; see Scripts/0002):
Clinic (settings and plan) · UserAccount (global, sign-in) · Invitation (global, hashed token) · Location · JobTitle (→ role) · Staff · ShiftDefinition · StaffWorkPattern → StaffWorkPatternDay · Shift · ClosedDay · CoverageRule · CredentialType ↔ JobTitle (CredentialTypeJobTitle) · Credential · LeaveRequest · AttendanceRecord · ScheduleOverride · Notification · audit.AuditLogEntry.

**API** (all JSON, all require sign-in unless marked):

| Area | Endpoints |
|---|---|
| Auth | POST signup*, login*, invite*, demo*, logout · GET me, config* |
| Clinic | GET lookups, settings, billing, coverage/{loc}, closed-days, export · PUT settings, coverage · POST locations, billing/plan, closed-days · DELETE closed-days/{id} |
| Staff | GET /staff?search, /staff/{id} · POST /staff, {id}/deactivate, {id}/reactivate, {id}/invite, {id}/credentials · PUT /staff/{id} · DELETE {id}/credentials/{cid} |
| Schedule | GET /schedule?locationId&date, /schedule/mine · POST shifts, publish, fill · PUT/DELETE shifts/{id} |
| Leave | GET mine, inbox, team · POST /leave, preview, {id}/decide |
| Attendance | GET me, /attendance?locationId&date · POST clock-in, clock-out, {id}/confirm · PUT {id} |
| Overview | GET dashboard, notifications, audit · POST notifications/read |

**Auth and authorization.** HttpOnly, SameSite=Strict cookie (10 h sliding). On every request the cookie is re-validated against the database, so deactivation and role changes apply immediately. Fallback policy requires sign-in on every endpoint. Role and location rules live in `Application/Common/Access.cs` and each service; the brief's roles matrix is followed (managers cannot decide their own leave or correct their own attendance; only the owner overrides a licence block, changes policies, sees the audit log and billing).

**Multi-tenancy.** Shared database, `ClinicId` on every tenant row, enforced by SQL Server row-level security (filter + block predicates on 18 tables). The API sets `SESSION_CONTEXT('ClinicId')` read-only on every connection it opens (EF interceptor). Even a query that forgets a filter cannot read or write another clinic.

**Errors.** Expected failures are typed (`ValidationException` with field keys, `NotFound`, `Forbidden`, `Conflict`) and mapped to RFC 9457 ProblemDetails; unexpected errors return a generic 500 and are logged. The UI ties `errors.field` to the input with `aria-invalid` and `aria-describedby` and moves focus to the first invalid field.

**Environments.** Development: local SQL Server, demo seeding on, cookies allowed over http. Production (not deployed): Azure App Service + Azure Static Web Apps + Azure SQL in a US region, HTTPS and HSTS on, demo off, secrets in Key Vault.

**SaaS essentials.**

| Area | Prototype status |
|---|---|
| Onboarding / activation | Sign-up creates a working clinic (defaults + US holidays); Today shows a 4-step checklist |
| Roles | 4 roles, job title decides role; scoped navigation, guards and API checks |
| Billing and plan gating | Simulated. Starter (1 location) and Practice (3 locations); location limit enforced for real |
| Transactional email | Simulated (logged): invitation, schedule published/changed, leave requested/decided, unscheduled clock-in |
| Audit log | Database triggers on 11 tables, owner view with before/after diff |
| Settings / profile | Clinic policies, coverage, closed days, locations; staff profile editor |
| Data export | Owner downloads all clinic data as JSON (no password hashes or tokens) |
| Data deletion | Not built (stated in the UI) |
| Analytics | Logged events: clinic_signed_up, signed_in, demo_started, invite_accepted, staff_added, staff_invited, shift_created, week_filled_from_patterns, schedule_published, leave_requested, leave_decided, clocked_in, clocked_out, attendance_corrected, location_added, plan_changed, data_exported |
| Admin tooling | Not built; the audit log and export are the support tools for now |

## 6. Delivery report

**What exists.** Everything in the MVP scope above, end to end, with seeded demo data (2 locations, 16 people, three weeks of shifts, an expired and two expiring licences, pending and approved leave, a missed clock-out and an unscheduled clock-in).

**Verification** (re-run on 2026-10-14 after the full test pass)

| Claim | Label |
|---|---|
| Backend builds with 0 warnings; 29 xUnit tests pass (leave counting, four checks, overrides, holidays, time zones) | Verified by execution |
| End-to-end API suite: 182 of 182 checks pass — session probe, roles matrix for all four roles, schedule, leave, attendance, staff, invitations, settings, plan limits, export, notifications, audit, tenant isolation, malformed input, security headers, rate limit (tests/e2e/api-smoke.mjs) | Verified by execution |
| Angular builds with no errors; 4 Vitest tests pass; initial bundle 84 kB transferred (brotli on the wire), every page lazy-loaded | Verified by execution |
| Tenant isolation in SQL (cross-clinic insert blocked, rows invisible) and through the API (second clinic gets 404 on demo records) | Verified by execution |
| UI journeys in the browser: sign-up, add staff with default pattern, invite and accept, sign in, fill from patterns, chart check and Go to shift, licence block and override, shift add/validate/delete/undo, drag to move with undo, day timeline, clock in/out with progress ring, leave with day count, inbox decision, attendance correction, settings, audit diff, notifications, theme | Verified by execution (browser, scripted) |
| Form errors tied to fields (aria-invalid + aria-describedby) and focus moved to the first one, on every form | Verified by execution (browser) |
| Dialogs restore focus to the control that opened them (close button and Escape) | Verified by execution (browser) |
| No sideways page scroll at 320px on all 12 routes; one h1 per view; skip link is the first tab stop; no unlabelled inputs or unnamed icon buttons | Verified by execution (browser, 320×720) |
| Contrast ratios in the token table, including job colours | Verified by execution (script) |
| axe-core 4.14 (WCAG 2.0/2.1/2.2 A and AA rules): 0 violations on all 12 routes, light and dark, desktop and 390px phone, including the day timeline | Verified by execution (browser) |
| Lighthouse 12.8 on the production build (brotli): desktop Performance 99–100, Accessibility 100, Best Practices 100; mobile (slow-4G, 4x CPU simulation) Performance 88–94, Accessibility 100, Best Practices 100; CLS ≤ 0.08 everywhere | Verified by execution (Lighthouse with Edge) |
| Full keyboard-only walk-through and screen reader output | Not verified (keyboard activation is covered only through click events) |
| LCP ≤ 2.5s on simulated mobile: measured 2.8–3.0s, so not met on the slow-4G profile (desktop 0.6–0.7s); INP not measurable in a lab run | Verified by execution — target missed on mobile |

Bugs found and fixed during testing: guards calling inject() after await (blank page), fieldset and sr-only overflow at 320px, focus lost after dialogs (native close event unreliable; now closed in code), staff editor not reloading from /staff/new to /staff/:id, model-binding errors leaking .NET type names and not mapping to fields, password and credential errors not tied to inputs, generic errors hidden on settings forms, phone layout Go to shift not focusing, default shift type for new patterns.

**Known limitations.** Pay and compensation, hours reports and the 30-day reminder job are not built. Email, billing and push are simulated. The demo clinic is shared by all visitors. Account deletion and an admin console are missing. No Playwright suite yet: browser checks were scripted by hand in this session; the API has a repeatable end-to-end suite. The attendance page labels the week assuming a Monday start. Leave balance does not yet pro-rate new hires or carry over.

**Two-minute manual check**

1. Sign in as Practice manager: Today shows an unscheduled clock-in and a missed clock-out.
2. Schedule → switch to Riverside (owner) → Next week → Publish: the licence block appears; publish without a reason, then with one.
3. On Schedule, add a shift with an end time before the start: the error is on the End field. Fix it, save, delete it, press Undo.
4. Sign in as Hygienist on a phone-sized window: clock in, clock out, then request leave over Thanksgiving week and read the day count.
5. Press Tab from the top of any page: the first stop is "Skip to main content".

## 7. Go-to-market kit

**Pricing**

| Plan | Price | For | Rationale |
|---|---|---|---|
| Trial | Free, 14 days | Everyone | No card: activation (first published week) is the gate, not payment |
| Starter | $4 per active staff / month | Single-location practices | Below the cost of one hour of manager time per month for a 10-person office |
| Practice | $6 per active staff / month | 2–3 locations | Cross-location scheduling and owner overrides are the multi-site value |
| Group | Contact us | 4+ locations, DSOs | Needs SSO, central reporting (roadmap) |

**Landing page copy**

- Headline: The staff schedule that knows who is licensed.
- Subhead: Chairside builds your dental team's week from their regular patterns, checks it for leave clashes, short-staffed days, expired licences and overtime, and only then lets you publish.
- Benefits: (1) A full week in minutes — fill from work patterns, fix what the chart check flags, publish. (2) No one works on an expired licence — required licences block publishing unless the owner signs off, and the sign-off is logged. (3) Leave without the back-and-forth — staff see exactly how many days a request costs; managers see if it leaves the day short.
- Proof (placeholder until real customers): "Built with practice managers from two-location offices." Replace with a named quote after the pilot.
- FAQ: Does it store patient data? No, staff only. Can staff use their phones? Yes, it installs like an app. Does it run payroll? No; it records hours and exports them. Can I try it without signing up? Yes, open the demo clinic.
- CTA: Start your free trial — or try the demo clinic.

**Launch checklist.** Real email provider and domain authentication (SPF/DKIM); Stripe in test, then live; Azure deploy in a US region with backups and alerts; privacy policy and terms reviewed by a US employment lawyer; disable demo sign-in in production or isolate it; Lighthouse and axe pass; Playwright suite in CI; status page; support inbox.

**First 30 days of growth experiments**

| Experiment | Hypothesis | Measure |
|---|---|---|
| Demo first on the landing page | Visitors who try the demo convert to trial at 2× those who see a video | Trial starts per visitor |
| "Import your roster" from CSV at sign-up | Clinics that import staff in the first session publish a week 50% more often | Activation rate |
| Licence expiry email to owners in week 1 | A concrete risk email lifts day-7 retention | Day-7 active clinics |
| Partner with two dental-assistant schools | Instructors recommend tools that track certifications | Referred sign-ups |

## 8. Roadmap (next three milestones)

| Milestone | Scope | Risks | Depends on |
|---|---|---|---|
| Pay and hours (brief M9 + reports) | Pay records with temporal history in the `pay` schema and its own RLS; hours report (scheduled, worked, breaks, paid, overtime) as inline TVFs; CSV export | Leaking pay to managers; FLSA rules per state | RLS pattern already in place |
| Real delivery | Email provider, 30-day credential reminders and nightly missed clock-out digest in Hangfire, Web Push for the PWA, Stripe billing | Email deliverability; billing edge cases (proration, failed payments) | Production hosting |
| Production hardening | Azure deploy, Playwright E2E for the five journeys, Lighthouse/axe in CI, per-clinic demo sandbox, account deletion, admin console | Shared demo abuse; migration safety | CI pipeline |
