import { ChangeDetectionStrategy, Component, ElementRef, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../core/api';
import { addDays, day, hours, instant, localParts, todayIn } from '../core/format';
import { Attendance as AttendanceRecord } from '../core/models';
import { Session } from '../core/session';
import { Toasts } from '../core/toast';
import { Badge, ErrorState, Loader, Mutation, PageHeader, Sheet, focusFirstError } from '../shared/ui';
import { ScrollRegion } from '../shared/scroll-region';
import { Avatar } from '../shared/brand';

interface Correction { id: number; name: string; inDate: string; inTime: string; outDate: string; outTime: string; breakMinutes: number; note: string }

@Component({
  selector: 'app-attendance',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, PageHeader, Badge, ErrorState, Sheet, Avatar, ScrollRegion],
  template: `
    <app-page-header eyebrow="Clock records" title="Attendance" [subtitle]="'Week of ' + day(anchorWeek()) + ' · times in clinic time'">
      <label class="sr-only" for="loc">Location</label>
      <select id="loc" class="input w-auto" [ngModel]="locationId()" (ngModelChange)="locationId.set($event); list.load()">
        @for (l of locations(); track l.id) { <option [ngValue]="l.id">{{ l.name }}</option> }
      </select>
      <div class="flex" role="group" aria-label="Week">
        <button type="button" class="btn rounded-r-none" (click)="move(-7)" aria-label="Previous week">‹</button>
        <button type="button" class="btn rounded-l-none border-l-0" (click)="move(7)" aria-label="Next week">›</button>
      </div>
    </app-page-header>

    @if (list.error(); as e) {
      <app-error-state [message]="e.message" (retry)="list.load()" />
    } @else if (list.data(); as rows) {
      @if (rows.length === 0) {
        <p class="card p-5 text-muted">No clock-ins at this location this week. Staff clock in from My day on their phones.</p>
      } @else {
        <div class="table-wrap">
          <table class="table min-w-[44rem]">
            <caption class="sr-only">Attendance records. Paid hours have unpaid breaks deducted.</caption>
            <thead><tr><th scope="col">Person</th><th scope="col">In</th><th scope="col">Out</th><th scope="col">Break</th><th scope="col">Paid</th><th scope="col">Flags</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead>
            <tbody>
              @for (r of rows; track r.attendanceId) {
                <tr>
                  <td><span class="flex items-center gap-2.5"><app-avatar [name]="r.staffName" [size]="30" /><span class="font-semibold">{{ r.staffName }}</span></span></td>
                  <td class="reading">{{ at(r.clockInUtc) }}</td>
                  <td class="reading">{{ r.clockOutUtc ? at(r.clockOutUtc) : '—' }}</td>
                  <td class="reading">{{ r.unpaidBreakMinutes }} min</td>
                  <td class="reading">{{ h(r.paidHours) }}</td>
                  <td>
                    <div class="flex flex-wrap gap-1">
                      @if (r.missingClockOut) { <app-badge status="flagged" label="Missing clock-out" /> }
                      @if (r.isUnscheduled) { <app-badge [status]="r.unscheduledConfirmed ? 'valid' : 'unscheduled'" [label]="r.unscheduledConfirmed ? 'Unscheduled, confirmed' : 'Unscheduled'" /> }
                      @if (r.weeklyOvertime) { <app-badge status="overtime" label="Over weekly threshold" /> }
                      @if (r.correctionNote) { <span class="badge badge-neutral" [title]="r.correctionNote">Corrected</span> }
                    </div>
                  </td>
                  <td class="whitespace-nowrap text-right">
                    @if (r.staffId !== session.me()?.staffId) {
                      @if (r.isUnscheduled && !r.unscheduledConfirmed) {
                        <button type="button" class="btn btn-sm mr-1" (click)="confirm(r)" [disabled]="m.busy()">Confirm</button>
                      }
                      <button type="button" class="btn btn-sm" (click)="openCorrect(r)" [attr.aria-label]="'Correct record for ' + r.staffName">Correct</button>
                    } @else {
                      <span class="text-xs text-muted">Own record</span>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        <p class="help mt-2">You cannot correct your own records; the Owner / Admin does. Every correction is written to the audit log.</p>
      }
    } @else {
      <div class="skeleton h-72"></div>
    }

    <app-sheet #sheet heading="Correct attendance">
      @if (c(); as v) {
        <form class="flex flex-col gap-4" (ngSubmit)="save()" novalidate>
          <p class="font-medium">{{ v.name }}</p>
          <div class="grid grid-cols-2 gap-3">
            <div class="field"><label class="label" for="inDate">Clock-in date</label><input id="inDate" class="input" type="date" name="inDate" [(ngModel)]="v.inDate"></div>
            <div class="field"><label class="label" for="inTime">Clock-in time</label>
              <input id="inTime" class="input" type="time" name="inTime" [(ngModel)]="v.inTime" [attr.aria-invalid]="!!f()['clockInTime'] || null"></div>
          </div>
          @if (f()['clockInTime']; as e) { <p class="field-error -mt-2">{{ e }}</p> }
          <div class="grid grid-cols-2 gap-3">
            <div class="field"><label class="label" for="outDate">Clock-out date</label><input id="outDate" class="input" type="date" name="outDate" [(ngModel)]="v.outDate"></div>
            <div class="field"><label class="label" for="outTime">Clock-out time</label>
              <input id="outTime" class="input" type="time" name="outTime" [(ngModel)]="v.outTime" [attr.aria-invalid]="!!f()['clockOutTime'] || null"></div>
          </div>
          @if (f()['clockOutTime']; as e) { <p class="field-error -mt-2">{{ e }}</p> }
          <div class="field">
            <label class="label" for="brk">Unpaid break (minutes)</label>
            <input id="brk" class="input" type="number" min="0" max="120" name="brk" [(ngModel)]="v.breakMinutes" aria-describedby="brk-help" [attr.aria-invalid]="!!f()['unpaidBreakMinutes'] || null">
            <p id="brk-help" class="help">Set to 0 if they worked through their break. Short paid breaks are never deducted.</p>
            @if (f()['unpaidBreakMinutes']; as e) { <p class="field-error">{{ e }}</p> }
          </div>
          <div class="field">
            <label class="label" for="note">Reason for the correction</label>
            <input id="note" class="input" name="note" maxlength="300" [(ngModel)]="v.note" [attr.aria-invalid]="!!f()['note'] || null" placeholder="For example: forgot to clock out, left at 5:00 PM">
            @if (f()['note']; as e) { <p class="field-error">{{ e }}</p> }
          </div>
          @if (m.error() && !hasFieldErrors()) { <p class="field-error" role="alert">{{ m.error()!.message }}</p> }
          <button type="submit" class="btn btn-primary self-end" [disabled]="m.busy()">Save correction</button>
        </form>
      }
    </app-sheet>
  `,
})
export class Attendance implements OnInit {
  protected readonly session = inject(Session);
  private readonly api = inject(Api);
  private readonly toasts = inject(Toasts);
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly sheet = viewChild.required<Sheet>('sheet');
  protected readonly locationId = signal(0);
  protected readonly anchor = signal(todayIn(this.session.timeZone()));
  protected readonly list = new Loader(() => this.api.attendance(this.locationId(), this.anchor()));
  protected readonly m = new Mutation();
  protected readonly f = this.m.fields;
  protected readonly c = signal<Correction | null>(null);
  protected readonly h = hours;
  protected readonly day = (d: string) => day(d);
  protected readonly locations = computed(() =>
    (this.session.lookups()?.locations ?? []).filter((l) => this.session.isOwner() || l.id === this.session.me()?.homeLocationId));
  protected readonly anchorWeek = computed(() => {
    const d = new Date(this.anchor() + 'T00:00:00Z');
    return addDays(this.anchor(), -((d.getUTCDay() + 6) % 7));
  });

