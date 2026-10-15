import {
  ChangeDetectionStrategy, Component, ElementRef, Signal, WritableSignal, computed, input, output, signal, viewChild,
} from '@angular/core';
import { Observable, firstValueFrom } from 'rxjs';
import { ApiError, toApiError } from '../core/api';
import { Icon } from './icons';

type BadgeTone = 'ok' | 'warn' | 'block' | 'neutral' | 'accent';

// Charting notation: every status is a symbol AND a word, never colour alone.
const STATUS: Record<string, { tone: BadgeTone; mark: string; label: string }> = {
  valid: { tone: 'ok', mark: '✓', label: 'Valid' },
  approved: { tone: 'ok', mark: '✓', label: 'Approved' },
  published: { tone: 'ok', mark: '✓', label: 'Published' },
  active: { tone: 'ok', mark: '✓', label: 'Active' },
  clocked_in: { tone: 'accent', mark: '●', label: 'Clocked in' },
  clocked_out: { tone: 'neutral', mark: '✓', label: 'Clocked out' },
  not_in: { tone: 'neutral', mark: '○', label: 'Not in yet' },
  pending: { tone: 'warn', mark: '◐', label: 'Pending' },
  draft: { tone: 'neutral', mark: '◌', label: 'Draft' },
  expiring: { tone: 'warn', mark: '!', label: 'Expiring soon' },
  flagged: { tone: 'warn', mark: '!', label: 'Flagged' },
  warning: { tone: 'warn', mark: '!', label: 'Warning' },
  unscheduled: { tone: 'warn', mark: '!', label: 'Unscheduled' },
  missing: { tone: 'block', mark: '✕', label: 'Missing' },
  expired: { tone: 'block', mark: '✕', label: 'Expired' },
  rejected: { tone: 'block', mark: '✕', label: 'Rejected' },
  block: { tone: 'block', mark: '✕', label: 'Blocks publishing' },
  deactivated: { tone: 'neutral', mark: '○', label: 'Deactivated' },
  overtime: { tone: 'warn', mark: '!', label: 'Overtime' },
};

@Component({
  selector: 'app-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="badge" [class]="'badge-' + spec().tone"><span aria-hidden="true">{{ spec().mark }}</span>{{ label() || spec().label }}</span>`,
})
export class Badge {
  readonly status = input.required<string>();
  readonly label = input<string>('');
  protected readonly spec = computed(() => STATUS[this.status()] ?? { tone: 'neutral' as const, mark: '•', label: this.status() });
}

@Component({
  selector: 'app-page-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="enter mb-7 flex flex-wrap items-end justify-between gap-4">
      <div class="min-w-0">
        @if (eyebrow()) { <p class="eyebrow mb-1.5">{{ eyebrow() }}</p> }
        <h1 class="page-title" tabindex="-1" #heading>{{ title() }}</h1>
        @if (subtitle()) { <p class="mt-1.5 max-w-2xl text-sm text-muted">{{ subtitle() }}</p> }
      </div>
      <div class="flex flex-wrap items-center gap-2"><ng-content /></div>
    </header>`,
})
export class PageHeader {
  readonly title = input.required<string>();
  readonly subtitle = input<string>('');
  readonly eyebrow = input<string>('');
}

/**
 * Modal sheet on the native <dialog>: the browser traps focus and closes on Escape.
 * We restore focus to whatever opened it, as the quality gates require.
 */
@Component({
  selector: 'app-sheet',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog #dialog class="sheet" [attr.aria-labelledby]="titleId" (close)="finish()" (cancel)="$event.preventDefault(); close()">
      <div class="flex items-center justify-between gap-3 border-b border-line px-5 py-2.5">
        <h2 class="section-title" [id]="titleId">{{ heading() }}</h2>
        <button type="button" class="btn btn-quiet btn-icon -mr-2" (click)="close()" aria-label="Close"><app-icon name="x" /></button>
      </div>
      <div class="max-h-[75vh] overflow-y-auto px-5 py-4"><ng-content /></div>
    </dialog>`,
})
export class Sheet {
  private static counter = 0;
  readonly heading = input.required<string>();
  readonly closed = output<void>();
  protected readonly titleId = `sheet-title-${++Sheet.counter}`;
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private opener: HTMLElement | null = null;

