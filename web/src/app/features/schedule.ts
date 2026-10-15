import { ChangeDetectionStrategy, Component, ElementRef, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { Api, toApiError } from '../core/api';
import { addDays, compactTime, day, hours, monthDay, time, toHHmm, todayIn, weekdayShort } from '../core/format';
import { Issue, SaveShift, ScheduleWeek, Shift } from '../core/models';
import { Session } from '../core/session';
import { Toasts } from '../core/toast';
import { Confirm } from '../core/confirm';
import { Avatar, jobClass } from '../shared/brand';
import { Icon } from '../shared/icons';
import { Badge, ErrorState, Mutation, PageHeader, Sheet, focusFirstError } from '../shared/ui';
import { ScrollRegion } from '../shared/scroll-region';
import { TabList } from '../shared/tablist';

interface EditState { shiftId: number | null; staffId: number; shiftDate: string; startTime: string; endTime: string; unpaidBreakMinutes: number | null }

const DAY_START = 7 * 60;   // timeline axis: 7:00 AM
const DAY_END = 19 * 60;    // to 7:00 PM

/**
 * Hero screen "Weekly schedule": both locations, four live checks, publish with the licence block and owner override.
 * Signature interactions: the live chart check, drag a shift to another day or person (the edit sheet does the same by
 * keyboard), a day timeline, and undoable deletes.
 */
@Component({
  selector: 'app-schedule',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, PageHeader, Badge, ErrorState, Sheet, Icon, Avatar, ScrollRegion, TabList],
  styles: `
    .shift { border-left: 3px solid var(--job); background: var(--job-bg); }
    .shift.draft { background: var(--c-surface); background-image: var(--c-draft); }
    .shift.has-block { box-shadow: inset 0 0 0 1.5px var(--c-block); }
    .shift.has-warn { box-shadow: inset 0 0 0 1.5px var(--c-warn); }
    .shift[draggable="true"] { cursor: grab; }
    .drop-target { outline: 2px dashed var(--c-accent); outline-offset: -3px; background: var(--c-accent-soft); }
    .bar { background: var(--job-bg); border: 1px solid color-mix(in srgb, var(--job) 45%, transparent); border-left: 3px solid var(--job); }
  `,
  template: `
    <app-page-header [eyebrow]="session.locationName(locationId()) + ' · ' + (session.isManager() ? 'Planning' : 'Published schedule')" title="Schedule" [subtitle]="weekLabel()">
      @if (session.isManager()) {
        <label class="sr-only" for="loc">Location</label>
        <select id="loc" class="input w-auto" [ngModel]="locationId()" (ngModelChange)="changeLocation($event)">
          @for (l of session.lookups()?.locations ?? []; track l.id) { <option [ngValue]="l.id">{{ l.name }}</option> }
        </select>
      }
      <div class="flex rounded-control border border-line-strong bg-surface" role="group" aria-label="Week">
        <button type="button" class="btn btn-quiet btn-icon rounded-r-none" (click)="shiftWeek(-7)" aria-label="Previous week"><app-icon name="chevron-left" /></button>
        <button type="button" class="btn btn-quiet rounded-none border-x border-x-line px-3" (click)="goToday()">This week</button>
        <button type="button" class="btn btn-quiet btn-icon rounded-l-none" (click)="shiftWeek(7)" aria-label="Next week"><app-icon name="chevron-right" /></button>
      </div>
    </app-page-header>

    @if (error(); as e) {
      <app-error-state [message]="e" (retry)="load()" />
    } @else if (week(); as w) {
      @if (w.canEdit) {
        <div class="mb-5 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
          <!-- Signature interaction: the live chart check. Re-runs on the server after every edit. -->
          <section class="card enter p-4" aria-labelledby="check-title" aria-live="polite">
            <div class="flex flex-wrap items-center gap-3">
              <span class="grid h-9 w-9 place-items-center rounded-full" [class]="blocks().length ? 'bg-block-bg text-block' : warnings().length ? 'bg-warn-bg text-warn' : 'bg-ok-bg text-ok'">
                <app-icon [name]="blocks().length ? 'shield' : warnings().length ? 'warning' : 'badge-check'" [size]="18" />
              </span>
              <div class="mr-auto">
                <h2 id="check-title" class="section-title leading-tight">Chart check</h2>
                <p class="text-xs text-muted">Overlaps, leave, minimum staffing, licences and overtime, across both locations</p>
              </div>
              @if (blocks().length) { <app-badge status="block" [label]="blocks().length + ' blocking'" /> }
              @if (warnings().length) { <app-badge status="warning" [label]="warnings().length + ' warning' + (warnings().length === 1 ? '' : 's')" /> }
              @if (!w.issues.length) { <app-badge status="valid" label="No problems found" /> }
              @if (w.issues.length) {
                <button type="button" class="btn btn-quiet btn-sm" (click)="showIssues.set(!showIssues())" [attr.aria-expanded]="showIssues()">
                  {{ showIssues() ? 'Hide details' : 'Show details' }}
                </button>
              }
            </div>
            @if (showIssues() && w.issues.length) {
              <ul class="mt-3 max-h-64 divide-y divide-line overflow-y-auto text-sm">
                @for (i of sortedIssues(); track $index) {
                  <li class="flex items-start gap-3 py-2">
                    <app-badge [status]="i.severity === 'Block' ? 'block' : 'warning'" [label]="kindLabel(i)" />
                    <span class="flex-1">{{ i.date ? dayLabel(i.date) + ': ' : '' }}{{ i.message }}</span>
                    @if (i.shiftId) { <button type="button" class="inline-flex items-center gap-1 whitespace-nowrap text-accent underline underline-offset-2" (click)="focusShift(i.shiftId)">Go to shift<app-icon name="arrow-right" [size]="14" /></button> }
                  </li>
                }
              </ul>
            }
          </section>

          <section class="card enter flex flex-col justify-between gap-3 p-4 lg:w-72" aria-label="Week actions" style="animation-delay: 40ms">
            <div>
              <p class="display-number text-3xl">{{ w.draftCount }}</p>
              <p class="text-sm text-muted">draft shift{{ w.draftCount === 1 ? '' : 's' }} only managers can see</p>
            </div>
            <div class="flex flex-col gap-2">
              <button type="button" class="btn" (click)="fill()" [disabled]="m.busy()"><app-icon name="wand" [size]="17" />Fill from work patterns</button>
              <button type="button" class="btn btn-primary" (click)="startPublish()" [disabled]="m.busy() || w.draftCount === 0">
                <app-icon [name]="w.draftCount ? 'send' : 'check'" [size]="17" />{{ w.draftCount === 0 ? 'All shifts published' : 'Publish ' + w.draftCount + ' shift' + (w.draftCount === 1 ? '' : 's') }}
              </button>
            </div>
          </section>
        </div>
      }

      <div class="mb-3 hidden flex-wrap items-center justify-between gap-3 md:flex">
        <div class="segmented" role="radiogroup" aria-label="View">
          <label><input type="radio" name="view" value="week" [ngModel]="view()" (ngModelChange)="view.set($event)" /><app-icon name="rows" [size]="16" />Week</label>
          <label><input type="radio" name="view" value="day" [ngModel]="view()" (ngModelChange)="view.set($event)" /><app-icon name="gantt" [size]="16" />Day timeline</label>
        </div>
        <ul class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted" aria-label="Legend">
          @for (j of legend; track j.label) { <li class="flex items-center gap-1.5" [class]="j.cls"><span class="job-dot"></span>{{ j.label }}</li> }
          <li class="flex items-center gap-1.5"><span class="inline-block h-3 w-4 rounded-sm border border-line-strong" style="background-image: var(--c-draft)"></span>Draft</li>
          @if (w.canEdit) { <li class="flex items-center gap-1.5"><app-icon name="grip" [size]="14" />Drag to move</li> }
        </ul>
      </div>

      @if (view() === 'week') {
        <!-- Desktop and tablet: the chart grid -->
        <div class="table-wrap enter hidden md:block">
          <table class="table min-w-[58rem] table-fixed">
            <caption class="sr-only">Shifts for the week of {{ weekLabel() }} at {{ session.locationName(w.locationId) }}. Rows are people, columns are days.</caption>
            <colgroup><col class="w-56">@for (d of w.days; track d.date) { <col> }</colgroup>
            <thead>
              <tr>
                <th scope="col">Person · week</th>
                @for (d of w.days; track d.date) {
                  <th scope="col" [id]="'day-' + d.date" class="!normal-case !tracking-normal">
                    <span class="flex items-center gap-1.5">
                      <span class="text-xs font-semibold uppercase tracking-wide">{{ weekday(d.date) }}</span>
                      <span class="grid h-6 min-w-6 place-items-center rounded-full px-1 text-xs font-semibold"
                            [class]="d.date === today() ? 'bg-accent text-on-accent' : 'text-ink'">{{ +d.date.slice(8) }}</span>
                    </span>
                    @if (d.closedName) { <span class="mt-1 block truncate text-[11px] font-medium text-warn" [title]="d.closedName">Closed · {{ d.closedName }}</span> }
                  </th>
                }
              </tr>
            </thead>
            <tbody>
              @for (r of w.rows; track r.staffId) {
                <tr [class]="job(r.jobTitle)">
                  <th scope="row" class="!bg-surface !py-2 !text-sm !font-normal !normal-case !tracking-normal !text-ink">
                    <span class="flex items-center gap-2.5">
                      <app-avatar [name]="r.name" [job]="r.jobTitle" [size]="32" />
                      <span class="min-w-0 flex-1">
                        <span class="block truncate font-semibold">{{ r.name }}</span>
                        <span class="flex items-center gap-1 truncate text-xs text-muted"><span class="job-dot"></span>{{ r.jobTitle }}{{ r.homeLocation !== session.locationName(w.locationId) ? ' · ' + r.homeLocation : '' }}</span>
                      </span>
                    </span>
                    <span class="mt-1.5 flex items-center gap-2">
                      <span class="h-1.5 flex-1 overflow-hidden rounded-full bg-line" aria-hidden="true">
                        <span class="block h-full rounded-full" [style.width.%]="hoursPct(r.weeklyHours)" [style.background]="r.overThreshold ? 'var(--c-warn)' : 'var(--job)'"></span>
                      </span>
                      <span class="reading text-[11px]" [class.text-warn]="r.overThreshold" [class.font-semibold]="r.overThreshold">{{ hrs(r.weeklyHours) }}</span>
                    </span>
                  </th>
                  @for (d of w.days; track d.date) {
                    <td class="!p-1.5 align-top" [class.drop-target]="dropKey() === r.staffId + '|' + d.date"
                        (dragover)="onDragOver($event, r.staffId, d.date)" (dragleave)="dropKey.set(null)" (drop)="onDrop($event, r.staffId, d.date)">
                      @for (s of cell(r.staffId, d.date); track s.shiftId) {
                        @if (s.locationId === w.locationId) {
                          <button type="button" [id]="'shift-' + s.shiftId" (click)="openEdit(s)" [disabled]="!w.canEdit"
                                  [attr.draggable]="w.canEdit" (dragstart)="onDragStart($event, s)" (dragend)="dragging.set(null)"
                                  class="shift mb-1 block w-full rounded-[7px] px-2 py-1.5 text-left text-xs transition-transform hover:-translate-y-px disabled:cursor-default disabled:hover:translate-y-0"
                                  [class.draft]="!s.isPublished" [class.has-block]="issueMark(s.shiftId) === 'block'" [class.has-warn]="issueMark(s.shiftId) === 'warn'"
                                  [class.opacity-40]="dragging() === s.shiftId">
                            <span class="sr-only">{{ r.name }}, {{ dayLabel(s.shiftDate) }}, </span>
                            <span class="reading block whitespace-nowrap font-semibold">{{ ct(s.startTime) }} – {{ ct(s.endTime) }}</span>
                            <span class="mt-0.5 flex items-center gap-1 text-[11px] text-muted">
                              {{ s.isPublished ? 'Published' : 'Draft' }}
                              @if (issueMark(s.shiftId); as mark) { <app-icon [name]="mark === 'block' ? 'shield' : 'warning'" [size]="12" [class]="mark === 'block' ? 'text-block' : 'text-warn'" /> }
                            </span>
                            <span class="sr-only">{{ shiftSuffix(s) }}</span>
                          </button>
                        } @else {
                          <p class="mb-1 rounded-[7px] border border-dashed border-line-strong px-2 py-1.5 text-[11px] text-muted">
                            <span class="reading block whitespace-nowrap">{{ ct(s.startTime) }} – {{ ct(s.endTime) }}</span><span class="flex items-center gap-1"><app-icon name="pin" [size]="11" />{{ session.locationName(s.locationId) }}</span>
                          </p>
                        }
                      } @empty {
                        @if (w.canEdit && !d.closedName) {
                          <button type="button" class="grid min-h-11 w-full place-items-center rounded-[7px] text-muted opacity-40 transition-opacity hover:bg-raised hover:opacity-100 focus:opacity-100"
                                  (click)="openNew(r.staffId, d.date)" [attr.aria-label]="'Add shift for ' + r.name + ' on ' + dayLabel(d.date)"><app-icon name="plus" [size]="16" /></button>
                        }
                      }
                    </td>
                  }
                </tr>
              } @empty {
                <tr><td [attr.colspan]="8" class="!py-10 text-center text-muted">Nobody is scheduled here this week. Add staff on the Staff page, then use Fill from work patterns.</td></tr>
              }
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" class="!bg-raised !text-xs">Coverage</th>
                @for (d of w.days; track d.date) {
                  <td class="!bg-raised !p-1.5 align-top text-[11px]">
                    @for (c of d.coverage; track c.jobTitle) {
                      <span class="mb-1 flex items-center justify-between gap-1 rounded-[6px] px-1.5 py-0.5"
                            [class]="c.scheduled < c.minimum ? 'bg-block-bg text-block font-semibold' : 'bg-ok-bg text-ok'">
                        <span class="truncate"><span aria-hidden="true">{{ c.scheduled < c.minimum ? '✕ ' : '✓ ' }}</span>{{ c.jobTitle }}</span>
                        <span class="reading">{{ c.scheduled }}/{{ c.minimum }}</span>
                      </span>
                    } @empty { <span class="text-muted">{{ d.closedName ? 'Closed' : 'No minimum' }}</span> }
                  </td>
                }
              </tr>
            </tfoot>
          </table>
        </div>
      } @else {
        <!-- Day timeline: when people overlap, gaps in the day, and who is where -->
        <section class="card enter hidden p-4 md:block" aria-labelledby="timeline-title">
          <div class="flex flex-wrap items-center gap-2">
            <h2 id="timeline-title" class="section-title mr-auto">{{ dayLabel(phoneDay()) }}</h2>
            @for (d of w.days; track d.date) {
              <button type="button" class="btn btn-sm min-w-12 !px-2" [class.!border-accent]="phoneDay() === d.date" [class.!bg-accent-soft]="phoneDay() === d.date"
                      [attr.aria-pressed]="phoneDay() === d.date" (click)="phoneDay.set(d.date)">{{ weekday(d.date) }} {{ +d.date.slice(8) }}</button>
            }
          </div>
          <div class="relative mt-4" role="list" [attr.aria-label]="'Shifts on ' + dayLabel(phoneDay())">
            <div class="ml-44 grid border-b border-line pb-1 text-[11px] text-muted" [style.grid-template-columns]="'repeat(' + axis.length + ', minmax(0, 1fr))'" aria-hidden="true">
              @for (h of axis; track h) { <span class="reading -translate-x-1/2">{{ h }}</span> }
            </div>
            @for (r of timelineRows(); track r.row.staffId) {
              <div class="flex items-center border-b border-line py-1.5 last:border-b-0" [class]="job(r.row.jobTitle)" role="listitem">
                <span class="flex w-44 shrink-0 items-center gap-2 pr-3">
                  <app-avatar [name]="r.row.name" [job]="r.row.jobTitle" [size]="26" />
                  <span class="truncate text-sm font-medium">{{ r.row.name }}</span>
                </span>
                <span class="relative h-9 flex-1 rounded-[6px]" style="background-image: repeating-linear-gradient(90deg, var(--c-line) 0 1px, transparent 1px calc(100% / 12))">
                  @if (phoneDay() === today() && nowPos() > 0 && nowPos() < 100) { <span class="absolute -top-1.5 -bottom-1.5 z-10 w-0.5 rounded-full bg-block" [style.left.%]="nowPos()" aria-hidden="true"></span> }
                  @for (s of r.shifts; track s.shiftId) {
                    <button type="button" class="bar absolute top-1 bottom-1 flex items-center overflow-hidden rounded-[6px] px-2 text-left text-[11px] font-medium disabled:cursor-default"
                            [class.opacity-70]="!s.isPublished" [style.left.%]="pos(s.startTime)" [style.width.%]="pos(s.endTime) - pos(s.startTime)"
                            [disabled]="!w.canEdit" (click)="openEdit(s)">
                      <span class="sr-only">{{ r.row.name }}, </span>
                      <span class="reading truncate">{{ ct(s.startTime) }} – {{ ct(s.endTime) }}</span>
                      @if (issueMark(s.shiftId); as mark) { <app-icon [name]="mark === 'block' ? 'shield' : 'warning'" [size]="12" class="ml-1" [class]="mark === 'block' ? 'text-block' : 'text-warn'" /> }
                      <span class="sr-only">{{ shiftSuffix(s) }}</span>
                    </button>
                  }
                </span>
              </div>
            } @empty {
              <p class="py-8 text-center text-muted">No shifts at this location on this day.</p>
            }
          </div>
        </section>
      }

      <!-- Phone: one day at a time instead of a squeezed grid -->
      <div class="md:hidden">
        <div class="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-2" role="tablist" aria-label="Day">
          @for (d of w.days; track d.date) {
            <button type="button" role="tab" class="flex min-h-14 min-w-12 flex-col items-center justify-center rounded-control border text-xs"
                    [class]="phoneDay() === d.date ? 'border-accent bg-accent text-on-accent' : 'border-line bg-surface'"
                    [attr.aria-selected]="phoneDay() === d.date" (click)="phoneDay.set(d.date)">
              <span class="font-medium">{{ weekday(d.date) }}</span><span class="display-number text-base">{{ +d.date.slice(8) }}</span>
            </button>
          }
        </div>
        @if (phoneDayInfo(); as d) {
          <h2 class="section-title mt-2">{{ dayLabel(d.date) }}</h2>
          @if (d.closedName) { <p class="mt-1 text-sm text-warn">Closed · {{ d.closedName }}</p> }
          <ul class="mt-2 flex flex-wrap gap-1.5 text-xs">
            @for (c of d.coverage; track c.jobTitle) {
              <li class="badge" [class]="c.scheduled < c.minimum ? 'badge-block' : 'badge-ok'"><span aria-hidden="true">{{ c.scheduled < c.minimum ? '✕' : '✓' }}</span>{{ c.jobTitle }} {{ c.scheduled }}/{{ c.minimum }}</li>
            }
          </ul>
          <ul class="mt-3 space-y-2">
            @for (s of dayShifts(d.date); track s.shiftId) {
              <li [class]="job(rowOf(s.staffId)?.jobTitle)">
                <button type="button" [id]="'pshift-' + s.shiftId" class="shift card flex w-full items-center gap-3 p-3 text-left" (click)="openEdit(s)" [disabled]="!w.canEdit"
                        [class.draft]="!s.isPublished" [class.has-block]="issueMark(s.shiftId) === 'block'" [class.has-warn]="issueMark(s.shiftId) === 'warn'">
                  <app-avatar [name]="nameOf(s.staffId)" [job]="rowOf(s.staffId)?.jobTitle ?? null" [size]="36" />
                  <span class="min-w-0 flex-1">
                    <span class="block truncate font-semibold">{{ nameOf(s.staffId) }}</span>
                    <span class="reading block text-sm">{{ t(s.startTime) }}–{{ t(s.endTime) }}</span>
                  </span>
                  @if (issueMark(s.shiftId); as mark) { <app-icon [name]="mark === 'block' ? 'shield' : 'warning'" [class]="mark === 'block' ? 'text-block' : 'text-warn'" /> }
                  <app-badge [status]="s.isPublished ? 'published' : 'draft'" />
                </button>
              </li>
            } @empty { <li class="card p-5 text-center text-muted">No shifts on this day.</li> }
          </ul>
          @if (w.canEdit && !d.closedName) { <button type="button" class="btn mt-3 w-full" (click)="openNew(null, d.date)"><app-icon name="plus" [size]="17" />Add shift</button> }
        }
      </div>
    } @else {
      <div class="space-y-3"><div class="skeleton h-24"></div><div class="skeleton h-96"></div></div>
    }

    <app-sheet #shiftSheet [heading]="edit()?.shiftId ? 'Edit shift' : 'Add shift'" (closed)="m.reset()">
      @if (edit(); as e) {
        <form class="flex flex-col gap-4" (ngSubmit)="save()" novalidate #shiftForm>
          <div class="field">
            <label class="label" for="staff">Person</label>
            <select id="staff" class="input" [(ngModel)]="e.staffId" name="staffId" [attr.aria-invalid]="!!m.fields()['staffId'] || null" aria-describedby="staff-help">
              @for (r of staffOptions(); track r.staffId) { <option [ngValue]="r.staffId">{{ r.name }} · {{ r.jobTitle }}</option> }
            </select>
            <p id="staff-help" class="help">Includes people from the other location, to cover gaps.</p>
            @if (m.fields()['staffId']; as err) { <p class="field-error">{{ err }}</p> }
          </div>
          <div class="field">
            <label class="label" for="date">Date</label>
            <input id="date" class="input" type="date" [(ngModel)]="e.shiftDate" name="shiftDate" [attr.aria-invalid]="!!m.fields()['shiftDate'] || null">
            @if (m.fields()['shiftDate']; as err) { <p class="field-error">{{ err }}</p> }
          </div>
          <fieldset>
            <legend class="label">Quick fill</legend>
            <div class="mt-1.5 flex flex-wrap gap-2">
              @for (d of session.lookups()?.shiftDefinitions ?? []; track d.id) {
                <button type="button" class="btn btn-sm" (click)="applyDefinition(e, d.startTime, d.endTime, d.unpaidBreakMinutes)">
                  {{ d.name }} <span class="reading text-muted">{{ t(d.startTime) }}–{{ t(d.endTime) }}</span>
                </button>
              }
            </div>
          </fieldset>
          <div class="grid grid-cols-2 gap-3">
            <div class="field">
              <label class="label" for="start">Start</label>
              <input id="start" class="input" type="time" [(ngModel)]="e.startTime" name="startTime" step="900" [attr.aria-invalid]="!!m.fields()['startTime'] || null">
            </div>
            <div class="field">
              <label class="label" for="end">End</label>
              <input id="end" class="input" type="time" [(ngModel)]="e.endTime" name="endTime" step="900"
                     [attr.aria-invalid]="!!m.fields()['endTime'] || null" [attr.aria-describedby]="m.fields()['endTime'] ? 'end-error' : null">
            </div>
          </div>
          @if (m.fields()['startTime']; as err) { <p class="field-error -mt-2">{{ err }}</p> }
          @if (m.fields()['endTime']; as err) { <p id="end-error" class="field-error -mt-2">{{ err }}</p> }
          <div class="field">
            <label class="label" for="break">Unpaid break (minutes)</label>
            <input id="break" class="input" type="number" min="0" max="120" step="5" [(ngModel)]="e.unpaidBreakMinutes" name="unpaidBreakMinutes"
                   aria-describedby="break-help" [attr.aria-invalid]="!!m.fields()['unpaidBreakMinutes'] || null">
            <p id="break-help" class="help">Leave empty to use the clinic default.</p>
            @if (m.fields()['unpaidBreakMinutes']; as err) { <p class="field-error">{{ err }}</p> }
          </div>
          @if (m.error() && !hasFieldErrors()) { <p class="field-error" role="alert">{{ m.error()!.message }}</p> }
          <div class="flex flex-col-reverse gap-2 border-t border-line pt-4 sm:flex-row sm:justify-between">
            @if (e.shiftId) { <button type="button" class="btn btn-danger" (click)="remove(e.shiftId)" [disabled]="m.busy()"><app-icon name="trash" [size]="16" />Delete shift</button> } @else { <span></span> }
            <button type="submit" class="btn btn-primary" [disabled]="m.busy()"><app-icon name="check" [size]="16" />{{ e.shiftId ? 'Save changes' : 'Add shift' }}</button>
          </div>
          <p class="help">Checks run again as soon as you save. Overlaps, leave and overtime warn; an expired required licence blocks publishing.</p>
        </form>
      }
    </app-sheet>

    <app-sheet #publishSheet heading="Publishing is blocked">
      <div class="alert alert-block" role="note"><app-icon name="shield" class="mt-0.5" />
        <p>These shifts include someone whose required licence is expired or missing on the shift date.</p>
      </div>
      <ul class="mt-3 list-disc space-y-1 pl-5 text-sm">
        @for (b of blocks(); track $index) { <li>{{ b.date ? dayLabel(b.date) + ': ' : '' }}{{ b.message }}</li> }
      </ul>
      @if (week()?.canOverride) {
        <form class="mt-4 flex flex-col gap-3" (ngSubmit)="publish(true)" novalidate>
          <div class="field">
            <label class="label" for="reason">Reason for the override</label>
            <textarea id="reason" class="input" rows="3" maxlength="300" [(ngModel)]="overrideReason" name="reason"
                      [attr.aria-invalid]="!!pm.fields()['overrideReason'] || null" aria-describedby="reason-help"></textarea>
            <p id="reason-help" class="help">Saved with your name in the audit log. For example: renewal submitted, board confirmation pending.</p>
            @if (pm.fields()['overrideReason']; as err) { <p class="field-error">{{ err }}</p> }
          </div>
          <button type="submit" class="btn btn-danger" [disabled]="pm.busy()"><app-icon name="shield" [size]="16" />Override and publish</button>
        </form>
      } @else {
        <p class="mt-4 text-sm">Only the Owner / Admin can override this. Change the shift to someone with a valid licence, or ask the owner to review it.</p>
      }
    </app-sheet>
  `,
})
export class Schedule implements OnInit {
  protected readonly session = inject(Session);
  private readonly api = inject(Api);
  private readonly toasts = inject(Toasts);
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly shiftSheet = viewChild.required<Sheet>('shiftSheet');
  private readonly publishSheet = viewChild.required<Sheet>('publishSheet');

