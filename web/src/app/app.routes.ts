import { Routes } from '@angular/router';
import { homeRedirect, managersOnly, ownerOnly, signedIn, signedOut } from './core/session';

export const routes: Routes = [
  { path: 'login', title: 'Sign in · Chairside', canActivate: [signedOut], loadComponent: () => import('./features/auth').then((m) => m.Login) },
  { path: 'signup', title: 'Create your clinic · Chairside', canActivate: [signedOut], loadComponent: () => import('./features/auth').then((m) => m.Signup) },
  { path: 'invite/:token', title: 'Join your clinic · Chairside', loadComponent: () => import('./features/auth').then((m) => m.Invite) },
  {
    path: '',
    canActivate: [signedIn],
    loadComponent: () => import('./layout/shell').then((m) => m.Shell),
    children: [
      { path: '', pathMatch: 'full', canActivate: [homeRedirect], children: [] },
      { path: 'today', title: 'Today · Chairside', canActivate: [managersOnly], loadComponent: () => import('./features/today').then((m) => m.Today) },
      { path: 'my', title: 'My day · Chairside', loadComponent: () => import('./features/my-day').then((m) => m.MyDay) },
      { path: 'schedule', title: 'Schedule · Chairside', loadComponent: () => import('./features/schedule').then((m) => m.Schedule) },
      { path: 'leave', title: 'Leave · Chairside', loadComponent: () => import('./features/leave').then((m) => m.Leave) },
      { path: 'attendance', title: 'Attendance · Chairside', canActivate: [managersOnly], loadComponent: () => import('./features/attendance').then((m) => m.Attendance) },
      { path: 'staff', title: 'Staff · Chairside', loadComponent: () => import('./features/staff').then((m) => m.StaffList) },
      {
        path: 'staff/:id', title: 'Staff member · Chairside', loadComponent: () => import('./features/staff').then((m) => m.StaffEdit),
        canDeactivate: [(page: { canLeave(): Promise<boolean> }) => page.canLeave()],
      },
      { path: 'settings', title: 'Settings · Chairside', canActivate: [ownerOnly], loadComponent: () => import('./features/settings').then((m) => m.Settings) },
      { path: 'audit', title: 'Audit log · Chairside', canActivate: [ownerOnly], loadComponent: () => import('./features/audit').then((m) => m.Audit) },
    ],
  },
  { path: '**', redirectTo: '' },
];
