import { Routes } from '@angular/router';
import { authGuard, guestGuard, roleGuard } from './core/auth/auth.guard';

export const routes: Routes = [
  {
    path: 'login',
    title: 'Sign in · Viral Shorts Factory',
    canActivate: [guestGuard],
    loadComponent: () => import('./features/login/login').then((m) => m.Login),
  },
  {
    path: '',
    canActivate: [authGuard],
    canActivateChild: [authGuard],
    loadComponent: () => import('./core/layout/shell').then((m) => m.Shell),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      {
        path: 'dashboard',
        title: 'Dashboard · Viral Shorts Factory',
        loadComponent: () => import('./features/dashboard/dashboard').then((m) => m.Dashboard),
      },
      {
        path: 'health',
        title: 'System health · Viral Shorts Factory',
        loadComponent: () => import('./features/health/health-page').then((m) => m.HealthPage),
      },
      {
        path: 'channels',
        title: 'Channels · Viral Shorts Factory',
        loadComponent: () => import('./features/channels/channels').then((m) => m.Channels),
      },
      {
        path: 'jobs',
        title: 'Jobs · Viral Shorts Factory',
        loadComponent: () => import('./features/jobs/jobs').then((m) => m.Jobs),
      },
      {
        path: 'research',
        loadChildren: () => import('./features/research/research.routes').then((m) => m.RESEARCH_ROUTES),
      },
      {
        path: 'content',
        loadChildren: () => import('./features/content/content.routes').then((m) => m.CONTENT_ROUTES),
      },
      {
        path: 'audit',
        title: 'Audit log · Viral Shorts Factory',
        canActivate: [roleGuard],
        data: { roles: ['owner'] },
        loadComponent: () => import('./features/audit/audit').then((m) => m.Audit),
      },
    ],
  },
  { path: '**', redirectTo: 'dashboard' },
];
