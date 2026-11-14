import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { AuthService } from '../../auth/auth.service';
import { firstAllowedPath } from '../../auth/auth.guard';

/** Login page: collects credentials, then hands off to the first page the user's role may open. */
@Component({
  selector: 'app-login',
  imports: [FormsModule],
  templateUrl: './login.component.html',
  styleUrl: './login.component.css',
})
export class LoginComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  username = '';
  password = '';
  readonly submitting = signal(false);
  readonly error = signal('');

  /** Sends credentials through AuthService; on success navigates to the landing page for the role. */
  submit(): void {
    if (this.submitting()) return;
    this.error.set('');
    this.submitting.set(true);
    this.auth.login(this.username.trim(), this.password).subscribe({
      next: () => {
        this.password = '';
        const landing = firstAllowedPath(this.auth);
        if (landing) void this.router.navigateByUrl(landing);
        else {
          this.auth.clear();
          this.error.set('Your role has no pages assigned. Contact an administrator.');
          this.submitting.set(false);
        }
      },
      error: (error: HttpErrorResponse) => {
        this.error.set(error.error?.error ?? 'Sign-in failed. Check that the API is running.');
        this.submitting.set(false);
      },
    });
  }
}
