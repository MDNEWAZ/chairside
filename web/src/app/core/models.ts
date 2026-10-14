// Mirrors the API DTOs in src/DentalStaff.Application/Features. Keep in sync when a DTO changes.

export type Role = 'owner_admin' | 'practice_manager' | 'clinical_staff' | 'reception';
export type Weekday = 'Sunday' | 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday';
export const WEEKDAYS: Weekday[] = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export interface Me {
  staffId: number;
  firstName: string;
  lastName: string;
  email: string;
  role: Role;
  jobTitle: string;
  homeLocationId: number;
  homeLocationName: string;
  clinic: { name: string; planCode: string; trialEndsUtc: string; isDemo: boolean; timeZoneId: string };
}

export interface LookupItem { id: number; name: string }
export interface JobTitleItem { id: number; name: string; role: Role }
export interface ShiftDefinitionItem { id: number; name: string; startTime: string; endTime: string; unpaidBreakMinutes: number | null }
export interface CredentialTypeItem { id: number; name: string; blocksScheduling: boolean; requiredForJobTitleIds: number[] }
export interface Lookups {
  locations: LookupItem[];
  jobTitles: JobTitleItem[];
  shiftDefinitions: ShiftDefinitionItem[];
  credentialTypes: CredentialTypeItem[];
}

export interface Shift {
  shiftId: number;
  staffId: number;
  locationId: number;
  shiftDate: string;
  startTime: string;
  endTime: string;
  unpaidBreakMinutes: number;
  isPublished: boolean;
  paidHours: number;
}
export interface CoverageCell { jobTitle: string; scheduled: number; minimum: number }
export interface ScheduleDay { date: string; closedName: string | null; coverage: CoverageCell[] }
export interface ScheduleRow {
  staffId: number; name: string; jobTitle: string; homeLocation: string; weeklyHours: number; overtimeEligible: boolean; overThreshold: boolean;
}
export type IssueKind = 'Overlap' | 'OnLeave' | 'ClosedDay' | 'BelowMinimum' | 'ExpiredLicence' | 'Overtime';
export interface Issue { kind: IssueKind; severity: 'Warning' | 'Block'; date: string | null; staffId: number | null; shiftId: number | null; message: string }
export interface ScheduleWeek {
  locationId: number;
  weekStart: string;
  days: ScheduleDay[];
  rows: ScheduleRow[];
  shifts: Shift[];
  issues: Issue[];
  draftCount: number;
  canEdit: boolean;
  canOverride: boolean;
  overtimeThresholdHours: number;
}
export interface SaveShift {
  locationId: number; staffId: number; shiftDate: string; startTime: string; endTime: string; unpaidBreakMinutes: number | null; isPublished?: boolean;
}

export type LeaveType = 'annual' | 'sick' | 'other';
export interface LeaveDraft { startDate: string; endDate: string; firstDayHalf: boolean; lastDayHalf: boolean; leaveType: LeaveType; note: string | null }
export interface LeaveBalance { allowance: number; used: number; pending: number; remaining: number; year: number }
export interface Leave {
  leaveRequestId: number; staffId: number; staffName: string; startDate: string; endDate: string; firstDayHalf: boolean; lastDayHalf: boolean;
  leaveType: string; daysCounted: number; status: 'pending' | 'approved' | 'rejected'; note: string | null; decidedBy: string | null;
  decisionComment: string | null; createdAtUtc: string;
}
export interface MyLeave { balance: LeaveBalance; requests: Leave[] }
export interface StaffingImpact { date: string; location: string; jobTitle: string; remainingAfter: number; minimum: number }
export interface InboxItem { request: Leave; jobTitle: string; homeLocation: string; impact: StaffingImpact[]; overlapping: Leave[] }

export interface Attendance {
  attendanceId: number; staffId: number; staffName: string; locationId: number; locationName: string; clockInUtc: string; clockOutUtc: string | null;
  unpaidBreakMinutes: number; paidHours: number | null; isUnscheduled: boolean; unscheduledConfirmed: boolean; missingClockOut: boolean;
  weeklyOvertime: boolean; correctionNote: string | null;
}
export interface ClockStatus {
  open: Attendance | null;
  todayShift: { shiftId: number; locationId: number; locationName: string; startTime: string; endTime: string } | null;
  defaultLocationId: number;
  locations: { locationId: number; name: string }[];
  recent: Attendance[];
  serverUtc: string;
}

export interface DirectoryItem {
  staffId: number; name: string; role: Role; jobTitle: string; homeLocationId: number; homeLocation: string; isActive: boolean; hasAccount: boolean;
  credentialStatus: 'valid' | 'expiring' | 'expired' | 'missing' | null;
}
export interface PatternDay { weekday: Weekday; shiftDefinitionId: number; locationId: number }
export interface CredentialRecord { credentialId: number; credentialTypeId: number; name: string; expiresOn: string; status: 'valid' | 'expiring' | 'expired'; required: boolean }
export interface StaffDetail {
  staffId: number; firstName: string; lastName: string; email: string; phone: string | null; role: Role; jobTitleId: number; homeLocationId: number;
  startDate: string; isActive: boolean; overtimeEligible: boolean; employmentType: 'full_time' | 'part_time'; hasAccount: boolean; invitePending: boolean;
  pattern: PatternDay[]; patternEffectiveFrom: string | null; credentials: CredentialRecord[]; canEdit: boolean; canInvite: boolean;
}
export interface StaffInput {
  firstName: string; lastName: string; email: string; phone: string | null; jobTitleId: number; homeLocationId: number; startDate: string;
  overtimeEligible: boolean; employmentType: 'full_time' | 'part_time'; pattern: PatternDay[];
}
export interface InviteResult { acceptUrlPath: string; expiresUtc: string; note: string }

export interface Dashboard {
  locationId: number;
  today: string;
  workingToday: { staffId: number; name: string; jobTitle: string; startTime: string; endTime: string; status: 'not_in' | 'clocked_in' | 'clocked_out' }[];
  onLeaveToday: Leave[];
  pendingLeave: number;
  credentials: { staffId: number; name: string; credential: string; expiresOn: string; status: 'expiring' | 'expired' }[];
  needsAttention: Attendance[];
  weekIssues: number;
  weekBlocks: number;
  weekDrafts: number;
  checklist: { addedStaff: boolean; setWorkPattern: boolean; publishedSchedule: boolean; invitedSomeone: boolean } | null;
}

export interface ClinicSettings {
  name: string; timeZoneId: string; workweekStart: Weekday; overtimeThresholdHours: number; defaultBreakMinutes: number; leaveAllowanceDays: number;
}
export interface Billing { planCode: string; trialEndsUtc: string; activeStaff: number; locations: number; maxLocations: number; monthlyEstimate: number; simulated: boolean }
export interface Coverage { locationId: number; cells: { jobTitleId: number; weekday: Weekday; minHeadcount: number }[] }
export interface ClosedDay { closedDayId: number; closedOn: string; name: string; locationId: number | null }
export interface NotificationItem { notificationId: number; type: string; message: string; isRead: boolean; createdAtUtc: string }
export interface Notifications { unread: number; items: NotificationItem[] }
export interface AuditItem {
  auditId: number; atUtc: string; who: string | null; action: string; entityName: string; entityId: string; oldValue: string | null; newValue: string | null;
}

export const ROLE_LABEL: Record<Role, string> = {
  owner_admin: 'Owner / Admin',
  practice_manager: 'Practice Manager',
  clinical_staff: 'Clinical staff',
  reception: 'Reception',
};
