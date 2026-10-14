import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../core/api';
import { instant } from '../core/format';
import { AuditItem } from '../core/models';
import { Session } from '../core/session';
import { ErrorState, Loader, PageHeader } from '../shared/ui';
import { ScrollRegion } from '../shared/scroll-region';

const ENTITIES = ['', 'Shift', 'LeaveRequest', 'AttendanceRecord', 'Staff', 'ScheduleOverride', 'StaffWorkPattern', 'Credential', 'CoverageRule', 'ClosedDay', 'Clinic', 'Location'];

/** Read-only audit trail, written by database triggers so no code path can skip it. */
@Component({
  selector: 'app-audit',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, PageHeader, ErrorState, ScrollRegion],
  template: `
    <app-page-header eyebrow="Owner / Admin" title="Audit log" subtitle="Every change to schedules, leave, attendance, staff, policies and overrides." >
      <label class="sr-only" for="ent">Record type</label>
      <select id="ent" class="input w-auto" [ngModel]="entity()" (ngModelChange)="entity.set($event); page.set(0); list.load()">
        @for (e of entities; track e) { <option [value]="e">{{ e || 'All record types' }}</option> }
      </select>
    </app-page-header>

    @if (list.error(); as e) {
      <app-error-state [message]="e.message" (retry)="list.load()" />
    } @else if (list.data(); as rows) {
      @if (rows.length === 0) {
        <p class="card p-5 text-muted">No changes recorded{{ entity() ? ' for ' + entity() : '' }} yet.</p>
      } @else {
        <div class="table-wrap">
          <table class="table min-w-[48rem]">
            <caption class="sr-only">Audit entries, newest first</caption>
            <thead><tr><th scope="col">When</th><th scope="col">Who</th><th scope="col">Change</th><th scope="col">Details</th></tr></thead>
            <tbody>
              @for (r of rows; track r.auditId) {
                <tr>
                  <td class="reading whitespace-nowrap">{{ when(r.atUtc) }}</td>
                  <td>{{ r.who ?? 'System' }}</td>
                  <td class="whitespace-nowrap">{{ r.action }} {{ r.entityName }} <span class="reading text-muted">#{{ r.entityId }}</span></td>
                  <td>
                    <details>
                      <summary class="cursor-pointer text-accent">{{ summary(r) }}</summary>
                      <pre class="reading mt-2 max-w-xl overflow-x-auto whitespace-pre-wrap break-all rounded-control bg-bg p-2 text-xs">{{ diff(r) }}</pre>
                    </details>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        <div class="mt-3 flex gap-2">
          <button type="button" class="btn btn-sm" [disabled]="page() === 0" (click)="go(-1)">Newer</button>
          <button type="button" class="btn btn-sm" [disabled]="rows.length < 50" (click)="go(1)">Older</button>
        </div>
      }
    } @else {
      <div class="skeleton h-80"></div>
    }
  `,
})
export class Audit implements OnInit {
  private readonly api = inject(Api);
  private readonly session = inject(Session);
  protected readonly entities = ENTITIES;
  protected readonly entity = signal('');
  protected readonly page = signal(0);
  protected readonly list = new Loader(() => this.api.audit(this.entity(), this.page()));

  ngOnInit(): void {
    void this.list.load();
  }

  protected go(delta: number): void {
    this.page.update((p) => Math.max(0, p + delta));
    void this.list.load();
  }

  protected when(utc: string): string {
    return instant(utc, this.session.timeZone(), true);
  }

  protected summary(r: AuditItem): string {
    const changed = this.changedKeys(r);
    return r.action === 'update' ? (changed.length ? `Changed ${changed.slice(0, 3).join(', ')}${changed.length > 3 ? '…' : ''}` : 'No field changes') : 'Show record';
  }

  protected diff(r: AuditItem): string {
    const oldV = this.parse(r.oldValue);
    const newV = this.parse(r.newValue);
    if (r.action !== 'update') return JSON.stringify(newV ?? oldV, null, 2);
    return this.changedKeys(r).map((k) => `${k}: ${JSON.stringify(oldV?.[k])} → ${JSON.stringify(newV?.[k])}`).join('\n');
  }

  private changedKeys(r: AuditItem): string[] {
    const oldV = this.parse(r.oldValue) ?? {};
    const newV = this.parse(r.newValue) ?? {};
    return Object.keys({ ...oldV, ...newV }).filter((k) => JSON.stringify(oldV[k]) !== JSON.stringify(newV[k]));
  }

  private parse(v: string | null): Record<string, unknown> | null {
    try {
      return v ? (JSON.parse(v) as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
}
