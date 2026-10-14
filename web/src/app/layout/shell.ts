import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, firstValueFrom } from 'rxjs';
import { Api } from '../core/api';
import { instant } from '../core/format';
import { Notifications, ROLE_LABEL } from '../core/models';
import { Session } from '../core/session';
import { Toasts } from '../core/toast';
import { Avatar, Logo } from '../shared/brand';
import { Icon, IconName } from '../shared/icons';
import { Sheet } from '../shared/ui';

interface NavItem { path: string; label: string; icon: IconName; show: () => boolean; tab: boolean }
type Theme = 'system' | 'light' | 'dark';

@Component({
  selector: 'app-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Sheet, Icon, Logo, Avatar],
  template: `
    <a class="skip-link" href="#main" (click)="skipToMain($event)">Skip to main content</a>

    <div class="min-h-dvh md:grid md:grid-cols-[16.5rem_1fr]">
      <!-- Desktop sidebar -->
      <aside class="hidden border-r border-line bg-surface md:sticky md:top-0 md:flex md:h-dvh md:flex-col" aria-label="Sidebar">
        <div class="px-5 pb-4 pt-6"><app-logo [caption]="session.me()?.clinic?.name ?? ''" /></div>
        <nav aria-label="Main" class="flex-1 overflow-y-auto px-3">
          <ul class="flex flex-col gap-0.5">
            @for (item of nav(); track item.path) {
              <li>
                <a [routerLink]="item.path" routerLinkActive #rla="routerLinkActive" ariaCurrentWhenActive="page"
                   class="group relative flex min-h-11 items-center gap-3 rounded-control px-3 text-sm font-medium transition-colors"
                   [class]="rla.isActive ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-raised hover:text-ink'">
                  @if (rla.isActive) { <span class="absolute -left-3 top-2 bottom-2 w-1 rounded-r-full bg-accent" aria-hidden="true"></span> }
                  <app-icon [name]="item.icon" [size]="19" />
                  {{ item.label }}
                </a>
              </li>
            }
          </ul>
        </nav>
        <div class="border-t border-line p-3">
          <div class="flex items-center gap-1">
            <button type="button" class="btn btn-quiet btn-icon relative" (click)="openNotifications()" [attr.aria-label]="'Notifications, ' + unread() + ' unread'">
              <app-icon name="bell" />
              @if (unread() > 0) { <span class="reading absolute right-1.5 top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-bold text-on-accent">{{ unread() }}</span> }
            </button>
            <button type="button" class="btn btn-quiet btn-icon" (click)="cycleTheme()" [attr.aria-label]="'Theme: ' + theme() + '. Change theme'">
              <app-icon [name]="theme() === 'dark' ? 'moon' : theme() === 'light' ? 'sun' : 'monitor'" />
            </button>
            <button type="button" class="btn btn-quiet btn-icon ml-auto" (click)="signOut()" aria-label="Sign out"><app-icon name="log-out" /></button>
          </div>
          <a [routerLink]="['/staff', session.me()?.staffId]" class="mt-2 flex items-center gap-3 rounded-control p-2 hover:bg-raised">
            <app-avatar [name]="fullName()" [job]="session.me()?.jobTitle ?? null" [size]="36" />
            <span class="min-w-0 leading-tight">
              <span class="block truncate text-sm font-semibold">{{ fullName() }}</span>
              <span class="block truncate text-xs text-muted">{{ session.me()?.jobTitle }} · {{ session.me()?.homeLocationName }}</span>
            </span>
          </a>
        </div>
      </aside>

      <div class="min-w-0 pb-24 md:pb-0">
        <!-- Phone app bar -->
        <header class="sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-line bg-surface/90 px-4 py-2 backdrop-blur md:hidden">
          <app-logo [size]="30" [caption]="session.me()?.clinic?.name ?? ''" />
          <div class="flex items-center">
            <button type="button" class="btn btn-quiet btn-icon relative" (click)="openNotifications()" [attr.aria-label]="'Notifications, ' + unread() + ' unread'">
              <app-icon name="bell" />
              @if (unread() > 0) { <span class="reading absolute right-1.5 top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-bold text-on-accent">{{ unread() }}</span> }
            </button>
          </div>
        </header>

        @if (session.me()?.clinic?.isDemo) {
          <p class="flex items-center gap-2 border-b border-line bg-accent-soft px-4 py-2 text-sm text-accent md:px-8">
            <app-icon name="sparkles" [size]="16" />
            <span>Demo clinic with sample data, shared by everyone trying Chairside. Email and billing are simulated.</span>
          </p>
        }
        <main id="main" #main tabindex="-1" class="mx-auto max-w-6xl px-4 py-6 outline-none md:px-10 md:py-9">
          <router-outlet />
        </main>
      </div>
    </div>

    <!-- Phone tab bar: the four most-used places, within thumb reach -->
    <nav aria-label="Main" class="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 backdrop-blur md:hidden" style="padding-bottom: env(safe-area-inset-bottom)">
      <ul class="grid" [style.grid-template-columns]="'repeat(' + (tabs().length + 1) + ', minmax(0, 1fr))'">
        @for (item of tabs(); track item.path) {
          <li>
            <a [routerLink]="item.path" routerLinkActive #tla="routerLinkActive" ariaCurrentWhenActive="page"
               class="flex min-h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium"
               [class]="tla.isActive ? 'text-accent' : 'text-muted'">
              <span class="grid h-7 w-12 place-items-center rounded-full transition-colors" [class.bg-accent-soft]="tla.isActive"><app-icon [name]="item.icon" [size]="20" /></span>
              {{ item.label }}
            </a>
          </li>
        }
        <li>
          <button type="button" class="flex min-h-16 w-full flex-col items-center justify-center gap-1 text-[11px] font-medium text-muted" (click)="more().open()">
            <span class="grid h-7 w-12 place-items-center rounded-full"><app-icon name="more" [size]="20" /></span>
            More
          </button>
        </li>
      </ul>
    </nav>

    <app-sheet #moreSheet heading="More">
      <a [routerLink]="['/staff', session.me()?.staffId]" (click)="more().close()" class="mb-3 flex items-center gap-3 rounded-card border border-line p-3">
        <app-avatar [name]="fullName()" [job]="session.me()?.jobTitle ?? null" [size]="40" />
        <span class="min-w-0"><span class="block font-semibold">{{ fullName() }}</span>
          <span class="block truncate text-sm text-muted">{{ roleLabel() }} · {{ session.me()?.homeLocationName }}</span></span>
      </a>
      <ul class="divide-y divide-line">
        @for (item of overflow(); track item.path) {
          <li><a [routerLink]="item.path" (click)="more().close()" class="flex min-h-12 items-center gap-3 text-sm font-medium"><app-icon [name]="item.icon" />{{ item.label }}</a></li>
        }
        <li>
          <button type="button" class="flex min-h-12 w-full items-center gap-3 text-sm font-medium" (click)="cycleTheme()">
            <app-icon [name]="theme() === 'dark' ? 'moon' : theme() === 'light' ? 'sun' : 'monitor'" /> Theme: {{ theme() }}
          </button>
        </li>
        <li><button type="button" class="flex min-h-12 w-full items-center gap-3 text-sm font-medium text-block" (click)="more().close(); signOut()"><app-icon name="log-out" /> Sign out</button></li>
      </ul>
    </app-sheet>

    <app-sheet #notificationsSheet heading="Notifications">
      @if (notifications(); as n) {
        @if (n.items.length === 0) {
          <div class="py-6 text-center">
            <span class="mx-auto grid h-12 w-12 place-items-center rounded-full bg-accent-soft text-accent"><app-icon name="bell" [size]="22" /></span>
            <p class="mt-3 font-medium">You are all caught up</p>
            <p class="help mt-1">Schedule changes and leave decisions will show up here.</p>
          </div>
        } @else {
          <ul class="divide-y divide-line">
            @for (item of n.items; track item.notificationId) {
              <li class="flex gap-3 py-3">
                <span class="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full" [class]="item.isRead ? 'bg-raised text-muted' : 'bg-accent-soft text-accent'">
                  <app-icon [name]="iconFor(item.type)" [size]="16" />
                </span>
                <div class="min-w-0">
                  <p [class.font-semibold]="!item.isRead">{{ item.message }}</p>
                  <p class="mt-0.5 text-xs text-muted">{{ when(item.createdAtUtc) }}{{ item.isRead ? '' : ' · New' }}</p>
                </div>
              </li>
            }
          </ul>
          <p class="help mt-3">Each notification is also sent by email (simulated in this prototype).</p>
        }
      } @else {
        <div class="skeleton h-16"></div>
      }
    </app-sheet>

    <div class="pointer-events-none fixed inset-x-0 bottom-20 z-40 flex flex-col items-center gap-2 px-4 md:bottom-6" aria-live="polite" role="status">
      @for (t of toasts.items(); track t.id) {
        <div class="enter pointer-events-auto flex max-w-md items-center gap-3 rounded-card bg-ink px-4 py-3 text-sm text-bg" style="box-shadow: var(--shadow-2)">
          <app-icon [name]="t.tone === 'block' ? 'circle-alert' : t.tone === 'neutral' ? 'info' : 'circle-check'" [size]="18" />
          <span>{{ t.message }}</span>
          @if (t.action; as a) {
            <button type="button" class="ml-1 inline-flex items-center gap-1 font-semibold underline underline-offset-2" (click)="a.run(); toasts.dismiss(t.id)"><app-icon name="undo" [size]="15" />{{ a.label }}</button>
          }
          <button type="button" class="ml-auto opacity-80 hover:opacity-100" (click)="toasts.dismiss(t.id)" aria-label="Dismiss message"><app-icon name="x" [size]="16" /></button>
        </div>
      }
    </div>
  `,
})
export class Shell {
  protected readonly session = inject(Session);
  protected readonly toasts = inject(Toasts);
  private readonly api = inject(Api);
  private readonly router = inject(Router);
  private readonly main = viewChild.required<ElementRef<HTMLElement>>('main');
  private readonly sheet = viewChild.required<Sheet>('notificationsSheet');
  protected readonly more = viewChild.required<Sheet>('moreSheet');

