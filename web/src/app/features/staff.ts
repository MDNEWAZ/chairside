import { ChangeDetectionStrategy, Component, ElementRef, OnInit, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Subject, debounceTime } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Api } from '../core/api';
import { day, time, todayIn } from '../core/format';
import { InviteResult, ROLE_LABEL, StaffDetail, StaffInput, WEEKDAYS, Weekday } from '../core/models';
import { Session } from '../core/session';
import { Toasts } from '../core/toast';
import { Confirm } from '../core/confirm';
import { Badge, ErrorState, Loader, Mutation, PageHeader, focusFirstError } from '../shared/ui';
import { ScrollRegion } from '../shared/scroll-region';
import { Avatar, jobClass } from '../shared/brand';
import { Icon } from '../shared/icons';

@Component({
  selector: 'app-staff-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, PageHeader, Badge, ErrorState, Avatar, Icon, ScrollRegion],
  template: `
    <app-page-header eyebrow="Team" title="Staff" subtitle="Everyone at your clinic, with their role, home location and licence status.">
      @if (session.isManager()) { <a routerLink="/staff/new" class="btn btn-primary"><app-icon name="user-plus" [size]="17" />Add staff member</a> }
    </app-page-header>

    <div class="mb-4 flex flex-wrap items-end gap-4">
      <div class="field w-full sm:w-80">
        <label class="label" for="search">Search by name or email</label>
        <input id="search" class="input" type="search" [ngModel]="search()" (ngModelChange)="search.set($event); searches.next()">
      </div>
      @if (session.isManager()) {
        <label class="check"><input type="checkbox" [ngModel]="includeInactive()" (ngModelChange)="includeInactive.set($event); list.load()"> Show deactivated</label>
      }
    </div>

    @if (list.error(); as e) {
      <app-error-state [message]="e.message" (retry)="list.load()" />
    } @else if (list.data(); as rows) {
      @if (rows.length === 0) {
        <p class="card p-5 text-muted">{{ search() ? 'Nobody matches “' + search() + '”.' : 'No staff yet. Add your first team member to start scheduling.' }}</p>
      } @else {
        <div class="table-wrap">
          <table class="table min-w-[40rem]">
            <caption class="sr-only">Staff directory, {{ rows.length }} people</caption>
            <thead><tr><th scope="col">Name</th><th scope="col">Job title</th><th scope="col">Home location</th><th scope="col">Licences</th><th scope="col">Account</th></tr></thead>
            <tbody>
              @for (r of rows; track r.staffId) {
                <tr [class.opacity-70]="!r.isActive">
                  <td>
                    <span class="flex items-center gap-3">
                      <app-avatar [name]="r.name" [job]="r.jobTitle" [size]="34" />
                      <span class="min-w-0">
                        @if (canOpen(r.staffId, r.homeLocationId)) { <a [routerLink]="['/staff', r.staffId]" class="font-semibold text-ink underline-offset-2 hover:text-accent hover:underline">{{ r.name }}</a> }
                        @else { <span class="font-semibold">{{ r.name }}</span> }
                        <span class="block text-xs text-muted">{{ roleLabel[r.role] }}</span>
                      </span>
                    </span>
                  </td>
                  <td [class]="job(r.jobTitle)"><span class="inline-flex items-center gap-1.5"><span class="job-dot"></span>{{ r.jobTitle }}</span></td>
                  <td>{{ r.homeLocation }}</td>
                  <td>@if (r.credentialStatus; as s) { <app-badge [status]="s" [label]="s === 'missing' ? 'Missing' : ''" /> } @else { <span class="text-muted">—</span> }</td>
                  <td>@if (!r.isActive) { <app-badge status="deactivated" /> } @else if (r.hasAccount) { <app-badge status="active" label="Signed up" /> } @else { <app-badge status="draft" label="No account yet" /> }</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    } @else {
      <div class="skeleton h-80"></div>
    }
  `,
})
export class StaffList implements OnInit {
  protected readonly session = inject(Session);
  private readonly api = inject(Api);
  protected readonly search = signal('');
  protected readonly includeInactive = signal(false);
  protected readonly list = new Loader(() => this.api.directory(this.search(), this.includeInactive()));
  protected readonly searches = new Subject<void>();
  protected readonly roleLabel = ROLE_LABEL;
  protected readonly job = jobClass;

