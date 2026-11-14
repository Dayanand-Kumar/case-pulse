import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';

export type TeamActivityRecord = {
  ID: number;
  'Team Member': string;
  'Activity Date': string;
  'Activity Type': string;
  Details: string;
  'Start Time': string;
  'End Time': string;
  'Duration Minutes': number;
};
export type TeamActivityPayload = {
  member: string;
  date: string;
  activityType: string;
  details: string;
  startTime: string;
  endTime: string;
};

@Injectable({ providedIn: 'root' })
export class TeamActivitiesService {
  private readonly api = inject(ApiService);

  /** Fetches a member's activities for one day; the caller fills the activity log. */
  getActivities(member: string, date: string): Observable<{ items: TeamActivityRecord[] }> {
    return this.api.get<{ items: TeamActivityRecord[] }>('/api/team-activities', {
      params: { member, date },
    });
  }

  /** Creates an activity entry; the caller refreshes the member's daily log. */
  createActivity(activity: TeamActivityPayload): Observable<TeamActivityRecord> {
    return this.api.post<TeamActivityRecord>('/api/team-activities', activity);
  }

  /** Deletes an activity entry; the caller removes it from the visible log. */
  deleteActivity(id: number): Observable<void> {
    return this.api.delete<void>(`/api/team-activities/${id}`);
  }
}
