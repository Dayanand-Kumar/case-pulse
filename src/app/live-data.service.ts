import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import { CaseMetricRow } from './case-metrics.service';

export type LiveDataResponse = {
  items: CaseMetricRow[];
  total: number;
  areaPath: string;
  fetchedAt: string;
};

@Injectable({ providedIn: 'root' })
export class LiveDataService {
  private readonly api = inject(ApiService);

  /** Requests the latest Azure DevOps records; the caller stores the response for display. */
  fetchLatest<T = CaseMetricRow>(): Observable<Omit<LiveDataResponse, 'items'> & { items: T[] }> {
    return this.api.get<Omit<LiveDataResponse, 'items'> & { items: T[] }>('/api/live-data');
  }
}
