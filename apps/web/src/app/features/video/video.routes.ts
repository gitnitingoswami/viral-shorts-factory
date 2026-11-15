import { Routes } from '@angular/router';

export const VIDEO_ROUTES: Routes = [
  {
    path: '',
    pathMatch: 'full',
    title: 'Video productions · Viral Shorts Factory',
    loadComponent: () => import('./productions/productions').then((m) => m.ProductionQueue),
  },
  {
    path: 'assets',
    title: 'Asset library · Viral Shorts Factory',
    loadComponent: () => import('./assets/asset-library').then((m) => m.AssetLibrary),
  },
  {
    path: ':id',
    title: 'Video production · Viral Shorts Factory',
    loadComponent: () => import('./production-detail/production-detail').then((m) => m.ProductionDetail),
  },
];
