import { ChangeDetectionStrategy, Component, ElementRef, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subject, debounceTime, firstValueFrom } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Api, toApiError } from '../core/api';
import { addDays, day, todayIn } from '../core/format';
import { InboxItem, Leave as LeaveRecord, LeaveBalance, LeaveDraft } from '../core/models';
import { Session } from '../core/session';
import { Toasts } from '../core/toast';
import { Confirm } from '../core/confirm';
import { TabList } from '../shared/tablist';
import { Badge, ErrorState, Loader, Mutation, PageHeader, focusFirstError } from '../shared/ui';
import { Avatar, jobClass } from '../shared/brand';
import { Icon, IconName } from '../shared/icons';

/** Hero screen "Leave request and inbox": request with a live day count, status list, and the manager inbox with staffing impact. */
@Component({
  selector: 'app-leave',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, PageHeader, Badge, ErrorState, Avatar, Icon, TabList],
  template: `
    <app-page-header eyebrow="Time off" title="Leave" subtitle="Request time off and see where your requests stand." />

    @if (session.isManager()) {
      <div class="mb-5 flex gap-1 border-b border-line" role="tablist" aria-label="Leave views">
        <button type="button" role="tab" id="tab-mine" aria-controls="panel-mine" [attr.aria-selected]="tab() === 'mine'" class="min-h-11 border-b-2 px-4 text-sm font-medium"
                [class]="tab() === 'mine' ? 'border-accent text-accent' : 'border-transparent text-muted'" (click)="tab.set('mine')">My leave</button>
        <button type="button" role="tab" id="tab-inbox" aria-controls="panel-inbox" [attr.aria-selected]="tab() === 'inbox'" class="min-h-11 border-b-2 px-4 text-sm font-medium"
                [class]="tab() === 'inbox' ? 'border-accent text-accent' : 'border-transparent text-muted'" (click)="openInbox()">
          Requests to decide @if (inbox.data(); as i) { <span class="reading">({{ i.length }})</span> }
        </button>
      </div>
    }

    @if (tab() === 'mine') {
      <div id="panel-mine" role="tabpanel" aria-labelledby="tab-mine" class="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <section class="card p-5" aria-labelledby="req-title">
          <h2 id="req-title" class="section-title">Request leave</h2>
          <form class="mt-4 flex flex-col gap-4" (ngSubmit)="submit()" novalidate>
            <div class="grid grid-cols-2 gap-3">
              <div class="field">
                <label class="label" for="start">First day</label>
                <input id="start" class="input" type="date" name="startDate" [(ngModel)]="draft.startDate" (ngModelChange)="onDraftChange(true)"
                       [attr.aria-invalid]="!!m.fields()['startDate'] || null" [attr.aria-describedby]="m.fields()['startDate'] ? 'start-error' : null">
              </div>
              <div class="field">
                <label class="label" for="end">Last day</label>
                <input id="end" class="input" type="date" name="endDate" [(ngModel)]="draft.endDate" (ngModelChange)="onDraftChange()" [min]="draft.startDate"
                       [attr.aria-invalid]="!!m.fields()['endDate'] || null" [attr.aria-describedby]="m.fields()['endDate'] ? 'end-error' : null">
              </div>
            </div>
            @if (m.fields()['startDate']; as e) { <p id="start-error" class="field-error -mt-2">{{ e }}</p> }
            @if (m.fields()['endDate']; as e) { <p id="end-error" class="field-error -mt-2">{{ e }}</p> }
            <div class="flex flex-wrap gap-x-5">
              <label class="check"><input type="checkbox" name="firstDayHalf" [(ngModel)]="draft.firstDayHalf" (ngModelChange)="onDraftChange()"> First day is a half day</label>
              @if (draft.endDate !== draft.startDate) {
                <label class="check"><input type="checkbox" name="lastDayHalf" [(ngModel)]="draft.lastDayHalf" (ngModelChange)="onDraftChange()"> Last day is a half day</label>
              }
            </div>
            @if (m.fields()['lastDayHalf']; as e) { <p class="field-error -mt-2">{{ e }}</p> }
            <fieldset class="field">
              <legend class="label mb-1.5">Type</legend>
              <div class="segmented">
                @for (t of types; track t.value) {
                  <label><input type="radio" name="leaveType" [value]="t.value" [(ngModel)]="draft.leaveType" (ngModelChange)="onDraftChange()" /><app-icon [name]="t.icon" [size]="15" />{{ t.label }}</label>
                }
              </div>
            </fieldset>
            <div class="field">
              <label class="label" for="note">Note for your manager (optional)</label>
              <textarea id="note" class="input" rows="2" maxlength="500" name="note" [(ngModel)]="draft.note"></textarea>
            </div>

            <div class="rounded-card border border-line bg-raised p-4 text-sm" aria-live="polite">
              @if (preview(); as p) {
                <div class="flex items-center gap-4">
                  <span class="text-center"><span class="display-number block text-4xl leading-none text-accent">{{ p.days }}</span><span class="text-[11px] uppercase text-muted">day{{ p.days === 1 ? '' : 's' }}</span></span>
                  <div>
                    <p class="font-medium">Working days counted</p>
                    <p class="text-muted">Closed days and your days off are not counted.</p>
                  </div>
                </div>
                @if (draft.leaveType === 'annual') {
                  <div class="mt-3 border-t border-line pt-3">
                    <div class="flex justify-between text-xs text-muted"><span>Left for {{ p.balance.year }} after this{{ p.balance.pending ? ' and your pending requests' : '' }}</span><span class="reading font-semibold" [class.text-block]="after(p) < 0" [class.text-ink]="after(p) >= 0">{{ after(p) }} of {{ p.balance.allowance }}</span></div>
                    <span class="mt-1.5 flex h-2 overflow-hidden rounded-full bg-line" aria-hidden="true">
                      <span class="h-full bg-accent" [style.width.%]="pct(after(p), p.balance.allowance)"></span>
                      <span class="h-full" style="background-image: var(--c-draft); background-color: var(--c-accent-soft)" [style.width.%]="pct(p.days, p.balance.allowance)"></span>
                    </span>
                    @if (after(p) < 0) { <p class="mt-2 text-sm text-block">This is more annual leave than you have left. Shorten the dates or choose another type.</p> }
                  </div>
                }
              } @else if (previewError()) {
                <p class="text-block">{{ previewError() }}</p>
              } @else {
                <p class="text-muted">Choose dates to see how many days are counted.</p>
              }
            </div>
            @if (m.error() && !hasFieldErrors()) { <p class="field-error" role="alert">{{ m.error()!.message }}</p> }
            <button type="submit" class="btn btn-primary w-full sm:w-auto sm:self-end" [disabled]="m.busy()">{{ m.busy() ? 'Sending' : 'Request leave' }}</button>
          </form>
        </section>

        <section aria-labelledby="mine-title">
          @if (mine.data(); as d) {
            <div class="card enter mb-5 flex items-center gap-5 p-4">
              <div class="relative h-24 w-24 shrink-0" aria-hidden="true">
                <svg viewBox="0 0 96 96" class="-rotate-90">
                  <circle cx="48" cy="48" r="40" fill="none" stroke="var(--c-line)" stroke-width="9" />
                  <circle cx="48" cy="48" r="40" fill="none" stroke="var(--c-warn)" stroke-width="9" [attr.stroke-dasharray]="ring" [attr.stroke-dashoffset]="ring * (1 - (d.balance.used + d.balance.pending) / max(d.balance.allowance))" />
                  <circle cx="48" cy="48" r="40" fill="none" stroke="var(--c-accent)" stroke-width="9" [attr.stroke-dasharray]="ring" [attr.stroke-dashoffset]="ring * (1 - d.balance.used / max(d.balance.allowance))" />
                </svg>
                <span class="absolute inset-0 grid place-items-center text-center leading-none"><span><span class="display-number block text-2xl">{{ d.balance.remaining }}</span><span class="text-[10px] uppercase text-muted">left</span></span></span>
              </div>
              <dl class="grid flex-1 grid-cols-3 gap-2 text-sm">
                <div><dt class="text-xs text-muted">Allowance {{ d.balance.year }}</dt><dd class="display-number text-xl">{{ d.balance.allowance }}</dd></div>
                <div><dt class="flex items-center gap-1 text-xs text-muted"><span class="h-2 w-2 rounded-full bg-accent"></span>Used</dt><dd class="display-number text-xl">{{ d.balance.used }}</dd></div>
                <div><dt class="flex items-center gap-1 text-xs text-muted"><span class="h-2 w-2 rounded-full" style="background: var(--c-warn)"></span>Pending</dt><dd class="display-number text-xl">{{ d.balance.pending }}</dd></div>
              </dl>
            </div>
          }
          <h2 id="mine-title" class="section-title">My requests</h2>
          @if (mine.error(); as e) {
            <div class="mt-3"><app-error-state [message]="e.message" (retry)="mine.load()" /></div>
          } @else if (mine.data(); as d) {
            @if (d.requests.length === 0) {
              <p class="card mt-3 p-5 text-muted">No requests yet. Use the form to ask for time off; your manager is notified straight away.</p>
            } @else {
              <ul class="mt-3 space-y-2">
                @for (r of d.requests; track r.leaveRequestId) {
                  <li class="card card-hover flex gap-4 p-4">
                    <span class="grid w-14 shrink-0 place-items-center self-start rounded-control bg-raised py-1.5 text-center">
                      <span class="text-[11px] font-semibold uppercase text-muted">{{ monthOf(r.startDate) }}</span>
                      <span class="display-number text-2xl leading-none">{{ +r.startDate.slice(8) }}</span>
                    </span>
                    <div class="min-w-0 flex-1">
                      <div class="flex flex-wrap items-center justify-between gap-2">
                        <p class="font-semibold">{{ range(r) }}</p>
                        <app-badge [status]="r.status" />
                      </div>
                      <p class="mt-0.5 text-sm text-muted">{{ typeLabel(r.leaveType) }} · <span class="reading">{{ r.daysCounted }}</span> day{{ r.daysCounted === 1 ? '' : 's' }}</p>
                      @if (r.decidedBy) { <p class="mt-1.5 rounded-control bg-raised px-2.5 py-1.5 text-sm">{{ r.decidedBy }}{{ r.decisionComment ? ': “' + r.decisionComment + '”' : ' decided this.' }}</p> }
                      @if (r.status === 'pending') {
                        <button type="button" class="btn btn-ghost btn-sm mt-2 -ml-2" [disabled]="w.busy()" (click)="withdraw(r)">Withdraw request<span class="sr-only"> for {{ range(r) }}</span></button>
                      }
                    </div>
                  </li>
                }
              </ul>
            }
          } @else {
            <div class="mt-3 space-y-2">@for (i of [1, 2]; track i) { <div class="skeleton h-20"></div> }</div>
          }
        </section>
      </div>
    } @else {
      <section id="panel-inbox" role="tabpanel" aria-labelledby="tab-inbox">
        @if (inbox.error(); as e) {
          <app-error-state [message]="e.message" (retry)="inbox.load()" />
        } @else if (inbox.data(); as items) {
          @if (items.length === 0) {
            <p class="card p-5 text-muted">No requests waiting. New requests appear here and in your notifications.</p>
          } @else {
            <ul class="space-y-3">
              @for (item of items; track item.request.leaveRequestId) {
                <li class="card p-5">
                  <div class="flex flex-wrap items-start justify-between gap-3">
                    <div class="flex items-center gap-3" [class]="job(item.jobTitle)">
                      <app-avatar [name]="item.request.staffName" [job]="item.jobTitle" [size]="42" />
                      <div>
                        <h2 class="section-title">{{ item.request.staffName }}</h2>
                        <p class="flex items-center gap-1 text-sm text-muted"><span class="job-dot"></span>{{ item.jobTitle }} · {{ item.homeLocation }}</p>
                      </div>
                    </div>
                    <app-badge status="pending" />
                  </div>
                  <p class="mt-3">{{ range(item.request) }} · {{ typeLabel(item.request.leaveType) }} · <span class="reading">{{ item.request.daysCounted }}</span> day{{ item.request.daysCounted === 1 ? '' : 's' }}</p>
                  @if (item.request.note) { <p class="mt-1 text-sm">“{{ item.request.note }}”</p> }

                  @if (item.impact.length) {
                    <div class="alert alert-warn mt-3" role="note"><span aria-hidden="true">!</span>
                      <div><p class="font-medium">Approving leaves the location short-staffed</p>
                        <ul class="mt-1 list-disc pl-5">
                          @for (i of item.impact; track i.date) { <li>{{ fmtDay(i.date) }} at {{ i.location }}: {{ i.remainingAfter }} of {{ i.minimum }} {{ i.jobTitle }}</li> }
                        </ul></div>
                    </div>
                  } @else {
                    <p class="mt-3 text-sm text-ok"><span aria-hidden="true">✓ </span>Minimum staffing still met on these days.</p>
                  }
                  @if (item.overlapping.length) {
                    <p class="mt-2 text-sm">Also off at this location: @for (o of item.overlapping; track o.leaveRequestId; let last = $last) {{{ o.staffName }} ({{ range(o) }}, {{ o.status }}){{ last ? '' : '; ' }}}</p>
                  }

                  <div class="mt-4 flex flex-col gap-3 border-t border-line pt-4 sm:flex-row sm:items-end">
                    <div class="field flex-1">
                      <label class="label" [for]="'c' + item.request.leaveRequestId">Comment <span class="font-normal text-muted">(needed to reject)</span></label>
                      <input class="input" [id]="'c' + item.request.leaveRequestId" maxlength="500" [(ngModel)]="comments[item.request.leaveRequestId]" [name]="'c' + item.request.leaveRequestId">
                    </div>
                    <div class="flex gap-2">
                      <button type="button" class="btn btn-danger flex-1" [disabled]="d.busy()" (click)="decide(item, false)">Reject</button>
                      <button type="button" class="btn btn-primary flex-1" [disabled]="d.busy()" (click)="decide(item, true)">Approve</button>
                    </div>
                  </div>
                </li>
              }
            </ul>
          }
        } @else {
          <div class="space-y-3">@for (i of [1, 2]; track i) { <div class="skeleton h-40"></div> }</div>
        }
      </section>
    }
  `,
})
export class Leave implements OnInit {
  protected readonly session = inject(Session);
  private readonly api = inject(Api);
  private readonly toasts = inject(Toasts);
  private readonly host = inject(ElementRef<HTMLElement>);
  protected readonly mine = new Loader(() => this.api.myLeave());
  protected readonly inbox = new Loader(() => this.api.inbox());
  protected readonly m = new Mutation();
  protected readonly d = new Mutation();
  protected readonly w = new Mutation();
  private readonly confirm = inject(Confirm);
  protected readonly tab = signal<'mine' | 'inbox'>('mine');
  protected readonly preview = signal<{ days: number; balance: LeaveBalance } | null>(null);
  protected readonly previewError = signal<string | null>(null);
  protected readonly comments: Record<number, string> = {};
  protected readonly types: { value: 'annual' | 'sick' | 'other'; label: string; icon: IconName }[] = [
    { value: 'annual', label: 'Annual', icon: 'leave' }, { value: 'sick', label: 'Sick', icon: 'clinical' }, { value: 'other', label: 'Other', icon: 'more' },
  ];
  protected readonly job = jobClass;
  protected readonly ring = 2 * Math.PI * 40;
  protected readonly max = (n: number) => Math.max(1, n);
  protected draft: LeaveDraft = this.blankDraft();
  private readonly previewRequests = new Subject<void>();

