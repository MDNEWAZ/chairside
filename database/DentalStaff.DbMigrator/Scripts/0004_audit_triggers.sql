-- Audit log written by the database, so no code path can skip it.
-- The API puts the signed-in user's id in SESSION_CONTEXT('UserId').
CREATE TRIGGER app.trg_Clinic_Audit ON app.Clinic
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;
    INSERT INTO audit.AuditLogEntry (ClinicId, UserId, Action, EntityName, EntityId, OldValue, NewValue)
    SELECT COALESCE(i.ClinicId, d.ClinicId),
           TRY_CAST(SESSION_CONTEXT(N'UserId') AS INT),
           CASE WHEN i.ClinicId IS NOT NULL AND d.ClinicId IS NOT NULL THEN 'update'
                WHEN i.ClinicId IS NOT NULL THEN 'insert' ELSE 'delete' END,
           'Clinic',
           CAST(COALESCE(i.ClinicId, d.ClinicId) AS NVARCHAR(40)),
           (SELECT x.* FROM deleted x WHERE x.ClinicId = d.ClinicId FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
           (SELECT x.* FROM inserted x WHERE x.ClinicId = i.ClinicId FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)
    FROM inserted i
    FULL OUTER JOIN deleted d ON d.ClinicId = i.ClinicId;
END;
GO

CREATE TRIGGER app.trg_Location_Audit ON app.Location
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;
    INSERT INTO audit.AuditLogEntry (ClinicId, UserId, Action, EntityName, EntityId, OldValue, NewValue)
    SELECT COALESCE(i.ClinicId, d.ClinicId),
           TRY_CAST(SESSION_CONTEXT(N'UserId') AS INT),
           CASE WHEN i.LocationId IS NOT NULL AND d.LocationId IS NOT NULL THEN 'update'
                WHEN i.LocationId IS NOT NULL THEN 'insert' ELSE 'delete' END,
           'Location',
           CAST(COALESCE(i.LocationId, d.LocationId) AS NVARCHAR(40)),
           (SELECT x.* FROM deleted x WHERE x.LocationId = d.LocationId FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
           (SELECT x.* FROM inserted x WHERE x.LocationId = i.LocationId FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)
    FROM inserted i
    FULL OUTER JOIN deleted d ON d.LocationId = i.LocationId;
END;
GO

CREATE TRIGGER app.trg_Staff_Audit ON app.Staff
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;
    INSERT INTO audit.AuditLogEntry (ClinicId, UserId, Action, EntityName, EntityId, OldValue, NewValue)
    SELECT COALESCE(i.ClinicId, d.ClinicId),
           TRY_CAST(SESSION_CONTEXT(N'UserId') AS INT),
           CASE WHEN i.StaffId IS NOT NULL AND d.StaffId IS NOT NULL THEN 'update'
                WHEN i.StaffId IS NOT NULL THEN 'insert' ELSE 'delete' END,
           'Staff',
           CAST(COALESCE(i.StaffId, d.StaffId) AS NVARCHAR(40)),
           (SELECT x.* FROM deleted x WHERE x.StaffId = d.StaffId FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
           (SELECT x.* FROM inserted x WHERE x.StaffId = i.StaffId FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)
    FROM inserted i
    FULL OUTER JOIN deleted d ON d.StaffId = i.StaffId;
END;
GO

CREATE TRIGGER app.trg_StaffWorkPattern_Audit ON app.StaffWorkPattern
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;
    INSERT INTO audit.AuditLogEntry (ClinicId, UserId, Action, EntityName, EntityId, OldValue, NewValue)
    SELECT COALESCE(i.ClinicId, d.ClinicId),
           TRY_CAST(SESSION_CONTEXT(N'UserId') AS INT),
           CASE WHEN i.PatternId IS NOT NULL AND d.PatternId IS NOT NULL THEN 'update'
                WHEN i.PatternId IS NOT NULL THEN 'insert' ELSE 'delete' END,
           'StaffWorkPattern',
           CAST(COALESCE(i.PatternId, d.PatternId) AS NVARCHAR(40)),
           (SELECT x.* FROM deleted x WHERE x.PatternId = d.PatternId FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
           (SELECT x.* FROM inserted x WHERE x.PatternId = i.PatternId FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)
    FROM inserted i
    FULL OUTER JOIN deleted d ON d.PatternId = i.PatternId;
END;
GO

CREATE TRIGGER app.trg_Shift_Audit ON app.Shift
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;
    INSERT INTO audit.AuditLogEntry (ClinicId, UserId, Action, EntityName, EntityId, OldValue, NewValue)
    SELECT COALESCE(i.ClinicId, d.ClinicId),
           TRY_CAST(SESSION_CONTEXT(N'UserId') AS INT),
           CASE WHEN i.ShiftId IS NOT NULL AND d.ShiftId IS NOT NULL THEN 'update'
                WHEN i.ShiftId IS NOT NULL THEN 'insert' ELSE 'delete' END,
           'Shift',
           CAST(COALESCE(i.ShiftId, d.ShiftId) AS NVARCHAR(40)),
           (SELECT x.* FROM deleted x WHERE x.ShiftId = d.ShiftId FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
           (SELECT x.* FROM inserted x WHERE x.ShiftId = i.ShiftId FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)
    FROM inserted i
    FULL OUTER JOIN deleted d ON d.ShiftId = i.ShiftId;
END;
GO

CREATE TRIGGER app.trg_ClosedDay_Audit ON app.ClosedDay
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;
    INSERT INTO audit.AuditLogEntry (ClinicId, UserId, Action, EntityName, EntityId, OldValue, NewValue)
    SELECT COALESCE(i.ClinicId, d.ClinicId),
           TRY_CAST(SESSION_CONTEXT(N'UserId') AS INT),
           CASE WHEN i.ClosedDayId IS NOT NULL AND d.ClosedDayId IS NOT NULL THEN 'update'
                WHEN i.ClosedDayId IS NOT NULL THEN 'insert' ELSE 'delete' END,
           'ClosedDay',
           CAST(COALESCE(i.ClosedDayId, d.ClosedDayId) AS NVARCHAR(40)),
           (SELECT x.* FROM deleted x WHERE x.ClosedDayId = d.ClosedDayId FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
           (SELECT x.* FROM inserted x WHERE x.ClosedDayId = i.ClosedDayId FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)
    FROM inserted i
    FULL OUTER JOIN deleted d ON d.ClosedDayId = i.ClosedDayId;
END;
GO

CREATE TRIGGER app.trg_CoverageRule_Audit ON app.CoverageRule
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;
    INSERT INTO audit.AuditLogEntry (ClinicId, UserId, Action, EntityName, EntityId, OldValue, NewValue)
    SELECT COALESCE(i.ClinicId, d.ClinicId),
           TRY_CAST(SESSION_CONTEXT(N'UserId') AS INT),
           CASE WHEN i.CoverageRuleId IS NOT NULL AND d.CoverageRuleId IS NOT NULL THEN 'update'
                WHEN i.CoverageRuleId IS NOT NULL THEN 'insert' ELSE 'delete' END,
           'CoverageRule',
           CAST(COALESCE(i.CoverageRuleId, d.CoverageRuleId) AS NVARCHAR(40)),
           (SELECT x.* FROM deleted x WHERE x.CoverageRuleId = d.CoverageRuleId FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
           (SELECT x.* FROM inserted x WHERE x.CoverageRuleId = i.CoverageRuleId FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)
    FROM inserted i
    FULL OUTER JOIN deleted d ON d.CoverageRuleId = i.CoverageRuleId;
END;
GO

CREATE TRIGGER app.trg_Credential_Audit ON app.Credential
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;
    INSERT INTO audit.AuditLogEntry (ClinicId, UserId, Action, EntityName, EntityId, OldValue, NewValue)
    SELECT COALESCE(i.ClinicId, d.ClinicId),
           TRY_CAST(SESSION_CONTEXT(N'UserId') AS INT),
           CASE WHEN i.CredentialId IS NOT NULL AND d.CredentialId IS NOT NULL THEN 'update'
                WHEN i.CredentialId IS NOT NULL THEN 'insert' ELSE 'delete' END,
           'Credential',
           CAST(COALESCE(i.CredentialId, d.CredentialId) AS NVARCHAR(40)),
           (SELECT x.* FROM deleted x WHERE x.CredentialId = d.CredentialId FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
           (SELECT x.* FROM inserted x WHERE x.CredentialId = i.CredentialId FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)
    FROM inserted i
    FULL OUTER JOIN deleted d ON d.CredentialId = i.CredentialId;
END;
GO

CREATE TRIGGER app.trg_LeaveRequest_Audit ON app.LeaveRequest
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;
    INSERT INTO audit.AuditLogEntry (ClinicId, UserId, Action, EntityName, EntityId, OldValue, NewValue)
    SELECT COALESCE(i.ClinicId, d.ClinicId),
           TRY_CAST(SESSION_CONTEXT(N'UserId') AS INT),
           CASE WHEN i.LeaveRequestId IS NOT NULL AND d.LeaveRequestId IS NOT NULL THEN 'update'
                WHEN i.LeaveRequestId IS NOT NULL THEN 'insert' ELSE 'delete' END,
           'LeaveRequest',
           CAST(COALESCE(i.LeaveRequestId, d.LeaveRequestId) AS NVARCHAR(40)),
           (SELECT x.* FROM deleted x WHERE x.LeaveRequestId = d.LeaveRequestId FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
           (SELECT x.* FROM inserted x WHERE x.LeaveRequestId = i.LeaveRequestId FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)
    FROM inserted i
    FULL OUTER JOIN deleted d ON d.LeaveRequestId = i.LeaveRequestId;
END;
GO

CREATE TRIGGER app.trg_AttendanceRecord_Audit ON app.AttendanceRecord
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;
    INSERT INTO audit.AuditLogEntry (ClinicId, UserId, Action, EntityName, EntityId, OldValue, NewValue)
    SELECT COALESCE(i.ClinicId, d.ClinicId),
           TRY_CAST(SESSION_CONTEXT(N'UserId') AS INT),
           CASE WHEN i.AttendanceId IS NOT NULL AND d.AttendanceId IS NOT NULL THEN 'update'
                WHEN i.AttendanceId IS NOT NULL THEN 'insert' ELSE 'delete' END,
           'AttendanceRecord',
           CAST(COALESCE(i.AttendanceId, d.AttendanceId) AS NVARCHAR(40)),
           (SELECT x.* FROM deleted x WHERE x.AttendanceId = d.AttendanceId FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
           (SELECT x.* FROM inserted x WHERE x.AttendanceId = i.AttendanceId FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)
    FROM inserted i
    FULL OUTER JOIN deleted d ON d.AttendanceId = i.AttendanceId;
END;
GO

CREATE TRIGGER app.trg_ScheduleOverride_Audit ON app.ScheduleOverride
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;
    INSERT INTO audit.AuditLogEntry (ClinicId, UserId, Action, EntityName, EntityId, OldValue, NewValue)
    SELECT COALESCE(i.ClinicId, d.ClinicId),
           TRY_CAST(SESSION_CONTEXT(N'UserId') AS INT),
           CASE WHEN i.OverrideId IS NOT NULL AND d.OverrideId IS NOT NULL THEN 'update'
                WHEN i.OverrideId IS NOT NULL THEN 'insert' ELSE 'delete' END,
           'ScheduleOverride',
           CAST(COALESCE(i.OverrideId, d.OverrideId) AS NVARCHAR(40)),
           (SELECT x.* FROM deleted x WHERE x.OverrideId = d.OverrideId FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
           (SELECT x.* FROM inserted x WHERE x.OverrideId = i.OverrideId FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)
    FROM inserted i
    FULL OUTER JOIN deleted d ON d.OverrideId = i.OverrideId;
END;
GO

