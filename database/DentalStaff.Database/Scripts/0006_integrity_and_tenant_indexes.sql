-- Integrity: the database, not only the application, prevents duplicates that double-count hours.
-- One shift per person per day per location (the "Fill week" and double-click race is closed here).
CREATE UNIQUE INDEX UX_Shift_StaffDayLocation ON app.Shift (ClinicId, StaffId, ShiftDate, LocationId);

-- One override per shift and credential type.
CREATE UNIQUE INDEX UX_ScheduleOverride_ShiftType ON app.ScheduleOverride (ShiftId, CredentialTypeId);

-- One closed day per location (or clinic-wide) per date.
CREATE UNIQUE INDEX UX_ClosedDay_LocationDate ON app.ClosedDay (ClinicId, LocationId, ClosedOn);

-- Tenant indexes: row-level security adds "ClinicId = SESSION_CONTEXT" to every query, so lead with ClinicId.
CREATE INDEX IX_Staff_Clinic ON app.Staff (ClinicId, HomeLocationId) INCLUDE (IsActive, JobTitleId, Role, UserId);
CREATE INDEX IX_Credential_ClinicStaff ON app.Credential (ClinicId, StaffId, CredentialTypeId) INCLUDE (ExpiresOn);
CREATE INDEX IX_LeaveRequest_ClinicStaff ON app.LeaveRequest (ClinicId, StaffId, StartDate);
CREATE INDEX IX_LeaveRequest_ClinicStatus ON app.LeaveRequest (ClinicId, Status, StartDate, EndDate);
CREATE INDEX IX_CoverageRule_Clinic ON app.CoverageRule (ClinicId, LocationId);
CREATE INDEX IX_StaffWorkPattern_Clinic ON app.StaffWorkPattern (ClinicId, StaffId, EffectiveFrom);
CREATE INDEX IX_AttendanceRecord_ClinicClockIn ON app.AttendanceRecord (ClinicId, ClockInUtc) INCLUDE (StaffId, LocationId, ClockOutUtc);
CREATE INDEX IX_Notification_ClinicRecipient ON app.Notification (ClinicId, RecipientStaffId, IsRead);
GO

-- Invitations are bound to the address they were sent to and can be revoked when a newer one is issued.
ALTER TABLE app.Invitation ADD Email NVARCHAR(256) NULL, RevokedUtc DATETIME2(0) NULL;
-- Rotating the stamp signs a person out everywhere (logout, deactivation, password or email change).
ALTER TABLE app.UserAccount ADD SecurityStamp UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_UserAccount_SecurityStamp DEFAULT (NEWID());
GO

