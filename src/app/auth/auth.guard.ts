import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map } from 'rxjs';
import { AuthService } from './auth.service';

/** Page order used to pick a landing page the role is allowed to open. */
const PAGE_ORDER: { permission: string; path: string }[] = [
  { permission: 'cases', path: '/' },
  { permission: 'dashboard', path: '/dashboard' },
  { permission: 'risk-summary', path: '/risk-summary' },
  { permission: 'reports', path: '/reports' },
  { permission: 'documentation', path: '/documentation' },
  { permission: 'team-workload', path: '/team-workload' },
  { permission: 'categories', path: '/categories' },
  { permission: 'monitoring', path: '/monitoring' },
  { permission: 'live-data', path: '/live-data' },
  { permission: 'access-management', path: '/access' },
];

/** Returns the first page a user may open, or null when the role has none. */
export const firstAllowedPath = (auth: AuthService): string | null => (
  PAGE_ORDER.find(({ permission }) => auth.can(permission))?.path ?? null
);

/** Protects workspace routes: requires a valid session and the route's workspacePage permission. */
export const pageGuard: CanActivateFn = (route) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return auth.verifySession().pipe(
    map((valid) => {
      if (!valid) return router.parseUrl('/login');
      const page = route.data['workspacePage'] as string | undefined;
      if (!page || auth.can(page)) return true;
      const fallback = firstAllowedPath(auth);
      if (fallback) return router.parseUrl(fallback);
      auth.clear();
      return router.parseUrl('/login');
    }),
  );
};

/** Keeps signed-in users away from the login page. */
export const loginGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return auth.verifySession().pipe(
    map((valid) => {
      if (!valid) return true;
      const landing = firstAllowedPath(auth);
      if (landing) return router.parseUrl(landing);
      auth.clear();
      return true;
    }),
  );
};
