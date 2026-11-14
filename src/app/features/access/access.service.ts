import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../api.service';

export type AccessUser = { id: number; username: string; displayName: string; role: string; active: boolean; lastLoginAt: string | null };
export type AccessRole = { role: string; description: string; permissions: string[] };
export type AccessSettings = { permissions: string[]; roles: AccessRole[]; users: AccessUser[] };

/** API calls for user and role administration. */
@Injectable({ providedIn: 'root' })
export class AccessService {
  private readonly api = inject(ApiService);

  /** Loads users, roles and assignable permissions; the Access page renders them. */
  getAccess(): Observable<AccessSettings> {
    return this.api.get<AccessSettings>('/api/admin/access');
  }

  /** Changes a user's role or active state; the Access page reloads afterwards. */
  updateUser(id: number, changes: { role?: string; active?: boolean }): Observable<void> {
    return this.api.patch<void>(`/api/admin/users/${id}`, changes);
  }

  /** Replaces the permissions granted to a role; the Access page reloads afterwards. */
  setRolePermissions(role: string, permissions: string[]): Observable<void> {
    return this.api.put<void>(`/api/admin/roles/${encodeURIComponent(role)}/permissions`, { permissions });
  }
}
