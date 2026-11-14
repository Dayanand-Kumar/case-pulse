import { HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';

export type WorkloadRecord = {
  id: number;
  Date: string;
  From: string;
  To: string;
  'Activity Type': string;
  'What did you work on': string;
  Resource: string;
};

@Injectable({ providedIn: 'root' })
export class TeamWorkloadService {
  private readonly api = inject(ApiService);

  /** Fetches workload rows for a date range; the caller aggregates and displays them. */
  getWorkload<T = WorkloadRecord>(params: HttpParams): Observable<{ items: T[] }> {
    return this.api.get<{ items: T[] }>('/api/team-workload', { params });
  }

  /** Saves imported workload records; the caller reloads the selected date range. */
  importWorkload(records: unknown[], replaceExisting: boolean): Observable<{ imported: number }> {
    return this.api.post<{ imported: number }>('/api/team-workload/import', { records, replaceExisting });
  }
}
