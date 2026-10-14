using DentalStaff.Application.Features;
using Microsoft.AspNetCore.Mvc;

namespace DentalStaff.Api.Controllers;

// Thin controllers: build the request, call the application service, return its DTO.
// Authorization and validation live in the services (and tenant isolation in the database).

[ApiController, Route("api/clinic")]
public sealed class ClinicController(ClinicService clinic) : ControllerBase
{
    [HttpGet("lookups")] public Task<LookupsDto> Lookups(CancellationToken ct) => clinic.LookupsAsync(ct);
    [HttpGet("settings")] public Task<ClinicSettingsDto> Settings(CancellationToken ct) => clinic.SettingsAsync(ct);
    [HttpPut("settings")] public Task<ClinicSettingsDto> UpdateSettings(ClinicSettingsDto r, CancellationToken ct) => clinic.UpdateSettingsAsync(r, ct);
    [HttpPost("locations")] public Task<LookupsDto> AddLocation(AddLocationRequest r, CancellationToken ct) => clinic.AddLocationAsync(r, ct);
    [HttpGet("billing")] public Task<BillingDto> Billing(CancellationToken ct) => clinic.BillingAsync(ct);
    [HttpPost("billing/plan")] public Task<BillingDto> ChangePlan(ChangePlanRequest r, CancellationToken ct) => clinic.ChangePlanAsync(r, ct);
    [HttpGet("coverage/{locationId:int}")] public Task<CoverageDto> Coverage(int locationId, CancellationToken ct) => clinic.CoverageAsync(locationId, ct);
    [HttpPut("coverage")] public Task<CoverageDto> SaveCoverage(CoverageDto r, CancellationToken ct) => clinic.SaveCoverageAsync(r, ct);
    [HttpGet("closed-days")] public Task<List<ClosedDayDto>> ClosedDays(CancellationToken ct) => clinic.ClosedDaysAsync(ct);
    [HttpPost("closed-days")] public Task<List<ClosedDayDto>> AddClosedDay(AddClosedDayRequest r, CancellationToken ct) => clinic.AddClosedDayAsync(r, ct);
    [HttpDelete("closed-days/{id:int}")] public Task<List<ClosedDayDto>> DeleteClosedDay(int id, CancellationToken ct) => clinic.DeleteClosedDayAsync(id, ct);

    [HttpGet("export")]
    public async Task<IActionResult> Export(CancellationToken ct) =>
        File(System.Text.Json.JsonSerializer.SerializeToUtf8Bytes(await clinic.ExportAsync(ct), new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web) { WriteIndented = true }),
            "application/json", $"chairside-export-{DateTime.UtcNow:yyyyMMdd}.json");
}

[ApiController, Route("api/staff")]
public sealed class StaffController(StaffService staff) : ControllerBase
{
    [HttpGet] public Task<List<DirectoryItemDto>> List(string? search, bool includeInactive, CancellationToken ct) => staff.DirectoryAsync(search, includeInactive, ct);
    [HttpGet("{id:int}")] public Task<StaffDetailDto> Get(int id, CancellationToken ct) => staff.GetAsync(id, ct);
    [HttpPost] public Task<StaffDetailDto> Create(StaffInput r, CancellationToken ct) => staff.CreateAsync(r, ct);
    [HttpPut("{id:int}")] public Task<StaffDetailDto> Update(int id, StaffInput r, CancellationToken ct) => staff.UpdateAsync(id, r, ct);
    [HttpPost("{id:int}/deactivate")] public Task<StaffDetailDto> Deactivate(int id, CancellationToken ct) => staff.SetActiveAsync(id, false, ct);
    [HttpPost("{id:int}/reactivate")] public Task<StaffDetailDto> Reactivate(int id, CancellationToken ct) => staff.SetActiveAsync(id, true, ct);
    [HttpPost("{id:int}/invite")] public Task<InviteResultDto> Invite(int id, CancellationToken ct) => staff.InviteAsync(id, ct);
    [HttpPost("{id:int}/credentials")] public Task<StaffDetailDto> AddCredential(int id, AddCredentialRequest r, CancellationToken ct) => staff.AddCredentialAsync(id, r, ct);
    [HttpDelete("{id:int}/credentials/{credentialId:int}")] public Task<StaffDetailDto> DeleteCredential(int id, int credentialId, CancellationToken ct) => staff.DeleteCredentialAsync(id, credentialId, ct);
}

