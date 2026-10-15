-- Tenant isolation enforced by the database. The API sets SESSION_CONTEXT('ClinicId') (read-only)
-- on every connection it opens for a signed-in request. Rows of other clinics are invisible and
-- cannot be inserted or moved into another clinic, whatever the application code does.
CREATE FUNCTION sec.fn_TenantAccess (@ClinicId UNIQUEIDENTIFIER)
RETURNS TABLE
WITH SCHEMABINDING
AS
RETURN SELECT 1 AS AccessGranted
       WHERE @ClinicId = CAST(SESSION_CONTEXT(N'ClinicId') AS UNIQUEIDENTIFIER);
GO

CREATE SECURITY POLICY sec.TenantIsolationPolicy
    ADD FILTER PREDICATE sec.fn_TenantAccess(ClinicId) ON app.Clinic
  , ADD BLOCK PREDICATE sec.fn_TenantAccess(ClinicId) ON app.Clinic AFTER INSERT
  , ADD BLOCK PREDICATE sec.fn_TenantAccess(ClinicId) ON app.Clinic AFTER UPDATE
  , ADD FILTER PREDICATE sec.fn_TenantAccess(ClinicId) ON app.Location
  , ADD BLOCK PREDICATE sec.fn_TenantAccess(ClinicId) ON app.Location AFTER INSERT
  , ADD BLOCK PREDICATE sec.fn_TenantAccess(ClinicId) ON app.Location AFTER UPDATE
  , ADD FILTER PREDICATE sec.fn_TenantAccess(ClinicId) ON app.JobTitle
  , ADD BLOCK PREDICATE sec.fn_TenantAccess(ClinicId) ON app.JobTitle AFTER INSERT
  , ADD BLOCK PREDICATE sec.fn_TenantAccess(ClinicId) ON app.JobTitle AFTER UPDATE
  , ADD FILTER PREDICATE sec.fn_TenantAccess(ClinicId) ON app.Staff
  , ADD BLOCK PREDICATE sec.fn_TenantAccess(ClinicId) ON app.Staff AFTER INSERT
  , ADD BLOCK PREDICATE sec.fn_TenantAccess(ClinicId) ON app.Staff AFTER UPDATE
  , ADD FILTER PREDICATE sec.fn_TenantAccess(ClinicId) ON app.ShiftDefinition
  , ADD BLOCK PREDICATE sec.fn_TenantAccess(ClinicId) ON app.ShiftDefinition AFTER INSERT
  , ADD BLOCK PREDICATE sec.fn_TenantAccess(ClinicId) ON app.ShiftDefinition AFTER UPDATE
  , ADD FILTER PREDICATE sec.fn_TenantAccess(ClinicId) ON app.StaffWorkPattern
  , ADD BLOCK PREDICATE sec.fn_TenantAccess(ClinicId) ON app.StaffWorkPattern AFTER INSERT
  , ADD BLOCK PREDICATE sec.fn_TenantAccess(ClinicId) ON app.StaffWorkPattern AFTER UPDATE
  , ADD FILTER PREDICATE sec.fn_TenantAccess(ClinicId) ON app.StaffWorkPatternDay
  , ADD BLOCK PREDICATE sec.fn_TenantAccess(ClinicId) ON app.StaffWorkPatternDay AFTER INSERT
  , ADD BLOCK PREDICATE sec.fn_TenantAccess(ClinicId) ON app.StaffWorkPatternDay AFTER UPDATE
  , ADD FILTER PREDICATE sec.fn_TenantAccess(ClinicId) ON app.Shift
  , ADD BLOCK PREDICATE sec.fn_TenantAccess(ClinicId) ON app.Shift AFTER INSERT
  , ADD BLOCK PREDICATE sec.fn_TenantAccess(ClinicId) ON app.Shift AFTER UPDATE
  , ADD FILTER PREDICATE sec.fn_TenantAccess(ClinicId) ON app.ClosedDay
  , ADD BLOCK PREDICATE sec.fn_TenantAccess(ClinicId) ON app.ClosedDay AFTER INSERT
  , ADD BLOCK PREDICATE sec.fn_TenantAccess(ClinicId) ON app.ClosedDay AFTER UPDATE
  , ADD FILTER PREDICATE sec.fn_TenantAccess(ClinicId) ON app.CoverageRule
  , ADD BLOCK PREDICATE sec.fn_TenantAccess(ClinicId) ON app.CoverageRule AFTER INSERT
  , ADD BLOCK PREDICATE sec.fn_TenantAccess(ClinicId) ON app.CoverageRule AFTER UPDATE
  , ADD FILTER PREDICATE sec.fn_TenantAccess(ClinicId) ON app.CredentialType
  , ADD BLOCK PREDICATE sec.fn_TenantAccess(ClinicId) ON app.CredentialType AFTER INSERT
  , ADD BLOCK PREDICATE sec.fn_TenantAccess(ClinicId) ON app.CredentialType AFTER UPDATE
  , ADD FILTER PREDICATE sec.fn_TenantAccess(ClinicId) ON app.CredentialTypeJobTitle
  , ADD BLOCK PREDICATE sec.fn_TenantAccess(ClinicId) ON app.CredentialTypeJobTitle AFTER INSERT
  , ADD BLOCK PREDICATE sec.fn_TenantAccess(ClinicId) ON app.CredentialTypeJobTitle AFTER UPDATE
  , ADD FILTER PREDICATE sec.fn_TenantAccess(ClinicId) ON app.Credential
  , ADD BLOCK PREDICATE sec.fn_TenantAccess(ClinicId) ON app.Credential AFTER INSERT
  , ADD BLOCK PREDICATE sec.fn_TenantAccess(ClinicId) ON app.Credential AFTER UPDATE
  , ADD FILTER PREDICATE sec.fn_TenantAccess(ClinicId) ON app.LeaveRequest
  , ADD BLOCK PREDICATE sec.fn_TenantAccess(ClinicId) ON app.LeaveRequest AFTER INSERT
  , ADD BLOCK PREDICATE sec.fn_TenantAccess(ClinicId) ON app.LeaveRequest AFTER UPDATE
  , ADD FILTER PREDICATE sec.fn_TenantAccess(ClinicId) ON app.AttendanceRecord
  , ADD BLOCK PREDICATE sec.fn_TenantAccess(ClinicId) ON app.AttendanceRecord AFTER INSERT
  , ADD BLOCK PREDICATE sec.fn_TenantAccess(ClinicId) ON app.AttendanceRecord AFTER UPDATE
  , ADD FILTER PREDICATE sec.fn_TenantAccess(ClinicId) ON app.ScheduleOverride
  , ADD BLOCK PREDICATE sec.fn_TenantAccess(ClinicId) ON app.ScheduleOverride AFTER INSERT
  , ADD BLOCK PREDICATE sec.fn_TenantAccess(ClinicId) ON app.ScheduleOverride AFTER UPDATE
  , ADD FILTER PREDICATE sec.fn_TenantAccess(ClinicId) ON app.Notification
  , ADD BLOCK PREDICATE sec.fn_TenantAccess(ClinicId) ON app.Notification AFTER INSERT
  , ADD BLOCK PREDICATE sec.fn_TenantAccess(ClinicId) ON app.Notification AFTER UPDATE
  , ADD FILTER PREDICATE sec.fn_TenantAccess(ClinicId) ON audit.AuditLogEntry
  , ADD BLOCK PREDICATE sec.fn_TenantAccess(ClinicId) ON audit.AuditLogEntry AFTER INSERT
  , ADD BLOCK PREDICATE sec.fn_TenantAccess(ClinicId) ON audit.AuditLogEntry AFTER UPDATE
WITH (STATE = ON);
GO
