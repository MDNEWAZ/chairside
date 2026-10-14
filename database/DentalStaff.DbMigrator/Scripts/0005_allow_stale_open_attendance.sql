-- A forgotten clock-out from an earlier day stays open (and flagged) until a manager corrects it.
-- The old "one open record per person" index would stop that person clocking in today, so it is
-- replaced by a rule in the API: at most one open record that started today.
DROP INDEX UX_AttendanceRecord_Open ON app.AttendanceRecord;
CREATE INDEX IX_AttendanceRecord_Staff ON app.AttendanceRecord (StaffId, ClockInUtc DESC);
CREATE INDEX IX_AttendanceRecord_Location ON app.AttendanceRecord (LocationId, ClockInUtc DESC);
GO
