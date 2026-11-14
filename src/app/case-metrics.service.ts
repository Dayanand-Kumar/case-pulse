import { HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';

export type CaseMetricRow = Record<string, string | number | null | undefined>;
export type MetricsResponse = {
  items: CaseMetricRow[];
  total: number;
  lastDataRefreshByArea?: Record<string, string>;
};
export type ResourceRecord = {
  Resource_Name: string;
  Department: string;
  Team: string;
  Aliases?: string[];
};

@Injectable({ providedIn: 'root' })
export class CaseMetricsService {
  private readonly api = inject(ApiService);

  /** Retrieves filtered case or risk rows; the caller applies view state and cache updates. */
  getMetrics<T>(params: HttpParams): Observable<MetricsResponse & { items: T[] }> {
    return this.api.get<MetricsResponse & { items: T[] }>('/api/metrics', { params });
  }

  /** Retrieves ownership resources; the caller maps them into filter options. */
  getResources(): Observable<{ items: ResourceRecord[] }> {
    return this.api.get<{ items: ResourceRecord[] }>('/api/resources');
  }

  /** Imports validated workbook rows; the caller reports the result and refreshes metrics. */
  importMetrics(records: unknown[], dataset: 'cases' | 'riskSummary'): Observable<{ imported: number }> {
    return this.api.post<{ imported: number }>('/api/metrics/import', { records, dataset });
  }

  /** Checks database health; the caller updates the connection indicator. */
  getHealth(): Observable<{ database: string }> {
    return this.api.get<{ database: string }>('/api/health');
  }
}
