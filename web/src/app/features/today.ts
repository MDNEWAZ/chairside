import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { Api } from '../core/api';
import { day, instant, time, weekdayShort } from '../core/format';
import { ScheduleWeek } from '../core/models';
import { Session } from '../core/session';
import { Avatar, jobClass } from '../shared/brand';
import { Icon, IconName } from '../shared/icons';
import { Badge, ErrorState, Loader, PageHeader } from '../shared/ui';

/** Hero screen "Practice Manager dashboard": who is working, pending leave, credentials, clock-out problems, the week ahead. */
@Component({
  selector: 'app-today',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, PageHeader, Badge, ErrorState, Avatar, Icon],
  template: `
    <app-page-header [eyebrow]="eyebrow()" [title]="greeting() + ', ' + (session.me()?.firstName ?? '')" subtitle="Here is what needs you today.">
      @if (session.isOwner()) {
        <label class="sr-only" for="loc">Location</label>
        <select id="loc" class="input w-auto" [ngModel]="locationId()" (ngModelChange)="locationId.set($event); reload()">
          @for (l of session.lookups()?.locations ?? []; track l.id) { <option [ngValue]="l.id">{{ l.name }}</option> }
        </select>
      }
    </app-page-header>

    @if (data.error(); as e) {
      <app-error-state [message]="e.message" (retry)="reload()" />
    } @else if (data.data(); as d) {
      @if (d.checklist; as c) {
        @if (!(c.addedStaff && c.setWorkPattern && c.publishedSchedule && c.invitedSomeone)) {
          <section class="card enter mb-6 overflow-hidden" aria-labelledby="start-title">
            <div class="flex flex-wrap items-center gap-4 border-b border-line bg-accent-soft px-5 py-4">
              <span class="grid h-10 w-10 place-items-center rounded-full bg-accent text-on-accent"><app-icon name="sparkles" /></span>
              <div class="mr-auto">
                <h2 id="start-title" class="section-title">Get your clinic running</h2>
                <p class="text-sm text-muted">{{ doneCount(c) }} of 4 done · about 15 minutes in total</p>
              </div>
              <span class="h-2 w-40 overflow-hidden rounded-full bg-surface" aria-hidden="true"><span class="block h-full rounded-full bg-accent" [style.width.%]="doneCount(c) * 25"></span></span>
            </div>
            <ol class="grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-4">
              @for (step of steps(c); track step.label; let i = $index) {
                <li class="bg-surface">
                  <a [routerLink]="step.link" class="flex h-full items-start gap-3 p-4 hover:bg-raised">
                    <span class="grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold" [class]="step.done ? 'bg-ok-bg text-ok' : 'border border-line-strong text-muted'">
                      @if (step.done) { <app-icon name="check" [size]="15" /> } @else { {{ i + 1 }} }
                    </span>
                    <span><span class="block text-sm font-semibold" [class.line-through]="step.done" [class.text-muted]="step.done">{{ step.label }}</span>
                      <span class="block text-xs text-muted">{{ step.done ? 'Done' : step.hint }}</span></span>
                  </a>
                </li>
              }
            </ol>
          </section>
        }
      }

      <div class="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        @for (k of kpis(); track k.label; let i = $index) {
          <a [routerLink]="k.link" class="card card-hover enter block p-4" [style.animation-delay.ms]="i * 40">
            <span class="flex items-center justify-between">
              <span class="grid h-9 w-9 place-items-center rounded-full" [class]="k.tone"><app-icon [name]="k.icon" [size]="18" /></span>
              <app-icon name="arrow-right" [size]="16" class="text-muted" />
            </span>
            <span class="display-number mt-3 block text-3xl">{{ k.value }}</span>
            <span class="block text-sm text-muted">{{ k.label }}</span>
          </a>
        }
      </div>

      @if (week(); as w) {
        <section class="card enter mb-6 p-4" aria-labelledby="glance-title">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h2 id="glance-title" class="section-title">This week at a glance</h2>
            <a routerLink="/schedule" class="inline-flex items-center gap-1 text-sm font-medium text-accent">Open schedule<app-icon name="arrow-right" [size]="15" /></a>
          </div>
          <ol class="mt-3 grid grid-cols-7 gap-1.5">
            @for (g of glance(); track g.date) {
              <li class="flex flex-col items-center gap-1 rounded-control border px-1 py-2 text-center"
                  [class]="g.state === 'short' ? 'border-block bg-block-bg text-block' : g.state === 'closed' ? 'border-line bg-raised text-muted' : g.state === 'ok' ? 'border-transparent bg-ok-bg text-ok' : 'border-line text-muted'"
                  [class.ring-2]="g.date === d.today" [class.ring-accent]="g.date === d.today">
                <span class="text-[11px] font-semibold uppercase">{{ weekday(g.date) }}</span>
                <span class="display-number text-lg leading-none">{{ +g.date.slice(8) }}</span>
                <span class="text-[10px] font-medium">{{ g.label }}</span>
              </li>
            }
          </ol>
        </section>
      }

      <div class="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <section class="card enter p-4" aria-labelledby="working-title">
          <div class="flex items-center gap-4">
            <div class="relative h-16 w-16 shrink-0" aria-hidden="true">
              <svg viewBox="0 0 64 64" class="-rotate-90">
                <circle cx="32" cy="32" r="27" fill="none" stroke="var(--c-line)" stroke-width="6" />
                <circle cx="32" cy="32" r="27" fill="none" stroke="var(--c-accent)" stroke-width="6" stroke-linecap="round"
                        [attr.stroke-dasharray]="ring" [attr.stroke-dashoffset]="ring * (1 - inShare())" />
              </svg>
              <span class="reading absolute inset-0 grid place-items-center text-sm font-semibold">{{ inCount() }}/{{ d.workingToday.length }}</span>
            </div>
            <div>
              <h2 id="working-title" class="section-title">Who is working</h2>
              <p class="text-sm text-muted">{{ inCount() }} clocked in of {{ d.workingToday.length }} scheduled today</p>
            </div>
          </div>
          @if (d.workingToday.length === 0) {
            <p class="mt-4 rounded-control bg-raised p-4 text-sm text-muted">No published shifts today. Build and publish the week on the Schedule page.</p>
          } @else {
            <ul class="mt-4 divide-y divide-line">
              @for (p of d.workingToday; track p.staffId) {
                <li class="flex items-center gap-3 py-2.5" [class]="job(p.jobTitle)">
                  <app-avatar [name]="p.name" [job]="p.jobTitle" [size]="34" />
                  <span class="min-w-0 flex-1">
                    <span class="block truncate text-sm font-semibold">{{ p.name }}</span>
                    <span class="flex items-center gap-1 text-xs text-muted"><span class="job-dot"></span>{{ p.jobTitle }} · <span class="reading">{{ t(p.startTime) }}–{{ t(p.endTime) }}</span></span>
                  </span>
                  <app-badge [status]="p.status" />
                </li>
              }
            </ul>
          }
          @if (d.onLeaveToday.length) {
            <p class="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3 text-sm">
              <app-icon name="leave" [size]="16" class="text-muted" /><span class="text-muted">On leave today:</span>
              @for (l of d.onLeaveToday; track l.leaveRequestId) { <span class="badge badge-neutral">{{ l.staffName }}</span> }
            </p>
          }
        </section>

        <div class="flex flex-col gap-6">
          <section class="card enter p-4" aria-labelledby="attention-title" style="animation-delay: 60ms">
            <div class="flex items-center justify-between gap-2">
              <h2 id="attention-title" class="section-title">Clock-ins to review</h2>
              @if (d.needsAttention.length) { <a routerLink="/attendance" class="inline-flex items-center gap-1 text-sm font-medium text-accent">Review<app-icon name="arrow-right" [size]="15" /></a> }
            </div>
            @if (d.needsAttention.length === 0) {
              <p class="mt-3 flex items-center gap-2 text-sm text-muted"><app-icon name="circle-check" [size]="18" class="text-ok" />Nothing to review. Missed clock-outs and unscheduled clock-ins show up here.</p>
            } @else {
              <ul class="mt-3 space-y-2">
                @for (a of d.needsAttention; track a.attendanceId) {
                  <li class="flex items-center gap-3 rounded-control border border-line p-2.5">
                    <app-avatar [name]="a.staffName" [size]="30" />
                    <span class="min-w-0 flex-1"><span class="block truncate text-sm font-semibold">{{ a.staffName }}</span>
                      <span class="block text-xs text-muted">In at {{ at(a.clockInUtc) }}</span></span>
                    <app-badge [status]="a.missingClockOut ? 'flagged' : 'unscheduled'" [label]="a.missingClockOut ? 'Missing clock-out' : 'Unscheduled'" />
                  </li>
                }
              </ul>
            }
          </section>

          <section class="card enter p-4" aria-labelledby="cred-title" style="animation-delay: 100ms">
            <h2 id="cred-title" class="section-title">Licences and certifications</h2>
            @if (d.credentials.length === 0) {
              <p class="mt-3 flex items-center gap-2 text-sm text-muted"><app-icon name="shield" [size]="18" class="text-ok" />Nothing expires in the next 30 days.</p>
            } @else {
              <ul class="mt-3 space-y-2">
                @for (c of d.credentials; track c.staffId + c.credential) {
                  <li class="flex items-center gap-3 rounded-control border p-2.5" [class]="c.status === 'expired' ? 'border-block bg-block-bg' : 'border-line'">
                    <span class="grid w-12 shrink-0 place-items-center text-center">
                      <span class="display-number text-xl leading-none" [class]="c.status === 'expired' ? 'text-block' : 'text-warn'">{{ daysLeft(c.expiresOn, d.today) }}</span>
                      <span class="text-[10px] uppercase text-muted">{{ c.status === 'expired' ? 'days ago' : 'days left' }}</span>
                    </span>
                    <span class="min-w-0 flex-1">
                      <a [routerLink]="['/staff', c.staffId]" class="block truncate text-sm font-semibold underline-offset-2 hover:underline">{{ c.name }}</a>
                      <span class="block truncate text-xs text-muted">{{ c.credential }} · {{ day(c.expiresOn) }}</span>
                    </span>
                    <app-badge [status]="c.status" />
                  </li>
                }
              </ul>
            }
          </section>
        </div>
      </div>
    } @else {
      <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">@for (i of [1, 2, 3, 4]; track i) { <div class="skeleton h-28"></div> }</div>
      <div class="skeleton mt-6 h-24"></div>
      <div class="skeleton mt-6 h-64"></div>
    }
  `,
})
export class Today implements OnInit {
  protected readonly session = inject(Session);
  private readonly api = inject(Api);
  protected readonly locationId = signal<number | null>(null);
  protected readonly data = new Loader(() => this.api.dashboard(this.locationId()));
  protected readonly week = signal<ScheduleWeek | null>(null);
  protected readonly day = (d: string) => day(d);
  protected readonly weekday = weekdayShort;
  protected readonly t = time;
  protected readonly job = jobClass;
  protected readonly ring = 2 * Math.PI * 27;