  constructor() {
    this.searches.pipe(debounceTime(250), takeUntilDestroyed()).subscribe(() => void this.list.load());
  }

  ngOnInit(): void {
    void this.list.load();
  }

  protected canOpen(staffId: number, homeLocationId: number): boolean {
    return this.session.isOwner() || staffId === this.session.me()?.staffId
      || (this.session.role() === 'practice_manager' && homeLocationId === this.session.me()?.homeLocationId);
  }
}

interface PatternRow { weekday: Weekday; works: boolean; shiftDefinitionId: number; locationId: number }

@Component({
  selector: 'app-staff-edit',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, PageHeader, Badge, ErrorState, Avatar, Icon, ScrollRegion],
  // The browser's own prompt covers closing the tab or reloading with unsaved edits.
  host: { '(window:beforeunload)': 'onBeforeUnload($event)' },
  template: `
    <app-page-header [title]="isNew() ? 'Add staff member' : (detail()?.firstName ?? '') + ' ' + (detail()?.lastName ?? '')"
                     [subtitle]="isNew() ? 'Their work pattern decides which days count when they take leave.' : roleText()">
      <a routerLink="/staff" class="btn">Back to staff</a>
    </app-page-header>

    @if (loadError(); as e) {
      <app-error-state [message]="e" (retry)="load()" />
    } @else if (ready()) {
      @if (detail(); as d) {
        <section class="card enter mb-6 flex flex-wrap items-center gap-4 p-5" aria-label="Summary">
          <app-avatar [name]="d.firstName + ' ' + d.lastName" [job]="jobName(d.jobTitleId)" [size]="64" />
          <div class="min-w-0 flex-1">
            <p class="text-lg font-semibold">{{ d.firstName }} {{ d.lastName }}</p>
            <p class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted" [class]="job(jobName(d.jobTitleId))">
              <span class="inline-flex items-center gap-1.5"><span class="job-dot"></span>{{ jobName(d.jobTitleId) }}</span>
              <span class="inline-flex items-center gap-1"><app-icon name="pin" [size]="14" />{{ session.locationName(d.homeLocationId) }}</span>
              <span class="inline-flex items-center gap-1"><app-icon name="calendar" [size]="14" />Since {{ fmt(d.startDate) }}</span>
            </p>
          </div>
          <div class="flex flex-wrap gap-1.5">
            <app-badge [status]="d.isActive ? 'active' : 'deactivated'" />
            <app-badge [status]="d.hasAccount ? 'valid' : 'draft'" [label]="d.hasAccount ? 'Signed up' : d.invitePending ? 'Invited' : 'No account yet'" />
          </div>
        </section>
      }
      <form class="flex flex-col gap-6" (ngSubmit)="save()" novalidate>
        <fieldset class="card grid gap-4 p-5 sm:grid-cols-2" [disabled]="!editable()">
          <legend class="section-title px-1">Profile</legend>
          <div class="field"><label class="label" for="first">First name</label>
            <input id="first" class="input" name="firstName" [(ngModel)]="form.firstName" autocomplete="off" [attr.aria-invalid]="!!f()['firstName'] || null">
            @if (f()['firstName']; as e) { <p class="field-error">{{ e }}</p> }</div>
          <div class="field"><label class="label" for="last">Last name</label>
            <input id="last" class="input" name="lastName" [(ngModel)]="form.lastName" autocomplete="off" [attr.aria-invalid]="!!f()['lastName'] || null">
            @if (f()['lastName']; as e) { <p class="field-error">{{ e }}</p> }</div>
          <div class="field"><label class="label" for="email">Work email</label>
            <input id="email" class="input" type="email" name="email" maxlength="256" [(ngModel)]="form.email" autocomplete="off" [readonly]="!!detail()?.hasAccount"
                   [attr.aria-invalid]="!!f()['email'] || null" [attr.aria-describedby]="f()['email'] ? 'email-error' : detail()?.hasAccount ? 'email-help' : null">
            @if (f()['email']; as e) { <p id="email-error" class="field-error">{{ e }}</p> }
            @else if (detail()?.hasAccount) { <p id="email-help" class="help">They sign in with this address, so it cannot be changed here.</p> }</div>
          <div class="field"><label class="label" for="phone">Phone (optional)</label>
            <input id="phone" class="input" type="tel" name="phone" [(ngModel)]="form.phone" autocomplete="off" [attr.aria-invalid]="!!f()['phone'] || null">
            @if (f()['phone']; as e) { <p class="field-error">{{ e }}</p> }</div>
          <div class="field"><label class="label" for="job">Job title</label>
            <select id="job" class="input" name="jobTitleId" [(ngModel)]="form.jobTitleId" aria-describedby="job-help" [attr.aria-invalid]="!!f()['jobTitleId'] || null">
              @for (j of jobTitles(); track j.id) { <option [ngValue]="j.id">{{ j.name }}</option> }
            </select>
            <p id="job-help" class="help">The job title sets the role and what they can see.</p>
            @if (f()['jobTitleId']; as e) { <p class="field-error">{{ e }}</p> }</div>
          <div class="field"><label class="label" for="home">Home location</label>
            <select id="home" class="input" name="homeLocationId" [(ngModel)]="form.homeLocationId" [attr.aria-invalid]="!!f()['homeLocationId'] || null">
              @for (l of session.lookups()?.locations ?? []; track l.id) { <option [ngValue]="l.id">{{ l.name }}</option> }
            </select>
            @if (f()['homeLocationId']; as e) { <p class="field-error">{{ e }}</p> }</div>
          <div class="field"><label class="label" for="start">Start date</label>
            <input id="start" class="input" type="date" name="startDate" [(ngModel)]="form.startDate"></div>
          <fieldset class="field"><legend class="label">Employment</legend>
            <div class="flex flex-wrap gap-x-5">
              <label class="check"><input type="radio" name="employmentType" value="full_time" [(ngModel)]="form.employmentType"> Full time</label>
              <label class="check"><input type="radio" name="employmentType" value="part_time" [(ngModel)]="form.employmentType"> Part time</label>
            </div>
            <label class="check"><input type="checkbox" name="overtimeEligible" [(ngModel)]="form.overtimeEligible"> Eligible for overtime (warn above the weekly threshold)</label>
          </fieldset>
        </fieldset>

        <fieldset class="card p-5" [disabled]="!editable()" aria-describedby="pattern-help">
          <legend class="section-title px-1">Work pattern</legend>
          <p id="pattern-help" class="help">Their regular week. Used to fill draft schedules and to count leave days.
            @if (detail()?.patternEffectiveFrom; as from) { Current version since {{ fmt(from) }}; a change starts a new version today. }</p>
          @if (f()['pattern']; as e) { <p class="field-error mt-2">{{ e }}</p> }
          <div class="mt-3 table-wrap">
            <table class="table min-w-[34rem]">
              <caption class="sr-only">Work pattern by weekday</caption>
              <thead><tr><th scope="col">Day</th><th scope="col">Works</th><th scope="col">Shift</th><th scope="col">Location</th></tr></thead>
              <tbody>
                @for (p of pattern; track p.weekday) {
                  <tr>
                    <th scope="row" class="!bg-surface !text-sm !font-medium !normal-case !tracking-normal !text-ink">{{ p.weekday }}</th>
                    <td><label class="check"><input type="checkbox" [name]="'w' + p.weekday" [(ngModel)]="p.works"><span class="sr-only">Works on {{ p.weekday }}</span></label></td>
                    <td><label class="sr-only" [for]="'s' + p.weekday">Shift on {{ p.weekday }}</label>
                      <select class="input" [id]="'s' + p.weekday" [name]="'s' + p.weekday" [(ngModel)]="p.shiftDefinitionId" [disabled]="!p.works || !editable()">
                        @for (d of session.lookups()?.shiftDefinitions ?? []; track d.id) { <option [ngValue]="d.id">{{ d.name }} · {{ t(d.startTime) }}–{{ t(d.endTime) }}</option> }
                      </select></td>
                    <td><label class="sr-only" [for]="'l' + p.weekday">Location on {{ p.weekday }}</label>
                      <select class="input" [id]="'l' + p.weekday" [name]="'l' + p.weekday" [(ngModel)]="p.locationId" [disabled]="!p.works || !editable()">
                        @for (l of session.lookups()?.locations ?? []; track l.id) { <option [ngValue]="l.id">{{ l.name }}</option> }
                      </select></td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </fieldset>

        @if (m.error() && !hasFieldErrors()) { <p class="field-error" role="alert">{{ m.error()!.message }}</p> }
        @if (editable()) {
          <div class="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <button type="submit" class="btn btn-primary" [disabled]="m.busy()">{{ isNew() ? 'Add staff member' : 'Save changes' }}</button>
          </div>
        }
      </form>

      @if (detail(); as d) {
        <section class="card mt-6 p-5" aria-labelledby="cred-title">
          <h2 id="cred-title" class="section-title">Licences and certifications</h2>
          @if (d.credentials.length === 0) { <p class="mt-2 text-muted">None recorded.</p> }
          @else {
            <ul class="mt-3 divide-y divide-line">
              @for (c of d.credentials; track c.credentialId) {
                <li class="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span><span class="font-medium">{{ c.name }}</span>{{ c.required ? '' : ' (not required for this job)' }}
                    <span class="block text-sm text-muted">Expires {{ fmt(c.expiresOn) }}</span></span>
                  <span class="flex items-center gap-2"><app-badge [status]="c.status" />
                    @if (d.canEdit) { <button type="button" class="btn btn-sm btn-quiet" (click)="removeCredential(c.credentialId, c.name)" [disabled]="cm.busy()">Remove<span class="sr-only"> {{ c.name }}</span></button> }</span>
                </li>
              }
            </ul>
          }
          @if (d.canEdit) {
            <form class="mt-4 flex flex-col gap-3 border-t border-line pt-4 sm:flex-row sm:items-end" (ngSubmit)="addCredential()" novalidate>
              <div class="field flex-1"><label class="label" for="ctype">Credential</label>
                <select id="ctype" class="input" name="ctype" [(ngModel)]="newCredType">
                  @for (t of session.lookups()?.credentialTypes ?? []; track t.id) { <option [ngValue]="t.id">{{ t.name }}{{ t.blocksScheduling ? ' (blocks scheduling when expired)' : '' }}</option> }
                </select></div>
              <div class="field"><label class="label" for="cexp">Expires on</label>
                <input id="cexp" class="input" type="date" name="cexp" [(ngModel)]="newCredExpiry" [attr.aria-invalid]="!!cm.fields()['expiresOn'] || null" [attr.aria-describedby]="cm.error() ? 'cred-error' : null"></div>
              <button type="submit" class="btn" [disabled]="cm.busy()">Add credential</button>
            </form>
            @if (cm.error(); as e) { <p id="cred-error" class="field-error mt-2" role="alert">{{ cm.fields()['expiresOn'] || cm.fields()['credentialTypeId'] || e.message }}</p> }
          }
        </section>

        @if (d.canInvite || d.canEdit) {
          <section class="card mt-6 p-5" aria-labelledby="acct-title">
            <h2 id="acct-title" class="section-title">Account</h2>
            <p class="mt-2 text-sm">
              @if (d.hasAccount) { Signed up and can sign in. }
              @else if (d.invitePending) { Invitation sent and waiting. }
              @else { No account yet. They cannot sign in until invited. }
            </p>
            @if (invite(); as i) {
              <div class="alert alert-ok mt-3" role="status"><span aria-hidden="true">✓</span>
                <div class="min-w-0"><p>Invitation link (valid 7 days, works only for {{ d.email }}):</p><p class="reading mt-1 break-all">{{ origin + i.acceptUrlPath }}</p>
                  <button type="button" class="btn btn-sm mt-2" (click)="copyInvite(origin + i.acceptUrlPath)"><app-icon name="copy" [size]="15" />Copy link</button>
                  <p class="mt-2">{{ i.note }}</p></div>
              </div>
            }
            <div class="mt-3 flex flex-wrap gap-2">
              @if (d.canInvite) { <button type="button" class="btn" (click)="sendInvite()" [disabled]="am.busy()">{{ d.invitePending ? 'Send a new invitation' : 'Invite to sign in' }}</button> }
              @if (d.canEdit && d.staffId !== session.me()?.staffId) {
                <button type="button" class="btn" [class.btn-danger]="d.isActive" (click)="toggleActive(d)" [disabled]="am.busy()">{{ d.isActive ? 'Deactivate' : 'Reactivate' }}</button>
              }
            </div>
            @if (am.error(); as e) { <p class="field-error mt-2" role="alert">{{ e.message }}</p> }
            @if (d.canEdit) { <p class="help mt-2">Deactivating keeps all of their history. They can no longer sign in or be scheduled.</p> }
          </section>
        }
      }
    } @else {
      <div class="skeleton h-96"></div>
    }
  `,
})
export class StaffEdit {
  readonly id = input<string>();
  protected readonly session = inject(Session);
  private readonly api = inject(Api);
  private readonly router = inject(Router);
  private readonly toasts = inject(Toasts);
  private readonly host = inject(ElementRef<HTMLElement>);

