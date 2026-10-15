import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api } from '../core/api';
import { addDays, day, hours, instant, time, todayIn } from '../core/format';
import { Session } from '../core/session';
import { Toasts } from '../core/toast';
import { Confirm } from '../core/confirm';
import { Icon } from '../shared/icons';
import { Badge, ErrorState, Loader, Mutation, PageHeader } from '../shared/ui';
import { ScrollRegion } from '../shared/scroll-region';

/** Hero screens "My schedule" + "Clock in and out", phone first. The clock button is the largest control on the page. */
@Component({
  selector: 'app-my-day',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, PageHeader, Badge, ErrorState, Icon, ScrollRegion],
  styles: `
    .clock-btn { transition: transform var(--dur-fast) var(--ease-out), background-color var(--dur-fast); }
    .clock-btn:hover:not(:disabled) { transform: scale(1.02); }
    .clock-btn:active:not(:disabled) { transform: scale(0.98); }
    .pulse { animation: ring-pulse 2.2s var(--ease-out) infinite; }
    .tick { stroke-dasharray: 48; animation: draw var(--dur-slow) var(--ease-out) both; }
    @media (prefers-reduced-motion: reduce) { .pulse, .tick { animation: none; } }
  `,
  template: `
    <app-page-header [eyebrow]="greeting()" [title]="'Hi, ' + (session.me()?.firstName ?? '')" [subtitle]="'Times are ' + zoneLabel() + '.'" />

    <div class="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
      <section class="card enter overflow-hidden" aria-labelledby="clock-title">
        <div class="border-b border-line bg-raised px-5 py-4 text-center">
          <h2 id="clock-title" class="eyebrow">Clock in and out</h2>
          <p class="display-number mt-1 text-5xl" aria-live="off">{{ nowTime() }}</p>
          <p class="text-sm text-muted">{{ nowDate() }}</p>
        </div>

        <div class="px-5 pb-6 pt-5">
          @if (status.error(); as e) {
            <app-error-state [message]="e.message" (retry)="status.load()" />
          } @else if (status.data(); as s) {
            @if (staleDay()) {
              <div class="alert alert-warn mb-4" role="note">
                <app-icon name="warning" class="mt-0.5" />
                <p>You did not clock out on {{ staleDay() }}. Your manager will correct it. You can still clock in today.</p>
              </div>
            }
            <p class="flex items-center justify-center gap-2 text-center text-sm">
              @if (s.todayShift; as ts) {
                <app-icon name="calendar-check" [size]="16" class="text-accent" />
                <span>Today <span class="reading font-semibold">{{ t(ts.startTime) }}–{{ t(ts.endTime) }}</span> at <strong>{{ ts.locationName }}</strong></span>
              } @else {
                <app-icon name="info" [size]="16" class="text-muted" />
                <span class="text-muted">No shift today. A clock-in is still recorded and your manager confirms it.</span>
              }
            </p>

            <div class="relative mx-auto mt-6 grid h-52 w-52 place-items-center">
              @if (s.open; as o) {
                <svg class="absolute inset-0 -rotate-90" viewBox="0 0 208 208" aria-hidden="true">
                  <circle cx="104" cy="104" r="98" fill="none" stroke="var(--c-line)" stroke-width="8" />
                  <circle cx="104" cy="104" r="98" fill="none" stroke="var(--c-accent)" stroke-width="8" stroke-linecap="round"
                          [attr.stroke-dasharray]="circumference" [attr.stroke-dashoffset]="circumference * (1 - progress())" style="transition: stroke-dashoffset 1s linear" />
                </svg>
                <button type="button" class="clock-btn relative grid h-40 w-40 place-items-center rounded-full border border-line bg-surface text-ink"
                        style="box-shadow: var(--shadow-2)" [disabled]="m.busy()" (click)="clockOut()"
                        [attr.aria-label]="'Clock out. Clocked in for ' + elapsed() + ' at ' + o.locationName">
                  <span class="text-center">
                    <span class="reading block text-2xl font-semibold">{{ elapsed() }}</span>
                    <span class="mt-1 flex items-center justify-center gap-1.5 text-sm font-semibold text-block"><app-icon name="log-out" [size]="16" />{{ m.busy() ? 'Saving' : 'Clock out' }}</span>
                  </span>
                </button>
              } @else {
                <button type="button" class="clock-btn pulse grid h-44 w-44 place-items-center rounded-full bg-accent text-on-accent"
                        style="box-shadow: var(--shadow-2)" [disabled]="m.busy()" (click)="clockIn()"
                        [attr.aria-label]="'Clock in at ' + session.locationName(locationId)">
                  <span class="flex flex-col items-center gap-1.5">
                    <app-icon name="log-in" [size]="34" [stroke]="1.6" />
                    <span class="text-lg font-semibold">{{ m.busy() ? 'Saving' : 'Clock in' }}</span>
                  </span>
                </button>
              }
              @if (justDone()) {
                <span class="pointer-events-none absolute inset-0 grid place-items-center" aria-hidden="true">
                  <svg width="84" height="84" viewBox="0 0 24 24" fill="none" stroke="var(--c-ok)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                    <path class="tick" d="M5 12.5l4.2 4.2L19 7" />
                  </svg>
                </span>
              }
            </div>

            @if (s.open; as o) {
              <p class="mt-4 flex items-center justify-center gap-2 text-sm">
                <app-badge status="clocked_in" /><span>since <span class="reading font-semibold">{{ at(o.clockInUtc) }}</span> at {{ o.locationName }}</span>
              </p>
            } @else {
              <fieldset class="mt-5 text-center">
                <legend class="label mx-auto mb-2">Where are you working?</legend>
                <div class="segmented">
                  @for (l of s.locations; track l.locationId) {
                    <label><input type="radio" name="loc" [value]="l.locationId" [(ngModel)]="locationId" /><app-icon name="pin" [size]="15" />{{ l.name }}</label>
                  }
                </div>
                @if (m.fields()['locationId']; as e) { <p class="field-error mt-2 justify-center">{{ e }}</p> }
              </fieldset>
            }
            @if (m.error() && !m.fields()['locationId']) { <p class="field-error mt-3 justify-center" role="alert">{{ m.error()!.message }}</p> }
            <p class="help mt-5 flex items-center justify-center gap-1.5 text-center"><app-icon name="shield" [size]="14" />The time comes from the clinic's server, not your phone.</p>
          } @else {
            <div class="space-y-4"><div class="skeleton mx-auto h-5 w-2/3"></div><div class="skeleton mx-auto h-44 w-44 !rounded-full"></div><div class="skeleton mx-auto h-11 w-56"></div></div>
          }
        </div>
      </section>

      <section aria-labelledby="upcoming-title" class="enter" style="animation-delay: 60ms">
        <div class="flex items-center justify-between gap-2">
          <h2 id="upcoming-title" class="section-title">My upcoming shifts</h2>
          <a routerLink="/leave" class="btn btn-sm"><app-icon name="leave" [size]="16" />Request leave</a>
        </div>
        @if (shifts.error(); as e) {
          <div class="mt-3"><app-error-state [message]="e.message" (retry)="shifts.load()" /></div>
        } @else if (shifts.data(); as list) {
          @if (list.length === 0) {
            <div class="card mt-3 p-6 text-center">
              <span class="mx-auto grid h-12 w-12 place-items-center rounded-full bg-accent-soft text-accent"><app-icon name="calendar" [size]="22" /></span>
              <p class="mt-3 font-medium">No published shifts in the next four weeks</p>
              <p class="help mt-1">When your manager publishes the schedule, it appears here and you get a notification.</p>
            </div>
          } @else {
            <ol class="mt-3 space-y-2">
              @for (s of list; track s.shiftId; let first = $first) {
                <li class="card card-hover flex items-center gap-4 p-3.5" [class.!border-accent]="first">
                  <div class="grid w-14 shrink-0 place-items-center rounded-control py-1.5 text-center" [class]="first ? 'bg-accent text-on-accent' : 'bg-raised'">
                    <span class="text-[11px] font-semibold uppercase tracking-wide" [class.text-muted]="!first">{{ dayName(s.shiftDate) }}</span>
                    <span class="display-number text-2xl leading-none">{{ +s.shiftDate.slice(8) }}</span>
                  </div>
                  <div class="min-w-0 flex-1">
                    <p class="reading font-semibold">{{ t(s.startTime) }}–{{ t(s.endTime) }}</p>
                    <p class="flex items-center gap-1 text-sm text-muted"><app-icon name="pin" [size]="14" />{{ session.locationName(s.locationId) }}{{ s.unpaidBreakMinutes ? ' · ' + s.unpaidBreakMinutes + ' min break' : '' }}</p>
                  </div>
                  <span class="badge" [class]="first ? 'badge-accent' : 'badge-neutral'">{{ relative(s.shiftDate) }}</span>
                </li>
              }
            </ol>
          }
        } @else {
          <div class="mt-3 space-y-2">@for (i of [1, 2, 3]; track i) { <div class="skeleton h-20"></div> }</div>
        }

        @if (status.data()?.recent?.length) {
          <h2 class="section-title mt-8">My recent hours</h2>
          <div class="table-wrap mt-3">
            <table class="table">
              <caption class="sr-only">Clock-in records for the last 14 days</caption>
              <thead><tr><th scope="col">Day</th><th scope="col">In</th><th scope="col">Out</th><th scope="col">Paid</th><th scope="col">Status</th></tr></thead>
              <tbody>
                @for (r of status.data()!.recent; track r.attendanceId) {
                  <tr>
                    <td>{{ atDay(r.clockInUtc) }}</td>
                    <td class="reading">{{ at(r.clockInUtc) }}</td>
                    <td class="reading">{{ r.clockOutUtc ? at(r.clockOutUtc) : '—' }}</td>
                    <td class="reading">{{ h(r.paidHours) }}</td>
                    <td>
                      @if (r.missingClockOut) { <app-badge status="flagged" label="Missing clock-out" /> }
                      @else if (r.isUnscheduled && !r.unscheduledConfirmed) { <app-badge status="unscheduled" /> }
                      @else if (!r.clockOutUtc) { <app-badge status="clocked_in" /> }
                      @else { <app-badge status="clocked_out" label="Recorded" /> }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </section>
    </div>
  `,
})
export class MyDay implements OnInit {
  protected readonly session = inject(Session);
  private readonly api = inject(Api);
  private readonly toasts = inject(Toasts);
  protected readonly status = new Loader(() => this.api.clockStatus());
  protected readonly shifts = new Loader(() => this.api.myShifts());
  protected readonly m = new Mutation();
  protected locationId = 0;
  protected readonly t = time;
  protected readonly h = hours;
  protected readonly circumference = 2 * Math.PI * 98;
  protected readonly now = signal(new Date());
  protected readonly justDone = signal(false);
  protected readonly zoneLabel = computed(() => this.session.timeZone().split('/').pop()!.replace('_', ' ') + ' time');

