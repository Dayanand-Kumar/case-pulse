import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);

  /** Sends a typed GET request to an API endpoint. */
  get<T>(url: string, options?: { params?: HttpParams | Record<string, string> }): Observable<T> {
    return this.http.get<T>(url, options);
  }

  /** Sends a typed POST request to an API endpoint. */
  post<T>(url: string, body: unknown): Observable<T> {
    return this.http.post<T>(url, body);
  }

  /** Sends a PATCH request for partial updates. */
  patch<T>(url: string, body: unknown): Observable<T> {
    return this.http.patch<T>(url, body);
  }

  /** Sends a PUT request that replaces a resource. */
  put<T>(url: string, body: unknown): Observable<T> {
    return this.http.put<T>(url, body);
  }

  /** Sends a DELETE request to an API endpoint. */
  delete<T>(url: string): Observable<T> {
    return this.http.delete<T>(url);
  }
}