  // Clicking a button does not focus it in every browser (Safari), so remember the last control the user activated.
  // Keyboard activation (Enter/Space) also fires click, so this covers keyboard users too.
  private static lastActivated: HTMLElement | null = null;
  private static lastActivatedAt = 0;
  static {
    document.addEventListener('click', (e) => {
      Sheet.lastActivated = (e.target as HTMLElement | null)?.closest('button, a, [tabindex]') as HTMLElement | null;
      Sheet.lastActivatedAt = Date.now();
    }, true);
  }

  open(): void {
    const recent = Date.now() - Sheet.lastActivatedAt < 1000 ? Sheet.lastActivated : null;
    this.opener = recent ?? (document.activeElement as HTMLElement | null);
    this.isOpen = true;
    if (!this.dialog().nativeElement.open) this.dialog().nativeElement.showModal();
  }

  /** Close button, Escape and callers all come here, so focus is restored without waiting for the native close event. */
  close(): void {
    if (this.dialog().nativeElement.open) this.dialog().nativeElement.close();
    this.finish();
  }

  protected finish(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.closed.emit();
    this.opener?.focus();
    this.opener = null;
  }

  private isOpen = false;
}

@Component({
  selector: 'app-error-state',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="alert alert-block" role="alert">
      <app-icon name="circle-alert" class="mt-0.5" />
      <div class="flex-1">
        <p class="font-medium">{{ message() }}</p>
        @if (retryable()) { <button type="button" class="btn btn-sm mt-2" (click)="retry.emit()">Try again</button> }
      </div>
    </div>`,
})
export class ErrorState {
  readonly message = input.required<string>();
  readonly retryable = input(true);
  readonly retry = output<void>();
}

@Component({
  selector: 'app-no-access',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="card p-6"><p class="font-medium">You do not have access to this page.</p><p class="help mt-1">Ask your clinic's Owner / Admin if you need it.</p></div>`,
})
export class NoAccess {}

/** Loading, error and data for one API call, as signals. Keeps every screen's states consistent. */
export class Loader<T> {
  readonly data: WritableSignal<T | null> = signal(null);
  readonly loading = signal(false);
  readonly error = signal<ApiError | null>(null);

  private seq = 0;

  constructor(private readonly fetch: () => Observable<T>) {}

  /** Loads again; when calls overlap (fast week or location switching) only the latest answer is kept. */
  async load(): Promise<void> {
    const ticket = ++this.seq;
    this.loading.set(true);
    this.error.set(null);
    try {
      const data = await firstValueFrom(this.fetch());
      if (ticket === this.seq) this.data.set(data);
    } catch (e) {
      if (ticket === this.seq) this.error.set(toApiError(e));
    } finally {
      if (ticket === this.seq) this.loading.set(false);
    }
  }
}

/** Runs a mutation and exposes busy and field errors for a form. */
export class Mutation {
  readonly busy = signal(false);
  readonly error = signal<ApiError | null>(null);
  readonly fields: Signal<Record<string, string>> = computed(() => this.error()?.fields ?? {});

  async run<T>(call: () => Observable<T>): Promise<T | null> {
    this.busy.set(true);
    this.error.set(null);
    try {
      return await firstValueFrom(call());
    } catch (e) {
      this.error.set(toApiError(e));
      return null;
    } finally {
      this.busy.set(false);
    }
  }

  reset(): void {
    this.error.set(null);
  }
}

/**
 * After a failed submit: ties each invalid field to its error text (aria-describedby, keeping any help text)
 * and moves focus to the first one, so keyboard and screen reader users land on the error and hear it.
 */
export function focusFirstError(host: HTMLElement): void {
  setTimeout(() => {
    const invalid = Array.from(host.querySelectorAll<HTMLElement>('[aria-invalid="true"]'));
    invalid.forEach((input, i) => {
      const scope = input.closest('.field') ?? input.parentElement;
      const sibling = scope?.nextElementSibling;
      const error = scope?.querySelector<HTMLElement>('.field-error')
        ?? (sibling?.classList.contains('field-error') ? (sibling as HTMLElement) : null);
      if (!error) return;
      if (!error.id) error.id = `${input.id || 'field-' + i}-error`;
      const ids = new Set((input.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean));
      ids.add(error.id);
      input.setAttribute('aria-describedby', [...ids].join(' '));
    });
    invalid[0]?.focus();
  });
}
