import { Injectable, signal } from '@angular/core';

export interface ConfirmRequest {
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  /** Ask for a short text (for example a reason) before confirming. */
  input?: { label: string; required: boolean; maxLength: number; help?: string; value?: string };
  /** Extra lines shown as a list, for example the warnings a publish will ignore. */
  details?: string[];
}

export type ConfirmResult = { confirmed: false } | { confirmed: true; text: string };

/**
 * One confirm dialog for risky actions (publish, deactivate, reject, remove), rendered by the shell.
 * Callers await the answer; nothing happens unless the person confirms.
 */
@Injectable({ providedIn: 'root' })
export class Confirm {
  readonly request = signal<ConfirmRequest | null>(null);
  private resolve: ((r: ConfirmResult) => void) | null = null;

  ask(req: ConfirmRequest): Promise<ConfirmResult> {
    this.resolve?.({ confirmed: false });
    this.request.set(req);
    return new Promise((res) => (this.resolve = res));
  }

  answer(result: ConfirmResult): void {
    this.resolve?.(result);
    this.resolve = null;
    this.request.set(null);
  }
}