  ngOnInit(): void {
    this.locationId.set(this.session.me()?.homeLocationId ?? 0);
    void this.list.load();
  }

  protected move(days: number): void {
    this.anchor.set(addDays(this.anchor(), days));
    void this.list.load();
  }

  protected at(utc: string): string {
    return instant(utc, this.session.timeZone(), true);
  }

  protected hasFieldErrors(): boolean {
    return Object.keys(this.f()).length > 0;
  }

  protected openCorrect(r: AttendanceRecord): void {
    const zone = this.session.timeZone();
    const [inDate, inTime] = localParts(r.clockInUtc, zone);
    const [outDate, outTime] = r.clockOutUtc ? localParts(r.clockOutUtc, zone) : [inDate, ''];
    this.m.reset();
    this.c.set({ id: r.attendanceId, name: r.staffName, inDate, inTime, outDate, outTime, breakMinutes: r.unpaidBreakMinutes, note: '' });
    this.sheet().open();
  }

  protected async save(): Promise<void> {
    const v = this.c()!;
    const body = {
      clockInDate: v.inDate, clockInTime: v.inTime, clockOutDate: v.outTime ? v.outDate : null, clockOutTime: v.outTime || null,
      unpaidBreakMinutes: Number(v.breakMinutes), note: v.note,
    };
    const updated = await this.m.run(() => this.api.correct(v.id, body));
    if (!updated) {
      focusFirstError(this.host.nativeElement);
      return;
    }
    this.replace(updated);
    this.sheet().close();
    this.toasts.show(`Record for ${v.name} corrected and logged.`);
  }

  protected async confirm(r: AttendanceRecord): Promise<void> {
    const updated = await this.m.run(() => this.api.confirmUnscheduled(r.attendanceId));
    if (updated) {
      this.replace(updated);
      this.toasts.show(`Unscheduled clock-in for ${r.staffName} confirmed.`);
    } else {
      this.toasts.show(this.m.error()?.message ?? 'Could not confirm.', 'block');
    }
  }

  private replace(a: AttendanceRecord): void {
    this.list.data.update((rows) => rows?.map((x) => (x.attendanceId === a.attendanceId ? a : x)) ?? null);
  }
}