  protected readonly detail = signal<StaffDetail | null>(null);
  protected readonly loadError = signal<string | null>(null);
  protected readonly ready = signal(false);
  protected readonly invite = signal<InviteResult | null>(null);
  protected readonly m = new Mutation();
  protected readonly cm = new Mutation();
  protected readonly am = new Mutation();
  protected readonly f = this.m.fields;
  protected readonly t = time;
  protected readonly origin = location.origin;
  protected readonly job = jobClass;
  protected jobName(id: number): string {
    return this.session.lookups()?.jobTitles.find((j) => j.id === id)?.name ?? "";
  }
  protected readonly isNew = computed(() => !this.id() || this.id() === 'new');
  protected readonly editable = computed(() => this.isNew() ? this.session.isManager() : !!this.detail()?.canEdit);
  protected readonly jobTitles = computed(() =>
    (this.session.lookups()?.jobTitles ?? []).filter((j) => this.session.isOwner() || j.role === 'clinical_staff' || j.role === 'reception'));
  protected readonly roleText = computed(() => {
    const d = this.detail();
    return d ? `${ROLE_LABEL[d.role]} · ${this.session.locationName(d.homeLocationId)}${d.isActive ? '' : ' · Deactivated'}` : '';
  });

  protected form: StaffInput = this.blank();
  protected pattern: PatternRow[] = [];
  protected newCredType = 0;
  protected newCredExpiry = '';

