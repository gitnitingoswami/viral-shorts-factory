import { Routes } from '@angular/router';

export const RESEARCH_ROUTES: Routes = [
  {
    path: '',
    title: 'Research · Viral Shorts Factory',
    loadComponent: () => import('./research-page/research-page').then((m) => m.ResearchPage),
  },
  {
    path: 'niches',
    title: 'Niches · Viral Shorts Factory',
    loadComponent: () => import('./niches/niches').then((m) => m.Niches),
  },
  {
    path: 'collections/:id',
    title: 'Trend topics · Viral Shorts Factory',
    loadComponent: () => import('./topics/topics').then((m) => m.CollectionTopics),
  },
  {
    path: 'collections/:id/report',
    title: 'Weekly report · Viral Shorts Factory',
    loadComponent: () => import('./report/report').then((m) => m.ResearchReport),
  },
  {
    path: 'topics/compare',
    title: 'Compare topics · Viral Shorts Factory',
    loadComponent: () => import('./compare/compare').then((m) => m.TopicCompare),
  },
  {
    path: 'topics/:id',
    title: 'Topic · Viral Shorts Factory',
    loadComponent: () => import('./topic-detail/topic-detail').then((m) => m.TopicDetail),
  },
];