  protected readonly week = signal<ScheduleWeek | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly locationId = signal<number | null>(null);
  protected readonly anchor = signal<string | null>(null);
  protected readonly edit = signal<EditState | null>(null);
  protected readonly showIssues = signal(true);
  protected readonly phoneDay = signal('');
  protected readonly view = signal<'week' | 'day'>('week');
  protected readonly dragging = signal<number | null>(null);
  protected readonly dropKey = signal<string | null>(null);
  protected readonly m = new Mutation();
  protected readonly pm = new Mutation();
  protected overrideReason = '';

  protected readonly t = time;
  protected readonly ct = compactTime;
  protected readonly hrs = hours;
  protected readonly weekday = weekdayShort;
  protected readonly md = monthDay;
  protected readonly job = jobClass;
  protected readonly dayLabel = (d: string) => (d ? day(d) : '');
  protected readonly axis = ['7a', '8a', '9a', '10a', '11a', '12p', '1p', '2p', '3p', '4p', '5p', '6p'];
  protected readonly legend = [
    { label: 'Dentist', cls: 'job job-dentist' }, { label: 'Hygienist', cls: 'job job-hygienist' },
    { label: 'Assistant', cls: 'job job-assistant' }, { label: 'Reception', cls: 'job job-reception' },
  ];
  protected readonly today = computed(() => todayIn(this.session.timeZone()));
  /** Current clinic time on the timeline, for the "now" line. */
  protected readonly nowPos = computed(() => {
    const [h, m] = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: this.session.timeZone() }).format(new Date()).split(':');
    return this.pos(h + ':' + m);
  });
  protected readonly blocks = computed(() => (this.week()?.issues ?? []).filter((i) => i.severity === 'Block'));
  protected readonly warnings = computed(() => (this.week()?.issues ?? []).filter((i) => i.severity === 'Warning'));
  protected readonly sortedIssues = computed(() =>
    [...(this.week()?.issues ?? [])].sort((a, b) => (a.severity === b.severity ? (a.date ?? '').localeCompare(b.date ?? '') : a.severity === 'Block' ? -1 : 1)));
  protected readonly weekLabel = computed(() => {
    const w = this.week();
    return w ? `Week of ${day(w.weekStart)} – ${day(addDays(w.weekStart, 6), true)}` : 'Loading week';
  });
  protected readonly phoneDayInfo = computed(() => this.week()?.days.find((d) => d.date === this.phoneDay()) ?? this.week()?.days[0] ?? null);
  protected readonly staffOptions = computed(() => this.week()?.rows ?? []);
  protected readonly timelineRows = computed(() => {
    const w = this.week();
    if (!w) return [];
    return w.rows
      .map((row) => ({ row, shifts: this.dayShifts(this.phoneDay()).filter((s) => s.staffId === row.staffId) }))
      .filter((r) => r.shifts.length > 0);
  });

  async ngOnInit(): Promise<void> {
    this.locationId.set(this.session.me()?.homeLocationId ?? null);
    await this.load();
  }

  protected async load(): Promise<void> {
    this.error.set(null);
    try {
      this.apply(await firstValueFrom(this.api.week(this.locationId(), this.anchor())));
    } catch (e) {
      this.error.set(toApiError(e).message);
    }
  }

  protected changeLocation(id: number): void {
    this.locationId.set(id);
    void this.load();
  }

  protected shiftWeek(days: number): void {
    const w = this.week();
    if (!w) return;
    this.anchor.set(addDays(w.weekStart, days));
    void this.load();
  }

  protected goToday(): void {
    this.anchor.set(null);
    void this.load();
  }

  protected cell(staffId: number, date: string): Shift[] {
    return (this.week()?.shifts ?? []).filter((s) => s.staffId === staffId && s.shiftDate === date);
  }

  protected dayShifts(date: string): Shift[] {
    const w = this.week();
    return (w?.shifts ?? []).filter((s) => s.shiftDate === date && s.locationId === w!.locationId).sort((a, b) => a.startTime.localeCompare(b.startTime));
  }

  protected rowOf(staffId: number) {
    return this.week()?.rows.find((r) => r.staffId === staffId);
  }

  protected nameOf(staffId: number): string {
    return this.rowOf(staffId)?.name ?? '';
  }

  protected hoursPct(h: number): number {
    return Math.min(100, (h / Math.max(1, this.week()?.overtimeThresholdHours ?? 40)) * 100);
  }

  /** Position on the 7 AM – 7 PM timeline, as a percentage. */
  protected pos(t: string): number {
    const [h, m] = t.split(':').map(Number);
    return Math.min(100, Math.max(0, ((h * 60 + m - DAY_START) / (DAY_END - DAY_START)) * 100));
  }

  protected issueMark(shiftId: number): 'block' | 'warn' | null {
    const issues = (this.week()?.issues ?? []).filter((i) => i.shiftId === shiftId);
    return issues.some((i) => i.severity === 'Block') ? 'block' : issues.length ? 'warn' : null;
  }

  /** Screen-reader detail after the visible label (the visible text stays part of the name, WCAG 2.5.3). */
  protected shiftSuffix(s: Shift): string {
    const issues = (this.week()?.issues ?? []).filter((i) => i.shiftId === s.shiftId).map((i) => i.message).join(' ');
    return `, ${time(s.startTime)} to ${time(s.endTime)}. ${issues} Edit shift.`;
  }

  protected kindLabel(i: Issue): string {
    return { Overlap: 'Overlap', OnLeave: 'On leave', ClosedDay: 'Closed day', BelowMinimum: 'Short-staffed', ExpiredLicence: 'Licence', Overtime: 'Overtime' }[i.kind];
  }

  protected focusShift(shiftId: number): void {
    if (this.view() === 'day') this.view.set('week');
    setTimeout(() => {
      const el = this.host.nativeElement.querySelector(`#shift-${shiftId}`) as HTMLElement | null;
      if (el && el.offsetParent !== null) {
        el.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
        el.focus();
      } else {
        // Phone layout: switch to that day, then focus the shift card once it renders.
        const s = this.week()?.shifts.find((x) => x.shiftId === shiftId);
        if (s) {
          this.phoneDay.set(s.shiftDate);
          this.focusLater(`#pshift-${shiftId}`);
        }
      }
    });
  }

  // Drag and drop moves a shift to another day or person, keeping its times. The edit sheet offers the same by keyboard.
  protected onDragStart(event: DragEvent, s: Shift): void {
    this.dragging.set(s.shiftId);
    event.dataTransfer?.setData('text/plain', String(s.shiftId));
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  protected onDragOver(event: DragEvent, staffId: number, date: string): void {
    if (this.dragging() === null || !this.week()?.canEdit) return;
    event.preventDefault();
    this.dropKey.set(`${staffId}|${date}`);
  }

  protected async onDrop(event: DragEvent, staffId: number, date: string): Promise<void> {
    event.preventDefault();
    this.dropKey.set(null);
    const id = this.dragging();
    this.dragging.set(null);
    const s = this.week()?.shifts.find((x) => x.shiftId === id);
    if (!s || (s.staffId === staffId && s.shiftDate === date)) return;
    const w = await this.m.run(() => this.api.updateShift(s.shiftId, {
      locationId: s.locationId, staffId, shiftDate: date, startTime: s.startTime, endTime: s.endTime, unpaidBreakMinutes: s.unpaidBreakMinutes,
    }));
    if (!w) {
      this.toasts.show(Object.values(this.m.fields())[0] ?? this.m.error()?.message ?? 'Could not move the shift.', 'block');
      return;
    }
    this.apply(w);
    this.focusLater(`#shift-${s.shiftId}`);
    this.toasts.show(`Moved to ${this.nameOf(staffId)} on ${day(date)}. Checks re-run.`, 'ok', {
      label: 'Undo',
      run: async () => {
        try {
          this.apply(await firstValueFrom(this.api.updateShift(s.shiftId, {
            locationId: s.locationId, staffId: s.staffId, shiftDate: s.shiftDate, startTime: s.startTime, endTime: s.endTime, unpaidBreakMinutes: s.unpaidBreakMinutes,
          })));
          this.toasts.show('Move undone.');
        } catch (err) {
          this.toasts.show(toApiError(err).message, 'block');
        }
      },
    }, 8000);
  }

  protected openNew(staffId: number | null, date: string): void {
    const def = this.session.defaultShiftDefinition();
    this.edit.set({
      shiftId: null, staffId: staffId ?? this.staffOptions()[0]?.staffId ?? 0, shiftDate: date,
      startTime: toHHmm(def?.startTime ?? '08:00'), endTime: toHHmm(def?.endTime ?? '16:30'), unpaidBreakMinutes: def?.unpaidBreakMinutes ?? null,
    });
    this.shiftSheet().open();
  }

  protected openEdit(s: Shift): void {
    this.edit.set({
      shiftId: s.shiftId, staffId: s.staffId, shiftDate: s.shiftDate, startTime: toHHmm(s.startTime), endTime: toHHmm(s.endTime), unpaidBreakMinutes: s.unpaidBreakMinutes,
    });
    this.shiftSheet().open();
  }

  protected applyDefinition(e: EditState, start: string, end: string, breakMin: number | null): void {
    e.startTime = toHHmm(start);
    e.endTime = toHHmm(end);
    e.unpaidBreakMinutes = breakMin;
    this.edit.set({ ...e });
  }

  protected hasFieldErrors(): boolean {
    return Object.keys(this.m.fields()).length > 0;
  }

  protected async save(): Promise<void> {
    const e = this.edit()!;
    const body: SaveShift = {
      locationId: this.week()!.locationId, staffId: e.staffId, shiftDate: e.shiftDate, startTime: e.startTime, endTime: e.endTime,
      unpaidBreakMinutes: e.unpaidBreakMinutes === null || (e.unpaidBreakMinutes as unknown) === '' ? null : Number(e.unpaidBreakMinutes),
    };
    const before = new Set(this.week()!.shifts.map((s) => s.shiftId));
    const w = await this.m.run(() => (e.shiftId ? this.api.updateShift(e.shiftId, body) : this.api.createShift(body)));
    if (!w) {
      focusFirstError(this.host.nativeElement);
      return;
    }
    this.apply(w);
    this.shiftSheet().close();
    // The control that opened the sheet may have been replaced, so focus the saved shift instead.
    this.focusLater(`#shift-${e.shiftId ?? w.shifts.find((s) => !before.has(s.shiftId))?.shiftId}`);
    this.toasts.show(e.shiftId ? 'Shift updated. Checks re-run.' : 'Shift added. Checks re-run.');
  }

  /** Delete without a confirm step, but with Undo: the deleted shift is re-created exactly as it was. */
  protected async remove(shiftId: number): Promise<void> {
    const s = this.week()!.shifts.find((x) => x.shiftId === shiftId)!;
    const w = await this.m.run(() => this.api.deleteShift(shiftId));
    if (!w) return;
    this.apply(w);
    this.shiftSheet().close();
    this.focusLater(`button[aria-label="Add shift for ${this.nameOf(s.staffId)} on ${day(s.shiftDate)}"]`);
    this.toasts.show(`Shift for ${this.nameOf(s.staffId)} on ${day(s.shiftDate)} deleted.`, 'neutral', {
      label: 'Undo',
      run: async () => {
        try {
          this.apply(await firstValueFrom(this.api.createShift({
            locationId: s.locationId, staffId: s.staffId, shiftDate: s.shiftDate, startTime: s.startTime, endTime: s.endTime,
            unpaidBreakMinutes: s.unpaidBreakMinutes, isPublished: s.isPublished,
          })));
          this.toasts.show('Shift restored.');
        } catch (err) {
          this.toasts.show(toApiError(err).message, 'block');
        }
      },
    }, 8000);
  }

  protected async fill(): Promise<void> {
    const w = this.week()!;
    const r = await this.m.run(() => this.api.fill(w.locationId, w.weekStart));
    if (!r) {
      this.toasts.show(this.m.error()?.message ?? 'Could not fill the week.', 'block');
      return;
    }
    this.apply(r.week);
    this.toasts.show(r.created === 0 ? 'Nothing to add: everyone with a pattern already has a shift or is off.' : `${r.created} draft shift${r.created === 1 ? '' : 's'} added from work patterns.`);
  }

  private readonly confirm = inject(Confirm);

  protected async startPublish(): Promise<void> {
    if (this.blocks().length > 0) {
      this.overrideReason = '';
      this.pm.reset();
      this.publishSheet().open();
      return;
    }
    // Publishing notifies everyone, so say what goes out and which warnings are being accepted.
    const w = this.week()!;
    const warnings = w.issues.filter((i) => i.severity !== 'Block').map((i) => i.message);
    const answer = await this.confirm.ask({
      title: `Publish ${w.draftCount} shift${w.draftCount === 1 ? '' : 's'}?`,
      body: warnings.length
        ? `Staff at ${this.session.locationName(w.locationId)} are notified. These warnings stay open:`
        : `Staff at ${this.session.locationName(w.locationId)} are notified straight away. All checks pass.`,
      confirmLabel: 'Publish and notify',
      details: warnings.length > 8 ? [...warnings.slice(0, 8), `and ${warnings.length - 8} more`] : warnings,
    });
    if (answer.confirmed) void this.publish(false);
  }

  protected async publish(withOverride: boolean): Promise<void> {
    const w = this.week()!;
    const mut = withOverride ? this.pm : this.m;
    const r = await mut.run(() => this.api.publish(w.locationId, w.weekStart, withOverride ? this.overrideReason : null));
    if (!r) {
      if (!withOverride) this.toasts.show(mut.error()?.message ?? 'Could not publish.', 'block');
      else focusFirstError(this.host.nativeElement);
      return;
    }
    this.apply(r.week);
    this.publishSheet().close();
    this.toasts.show(`${r.published} shift${r.published === 1 ? '' : 's'} published. Staff have been notified${r.overrides ? ', and the override was logged' : ''}.`);
  }

  private focusLater(selector: string): void {
    setTimeout(() => (this.host.nativeElement.querySelector(selector) as HTMLElement | null)?.focus(), 50);
  }

  private apply(w: ScheduleWeek): void {
    this.week.set(w);
    if (!w.days.some((d) => d.date === this.phoneDay())) this.phoneDay.set(w.days.find((d) => d.date === this.today())?.date ?? w.days[0].date);
  }
}