  protected readonly nowTime = computed(() =>
    new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: this.session.timeZone() }).format(this.now()));
  protected readonly nowDate = computed(() =>
    new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: this.session.timeZone() }).format(this.now()));
  protected readonly greeting = computed(() => {
    const hour = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: this.session.timeZone() }).format(this.now()));
    return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  });
  protected readonly staleDay = computed(() => {
    const first = (this.status.data()?.recent ?? []).find((r) => r.missingClockOut);
    return first ? this.atDay(first.clockInUtc) : '';
  });
  private readonly confirm = inject(Confirm);
  /** How far this device's clock is from the server's, so a wrong phone clock does not skew the timer. Re-measured on each load. */
  protected readonly clockOffset = computed(() => {
    const s = this.status.data();
    return s ? Date.now() - Date.parse(s.serverUtc) : 0;
  });
  private readonly openMinutes = computed(() => {
    const open = this.status.data()?.open;
    return open ? Math.max(0, (this.now().getTime() - this.clockOffset() - new Date(open.clockInUtc).getTime()) / 60000) : 0;
  });
  protected readonly elapsed = computed(() => {
    const mins = Math.floor(this.openMinutes());
    return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`;
  });
  /** Share of today's shift worked so far; a full ring after 8 hours when there is no shift. */
  protected readonly progress = computed(() => {
    const s = this.status.data()?.todayShift;
    const [sh, sm] = (s?.startTime ?? '00:00').split(':').map(Number);
    const [eh, em] = (s?.endTime ?? '08:00').split(':').map(Number);
    const length = s ? eh * 60 + em - (sh * 60 + sm) : 480;
    return Math.min(1, this.openMinutes() / Math.max(1, length));
  });

  constructor() {
    const timer = setInterval(() => this.now.set(new Date()), 1000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  async ngOnInit(): Promise<void> {
    await Promise.all([this.status.load(), this.shifts.load()]);
    this.locationId = this.status.data()?.defaultLocationId ?? 0;
  }

  protected dayName(d: string): string {
    return day(d).split(',')[0];
  }

  protected relative(d: string): string {
    const today = todayIn(this.session.timeZone());
    if (d === today) return 'Today';
    if (d === addDays(today, 1)) return 'Tomorrow';
    const diff = Math.round((Date.parse(d) - Date.parse(today)) / 86400000);
    return `In ${diff} days`;
  }

  protected at(utc: string): string {
    return instant(utc, this.session.timeZone());
  }

  protected atDay(utc: string): string {
    return instant(utc, this.session.timeZone(), true).split(',').slice(0, 2).join(',');
  }

  protected async clockIn(): Promise<void> {
    const s = await this.m.run(() => this.api.clockIn(this.locationId));
    if (!s) {
      this.toasts.show(this.m.error()?.message ?? 'Could not clock in.', 'block');
      void this.status.load();
      return;
    }
    if (s) {
      this.status.data.set(s);
      this.celebrate();
      this.toasts.show(`Clocked in at ${this.at(s.open!.clockInUtc)}.`);
    }
  }

  protected async clockOut(): Promise<void> {
    // A tap moments after clocking in is usually a mistake: check first.
    const open = this.status.data()?.open;
    if (open && Date.now() - this.clockOffset() - new Date(open.clockInUtc).getTime() < 15 * 60_000) {
      const answer = await this.confirm.ask({
        title: 'Clock out already?', body: `You clocked in at ${this.at(open.clockInUtc)}, only a few minutes ago.`, confirmLabel: 'Clock out',
      });
      if (!answer.confirmed) return;
    }
    const s = await this.m.run(() => this.api.clockOut());
    if (!s) {
      this.toasts.show(this.m.error()?.message ?? 'Could not clock out.', 'block');
      void this.status.load();
      return;
    }
    if (s) {
      this.status.data.set(s);
      this.celebrate();
      this.toasts.show(`Clocked out at ${this.at(s.recent[0]?.clockOutUtc ?? s.serverUtc)}.`);
    }
  }

  private celebrate(): void {
    this.justDone.set(true);
    setTimeout(() => this.justDone.set(false), 1200);
  }
}