[ApiController, Route("api/schedule")]
public sealed class ScheduleController(ScheduleService schedule) : ControllerBase
{
    [HttpGet] public Task<ScheduleWeekDto> Week(int? locationId, DateOnly? date, CancellationToken ct) => schedule.GetWeekAsync(locationId, date, ct);
    [HttpGet("mine")] public Task<List<ShiftDto>> Mine(CancellationToken ct) => schedule.MyUpcomingAsync(ct);
    [HttpPost("shifts")] public Task<ScheduleWeekDto> Create(SaveShiftRequest r, CancellationToken ct) => schedule.CreateAsync(r, ct);
    [HttpPut("shifts/{id:int}")] public Task<ScheduleWeekDto> Update(int id, SaveShiftRequest r, CancellationToken ct) => schedule.UpdateAsync(id, r, ct);
    [HttpDelete("shifts/{id:int}")] public Task<ScheduleWeekDto> Delete(int id, CancellationToken ct) => schedule.DeleteAsync(id, ct);
    [HttpPost("publish")] public Task<PublishResult> Publish(PublishRequest r, CancellationToken ct) => schedule.PublishAsync(r, ct);
    [HttpPost("fill")] public Task<FillResult> Fill(WeekRequest r, CancellationToken ct) => schedule.FillFromPatternsAsync(r, ct);
}

[ApiController, Route("api/leave")]
public sealed class LeaveController(LeaveService leave) : ControllerBase
{
    [HttpGet("mine")] public Task<MyLeaveDto> Mine(CancellationToken ct) => leave.MineAsync(ct);
    [HttpPost("preview")] public Task<LeavePreviewDto> Preview(LeaveDraft r, CancellationToken ct) => leave.PreviewAsync(r, ct);
    [HttpPost] public Task<MyLeaveDto> Submit(LeaveDraft r, CancellationToken ct) => leave.RequestAsync(r, ct);
    [HttpGet("inbox")] public Task<List<InboxItemDto>> Inbox(CancellationToken ct) => leave.InboxAsync(ct);
    [HttpPost("{id:int}/decide")] public Task<List<InboxItemDto>> Decide(int id, DecideRequest r, CancellationToken ct) => leave.DecideAsync(id, r, ct);
    [HttpGet("team")] public Task<List<LeaveDto>> Team(DateOnly from, DateOnly to, CancellationToken ct) => leave.TeamAsync(from, to, ct);
}

[ApiController, Route("api/attendance")]
public sealed class AttendanceController(AttendanceService attendance) : ControllerBase
{
    [HttpGet("me")] public Task<ClockStatusDto> Status(CancellationToken ct) => attendance.StatusAsync(ct);
    [HttpPost("clock-in")] public Task<ClockStatusDto> ClockIn(ClockInRequest r, CancellationToken ct) => attendance.ClockInAsync(r, ct);
    [HttpPost("clock-out")] public Task<ClockStatusDto> ClockOut(CancellationToken ct) => attendance.ClockOutAsync(ct);
    [HttpGet] public Task<List<AttendanceDto>> ForLocation(int locationId, DateOnly? date, CancellationToken ct) => attendance.ForLocationAsync(locationId, date, ct);
    [HttpPut("{id:int}")] public Task<AttendanceDto> Correct(int id, CorrectAttendanceRequest r, CancellationToken ct) => attendance.CorrectAsync(id, r, ct);
    [HttpPost("{id:int}/confirm")] public Task<AttendanceDto> Confirm(int id, CancellationToken ct) => attendance.ConfirmUnscheduledAsync(id, ct);
}

[ApiController, Route("api")]
public sealed class OverviewController(DashboardService dashboard, NotificationService notifications, AuditService audit) : ControllerBase
{
    [HttpGet("dashboard")] public Task<DashboardDto> Dashboard(int? locationId, CancellationToken ct) => dashboard.TodayAsync(locationId, ct);
    [HttpGet("notifications")] public Task<NotificationsDto> Notifications(CancellationToken ct) => notifications.ListAsync(ct);
    [HttpPost("notifications/read")] public Task<NotificationsDto> MarkRead(CancellationToken ct) => notifications.MarkAllReadAsync(ct);
    [HttpGet("audit")] public Task<List<AuditDto>> Audit(string? entity, int page, CancellationToken ct) => audit.ListAsync(entity, page, ct);
}
