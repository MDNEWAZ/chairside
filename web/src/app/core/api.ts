import { HttpClient, HttpErrorResponse, HttpInterceptorFn, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, catchError, throwError } from 'rxjs';
import * as M from './models';

/** Adds the CSRF header the API requires on every state-changing request, and sends users to sign-in on 401. */
export const apiInterceptor: HttpInterceptorFn = (req, next) => {
  const router = inject(Router);
  const withHeader = req.url.startsWith('/api') ? req.clone({ setHeaders: { 'X-Chairside-Csrf': '1' } }) : req;
  return next(withHeader).pipe(
    catchError((err: unknown) => {
      if (err instanceof HttpErrorResponse && err.status === 401 && !req.url.startsWith('/api/auth/')) {
        void router.navigate(['/login'], { queryParams: { returnUrl: router.url } });
      }
      return throwError(() => err);
    }),
  );
};

/** A ProblemDetails response turned into UI-friendly parts. */
export interface ApiError {
  status: number;
  message: string;
  fields: Record<string, string>;
}

export function toApiError(err: unknown): ApiError {
  if (err instanceof HttpErrorResponse) {
    if (err.status === 0) return { status: 0, message: 'Cannot reach the server. Check your connection and try again.', fields: {} };
    if (err.status === 429) return { status: 429, message: 'Too many attempts. Wait a minute and try again.', fields: {} };
    const body = err.error as { title?: string; errors?: Record<string, string[]> } | null;
    const fields: Record<string, string> = {};
    for (const [k, v] of Object.entries(body?.errors ?? {})) fields[k.charAt(0).toLowerCase() + k.slice(1)] = v[0];
    return { status: err.status, message: body?.title ?? 'Something went wrong. Try again.', fields };
  }
  return { status: -1, message: 'Something went wrong. Try again.', fields: {} };
}

@Injectable({ providedIn: 'root' })
export class Api {
  private readonly http = inject(HttpClient);

  // Auth
  config = () => this.http.get<{ demoEnabled: boolean; minPasswordLength: number }>('/api/auth/config');
  me = () => this.http.get<M.Me>('/api/auth/me');
  /** The signed-in person and lookups in one call; null when signed out. */
  session = () => this.http.get<{ me: M.Me; lookups: M.Lookups } | null>('/api/auth/session');
  login = (email: string, password: string) => this.http.post<M.Me>('/api/auth/login', { email, password });
  demo = (persona: string) => this.http.post<M.Me>('/api/auth/demo', { persona });
  signup = (body: unknown) => this.http.post<M.Me>('/api/auth/signup', body);
  acceptInvite = (token: string, password: string) => this.http.post<M.Me>('/api/auth/invite', { token, password });
  logout = () => this.http.post<void>('/api/auth/logout', {});

  // Clinic
  lookups = () => this.http.get<M.Lookups>('/api/clinic/lookups');
  settings = () => this.http.get<M.ClinicSettings>('/api/clinic/settings');
  saveSettings = (s: M.ClinicSettings) => this.http.put<M.ClinicSettings>('/api/clinic/settings', s);
  addLocation = (name: string, address: string | null) => this.http.post<M.Lookups>('/api/clinic/locations', { name, address });
  billing = () => this.http.get<M.Billing>('/api/clinic/billing');
  changePlan = (planCode: string) => this.http.post<M.Billing>('/api/clinic/billing/plan', { planCode });
  coverage = (locationId: number) => this.http.get<M.Coverage>(`/api/clinic/coverage/${locationId}`);
  saveCoverage = (c: M.Coverage) => this.http.put<M.Coverage>('/api/clinic/coverage', c);
  closedDays = () => this.http.get<M.ClosedDay[]>('/api/clinic/closed-days');
  addClosedDay = (b: { closedOn: string; name: string; locationId: number | null }) => this.http.post<M.ClosedDay[]>('/api/clinic/closed-days', b);
  deleteClosedDay = (id: number) => this.http.delete<M.ClosedDay[]>(`/api/clinic/closed-days/${id}`);
  exportData = () => this.http.get('/api/clinic/export', { responseType: 'blob' });

