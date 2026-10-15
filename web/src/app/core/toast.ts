import { Injectable, signal } from '@angular/core';

export interface Toast {
  id: number;
  message: string;
  tone: 'ok' | 'block' | 'neutral';
  action?: { label: string; run: () => void };
}

/**
 * Status messages, announced through live regions in the shell (errors assertively). Undo actions live here.
 * Timers pause while the pointer or keyboard focus is on a toast, so nobody loses an Undo mid-reach (WCAG 2.2.1).
 */
@Injectable({ providedIn: 'root' })
export class Toasts {
  private nextId = 1;
  private readonly timers = new Map<number, { remaining: number; started: number; handle: ReturnType<typeof setTimeout> | null }>();
  readonly items = signal<Toast[]>([]);

  show(message: string, tone: Toast['tone'] = 'ok', action?: Toast['action'], ms = 6000): void {
    const toast: Toast = { id: this.nextId++, message, tone, action };
    this.items.update((list) => [...list.slice(-2), toast]);
    this.timers.set(toast.id, { remaining: action ? Math.max(ms, 10000) : ms, started: 0, handle: null });
    this.resume(toast.id);
  }

  pause(id: number): void {
    const t = this.timers.get(id);
    if (!t?.handle) return;
    clearTimeout(t.handle);
    t.handle = null;
    t.remaining -= Date.now() - t.started;
  }

  resume(id: number): void {
    const t = this.timers.get(id);
    if (!t || t.handle) return;
    t.started = Date.now();
    t.handle = setTimeout(() => this.dismiss(id), Math.max(1500, t.remaining));
  }

  dismiss(id: number): void {
    const t = this.timers.get(id);
    if (t?.handle) clearTimeout(t.handle);
    this.timers.delete(id);
    this.items.update((list) => list.filter((x) => x.id !== id));
  }
}
