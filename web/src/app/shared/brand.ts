import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * The Chairside mark: a molar drawn in one stroke, with a check where the roots meet —
 * "the team is covered and compliant". Uses currentColor so it follows the theme.
 */
@Component({
  selector: 'app-logo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="inline-flex items-center gap-2.5">
      <span class="grid place-items-center rounded-[10px] bg-accent text-on-accent" [style.width.px]="size()" [style.height.px]="size()"
            style="box-shadow: inset 0 -2px 0 rgb(0 0 0 / 0.12)">
        <svg [attr.width]="size() * 0.66" [attr.height]="size() * 0.66" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M7.2 3.2C4.9 3.2 3.4 5 3.4 7.4c0 2.3.8 3.9 1.4 5.8.7 2.3 1 6.6 2.8 6.6 1.5 0 1.6-4.1 3.3-4.1h2.2c1.7 0 1.8 4.1 3.3 4.1 1.8 0 2.1-4.3 2.8-6.6.6-1.9 1.4-3.5 1.4-5.8 0-2.4-1.5-4.2-3.8-4.2-1.7 0-2.6 1-4.2 1h-.8c-1.6 0-2.5-1-4.2-1z" />
          <path d="M9.2 9.6l1.9 1.9 3.8-3.9" />
        </svg>
      </span>
      @if (wordmark()) {
        <span class="leading-tight">
          <span class="block text-[1.05rem] font-semibold tracking-tight" style="font-family: var(--font-display)">Chairside</span>
          @if (caption()) { <span class="block truncate text-xs text-muted">{{ caption() }}</span> }
        </span>
      }
    </span>`,
})
export class Logo {
  readonly size = input(34);
  readonly wordmark = input(true);
  readonly caption = input('');
}

/** Job title to colour class; colour is always shown next to the title text, never alone. */
export function jobClass(jobTitle: string | null | undefined): string {
  const t = (jobTitle ?? '').toLowerCase();
  if (t.includes('dentist')) return 'job job-dentist';
  if (t.includes('hygien')) return 'job job-hygienist';
  if (t.includes('assistant')) return 'job job-assistant';
  if (t.includes('reception')) return 'job job-reception';
  if (t.includes('owner')) return 'job job-owner';
  return 'job';
}

@Component({
  selector: 'app-avatar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-hidden': 'true', class: 'inline-flex' },
  template: `<span [class]="'avatar ' + jobClass(job())" [style.width.px]="size()" [style.height.px]="size()" [style.fontSize.px]="size() * 0.38">{{ initials() }}</span>`,
})
export class Avatar {
  readonly name = input.required<string>();
  readonly job = input<string | null>(null);
  readonly size = input(32);
  protected readonly jobClass = jobClass;
  protected readonly initials = computed(() =>
    this.name().split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join(''));
}