  constructor() {
    this.previewRequests.pipe(debounceTime(250), takeUntilDestroyed()).subscribe(() => void this.runPreview());
  }

  async ngOnInit(): Promise<void> {
    await this.mine.load();
    if (this.session.isManager()) void this.inbox.load();
    this.previewRequests.next();
  }

  protected openInbox(): void {
    this.tab.set('inbox');
    void this.inbox.load();
  }

  protected onDraftChange(startChanged = false): void {
    if (startChanged && this.draft.endDate < this.draft.startDate) this.draft.endDate = this.draft.startDate;
    if (this.draft.startDate === this.draft.endDate) this.draft.lastDayHalf = false;
    this.m.reset();
    this.previewRequests.next();
  }

  protected hasFieldErrors(): boolean {
    return Object.keys(this.m.fields()).length > 0;
  }

  protected async submit(): Promise<void> {
    const result = await this.m.run(() => this.api.requestLeave(this.draft));
    if (!result) {
      focusFirstError(this.host.nativeElement);
      return;
    }
    this.mine.data.set(result);
    const latest = result.requests[0];
    this.toasts.show(latest?.status === 'approved' ? 'Leave recorded as approved.' : 'Request sent. Your manager has been notified.');
    this.draft = this.blankDraft();
    this.previewRequests.next();
  }