  protected readonly greeting = computed(() => {
    const hour = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: this.session.timeZone() }).format(new Date()));
    return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  });
  protected readonly eyebrow = computed(() => {
    const d = this.data.data();
    return d ? `${day(d.today)} · ${this.session.locationName(d.locationId)}` : '';
  });
  protected readonly inCount = computed(() => this.data.data()?.workingToday.filter((w) => w.status === 'clocked_in').length ?? 0);
  protected readonly inShare = computed(() => {
    const total = this.data.data()?.workingToday.length ?? 0;
    return total ? this.inCount() / total : 0;
  });
  protected readonly kpis = computed(() => {
    const d = this.data.data();
    if (!d) return [];
    const items: { label: string; value: number; icon: IconName; tone: string; link: string }[] = [
      { label: 'Working today', value: d.workingToday.length, icon: 'users', tone: 'bg-accent-soft text-accent', link: '/schedule' },
      { label: 'Leave requests to decide', value: d.pendingLeave, icon: 'leave', tone: d.pendingLeave ? 'bg-warn-bg text-warn' : 'bg-raised text-muted', link: '/leave' },
      { label: 'Licences expiring or expired', value: d.credentials.length, icon: 'shield', tone: d.credentials.some((c) => c.status === 'expired') ? 'bg-block-bg text-block' : d.credentials.length ? 'bg-warn-bg text-warn' : 'bg-ok-bg text-ok', link: '/staff' },
      { label: d.weekBlocks ? `Schedule checks · ${d.weekBlocks} blocking` : 'Schedule checks this week', value: d.weekIssues, icon: 'badge-check', tone: d.weekBlocks ? 'bg-block-bg text-block' : d.weekIssues ? 'bg-warn-bg text-warn' : 'bg-ok-bg text-ok', link: '/schedule' },
    ];
    return items;
  });
  protected readonly glance = computed(() =>
    (this.week()?.days ?? []).map((d) => {
      const short = d.coverage.some((c) => c.scheduled < c.minimum);
      const state = d.closedName ? 'closed' : d.coverage.length === 0 ? 'none' : short ? 'short' : 'ok';
      const label = state === 'closed' ? 'Closed' : state === 'short' ? 'Short' : state === 'ok' ? 'Covered' : '—';
      return { date: d.date, state, label };
    }));

  ngOnInit(): void {
    this.locationId.set(this.session.me()?.homeLocationId ?? null);
    void this.reload();
    // The front desk leaves this open all day: refresh who is in every minute while the tab is visible.
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible' && !this.data.loading()) void this.reload();
    }, 60_000);
    this.destroyRef.onDestroy(() => clearInterval(timer));
  }

  private readonly destroyRef = inject(DestroyRef);

  protected async reload(): Promise<void> {
    await this.data.load();
    try {
      this.week.set(await firstValueFrom(this.api.week(this.locationId(), null)));
    } catch {
      this.week.set(null); // the glance strip is optional; the rest of the page still works
    }
  }

  protected at(utc: string): string {
    return instant(utc, this.session.timeZone(), true);
  }

  protected daysLeft(expiresOn: string, today: string): number {
    return Math.abs(Math.round((Date.parse(expiresOn) - Date.parse(today)) / 86400000));
  }

  protected doneCount(c: { addedStaff: boolean; setWorkPattern: boolean; publishedSchedule: boolean; invitedSomeone: boolean }): number {
    return [c.addedStaff, c.setWorkPattern, c.publishedSchedule, c.invitedSomeone].filter(Boolean).length;
  }

  protected steps(c: { addedStaff: boolean; setWorkPattern: boolean; publishedSchedule: boolean; invitedSomeone: boolean }) {
    return [
      { label: 'Add your team', hint: 'Name, job title, home location', done: c.addedStaff, link: '/staff' },
      { label: 'Set work patterns', hint: 'Who usually works which days', done: c.setWorkPattern, link: '/staff' },
      { label: 'Publish your first week', hint: 'Fill from patterns, then publish', done: c.publishedSchedule, link: '/schedule' },
      { label: 'Invite staff to sign in', hint: 'They clock in from their phones', done: c.invitedSomeone, link: '/staff' },
    ];
  }
}
