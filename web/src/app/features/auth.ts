import { ChangeDetectionStrategy, Component, ElementRef, OnInit, inject, input, signal } from '@angular/core';
import { FormArray, FormControl, FormGroup, NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { Api } from '../core/api';
import { Me } from '../core/models';
import { Session } from '../core/session';
import { Mutation, focusFirstError } from '../shared/ui';
import { Avatar, Logo } from '../shared/brand';
import { Icon, IconName } from '../shared/icons';

const US_ZONES = [
  ['America/New_York', 'Eastern'], ['America/Chicago', 'Central'], ['America/Denver', 'Mountain'], ['America/Phoenix', 'Arizona'],
  ['America/Los_Angeles', 'Pacific'], ['America/Anchorage', 'Alaska'], ['Pacific/Honolulu', 'Hawaii'],
] as const;

/**
 * Wraps an auth page. On large screens a brand panel shows what the product does with a live-looking
 * preview built from the real components (not an image), so the value is clear before signing in.
 */
@Component({
  selector: 'app-auth-frame',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Logo, Icon, Avatar],
  template: `
    <a class="skip-link" href="#auth-main">Skip to main content</a>
    <div class="min-h-dvh lg:grid lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <aside class="relative hidden overflow-hidden border-r border-line bg-surface lg:flex lg:flex-col lg:justify-between lg:p-12" aria-label="About Chairside">
        <div class="absolute inset-0 opacity-60" aria-hidden="true"
             style="background-image: linear-gradient(var(--c-line) 1px, transparent 1px); background-size: 100% 32px; mask-image: linear-gradient(to bottom, black, transparent 85%)"></div>
        <div class="relative"><app-logo [size]="40" /></div>

        <div class="relative">
          <p class="eyebrow">Staff scheduling for dental practices</p>
          <p class="page-title mt-3 max-w-md !text-[2.6rem] !leading-[1.05]">The schedule that knows who is licensed, who is off, and who is short.</p>

          <!-- Product preview: real tokens and components, purely illustrative. -->
          <div class="mt-9 max-w-md rotate-[-1deg] rounded-card border border-line bg-surface p-4" style="box-shadow: var(--shadow-2)" aria-hidden="true">
            <div class="flex items-center justify-between">
              <p class="text-sm font-semibold">Week of Oct 19 · Downtown</p>
              <span class="badge badge-block"><app-icon name="shield" [size]="12" />1 blocking</span>
            </div>
            <div class="mt-3 space-y-2">
              @for (row of preview; track row.name) {
                <div class="flex items-center gap-3" [class]="row.job">
                  <app-avatar [name]="row.name" [job]="row.title" [size]="28" />
                  <div class="min-w-0 flex-1">
                    <p class="truncate text-xs font-semibold">{{ row.name }}</p>
                    <p class="text-[11px] text-muted">{{ row.title }}</p>
                  </div>
                  <div class="flex gap-1">
                    @for (d of row.days; track $index) {
                      <span class="h-6 w-7 rounded-[5px] border" [style.background]="d ? 'var(--job-bg)' : 'transparent'"
                            [style.borderColor]="d === 2 ? 'var(--c-block)' : d ? 'color-mix(in srgb, var(--job) 35%, transparent)' : 'var(--c-line)'"></span>
                    }
                  </div>
                </div>
              }
            </div>
            <p class="mt-3 flex items-center gap-2 rounded-control bg-block-bg px-2.5 py-2 text-xs text-block">
              <app-icon name="warning" [size]="14" /> Lucas Moreno's dental licence expired on Oct 11.
            </p>
          </div>
        </div>

        <ul class="relative grid max-w-md gap-3 text-sm">
          @for (b of benefits; track b.text) {
            <li class="flex items-start gap-3"><span class="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent-soft text-accent"><app-icon [name]="b.icon" [size]="15" /></span><span class="pt-1">{{ b.text }}</span></li>
          }
        </ul>
      </aside>

      <main id="auth-main" class="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-10 lg:px-8">
        <div class="mb-8 lg:hidden"><app-logo /></div>
        <div class="enter"><ng-content /></div>
      </main>
    </div>`,
})
export class AuthFrame {
  protected readonly preview = [
    { name: 'Ethan Brooks', title: 'Dentist', job: 'job job-dentist', days: [1, 1, 1, 1, 0] },
    { name: 'Lucas Moreno', title: 'Dentist', job: 'job job-dentist', days: [2, 2, 0, 2, 2] },
    { name: 'Grace Kim', title: 'Hygienist', job: 'job job-hygienist', days: [1, 1, 1, 1, 1] },
    { name: 'Hannah Wright', title: 'Receptionist', job: 'job job-reception', days: [1, 1, 1, 0, 1] },
  ];
  protected readonly benefits: { icon: IconName; text: string }[] = [
    { icon: 'wand', text: 'Fill a whole week from each person’s regular pattern in one click.' },
    { icon: 'shield', text: 'Expired licences block publishing unless the owner signs off — and it is logged.' },
    { icon: 'leave', text: 'Leave requests show exactly how many days they cost and who is left on the floor.' },
  ];
}

