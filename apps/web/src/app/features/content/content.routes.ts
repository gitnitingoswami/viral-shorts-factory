import { Routes } from '@angular/router';

export const CONTENT_ROUTES: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'scripts' },
  {
    path: 'ideas',
    title: 'Content ideas · Viral Shorts Factory',
    loadComponent: () => import('./ideas/ideas').then((m) => m.ContentIdeas),
  },
  {
    path: 'scripts',
    title: 'Scripts · Viral Shorts Factory',
    loadComponent: () => import('./scripts/scripts').then((m) => m.ScriptList),
  },
  {
    path: 'scripts/:id',
    title: 'Script workspace · Viral Shorts Factory',
    loadComponent: () => import('./script-workspace/script-workspace').then((m) => m.ScriptWorkspace),
  },
];