  // Staff
  directory = (search: string, includeInactive: boolean) =>
    this.http.get<M.DirectoryItem[]>('/api/staff', { params: new HttpParams().set('search', search).set('includeInactive', includeInactive) });
  staff = (id: number) => this.http.get<M.StaffDetail>(`/api/staff/${id}`);
  createStaff = (s: M.StaffInput) => this.http.post<M.StaffDetail>('/api/staff', s);
  updateStaff = (id: number, s: M.StaffInput) => this.http.put<M.StaffDetail>(`/api/staff/${id}`, s);
  setActive = (id: number, active: boolean) => this.http.post<M.StaffDetail>(`/api/staff/${id}/${active ? 'reactivate' : 'deactivate'}`, {});
  invite = (id: number) => this.http.post<M.InviteResult>(`/api/staff/${id}/invite`, {});
  addCredential = (id: number, credentialTypeId: number, expiresOn: string) =>
    this.http.post<M.StaffDetail>(`/api/staff/${id}/credentials`, { credentialTypeId, expiresOn });
  deleteCredential = (id: number, credentialId: number) => this.http.delete<M.StaffDetail>(`/api/staff/${id}/credentials/${credentialId}`);

  // Schedule
  week = (locationId: number | null, date: string | null): Observable<M.ScheduleWeek> => {
    let params = new HttpParams();
    if (locationId) params = params.set('locationId', locationId);
    if (date) params = params.set('date', date);
    return this.http.get<M.ScheduleWeek>('/api/schedule', { params });
  };
  myShifts = () => this.http.get<M.Shift[]>('/api/schedule/mine');
  createShift = (s: M.SaveShift) => this.http.post<M.ScheduleWeek>('/api/schedule/shifts', s);
  updateShift = (id: number, s: M.SaveShift) => this.http.put<M.ScheduleWeek>(`/api/schedule/shifts/${id}`, s);
  deleteShift = (id: number) => this.http.delete<M.ScheduleWeek>(`/api/schedule/shifts/${id}`);
  publish = (locationId: number, weekStart: string, overrideReason: string | null) =>
    this.http.post<{ published: number; overrides: number; week: M.ScheduleWeek }>('/api/schedule/publish', { locationId, weekStart, overrideReason });
  fill = (locationId: number, weekStart: string) => this.http.post<{ created: number; week: M.ScheduleWeek }>('/api/schedule/fill', { locationId, weekStart });

  // Leave
  myLeave = () => this.http.get<M.MyLeave>('/api/leave/mine');
  previewLeave = (d: M.LeaveDraft) => this.http.post<{ daysCounted: number; balance: M.LeaveBalance }>('/api/leave/preview', d);
  requestLeave = (d: M.LeaveDraft) => this.http.post<M.MyLeave>('/api/leave', d);
  cancelLeave = (id: number) => this.http.delete<M.MyLeave>(`/api/leave/${id}`);
  inbox = () => this.http.get<M.InboxItem[]>('/api/leave/inbox');
  decide = (id: number, approve: boolean, comment: string | null) => this.http.post<M.InboxItem[]>(`/api/leave/${id}/decide`, { approve, comment });

  // Attendance
  clockStatus = () => this.http.get<M.ClockStatus>('/api/attendance/me');
  clockIn = (locationId: number) => this.http.post<M.ClockStatus>('/api/attendance/clock-in', { locationId });
  clockOut = () => this.http.post<M.ClockStatus>('/api/attendance/clock-out', {});
  attendance = (locationId: number, date: string | null) => {
    let params = new HttpParams().set('locationId', locationId);
    if (date) params = params.set('date', date);
    return this.http.get<M.Attendance[]>('/api/attendance', { params });
  };
  correct = (id: number, body: unknown) => this.http.put<M.Attendance>(`/api/attendance/${id}`, body);
  confirmUnscheduled = (id: number) => this.http.post<M.Attendance>(`/api/attendance/${id}/confirm`, {});

  // Overview
  dashboard = (locationId: number | null) =>
    this.http.get<M.Dashboard>('/api/dashboard', { params: locationId ? new HttpParams().set('locationId', locationId) : undefined });
  notifications = () => this.http.get<M.Notifications>('/api/notifications');
  markRead = () => this.http.post<M.Notifications>('/api/notifications/read', {});
  audit = (entity: string, page: number) => this.http.get<M.AuditItem[]>('/api/audit', { params: new HttpParams().set('entity', entity).set('page', page) });
}