-- Audit the remaining policy tables. UserAccount is deliberately not audited: it holds password hashes.
CREATE TRIGGER app.trg_StaffWorkPatternDay_Audit ON app.StaffWorkPatternDay
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;
    INSERT INTO audit.AuditLogEntry (ClinicId, UserId, Action, EntityName, EntityId, OldValue, NewValue)
    SELECT COALESCE(i.ClinicId, d.ClinicId),
           TRY_CAST(SESSION_CONTEXT(N'UserId') AS INT),
           CASE WHEN i.PatternDayId IS NOT NULL AND d.PatternDayId IS NOT NULL THEN 'update'
                WHEN i.PatternDayId IS NOT NULL THEN 'insert' ELSE 'delete' END,
           'StaffWorkPatternDay',
           CAST(COALESCE(i.PatternDayId, d.PatternDayId) AS NVARCHAR(40)),
           (SELECT x.* FROM deleted x WHERE x.PatternDayId = d.PatternDayId FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
           (SELECT x.* FROM inserted x WHERE x.PatternDayId = i.PatternDayId FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)
    FROM inserted i
    FULL OUTER JOIN deleted d ON d.PatternDayId = i.PatternDayId;
END;
GO

CREATE TRIGGER app.trg_JobTitle_Audit ON app.JobTitle
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;
    INSERT INTO audit.AuditLogEntry (ClinicId, UserId, Action, EntityName, EntityId, OldValue, NewValue)
    SELECT COALESCE(i.ClinicId, d.ClinicId),
           TRY_CAST(SESSION_CONTEXT(N'UserId') AS INT),
           CASE WHEN i.JobTitleId IS NOT NULL AND d.JobTitleId IS NOT NULL THEN 'update'
                WHEN i.JobTitleId IS NOT NULL THEN 'insert' ELSE 'delete' END,
           'JobTitle',
           CAST(COALESCE(i.JobTitleId, d.JobTitleId) AS NVARCHAR(40)),
           (SELECT x.* FROM deleted x WHERE x.JobTitleId = d.JobTitleId FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
           (SELECT x.* FROM inserted x WHERE x.JobTitleId = i.JobTitleId FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)
    FROM inserted i
    FULL OUTER JOIN deleted d ON d.JobTitleId = i.JobTitleId;
END;
GO

CREATE TRIGGER app.trg_ShiftDefinition_Audit ON app.ShiftDefinition
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;
    INSERT INTO audit.AuditLogEntry (ClinicId, UserId, Action, EntityName, EntityId, OldValue, NewValue)
    SELECT COALESCE(i.ClinicId, d.ClinicId),
           TRY_CAST(SESSION_CONTEXT(N'UserId') AS INT),
           CASE WHEN i.ShiftDefinitionId IS NOT NULL AND d.ShiftDefinitionId IS NOT NULL THEN 'update'
                WHEN i.ShiftDefinitionId IS NOT NULL THEN 'insert' ELSE 'delete' END,
           'ShiftDefinition',
           CAST(COALESCE(i.ShiftDefinitionId, d.ShiftDefinitionId) AS NVARCHAR(40)),
           (SELECT x.* FROM deleted x WHERE x.ShiftDefinitionId = d.ShiftDefinitionId FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
           (SELECT x.* FROM inserted x WHERE x.ShiftDefinitionId = i.ShiftDefinitionId FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)
    FROM inserted i
    FULL OUTER JOIN deleted d ON d.ShiftDefinitionId = i.ShiftDefinitionId;
END;
GO

CREATE TRIGGER app.trg_CredentialType_Audit ON app.CredentialType
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;
    INSERT INTO audit.AuditLogEntry (ClinicId, UserId, Action, EntityName, EntityId, OldValue, NewValue)
    SELECT COALESCE(i.ClinicId, d.ClinicId),
           TRY_CAST(SESSION_CONTEXT(N'UserId') AS INT),
           CASE WHEN i.CredentialTypeId IS NOT NULL AND d.CredentialTypeId IS NOT NULL THEN 'update'
                WHEN i.CredentialTypeId IS NOT NULL THEN 'insert' ELSE 'delete' END,
           'CredentialType',
           CAST(COALESCE(i.CredentialTypeId, d.CredentialTypeId) AS NVARCHAR(40)),
           (SELECT x.* FROM deleted x WHERE x.CredentialTypeId = d.CredentialTypeId FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
           (SELECT x.* FROM inserted x WHERE x.CredentialTypeId = i.CredentialTypeId FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)
    FROM inserted i
    FULL OUTER JOIN deleted d ON d.CredentialTypeId = i.CredentialTypeId;
END;
GO

-- Token hashes are never copied into the audit log.
CREATE TRIGGER app.trg_Invitation_Audit ON app.Invitation
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;
    INSERT INTO audit.AuditLogEntry (ClinicId, UserId, Action, EntityName, EntityId, OldValue, NewValue)
    SELECT COALESCE(i.ClinicId, d.ClinicId),
           TRY_CAST(SESSION_CONTEXT(N'UserId') AS INT),
           CASE WHEN i.InvitationId IS NOT NULL AND d.InvitationId IS NOT NULL THEN 'update'
                WHEN i.InvitationId IS NOT NULL THEN 'insert' ELSE 'delete' END,
           'Invitation',
           CAST(COALESCE(i.InvitationId, d.InvitationId) AS NVARCHAR(40)),
           (SELECT x.InvitationId, x.StaffId, x.Email, x.ExpiresUtc, x.AcceptedUtc, x.RevokedUtc FROM deleted x WHERE x.InvitationId = d.InvitationId FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
           (SELECT x.InvitationId, x.StaffId, x.Email, x.ExpiresUtc, x.AcceptedUtc, x.RevokedUtc FROM inserted x WHERE x.InvitationId = i.InvitationId FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)
    FROM inserted i
    FULL OUTER JOIN deleted d ON d.InvitationId = i.InvitationId;
END;
GO