  constructor() {
    // The router reuses this component from /staff/new to /staff/:id, so reload whenever the id changes.
    effect(() => {
      this.id();
      untracked(() => void this.load());
    });
  }

  protected async load(): Promise<void> {
    this.loadError.set(null);
    this.ready.set(false);
    this.invite.set(null);
    this.detail.set(null);
    this.m.reset();
    this.newCredType = this.session.lookups()?.credentialTypes[0]?.id ?? 0;
    if (this.isNew()) {
      this.form = this.blank();
      this.pattern = this.patternFrom([]);
      this.saved = this.snapshot();
      this.ready.set(true);
      return;
    }
    const loader = new Loader(() => this.api.staff(Number(this.id())));
    await loader.load();
    if (loader.error()) {
      this.loadError.set(loader.error()!.message);
      return;
    }
    this.applyDetail(loader.data()!);
    this.ready.set(true);
  }

  protected fmt(d: string): string {
    return day(d, true);
  }

  protected hasFieldErrors(): boolean {
    return Object.keys(this.f()).length > 0;
  }

  protected async save(): Promise<void> {
    const body: StaffInput = {
      ...this.form,
      phone: this.form.phone || null,
      pattern: this.pattern.filter((p) => p.works).map(({ weekday, shiftDefinitionId, locationId }) => ({ weekday, shiftDefinitionId, locationId })),
    };
    const saved = await this.m.run(() => (this.isNew() ? this.api.createStaff(body) : this.api.updateStaff(Number(this.id()), body)));
    if (!saved) {
      focusFirstError(this.host.nativeElement);
      return;
    }
    this.toasts.show(this.isNew() ? `${saved.firstName} ${saved.lastName} added.` : 'Changes saved.');
    this.saved = this.snapshot();
    if (this.isNew()) await this.router.navigate(['/staff', saved.staffId]);
    else this.applyDetail(saved);
  }

