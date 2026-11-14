import { Routes } from '@angular/router';
import { loginGuard, pageGuard } from './auth/auth.guard';
import { LoginComponent } from './features/login/login.component';

export type WorkspacePage =
  | 'cases'
  | 'dashboard'
  | 'risk-summary'
  | 'team-workload'
  | 'categories'
  | 'documentation'
  | 'reports'
  | 'monitoring'
  | 'live-data'
  | 'access-management';

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
  'access-management': '/access',
};

/** Builds a guarded workspace route; the guard checks sign-in and the page permission. */
const page = (path: string, workspacePage: WorkspacePage, pathMatch?: 'full') => ({
  path,
  ...(pathMatch ? { pathMatch } : {}),
  children: [],
  canActivate: [pageGuard],
  data: { workspacePage },
});

export const routes: Routes = [
  { path: 'login', component: LoginComponent, canActivate: [loginGuard] },
  page('', 'cases', 'full'),
  page('dashboard', 'dashboard'),
  page('risk-summary', 'risk-summary'),
  page('team-workload', 'team-workload'),
  page('categories', 'categories'),
  page('documentation', 'documentation'),
  page('reports', 'reports'),
  page('monitoring', 'monitoring'),
  page('live-data', 'live-data'),
  page('access', 'access-management'),
  { path: '**', redirectTo: '' },
];
