import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Session } from './core/session';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet],
  template: `
    @if (session.unreachable(); as problem) {
      <main class="grid min-h-dvh place-items-center p-4">
        <div class="card max-w-md p-6 text-center" role="alert">
          <h1 class="section-title text-xl">We could not load Chairside</h1>
          <p class="mt-2 text-muted">{{ problem }} Your data is safe; nothing was changed.</p>
          <button type="button" class="btn btn-primary mt-5" (click)="retry()">Try again</button>
        </div>
      </main>
    } @else {
      <router-outlet />
    }
  `,
})
export class App {
  protected readonly session = inject(Session);

  protected retry(): void {
    location.reload();
  }
}
