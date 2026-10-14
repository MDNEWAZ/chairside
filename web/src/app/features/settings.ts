import { ChangeDetectionStrategy, Component, ElementRef, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { Api, toApiError } from '../core/api';
import { day } from '../core/format';
import { ClinicSettings, Coverage, WEEKDAYS, Weekday } from '../core/models';
import { Session } from '../core/session';
import { Toasts } from '../core/toast';
import { Badge, ErrorState, Loader, Mutation, PageHeader, focusFirstError } from '../shared/ui';
import { ScrollRegion } from '../shared/scroll-region';
import { Icon } from '../shared/icons';

const ZONES = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix', 'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu'];

/** Owner / Admin only: clinic policies, coverage rules, closed days, locations, plan (simulated billing), and data export. */
@Component({
  selector: 'app-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, PageHeader, Badge, ErrorState, Icon, ScrollRegion],
  template: `
    <app-page-header eyebrow="Owner / Admin" title="Settings" subtitle="Clinic policies. Every change is written to the audit log." />

    <div class="flex flex-col gap-6">
      <section class="card p-5" aria-labelledby="pol-title">
        <h2 id="pol-title" class="section-title flex items-center gap-2"><span class="grid h-8 w-8 place-items-center rounded-full bg-accent-soft text-accent"><app-icon name="settings" [size]="16" /></span>Clinic and policies</h2>
        @if (settings.error(); as e) { <div class="mt-3"><app-error-state [message]="e.message" (retry)="settings.load()" /></div> }
        @else if (s(); as v) {
          <form class="mt-4 grid gap-4 sm:grid-cols-2" (ngSubmit)="saveSettings()" novalidate>
            <div class="field sm:col-span-2"><label class="label" for="name">Practice name</label>
              <input id="name" class="input" name="name" [(ngModel)]="v.name" [attr.aria-invalid]="!!sm.fields()['name'] || null">
              @if (sm.fields()['name']; as e) { <p class="field-error">{{ e }}</p> }</div>
            <div class="field"><label class="label" for="tz">Time zone</label>
              <select id="tz" class="input" name="tz" [(ngModel)]="v.timeZoneId">@for (z of zones; track z) { <option [value]="z">{{ z }}</option> }</select></div>
            <div class="field"><label class="label" for="wk">Workweek starts on</label>
              <select id="wk" class="input" name="wk" [(ngModel)]="v.workweekStart">@for (d of weekdays; track d) { <option [value]="d">{{ d }}</option> }</select></div>
            <div class="field"><label class="label" for="ot">Weekly overtime threshold (hours)</label>
              <input id="ot" class="input" type="number" min="1" max="80" name="ot" [(ngModel)]="v.overtimeThresholdHours" [attr.aria-invalid]="!!sm.fields()['overtimeThresholdHours'] || null">
              @if (sm.fields()['overtimeThresholdHours']; as e) { <p class="field-error">{{ e }}</p> }</div>
            <div class="field"><label class="label" for="br">Default unpaid break (minutes)</label>
              <input id="br" class="input" type="number" min="0" max="120" name="br" [(ngModel)]="v.defaultBreakMinutes" [attr.aria-invalid]="!!sm.fields()['defaultBreakMinutes'] || null">
              @if (sm.fields()['defaultBreakMinutes']; as e) { <p class="field-error">{{ e }}</p> }</div>
            <div class="field"><label class="label" for="la">Yearly leave allowance (days)</label>
              <input id="la" class="input" type="number" min="0" max="60" step="0.5" name="la" [(ngModel)]="v.leaveAllowanceDays" aria-describedby="la-help" [attr.aria-invalid]="!!sm.fields()['leaveAllowanceDays'] || null">
              <p id="la-help" class="help">Counts annual leave in the calendar year. Sick and other leave are recorded but not deducted.</p>
              @if (sm.fields()['leaveAllowanceDays']; as e) { <p class="field-error">{{ e }}</p> }</div>
            @if (sm.error() && !hasErrors(sm)) { <p class="field-error sm:col-span-2" role="alert">{{ sm.error()!.message }}</p> }
            <div class="flex items-end justify-end sm:col-span-2"><button type="submit" class="btn btn-primary" [disabled]="sm.busy()">Save policies</button></div>
          </form>
        } @else { <div class="skeleton mt-3 h-48"></div> }
      </section>

      <section class="card p-5" aria-labelledby="cov-title">
        <div class="flex flex-wrap items-end justify-between gap-3">
          <div><h2 id="cov-title" class="section-title flex items-center gap-2"><span class="grid h-8 w-8 place-items-center rounded-full bg-accent-soft text-accent"><app-icon name="users" [size]="16" /></span>Minimum staffing</h2>
            <p class="help">The schedule warns when a day falls below these numbers. Closed days are skipped.</p></div>
          <div class="field"><label class="label" for="covloc">Location</label>
            <select id="covloc" class="input w-auto" [ngModel]="coverageLocation()" (ngModelChange)="coverageLocation.set($event); loadCoverage()">
              @for (l of session.lookups()?.locations ?? []; track l.id) { <option [ngValue]="l.id">{{ l.name }}</option> }
            </select></div>
        </div>
        @if (coverage(); as c) {
          <form (ngSubmit)="saveCoverage()" novalidate>
            <div class="table-wrap mt-3">
              <table class="table min-w-[40rem]">
                <caption class="sr-only">Minimum headcount by job title and weekday</caption>
                <thead><tr><th scope="col">Job title</th>@for (d of weekdays; track d) { <th scope="col">{{ d.slice(0, 3) }}</th> }</tr></thead>
                <tbody>
                  @for (j of coverageTitles(); track j.id) {
                    <tr>
                      <th scope="row" class="!bg-surface !text-sm !font-medium !normal-case !tracking-normal !text-ink">{{ j.name }}</th>
                      @for (d of weekdays; track d) {
                        <td class="!p-1"><label class="sr-only" [for]="'cv' + j.id + d">{{ j.name }} on {{ d }}</label>
                          <input class="input reading !min-h-9 w-16 text-center" type="number" min="0" max="20" [id]="'cv' + j.id + d" [name]="'cv' + j.id + d"
                                 [ngModel]="cell(c, j.id, d)" (ngModelChange)="setCell(c, j.id, d, $event)"></td>
                      }
                    </tr>
                  }
                </tbody>
              </table>
            </div>
            @if (cvm.error(); as e) { <p class="field-error mt-2" role="alert">{{ e.message }}</p> }
            <div class="mt-3 flex justify-end"><button type="submit" class="btn btn-primary" [disabled]="cvm.busy()">Save minimums</button></div>
          </form>
        } @else { <div class="skeleton mt-3 h-40"></div> }
      </section>

      <section class="card p-5" aria-labelledby="cd-title">
        <h2 id="cd-title" class="section-title flex items-center gap-2"><span class="grid h-8 w-8 place-items-center rounded-full bg-accent-soft text-accent"><app-icon name="calendar" [size]="16" /></span>Closed days</h2>
        <p class="help">Prefilled with US federal holidays. Closed days are skipped in staffing checks and never deducted from leave.</p>
        <form class="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end" (ngSubmit)="addClosedDay()" novalidate>
          <div class="field"><label class="label" for="cdd">Date</label><input id="cdd" class="input" type="date" name="cdd" [(ngModel)]="newClosed.closedOn" [attr.aria-invalid]="!!cdm.fields()['closedOn'] || null"></div>
          <div class="field flex-1"><label class="label" for="cdn">Name</label><input id="cdn" class="input" name="cdn" [(ngModel)]="newClosed.name" placeholder="For example, Staff training day" [attr.aria-invalid]="!!cdm.fields()['name'] || null"></div>
          <div class="field"><label class="label" for="cdl">Applies to</label>
            <select id="cdl" class="input" name="cdl" [(ngModel)]="newClosed.locationId"><option [ngValue]="null">All locations</option>
              @for (l of session.lookups()?.locations ?? []; track l.id) { <option [ngValue]="l.id">{{ l.name }}</option> }</select></div>
          <button type="submit" class="btn" [disabled]="cdm.busy()">Add closed day</button>
        </form>
        @if (cdm.error(); as e) { <p class="field-error mt-2" role="alert">{{ cdm.fields()['closedOn'] || cdm.fields()['name'] || cdm.fields()['locationId'] || e.message }}</p> }
        @if (closed.data(); as list) {
          <ul class="mt-4 divide-y divide-line">
            @for (c of list.slice(0, showAllClosed() ? 999 : 6); track c.closedDayId) {
              <li class="flex items-center justify-between gap-2 py-2 text-sm">
                <span><span class="reading">{{ fmt(c.closedOn) }}</span> · {{ c.name }} <span class="text-muted">· {{ c.locationId ? session.locationName(c.locationId) : 'All locations' }}</span></span>
                <button type="button" class="btn btn-sm btn-quiet" (click)="removeClosedDay(c.closedDayId, c.name)" [attr.aria-label]="'Remove ' + c.name">Remove</button>
              </li>
            } @empty { <li class="py-2 text-muted">No upcoming closed days.</li> }
          </ul>
          @if (list.length > 6) { <button type="button" class="btn btn-sm mt-2" (click)="showAllClosed.set(!showAllClosed())">{{ showAllClosed() ? 'Show fewer' : 'Show all ' + list.length }}</button> }
        }
      </section>

      <section class="card p-5" aria-labelledby="loc-title">
        <h2 id="loc-title" class="section-title flex items-center gap-2"><span class="grid h-8 w-8 place-items-center rounded-full bg-accent-soft text-accent"><app-icon name="building" [size]="16" /></span>Locations</h2>
        <ul class="mt-2 flex flex-wrap gap-2">@for (l of session.lookups()?.locations ?? []; track l.id) { <li class="badge badge-neutral">{{ l.name }}</li> }</ul>
        <form class="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end" (ngSubmit)="addLocation()" novalidate>
          <div class="field flex-1"><label class="label" for="ln">New location name</label><input id="ln" class="input" name="ln" [(ngModel)]="newLocation" [attr.aria-invalid]="!!lm.fields()['name'] || null" aria-describedby="ln-error"></div>
          <button type="submit" class="btn" [disabled]="lm.busy()">Add location</button>
        </form>
        @if (lm.error(); as e) { <p id="ln-error" class="field-error mt-2" role="alert">{{ lm.fields()['name'] || lm.fields()['address'] || e.message }}</p> }
      </section>

      <section class="card p-5" aria-labelledby="bill-title">
        <div class="flex flex-wrap items-center gap-2"><h2 id="bill-title" class="section-title flex items-center gap-2"><span class="grid h-8 w-8 place-items-center rounded-full bg-accent-soft text-accent"><app-icon name="badge-check" [size]="16" /></span>Plan and billing</h2><span class="badge badge-warn">Simulated</span></div>
        <p class="help">No payment is taken in this prototype. Plan limits are enforced for real.</p>
        @if (billing.data(); as b) {
          <dl class="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div><dt class="text-muted">Plan</dt><dd class="font-medium capitalize">{{ b.planCode }}</dd></div>
            <div><dt class="text-muted">Active staff</dt><dd class="reading font-medium">{{ b.activeStaff }}</dd></div>
            <div><dt class="text-muted">Locations</dt><dd class="reading font-medium">{{ b.locations }} of {{ b.maxLocations }}</dd></div>
            <div><dt class="text-muted">Monthly estimate</dt><dd class="reading font-medium">\${{ b.monthlyEstimate }}</dd></div>
          </dl>
          @if (b.planCode === 'trial') { <p class="mt-2 text-sm">Trial ends {{ trialEnd(b.trialEndsUtc) }}.</p> }
          <div class="mt-3 grid gap-3 sm:grid-cols-2">
            @for (p of plans; track p.code) {
              <div class="rounded-card border p-4" [class]="b.planCode === p.code ? 'border-accent bg-accent-soft' : 'border-line'">
                <p class="font-semibold">{{ p.name }} <span class="reading font-normal text-muted">\${{ p.price }} per active staff / month</span></p>
                <p class="help">{{ p.detail }}</p>
                @if (b.planCode !== p.code) { <button type="button" class="btn btn-sm mt-2" (click)="changePlan(p.code)" [disabled]="bm.busy()">Switch to {{ p.name }} (simulated)</button> }
                @else { <app-badge status="valid" label="Current plan" /> }
              </div>
            }
          </div>
          @if (bm.error(); as e) { <p class="field-error mt-2" role="alert">{{ bm.fields()['planCode'] || e.message }}</p> }
        } @else if (billing.error(); as e) { <div class="mt-3"><app-error-state [message]="e.message" (retry)="billing.load()" /></div> }
      </section>

      <section class="card p-5" aria-labelledby="data-title">
        <h2 id="data-title" class="section-title flex items-center gap-2"><span class="grid h-8 w-8 place-items-center rounded-full bg-accent-soft text-accent"><app-icon name="download" [size]="16" /></span>Your data</h2>
        <p class="help">Download everything your clinic has stored, as JSON. Passwords are never included.</p>
        <button type="button" class="btn mt-3" (click)="exportData()" [disabled]="exporting()"><app-icon name="download" [size]="16" />{{ exporting() ? 'Preparing file' : 'Download all data' }}</button>
        <p class="help mt-3">Closing a clinic and deleting its data is not available in this prototype yet. When it is, records will first be kept for the period US employment law requires.</p>
      </section>
    </div>
  `,
})
export class Settings implements OnInit {
  protected readonly session = inject(Session);
  private readonly api = inject(Api);
  private readonly toasts = inject(Toasts);
  private readonly host = inject(ElementRef<HTMLElement>);
  protected readonly zones = ZONES;
  protected readonly weekdays = WEEKDAYS;
  protected readonly plans = [
    { code: 'starter', name: 'Starter', price: 4, detail: 'One location. Scheduling, leave, clock-in and licence tracking.' },
    { code: 'practice', name: 'Practice', price: 6, detail: 'Up to three locations, cross-location scheduling and owner overrides.' },
  ];
  protected readonly settings = new Loader(() => this.api.settings());
  protected readonly billing = new Loader(() => this.api.billing());
  protected readonly closed = new Loader(() => this.api.closedDays());
  protected readonly s = signal<ClinicSettings | null>(null);
  protected readonly coverage = signal<Coverage | null>(null);
  protected readonly coverageLocation = signal(0);
  protected readonly showAllClosed = signal(false);
  protected readonly exporting = signal(false);
  protected readonly sm = new Mutation();
  protected readonly cvm = new Mutation();
  protected readonly cdm = new Mutation();
  protected readonly lm = new Mutation();
  protected readonly bm = new Mutation();
  protected newClosed = { closedOn: '', name: '', locationId: null as number | null };
  protected newLocation = '';

  async ngOnInit(): Promise<void> {
    this.coverageLocation.set(this.session.me()?.homeLocationId ?? 0);
    await Promise.all([this.settings.load(), this.billing.load(), this.closed.load(), this.loadCoverage()]);
    this.s.set(this.settings.data() ? { ...this.settings.data()! } : null);
  }

  protected hasErrors(m: Mutation): boolean {
    return Object.keys(m.fields()).length > 0;
  }

  protected coverageTitles() {
    return (this.session.lookups()?.jobTitles ?? []).filter((j) => j.role === 'clinical_staff' || j.role === 'reception');
  }

  protected cell(c: Coverage, jobTitleId: number, d: Weekday): number {
    return c.cells.find((x) => x.jobTitleId === jobTitleId && x.weekday === d)?.minHeadcount ?? 0;
  }

  protected setCell(c: Coverage, jobTitleId: number, d: Weekday, value: number): void {
    const existing = c.cells.find((x) => x.jobTitleId === jobTitleId && x.weekday === d);
    if (existing) existing.minHeadcount = Number(value) || 0;
    else c.cells.push({ jobTitleId, weekday: d, minHeadcount: Number(value) || 0 });
  }

  protected async loadCoverage(): Promise<void> {
    this.coverage.set(null);
    try {
      this.coverage.set(await firstValueFrom(this.api.coverage(this.coverageLocation())));
    } catch (e) {
      this.toasts.show(toApiError(e).message, 'block');
    }
  }

  protected async saveSettings(): Promise<void> {
    const saved = await this.sm.run(() => this.api.saveSettings(this.s()!));
    if (!saved) {
      focusFirstError(this.host.nativeElement);
      return;
    }
    this.s.set({ ...saved });
    const me = this.session.me();
    if (me) this.session.me.set({ ...me, clinic: { ...me.clinic, name: saved.name, timeZoneId: saved.timeZoneId } });
    this.toasts.show('Policies saved.');
  }

  protected async saveCoverage(): Promise<void> {
    const saved = await this.cvm.run(() => this.api.saveCoverage(this.coverage()!));
    if (saved) {
      this.coverage.set(saved);
      this.toasts.show('Minimum staffing saved. The schedule checks use it now.');
    }
  }

  protected async addClosedDay(): Promise<void> {
    const list = await this.cdm.run(() => this.api.addClosedDay(this.newClosed));
    if (list) {
      this.closed.data.set(list);
      this.toasts.show(`${this.newClosed.name} added.`);
      this.newClosed = { closedOn: '', name: '', locationId: null };
    } else focusFirstError(this.host.nativeElement);
  }

  protected async removeClosedDay(id: number, name: string): Promise<void> {
    const list = await this.cdm.run(() => this.api.deleteClosedDay(id));
    if (list) {
      this.closed.data.set(list);
      this.toasts.show(`${name} removed.`, 'neutral');
    }
  }

  protected async addLocation(): Promise<void> {
    const lookups = await this.lm.run(() => this.api.addLocation(this.newLocation, null));
    if (lookups) {
      this.session.lookups.set(lookups);
      this.toasts.show(`${this.newLocation} added.`);
      this.newLocation = '';
      void this.billing.load();
    } else focusFirstError(this.host.nativeElement);
  }

  protected async changePlan(code: string): Promise<void> {
    const b = await this.bm.run(() => this.api.changePlan(code));
    if (b) {
      this.billing.data.set(b);
      this.toasts.show(`Plan changed to ${code} (simulated, no charge).`);
    }
  }

  protected async exportData(): Promise<void> {
    this.exporting.set(true);
    try {
      const blob = await firstValueFrom(this.api.exportData());
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement('a'), { href: url, download: `chairside-export-${new Date().toISOString().slice(0, 10)}.json` });
      a.click();
      URL.revokeObjectURL(url);
      this.toasts.show('Export downloaded.');
    } catch (e) {
      this.toasts.show(toApiError(e).message, 'block');
    } finally {
      this.exporting.set(false);
    }
  }

  protected fmt(d: string): string {
    return day(d, true);
  }

  protected trialEnd(utc: string): string {
    return day(utc.slice(0, 10), true);
  }
}
