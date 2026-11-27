import { Routes } from '@angular/router';

export type WorkspacePage =
  | 'cases'
  | 'dashboard'
  | 'risk-summary'
  | 'team-workload'
  | 'categories'
  | 'documentation'
  | 'reports'
  | 'monitoring'
  | 'live-data';

export const workspacePagePaths: Record<WorkspacePage, string> = {
  cases: '/',
  dashboard: '/dashboard',
  'risk-summary': '/risk-summary',
  'team-workload': '/team-workload',
  categories: '/categories',
  documentation: '/documentation',
  reports: '/reports',
  monitoring: '/monitoring',
  'live-data': '/live-data',
};

/** Builds a workspace route with its page metadata. */
const page = (path: string, workspacePage: WorkspacePage, pathMatch?: 'full') => ({
  path,
  ...(pathMatch ? { pathMatch } : {}),
  children: [],
  data: { workspacePage },
});

export const routes: Routes = [
  page('', 'cases', 'full'),
  page('dashboard', 'dashboard'),
  page('risk-summary', 'risk-summary'),
  page('team-workload', 'team-workload'),
  page('categories', 'categories'),
  page('documentation', 'documentation'),
  page('reports', 'reports'),
  page('monitoring', 'monitoring'),
  page('live-data', 'live-data'),
  { path: '**', redirectTo: '' },
];
