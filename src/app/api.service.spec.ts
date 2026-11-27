import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { environment } from '../environments/environment';
import { ApiService } from './api.service';

describe('ApiService deployment URLs', () => {
  const originalApiUrl = environment.apiUrl;

  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
    environment.apiUrl = originalApiUrl;
    delete window.CASEPULSE_API_URL;
  });

  for (const [base, expected] of [
    ['/api', '/api/health'],
    ['https://api.example.test', 'https://api.example.test/api/health'],
    ['https://api.example.test/api/', 'https://api.example.test/api/health'],
  ]) {
    it(`resolves requests with ${base}`, () => {
      environment.apiUrl = base;
      TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
      TestBed.inject(ApiService).get('/api/health').subscribe();
      TestBed.inject(HttpTestingController).expectOne(expected).flush({ status: 'ok' });
    });
  }

  it('uses the deployed runtime API URL instead of the default proxy', () => {
    environment.apiUrl = '/api';
    window.CASEPULSE_API_URL = 'https://api.example.test/';
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    TestBed.inject(ApiService).get('/api/health').subscribe();
    TestBed.inject(HttpTestingController).expectOne('https://api.example.test/api/health').flush({ status: 'ok' });
  });
});