async function finish(session: Session, router: Router, me: Me, returnUrl?: string | null): Promise<void> {
  await session.set(me);
  await router.navigateByUrl(returnUrl && returnUrl.startsWith('/') && !returnUrl.startsWith('//') ? returnUrl : session.homeRoute());
}

@Component({
  selector: 'app-login',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, RouterLink, AuthFrame, Avatar],
  template: `
    <app-auth-frame>
      <h1 class="page-title">Sign in</h1>
      <p class="mt-1 text-sm text-muted">Schedules, leave, clock-ins and licences for your practice.</p>

      @if (demoEnabled()) {
        <section class="card mt-6 p-4" aria-labelledby="demo-title">
          <h2 id="demo-title" class="section-title">Try the demo clinic</h2>
          <p class="help mt-1">Step into Bright Smiles Dental as one of four people. No password needed.</p>
          <div class="mt-3 grid gap-2 sm:grid-cols-2">
            @for (p of personas; track p.key) {
              <button type="button" class="card-hover flex items-center gap-3 rounded-control border border-line bg-surface p-2.5 text-left disabled:opacity-60"
                      [disabled]="demo.busy()" (click)="tryDemo(p.key)" [attr.aria-label]="'Try the demo as ' + p.label + ', ' + p.who">
                <app-avatar [name]="p.who" [job]="p.job" [size]="34" />
                <span class="min-w-0 leading-tight">
                  <span class="block text-sm font-semibold">{{ p.label }}</span>
                  <span class="block text-xs leading-snug text-muted">{{ p.does }}</span>
                </span>
              </button>
            }
          </div>
          @if (demo.error(); as e) { <p class="field-error mt-2" role="alert">{{ e.message }}</p> }
        </section>
      }

      <form class="mt-6 flex flex-col gap-4" [formGroup]="form" (ngSubmit)="submit()" novalidate>
        <div class="field">
          <label class="label" for="email">Work email</label>
          <input id="email" class="input" type="email" formControlName="email" autocomplete="username"
                 [attr.aria-invalid]="!!m.fields()['email'] || null" [attr.aria-describedby]="m.fields()['email'] ? 'email-error' : null">
          @if (m.fields()['email']; as e) { <p id="email-error" class="field-error">{{ e }}</p> }
        </div>
        <div class="field">
          <label class="label" for="password">Password</label>
          <input id="password" class="input" type="password" formControlName="password" autocomplete="current-password"
                 [attr.aria-invalid]="!!m.fields()['password'] || null" [attr.aria-describedby]="m.fields()['password'] ? 'password-error' : null">
          @if (m.fields()['password']; as e) { <p id="password-error" class="field-error">{{ e }}</p> }
        </div>
        @if (m.error() && !hasFieldErrors()) { <p class="field-error" role="alert">{{ m.error()!.message }}</p> }
        <button type="submit" class="btn btn-primary w-full" [disabled]="m.busy()">{{ m.busy() ? 'Signing in' : 'Sign in' }}</button>
      </form>
      <p class="mt-6 text-sm">New to Chairside? <a routerLink="/signup" class="font-medium text-accent underline underline-offset-2">Create your clinic</a></p>
    </app-auth-frame>`,
})
export class Login implements OnInit {
  private readonly api = inject(Api);
  private readonly session = inject(Session);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly host = inject(ElementRef<HTMLElement>);
  protected readonly m = new Mutation();
  protected readonly demo = new Mutation();
  protected readonly demoEnabled = signal(false);
  protected readonly personas = [
    { key: 'owner', label: 'Owner', who: 'Maya Patel', job: 'Owner', does: 'Both locations, overrides' },
    { key: 'manager', label: 'Practice manager', who: 'Jordan Lee', job: 'Practice manager', does: 'Builds the week, decides leave' },
    { key: 'hygienist', label: 'Hygienist', who: 'Grace Kim', job: 'Hygienist', does: 'Clocks in, requests leave' },
    { key: 'reception', label: 'Receptionist', who: 'Hannah Wright', job: 'Receptionist', does: 'Sees who is in today' },
  ];
  protected readonly form = inject(NonNullableFormBuilder).group({ email: '', password: '' });

