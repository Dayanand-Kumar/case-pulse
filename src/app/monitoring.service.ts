import { HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';

export type MonitoringRecord = {
  id: number;
  module: string;
  error_date: string;
  exact_timestamp: string | null;
  error_details: string;
  occurrence_count: number;
  alarm_configured: string;
  remarks: string | null;
  severity: string | null;
  environment: string | null;
  status: string | null;
  owner: string | null;
  ticket_id: string | null;
};
export type MonitoringOccurrence = {
  error_date: string;
  occurrences: number;
  entries: number;
  first_seen: string | null;
  last_seen: string | null;
};

@Injectable({ providedIn: 'root' })
export class MonitoringService {
  private readonly api = inject(ApiService);

  /** Fetches filtered monitoring rows; the caller updates the table and analytics. */
  getRecords<T = MonitoringRecord>(params: HttpParams): Observable<{ items: T[] }> {
    return this.api.get<{ items: T[] }>('/api/error-details', { params });
  }

  /** Fetches occurrence history for a selected error; the caller renders its analytics. */
  getOccurrences<T = MonitoringOccurrence>(params: HttpParams): Observable<{ items: T[]; total: number }> {
    return this.api.get<{ items: T[]; total: number }>('/api/error-details/occurrences', { params });
  }

  /** Persists imported monitoring records; the caller refreshes the active query. */
  importRecords(records: unknown[]): Observable<{ imported: number }> {
    return this.api.post<{ imported: number }>('/api/error-details/import', { records });
  }
}
