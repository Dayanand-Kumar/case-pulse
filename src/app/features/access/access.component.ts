import { Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { AuthService } from '../../auth/auth.service';
import { AccessService, AccessSettings } from './access.service';

/** Admin page: assign roles to users and choose which pages each role can open. */
@Component({
  selector: 'app-access',
  imports: [DatePipe],
  templateUrl: './access.component.html',
  styleUrl: './access.component.css',
})
export class AccessComponent implements OnInit {
  private readonly accessApi = inject(AccessService);
  protected readonly auth = inject(AuthService);

  readonly settings = signal<AccessSettings | null>(null);
  readonly message = signal('');
  readonly error = signal('');

  /** Loads current users and role permissions when the page opens. */
  ngOnInit(): void {
    this.reload();
  }

  /** Fetches settings from AccessService and stores them for the template. */
  private reload(): void {
    this.accessApi.getAccess().subscribe({
      next: (settings) => this.settings.set(settings),
      error: (error: HttpErrorResponse) => this.fail(error),
    });
  }

  /** Shows an API error without leaving stale success text. */
  private fail(error: HttpErrorResponse): void {
    this.message.set('');
    this.error.set(error.error?.error ?? 'The request failed.');
    this.reload();
  }

  /** Runs after a successful save: shows the message and reloads from the database. */
  private saved(text: string): void {
    this.error.set('');
    this.message.set(text);
    this.reload();
  }

  /** Reads the chosen value from a select event and saves the user's role. */
  changeRole(userId: number, event: Event): void {
    const role = (event.target as HTMLSelectElement).value;
    this.accessApi.updateUser(userId, { role }).subscribe({
      next: () => this.saved('Role updated. It applies on the user\'s next request.'),
      error: (error: HttpErrorResponse) => this.fail(error),
    });
  }

  /** Activates or deactivates a user; deactivation also ends their sessions. */
  toggleActive(userId: number, active: boolean): void {
    this.accessApi.updateUser(userId, { active }).subscribe({
      next: () => this.saved(active ? 'User activated.' : 'User deactivated.'),
      error: (error: HttpErrorResponse) => this.fail(error),
    });
  }

  /** Adds or removes one permission on a role and saves the full list. */
  togglePermission(role: string, current: string[], permission: string, granted: boolean): void {
    const next = granted ? [...current, permission] : current.filter((item) => item !== permission);
    this.accessApi.setRolePermissions(role, next).subscribe({
      next: () => this.saved(`Permissions updated for ${role}.`),
      error: (error: HttpErrorResponse) => this.fail(error),
    });
  }

  /** Converts a permission key to a readable label. */
  label(permission: string): string {
    return permission.replace(/-/g, ' ').replace(/^./, (letter) => letter.toUpperCase());
  }
}