  protected async addCredential(): Promise<void> {
    const d = await this.cm.run(() => this.api.addCredential(this.detail()!.staffId, this.newCredType, this.newCredExpiry));
    if (d) {
      this.detail.set(d);
      this.newCredExpiry = '';
      this.toasts.show('Credential added.');
    } else {
      focusFirstError(this.host.nativeElement);
    }
  }

  private readonly confirm = inject(Confirm);
  private saved = '';

  /** True when the form differs from what was last loaded or saved. */
  hasUnsavedChanges(): boolean {
    return this.ready() && this.editable() && this.snapshot() !== this.saved;
  }

  protected onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.hasUnsavedChanges()) event.preventDefault();
  }

  /** Route guard hook: asks before leaving with unsaved edits. */
  async canLeave(): Promise<boolean> {
    if (!this.hasUnsavedChanges()) return true;
    const answer = await this.confirm.ask({
      title: 'Leave without saving?', body: 'Your changes to this person are not saved yet.', confirmLabel: 'Discard changes', danger: true,
    });
    return answer.confirmed;
  }

  private snapshot(): string {
    return JSON.stringify([this.form, this.pattern]);
  }

  protected async copyInvite(link: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(link);
      this.toasts.show('Link copied. Send it to them directly.');
    } catch {
      this.toasts.show('Could not copy. Select the link and copy it instead.', 'block');
    }
  }

  protected async removeCredential(credentialId: number, name: string): Promise<void> {
    const answer = await this.confirm.ask({
      title: `Remove ${name}?`, body: 'If it is required for their job, their shifts may be blocked from publishing until a new one is added.',
      confirmLabel: 'Remove credential', danger: true,
    });
    if (!answer.confirmed) return;
    const d = await this.cm.run(() => this.api.deleteCredential(this.detail()!.staffId, credentialId));
    if (d) {
      this.detail.set(d);
      this.toasts.show('Credential removed.', 'neutral');
    }
  }

  protected async sendInvite(): Promise<void> {
    const r = await this.am.run(() => this.api.invite(this.detail()!.staffId));
    if (r) {
      this.invite.set(r);
      this.detail.update((d) => (d ? { ...d, invitePending: true } : d));
    }
  }

  protected async toggleActive(d: StaffDetail): Promise<void> {
    if (d.isActive) {
      const answer = await this.confirm.ask({
        title: `Deactivate ${d.firstName} ${d.lastName}?`,
        body: 'Their history is kept. These happen straight away:',
        details: ['Signed out everywhere and can no longer sign in', 'Future shifts are removed from the schedule', 'Pending leave requests are closed', 'Any open invitation stops working'],
        confirmLabel: 'Deactivate', danger: true,
      });
      if (!answer.confirmed) return;
    }
    const updated = await this.am.run(() => this.api.setActive(d.staffId, !d.isActive));
    if (updated) {
      this.applyDetail(updated);
      this.toasts.show(updated.isActive ? 'Reactivated.' : 'Deactivated. Their history is kept.', 'neutral');
    }
  }

  private applyDetail(d: StaffDetail): void {
    this.detail.set(d);
    this.form = {
      firstName: d.firstName, lastName: d.lastName, email: d.email, phone: d.phone, jobTitleId: d.jobTitleId, homeLocationId: d.homeLocationId,
      startDate: d.startDate, overtimeEligible: d.overtimeEligible, employmentType: d.employmentType, pattern: d.pattern,
    };
    this.pattern = this.patternFrom(d.pattern);
    this.saved = this.snapshot();
  }

  private patternFrom(days: StaffDetail['pattern']): PatternRow[] {
    const defaultDef = this.session.defaultShiftDefinition()?.id ?? 0;
    const defaultLoc = this.form.homeLocationId || (this.session.me()?.homeLocationId ?? 0);
    return WEEKDAYS.map((weekday) => {
      const existing = days.find((d) => d.weekday === weekday);
      // A new person starts with a Monday-to-Friday pattern, the most common case; managers adjust it.
      const works = existing ? true : this.isNew() && weekday !== 'Saturday' && weekday !== 'Sunday';
      return { weekday, works, shiftDefinitionId: existing?.shiftDefinitionId ?? defaultDef, locationId: existing?.locationId ?? defaultLoc };
    });
  }

  private blank(): StaffInput {
    const titles = this.session.lookups()?.jobTitles ?? [];
    return {
      firstName: '', lastName: '', email: '', phone: null,
      jobTitleId: titles.find((j) => j.name === 'Dental assistant')?.id ?? titles[0]?.id ?? 0,
      homeLocationId: this.session.me()?.homeLocationId ?? 0, startDate: todayIn(this.session.timeZone()),
      overtimeEligible: true, employmentType: 'full_time', pattern: [],
    };
  }
}
