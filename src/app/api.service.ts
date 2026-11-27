import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../environments/environment';

declare global {
  interface Window {
    CASEPULSE_API_URL?: string;
  }
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly apiBase = (window.CASEPULSE_API_URL || environment.apiUrl).replace(/\/$/, '');
  private resolve(url: string): string {
    if (!url.startsWith('/api')) return url;
    if (this.apiBase === '/api') return url;
    if (this.apiBase.endsWith('/api')) return `${this.apiBase}${url.slice('/api'.length)}`;
    return `${this.apiBase}${url}`;
  }

  /** Sends a typed GET request to an API endpoint. */
  get<T>(url: string, options?: { params?: HttpParams | Record<string, string> }): Observable<T> {
    return this.http.get<T>(this.resolve(url), options);
  }

  /** Sends a typed POST request to an API endpoint. */
  post<T>(url: string, body: unknown): Observable<T> {
    return this.http.post<T>(this.resolve(url), body);
  }

  /** Sends a PATCH request for partial updates. */
  patch<T>(url: string, body: unknown): Observable<T> {
    return this.http.patch<T>(this.resolve(url), body);
  }

  /** Sends a PUT request that replaces a resource. */
  put<T>(url: string, body: unknown): Observable<T> {
    return this.http.put<T>(this.resolve(url), body);
  }

  /** Sends a DELETE request to an API endpoint. */
  delete<T>(url: string): Observable<T> {
    return this.http.delete<T>(this.resolve(url));
  }
}