  protected readonly notifications = signal<Notifications | null>(null);
  protected readonly unread = computed(() => this.notifications()?.unread ?? 0);
  protected readonly theme = signal<Theme>(this.readTheme());
  protected readonly fullName = computed(() => `${this.session.me()?.firstName ?? ''} ${this.session.me()?.lastName ?? ''}`.trim());
  protected readonly roleLabel = computed(() => (this.session.role() ? ROLE_LABEL[this.session.role()!] : ''));

  private readonly items: NavItem[] = [
    { path: '/today', label: 'Today', icon: 'dashboard', show: () => this.session.isManager(), tab: true },
    { path: '/my', label: 'My day', icon: 'clock', show: () => true, tab: true },
    { path: '/schedule', label: 'Schedule', icon: 'calendar', show: () => true, tab: true },
    { path: '/leave', label: 'Leave', icon: 'leave', show: () => true, tab: true },
    { path: '/attendance', label: 'Attendance', icon: 'clipboard', show: () => this.session.isManager(), tab: false },
    { path: '/staff', label: 'Staff', icon: 'users', show: () => true, tab: !this.session.isManager() },
    { path: '/settings', label: 'Settings', icon: 'settings', show: () => this.session.isOwner(), tab: false },
    { path: '/audit', label: 'Audit log', icon: 'audit', show: () => this.session.isOwner(), tab: false },
  ];
  protected readonly nav = computed(() => (this.session.role(), this.items.filter((i) => i.show())));
  protected readonly tabs = computed(() => this.nav().filter((i) => i.tab).slice(0, 4));
  protected readonly overflow = computed(() => this.nav().filter((i) => !this.tabs().includes(i)));