  async ngOnInit(): Promise<void> {
    try {
      this.demoEnabled.set((await firstValueFrom(this.api.config())).demoEnabled);
    } catch {
      this.demoEnabled.set(false);
    }
  }

  protected hasFieldErrors(): boolean {
    return Object.keys(this.m.fields()).length > 0;
  }

  protected async submit(): Promise<void> {
    const { email, password } = this.form.getRawValue();
    const me = await this.m.run(() => this.api.login(email, password));
    if (me) await finish(this.session, this.router, me, this.route.snapshot.queryParamMap.get('returnUrl'));
    else focusFirstError(this.host.nativeElement);
  }

  protected async tryDemo(persona: string): Promise<void> {
    const me = await this.demo.run(() => this.api.demo(persona));
    if (me) await finish(this.session, this.router, me);
  }
}

@Component({
  selector: 'app-signup',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, RouterLink, AuthFrame],
  template: `
    <app-auth-frame>
      <h1 class="page-title">Create your clinic</h1>
      <p class="mt-1 text-sm text-muted">14-day free trial. No card needed. You can invite your team next.</p>

      <form class="mt-6 flex flex-col gap-4" [formGroup]="form" (ngSubmit)="submit()" novalidate>
        <div class="field">
          <label class="label" for="clinicName">Practice name</label>
          <input id="clinicName" class="input" formControlName="clinicName" autocomplete="organization" [attr.aria-invalid]="!!f()['clinicName'] || null" [attr.aria-describedby]="f()['clinicName'] ? 'clinicName-error' : null">
          @if (f()['clinicName']; as e) { <p id="clinicName-error" class="field-error">{{ e }}</p> }
        </div>
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div class="field">
            <label class="label" for="firstName">Your first name</label>
            <input id="firstName" class="input" formControlName="firstName" autocomplete="given-name" [attr.aria-invalid]="!!f()['firstName'] || null" [attr.aria-describedby]="f()['firstName'] ? 'firstName-error' : null">
            @if (f()['firstName']; as e) { <p id="firstName-error" class="field-error">{{ e }}</p> }
          </div>
          <div class="field">
            <label class="label" for="lastName">Your last name</label>
            <input id="lastName" class="input" formControlName="lastName" autocomplete="family-name" [attr.aria-invalid]="!!f()['lastName'] || null" [attr.aria-describedby]="f()['lastName'] ? 'lastName-error' : null">
            @if (f()['lastName']; as e) { <p id="lastName-error" class="field-error">{{ e }}</p> }
          </div>
        </div>
        <div class="field">
          <label class="label" for="email">Work email</label>
          <input id="email" class="input" type="email" formControlName="email" autocomplete="email" [attr.aria-invalid]="!!f()['email'] || null" [attr.aria-describedby]="f()['email'] ? 'email-error' : null">
          @if (f()['email']; as e) { <p id="email-error" class="field-error">{{ e }}</p> }
        </div>
        <div class="field">
          <label class="label" for="password">Password</label>
          <input id="password" class="input" type="password" formControlName="password" autocomplete="new-password" [attr.aria-describedby]="f()['password'] ? 'password-help password-error' : 'password-help'" [attr.aria-invalid]="!!f()['password'] || null">
          <p id="password-help" class="help">At least 10 characters. A short phrase is easy to remember.</p>
          @if (f()['password']; as e) { <p id="password-error" class="field-error">{{ e }}</p> }
        </div>
        <div class="field">
          <label class="label" for="timeZoneId">Time zone</label>
          <select id="timeZoneId" class="input" formControlName="timeZoneId" aria-describedby="tz-help">
            @for (z of zones; track z[0]) { <option [value]="z[0]">{{ z[1] }} ({{ z[0] }})</option> }
          </select>
          <p id="tz-help" class="help">All shift and clock times use this zone.</p>
        </div>
        <fieldset class="field" formArrayName="locationNames" [attr.aria-describedby]="f()['locationNames'] ? 'loc-error' : null">
          <legend class="label">Locations</legend>
          <p class="help mb-1">One to three. You can add more later on the Practice plan.</p>
          @for (c of locations.controls; track $index; let i = $index) {
            <div class="mb-2 flex gap-2">
              <label class="sr-only" [for]="'loc' + i">Location {{ i + 1 }} name</label>
              <input class="input" [id]="'loc' + i" [formControlName]="i" placeholder="For example, Downtown">
              @if (locations.length > 1) {
                <button type="button" class="btn btn-quiet" (click)="locations.removeAt(i)" [attr.aria-label]="'Remove location ' + (i + 1)">✕</button>
              }
            </div>
          }
          @if (locations.length < 3) { <button type="button" class="btn btn-sm self-start" (click)="addLocation()">Add location</button> }
          @if (f()['locationNames']; as e) { <p id="loc-error" class="field-error">{{ e }}</p> }
        </fieldset>
        @if (m.error() && !hasFieldErrors()) { <p class="field-error" role="alert">{{ m.error()!.message }}</p> }
        <button type="submit" class="btn btn-primary w-full" [disabled]="m.busy()">{{ m.busy() ? 'Creating your clinic' : 'Create clinic' }}</button>
      </form>
      <p class="mt-6 text-sm">Already have an account? <a routerLink="/login" class="font-medium text-accent underline underline-offset-2">Sign in</a></p>
    </app-auth-frame>`,
})
export class Signup {
  private readonly api = inject(Api);
  private readonly session = inject(Session);
  private readonly router = inject(Router);
  private readonly host = inject(ElementRef<HTMLElement>);
  protected readonly zones = US_ZONES;
  protected readonly m = new Mutation();
  protected readonly f = this.m.fields;
  protected readonly form = new FormGroup({
    clinicName: new FormControl('', { nonNullable: true }),
    firstName: new FormControl('', { nonNullable: true }),
    lastName: new FormControl('', { nonNullable: true }),
    email: new FormControl('', { nonNullable: true }),
    password: new FormControl('', { nonNullable: true }),
    timeZoneId: new FormControl(this.guessZone(), { nonNullable: true }),
    locationNames: new FormArray([new FormControl('Main office', { nonNullable: true, validators: Validators.required })]),
  });
  protected readonly locations = this.form.controls.locationNames;