  protected after(p: { days: number; balance: LeaveBalance }): number {
    return p.balance.remaining - p.balance.pending - p.days;
  }

  protected async withdraw(r: LeaveRecord): Promise<void> {
    const answer = await this.confirm.ask({
      title: 'Withdraw this request?', body: `Your request for ${this.range(r)} is removed and your manager no longer sees it.`,
      confirmLabel: 'Withdraw request', danger: true,
    });
    if (!answer.confirmed) return;
    const result = await this.w.run(() => this.api.cancelLeave(r.leaveRequestId));
    if (!result) {
      this.toasts.show(this.w.error()?.message ?? 'Could not withdraw the request.', 'block');
      void this.mine.load();
      return;
    }
    this.mine.data.set(result);
    this.previewRequests.next();
    this.toasts.show('Request withdrawn.');
  }

  protected async decide(item: InboxItem, approve: boolean): Promise<void> {
    const id = item.request.leaveRequestId;
    const who = item.request.staffName;
    let comment = (this.comments[id] ?? '').trim();
    if (!approve) {
      // A rejection always says why, so the person is not left guessing.
      const answer = await this.confirm.ask({
        title: `Reject leave for ${who}?`, body: `${this.range(item.request)}. They are notified with your reason.`,
        confirmLabel: 'Reject request', danger: true,
        input: { label: 'Reason', required: true, maxLength: 500, help: 'For example: two others are already off that week.', value: comment },
      });
      if (!answer.confirmed) return;
      comment = answer.text.trim();
    } else if (item.impact.length) {
      const answer = await this.confirm.ask({
        title: `Approve and leave the location short?`, body: `Approving ${who}'s leave drops staffing below the minimum on these days:`,
        confirmLabel: 'Approve anyway', details: item.impact.map((i) => `${day(i.date)} at ${i.location}: ${i.remainingAfter} of ${i.minimum} ${i.jobTitle}`),
      });
      if (!answer.confirmed) return;
    }
    const result = await this.d.run(() => this.api.decide(id, approve, comment || null));
    if (!result) {
      this.toasts.show(this.d.error()?.fields['comment'] ?? this.d.error()?.message ?? 'Could not save the decision.', 'block');
      if (this.d.error()?.status === 409 || this.d.error()?.status === 404) void this.inbox.load();
      return;
    }
    this.inbox.data.set(result);
    this.toasts.show(`${approve ? 'Approved' : 'Rejected'} leave for ${item.request.staffName}. They have been notified.`);
  }