  constructor() {
    void this.refreshNotifications();
    // On each navigation, move focus to the new page's heading so screen readers announce it.
    this.router.events.pipe(filter((e) => e instanceof NavigationEnd), takeUntilDestroyed(inject(DestroyRef))).subscribe(() => {
      setTimeout(() => (this.main().nativeElement.querySelector('h1') as HTMLElement | null)?.focus());
      void this.refreshNotifications();
    });
  }

  protected skipToMain(event: Event): void {
    event.preventDefault();
    this.main().nativeElement.focus();
  }

  protected iconFor(type: string): IconName {
    if (type.startsWith('schedule')) return 'calendar-check';
    if (type.startsWith('leave')) return 'leave';
    if (type.includes('clock')) return 'clock';
    if (type.includes('credential')) return 'shield';
    return 'bell';
  }

  protected async openNotifications(): Promise<void> {
    this.sheet().open();
    try {
      const n = await firstValueFrom(this.api.markRead());
      // Show what was unread at open time, then clear the counter.
      this.notifications.update((prev) => ({ unread: 0, items: prev?.items ?? n.items }));
      setTimeout(() => this.notifications.set(n), 4000);
    } catch {
      this.toasts.show('Could not load notifications. Try again.', 'block');
    }
  }

  protected when(utc: string): string {
    return instant(utc, this.session.timeZone(), true);
  }

  protected cycleTheme(): void {
    const next: Theme = this.theme() === 'system' ? 'dark' : this.theme() === 'dark' ? 'light' : 'system';
    this.theme.set(next);
    if (next === 'system') delete document.documentElement.dataset['theme'];
    else document.documentElement.dataset['theme'] = next;
    try {
      if (next === 'system') localStorage.removeItem('chairside.theme');
      else localStorage.setItem('chairside.theme', next);
    } catch {
      // Storage may be blocked; the theme still applies for this visit.
    }
  }

  protected async signOut(): Promise<void> {
    try {
      await firstValueFrom(this.api.logout());
    } finally {
      this.session.clear();
      await this.router.navigate(['/login']);
    }
  }

  private async refreshNotifications(): Promise<void> {
    try {
      this.notifications.set(await firstValueFrom(this.api.notifications()));
    } catch {
      // The bell simply shows no count if this fails; pages report their own errors.
    }
  }

  private readTheme(): Theme {
    const t = document.documentElement.dataset['theme'];
    return t === 'light' || t === 'dark' ? t : 'system';
  }
}