  protected hasFieldErrors(): boolean {
    return Object.keys(this.f()).length > 0;
  }

  protected addLocation(): void {
    this.locations.push(new FormControl('', { nonNullable: true }));
    setTimeout(() => (this.host.nativeElement.querySelector(`#loc${this.locations.length - 1}`) as HTMLElement | null)?.focus());
  }

  protected async submit(): Promise<void> {
    const me = await this.m.run(() => this.api.signup(this.form.getRawValue()));
    if (me) await finish(this.session, this.router, me, '/today');
    else focusFirstError(this.host.nativeElement);
  }

  private guessZone(): string {
    const z = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return US_ZONES.some(([id]) => id === z) ? z : 'America/New_York';
  }
}

@Component({
  selector: 'app-invite',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, RouterLink, AuthFrame],
  template: `
    <app-auth-frame>
      <h1 class="page-title">Join your clinic</h1>
      <p class="mt-1 text-sm text-muted">Choose a password to finish setting up your account.</p>
      <form class="mt-6 flex flex-col gap-4" [formGroup]="form" (ngSubmit)="submit()" novalidate>
        <div class="field">
          <label class="label" for="password">Password</label>
          <input id="password" class="input" type="password" formControlName="password" autocomplete="new-password" [attr.aria-describedby]="m.fields()['password'] ? 'pw-help pw-error' : 'pw-help'"
                 [attr.aria-invalid]="!!m.fields()['password'] || null">
          <p id="pw-help" class="help">At least 10 characters.</p>
          @if (m.fields()['password']; as e) { <p id="pw-error" class="field-error">{{ e }}</p> }
        </div>
        @if (m.error() && !m.fields()['password']) {
          <div class="alert alert-block" role="alert"><span aria-hidden="true">✕</span><p>{{ m.error()!.message }}</p></div>
        }
        <button type="submit" class="btn btn-primary w-full" [disabled]="m.busy()">Set password and continue</button>
      </form>
      <p class="mt-6 text-sm"><a routerLink="/login" class="text-accent underline underline-offset-2">Back to sign in</a></p>
    </app-auth-frame>`,
})
export class Invite {
  readonly token = input.required<string>();
  private readonly api = inject(Api);
  private readonly session = inject(Session);
  private readonly router = inject(Router);
  private readonly host = inject(ElementRef<HTMLElement>);
  protected readonly m = new Mutation();
  protected readonly form = inject(NonNullableFormBuilder).group({ password: '' });

  protected async submit(): Promise<void> {
    const me = await this.m.run(() => this.api.acceptInvite(this.token(), this.form.getRawValue().password));
    if (me) await finish(this.session, this.router, me, '/my');
    else focusFirstError(this.host.nativeElement);
  }
}
