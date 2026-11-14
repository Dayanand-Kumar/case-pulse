import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectorRef, Component, inject, signal } from '@angular/core';
import { LiveDataService } from '../../live-data.service';

type LiveRow = Record<string, string | number | null | undefined> & {
  ID: string | number;
};

@Component({
  selector: 'app-live-data',
  templateUrl: './live-data.component.html',
})
export class LiveDataComponent {
  private readonly liveDataApi = inject(LiveDataService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  readonly rows = signal<LiveRow[]>([]);
  readonly loading = signal(false);
  readonly fetchedAt = signal('');
  readonly errorMessage = signal('');

  /** Starts a live work-item request, then stores the response for the page table. */
  pullLatest(): void {
    this.loading.set(true);
    this.errorMessage.set('');
    this.liveDataApi.fetchLatest<LiveRow>().subscribe({
      next: (response) => {
        this.rows.set(response.items);
        this.fetchedAt.set(response.fetchedAt);
        this.loading.set(false);
      },
      error: (error: HttpErrorResponse) => {
        this.loading.set(false);
        this.errorMessage.set(error.error?.error ?? 'Could not pull live Azure DevOps data.');
        this.changeDetector.markForCheck();
      },
    });
  }
}