  protected range(r: LeaveRecord): string {
    const first = day(r.startDate) + (r.firstDayHalf ? ' (half)' : '');
    return r.startDate === r.endDate ? first : `${first} – ${day(r.endDate)}${r.lastDayHalf ? ' (half)' : ''}`;
  }

  protected pct(part: number, whole: number): number {
    return Math.max(0, Math.min(100, (part / Math.max(1, whole)) * 100));
  }

  protected monthOf(d: string): string {
    return new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' }).format(new Date(d + 'T00:00:00Z'));
  }

  protected fmtDay(d: string): string {
    return day(d);
  }

  protected typeLabel(t: string): string {
    return { annual: 'Annual leave', sick: 'Sick leave', other: 'Other leave' }[t] ?? 'Leave';
  }

  private async runPreview(): Promise<void> {
    try {
      const p = await firstValueFrom(this.api.previewLeave(this.draft));
      this.preview.set({ days: p.daysCounted, balance: p.balance });
      this.previewError.set(null);
    } catch (e) {
      this.preview.set(null);
      this.previewError.set(Object.values(toApiError(e).fields)[0] ?? toApiError(e).message);
    }
  }

  private blankDraft(): LeaveDraft {
    const start = addDays(todayIn(this.session.timeZone()), 7);
    return { startDate: start, endDate: start, firstDayHalf: false, lastDayHalf: false, leaveType: 'annual', note: null };
  }
}
