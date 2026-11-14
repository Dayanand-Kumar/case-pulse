import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, catchError, map, of, tap } from 'rxjs';
import { ApiService } from '../api.service';

export type AuthUser = {
  id: number;
  username: string;
  displayName: string;
  role: string;
  permissions: string[];
};
type LoginResponse = { token: string; expiresAt: string; user: AuthUser };

const STORAGE_KEY = 'casepulse.session';

/** Holds the signed-in user and token; the interceptor and guards read from here. */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly session = signal<{ token: string; user: AuthUser } | null>(this.restore());
  private verified = false;

  readonly user = computed(() => this.session()?.user ?? null);
  readonly isLoggedIn = computed(() => this.session() !== null);
  readonly token = computed(() => this.session()?.token ?? null);

  /** Reads a session saved by an earlier page load; the guard re-verifies it with the API. */
  private restore(): { token: string; user: AuthUser } | null {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  }

  /** Stores a session for this tab; the sidebar and guards react through signals. */
  setSession(token: string, user: AuthUser): void {
    this.session.set({ token, user });
    this.verified = true;
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ token, user }));
  }

  /** Sends credentials to the API; the login page navigates to the first allowed page afterwards. */
  login(username: string, password: string): Observable<AuthUser> {
    return this.api.post<LoginResponse>('/api/auth/login', { username, password }).pipe(
      tap((response) => this.setSession(response.token, response.user)),
      map((response) => response.user),
    );
  }

  /** Confirms a restored token is still valid, refreshing role permissions; the guard uses the result. */
  verifySession(): Observable<boolean> {
    if (!this.session()) return of(false);
    if (this.verified) return of(true);
    return this.api.get<{ user: AuthUser }>('/api/auth/me').pipe(
      tap(({ user }) => this.setSession(this.session()!.token, user)),
      map(() => true),
      catchError(() => {
        this.clear();
        return of(false);
      }),
    );
  }

  /** Ends the server session, clears local state and returns to the login page. */
  logout(): void {
    if (this.session()) this.api.post('/api/auth/logout', {}).subscribe({ error: () => undefined });
    this.clear();
    void this.router.navigateByUrl('/login');
  }

  /** Drops local session state without calling the API (used when the server already rejected it). */
  clear(): void {
    this.session.set(null);
    this.verified = false;
    sessionStorage.removeItem(STORAGE_KEY);
  }

  /** Tells whether the current role may use a page or capability. */
  can(permission: string): boolean {
    return this.session()?.user.permissions.includes(permission) ?? false;
  }
}
