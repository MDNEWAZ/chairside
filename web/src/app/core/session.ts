import { Injectable, computed, inject, signal } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { Api, toApiError } from './api';
import { Lookups, Me, Role, ShiftDefinitionItem } from './models';

/** The signed-in person and clinic lookups, loaded once per session. */
@Injectable({ providedIn: 'root' })
export class Session {
  private readonly api = inject(Api);
  private loaded = false;

  readonly me = signal<Me | null>(null);
  readonly lookups = signal<Lookups | null>(null);
  /** Set when the start-up check could not reach the server (offline or a server error), as opposed to "signed out". */
  readonly unreachable = signal<string | null>(null);
  readonly role = computed<Role | null>(() => this.me()?.role ?? null);
  readonly isOwner = computed(() => this.role() === 'owner_admin');
  readonly isManager = computed(() => this.role() === 'owner_admin' || this.role() === 'practice_manager');
  readonly timeZone = computed(() => this.me()?.clinic.timeZoneId ?? 'America/New_York');

  /** Resolves to the signed-in person, or null. Called by guards; hits the API once. */
  async ensure(): Promise<Me | null> {
    if (this.loaded) return this.me();
    // One start-up round trip for the person and the clinic lookups; a signed-out visit gets null, not an error.
    try {
      const session = await firstValueFrom(this.api.session());
      this.me.set(session?.me ?? null);
      this.lookups.set(session?.lookups ?? null);
      this.unreachable.set(null);
    } catch (e) {
      const err = toApiError(e);
      this.me.set(null);
      // Offline or a server fault is not "signed out": show a retry screen instead of the sign-in page, and try again next time.
      if (err.status === 0 || err.status >= 500) {
        this.unreachable.set(err.status === 0 ? 'Chairside cannot reach the server. Check your internet connection.' : 'Chairside is having trouble on our side.');
        return null;
      }
    }
    this.loaded = true;
    return this.me();
  }

  async set(me: Me): Promise<void> {
    this.me.set(me);
    this.loaded = true;
    await this.refreshLookups();
  }

  async refreshLookups(): Promise<void> {
    this.lookups.set(await firstValueFrom(this.api.lookups()));
  }

  clear(): void {
    this.me.set(null);
    this.lookups.set(null);
    this.loaded = true;
  }

  locationName(id: number | null | undefined): string {
    return this.lookups()?.locations.find((l) => l.id === id)?.name ?? '';
  }

  /** The longest shift type (normally "Full day"): the sensible default for new patterns and shifts. */
  defaultShiftDefinition(): ShiftDefinitionItem | undefined {
    const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
    return [...(this.lookups()?.shiftDefinitions ?? [])].sort((a, b) =>
      (minutes(b.endTime) - minutes(b.startTime)) - (minutes(a.endTime) - minutes(a.startTime)))[0];
  }

  homeRoute(): string {
    return this.isManager() ? '/today' : '/my';
  }
}

// Guards inject everything before the first await: inject() only works synchronously in the injection context.
export const signedIn: CanActivateFn = async (_route, state) => {
  const session = inject(Session);
  const router = inject(Router);
  if (await session.ensure()) return true;
  return session.unreachable() ? false : router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
};

export const managersOnly: CanActivateFn = async () => {
  const session = inject(Session);
  const router = inject(Router);
  await session.ensure();
  return session.isManager() ? true : router.createUrlTree(['/my']);
};

export const ownerOnly: CanActivateFn = async () => {
  const session = inject(Session);
  const router = inject(Router);
  await session.ensure();
  return session.isOwner() ? true : router.createUrlTree([session.homeRoute()]);
};

export const signedOut: CanActivateFn = async () => {
  const session = inject(Session);
  const router = inject(Router);
  return (await session.ensure()) ? router.createUrlTree([session.homeRoute()]) : true;
};

export const homeRedirect: CanActivateFn = async () => {
  const session = inject(Session);
  const router = inject(Router);
  const me = await session.ensure();
  return session.unreachable() ? false : router.createUrlTree([me ? session.homeRoute() : '/login']);
};
