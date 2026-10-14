import { Injectable, signal } from '@angular/core';

export interface Toast {
  id: number;
  message: string;
  tone: 'ok' | 'block' | 'neutral';
  action?: { label: string; run: () => void };
}

/** Status messages, announced through an aria-live region in the shell. Undo actions live here. */
@Injectable({ providedIn: 'root' })
export class Toasts {
  private nextId = 1;
  readonly items = signal<Toast[]>([]);

  show(message: string, tone: Toast['tone'] = 'ok', action?: Toast['action'], ms = 6000): void {
    const toast: Toast = { id: this.nextId++, message, tone, action };
    this.items.update((list) => [...list.slice(-2), toast]);
    setTimeout(() => this.dismiss(toast.id), ms);
  }

  dismiss(id: number): void {
    this.items.update((list) => list.filter((t) => t.id !== id));
  }
}
