import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { App } from './app';
import { parseCsv } from './csv';

describe('parseCsv', () => {
  it('parses quoted values, escaped quotes, and embedded newlines', () => {
    expect(parseCsv('\uFEFFName,Description\r\n"Smith, Jane","Said ""hello""\nand left"\r\n')).toEqual([
      ['Name', 'Description'],
      ['Smith, Jane', 'Said "hello"\nand left'],
    ]);
  });

  it('preserves empty fields and trailing columns', () => {
    expect(parseCsv('a,,c,\n1,2,3,')).toEqual([
      ['a', '', 'c', ''],
      ['1', '2', '3', ''],
    ]);
  });

  it('rejects malformed quoted fields', () => {
    expect(() => parseCsv('"unfinished')).toThrow('unclosed quoted field');
    expect(() => parseCsv('un"closed,value')).toThrow('quote inside an unquoted field');
  });
});

describe('App', () => {
  let httpTesting: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpTesting.verify();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    httpTesting.expectOne('/api/health').flush({ status: 'ok', database: 'connected' });
    httpTesting.expectOne('/api/metrics').flush({ items: [], total: 0 });
    expect(app).toBeTruthy();
  });

  it('should render the metrics workspace', async () => {
    const fixture = TestBed.createComponent(App);
    httpTesting.expectOne('/api/health').flush({ status: 'ok', database: 'connected' });
    httpTesting.expectOne('/api/metrics').flush({ items: [], total: 0 });
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h1')?.textContent).toContain('Case Tracker');
    const navigationItems = Array.from(compiled.querySelectorAll('.sidebar nav .nav-item'));
    expect(navigationItems).toHaveLength(5);
    expect(navigationItems.map((item) => item.querySelector('svg')?.classList.item(1))).toEqual([
      'cases-icon',
      'dashboard-icon',
      'people-icon',
      'documentation-icon',
      'reports-icon',
    ]);
    expect(navigationItems[3].textContent).toContain('Documentation');
    expect(navigationItems[3].getAttribute('aria-current')).toBeNull();
    expect(navigationItems[4].textContent).toContain('Reports');
    expect(navigationItems[4].getAttribute('aria-disabled')).toBeNull();
  });

  it('opens Reports, requires a complete date range, and switches report tabs', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    httpTesting.expectOne('/api/health').flush({ status: 'ok', database: 'connected' });
    httpTesting.expectOne('/api/metrics').flush({ items: [], total: 0 });
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    compiled.querySelector<HTMLAnchorElement>('a.nav-item[href="/reports"]')?.click();
    fixture.detectChanges();
    expect(app.reportsView).toBe(true);
    expect(compiled.querySelector('h1')?.textContent).toContain('Reports');

    app.applyReportDateRange();
    fixture.detectChanges();
    expect(app.reportRangeApplied).toBe(false);
    expect(compiled.textContent).toContain('Select both a start date and an end date');

    app.reportDateFrom = '2026-10-01';
    app.reportDateTo = '2026-10-31';
    app.applyReportDateRange();
    fixture.detectChanges();
    expect(app.reportRangeApplied).toBe(true);
    expect(compiled.textContent).toContain('45,971');
    expect(compiled.textContent).toContain('42,898');
    expect(compiled.textContent).toContain('766/1273');

    const patientsTab = Array.from(compiled.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
      .find((tab) => tab.textContent?.includes('Patient count'));
    patientsTab?.click();
    fixture.detectChanges();
    expect(app.selectedReportTab).toBe('patients');
    expect(compiled.textContent).toContain('47,949');
    expect(compiled.querySelector<HTMLButtonElement>('button[title*="report workbook columns"]')?.disabled).toBe(true);
    expect(compiled.querySelector('.report-detail-prompt')?.textContent).toContain('every patient detail row');

    app.clearReportDateRange();
    fixture.detectChanges();
    expect(app.reportRangeApplied).toBe(false);
    expect(compiled.textContent).toContain('Select a date range to continue');
  });

  it('shows the step-by-step EC2 deployment guide from the Documentation tab', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    httpTesting.expectOne('/api/health').flush({ status: 'ok', database: 'connected' });
    httpTesting.expectOne('/api/metrics').flush({ items: [], total: 0 });
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    compiled.querySelector<HTMLAnchorElement>('a[href="/documentation"]')?.click();
    fixture.detectChanges();

    expect(app.documentationView).toBe(true);
    expect(compiled.querySelector('h1')?.textContent).toContain('Deployment documentation');
    expect(compiled.querySelector('#ec2-folders')?.textContent).toContain('/opt/casepulse/');
    expect(compiled.querySelector('#ec2-postgres')?.textContent).toContain('casepulse_app');
    expect(compiled.querySelector('#ec2-nginx')?.textContent).toContain('proxy_pass');
    expect(compiled.querySelector('.documentation-content')?.textContent).toContain('does not currently provide user sign-in');
    expect(compiled.querySelector('a.nav-item[href="/documentation"]')?.getAttribute('aria-current')).toBe('page');

    compiled.querySelector<HTMLAnchorElement>('a.nav-item[href="/"]')?.click();
    fixture.detectChanges();
    expect(app.documentationView).toBe(false);
    expect(compiled.querySelector('h1')?.textContent).toContain('Case Tracker');
  });

  it('defaults to External cases and excludes unclassified tags everywhere', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    httpTesting.expectOne('/api/health').flush({ status: 'ok', database: 'connected' });
    const metricsRequest = httpTesting.expectOne('/api/metrics');
    expect(metricsRequest.request.params.has('tags')).toBe(false);
    const row = (id: number, tags: string) => ({
      'Work Item Type': 'Bug',
      ID: id,
      'Salesforce ID': null,
      Title: `Case ${id}`,
      'Assigned To': 'Owner',
      State: 'Implementation',
      Priority: '2 - High',
      Tags: tags,
      'Area Path': 'Core',
      'Created Date': '2026-10-07',
      'Created Time': '11:04:17',
      Age: 10,
      Resolution: null,
      'Comment Count': null,
      'Related Link Count': null,
      'Closing Comment': null,
      'Closed Date': null,
      'Closed Time': null,
    });
    metricsRequest.flush({
      items: [
        row(1, 'External;Batch1'),
        row(2, 'Internal'),
        row(3, 'Other'),
        row(4, 'NotExternal'),
      ],
      total: 4,
    });

    fixture.detectChanges();
    expect(app.tags).toBe('External');
    expect(app.rows.map((item) => item.ID)).toEqual([1]);
    expect(app.total).toBe(1);
    expect(app.multiSelect).toBe(false);

    app.showDashboard();
    expect(app.rows.map((item) => item.ID)).toEqual([1]);
    expect(app.total).toBe(1);

    app.setMultiSelect(true);
    app.selectTag('Internal');
    expect(app.tags).toBe('External, Internal');
    expect(app.rows.map((item) => item.ID)).toEqual([1, 2]);
    expect(app.total).toBe(2);

    app.setMultiSelect(false);
    expect(app.tags).toBe('External');
    expect(app.rows.map((item) => item.ID)).toEqual([1]);

    app.tags = 'Other';
    app.applyFilters();
    expect(app.rows).toEqual([]);
    expect(app.total).toBe(0);

    app.clearFilters();
    expect(app.tags).toBe('External');
    expect(app.multiSelect).toBe(false);
    expect(app.rows.map((item) => item.ID)).toEqual([1]);
  });

  it('filters cases by the Prescribing and eP2 area paths', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    httpTesting.expectOne('/api/health').flush({ status: 'ok', database: 'connected' });
    httpTesting.expectOne('/api/metrics').flush({
      items: [
        {
          'Work Item Type': 'Bug',
          ID: 1,
          'Salesforce ID': null,
          Title: 'Prescribing case',
          'Assigned To': 'Owner',
          State: 'Implementation',
          Priority: '2 - High',
          Tags: 'External',
          'Area Path': 'Central Change Portfolio\\EHR\\Prescribing',
          'Created Date': '2026-10-07',
          'Created Time': '11:04:17',
          Age: 10,
          Resolution: null,
          'Comment Count': null,
          'Related Link Count': null,
          'Closing Comment': null,
          'Closed Date': null,
          'Closed Time': null,
        },
        {
          'Work Item Type': 'Bug',
          ID: 2,
          'Salesforce ID': null,
          Title: 'Accounting case',
          'Assigned To': 'Owner',
          State: 'Implementation',
          Priority: '2 - High',
          Tags: 'Internal',
          'Area Path': 'Accounting',
          'Created Date': '2026-10-07',
          'Created Time': '11:04:17',
          Age: 10,
          Resolution: null,
          'Comment Count': null,
          'Related Link Count': null,
          'Closing Comment': null,
          'Closed Date': null,
          'Closed Time': null,
        },
        {
          'Work Item Type': 'Bug',
          ID: 3,
          'Salesforce ID': null,
          Title: 'eP2 case',
          'Assigned To': 'Owner',
          State: 'Implementation',
          Priority: '2 - High',
          Tags: 'External',
          'Area Path': 'Central Change Portfolio\\v1 - ePractice',
          'Created Date': '2026-10-07',
          'Created Time': '11:04:17',
          Age: 10,
          Resolution: null,
          'Comment Count': null,
          'Related Link Count': null,
          'Closing Comment': null,
          'Closed Date': null,
          'Closed Time': null,
        },
      ],
      total: 3,
      lastDataRefreshByArea: {
        'Central Change Portfolio\\EHR\\Prescribing': '2026-10-14T14:08:12.000Z',
        Accounting: '2026-10-14T14:00:00.000Z',
        'Central Change Portfolio\\v1 - ePractice': '2026-10-14T13:00:00.000Z',
      },
    });

    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.last-data-refresh')).toBeNull();
    const prescribingButton = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button'))
      .find((button) => button.textContent?.trim() === 'Prescribing');
    expect(prescribingButton).toBeTruthy();
    expect(prescribingButton?.getAttribute('aria-pressed')).toBe('false');

    app.selectArea(app.prescribingAreaPath);
    fixture.detectChanges();
    expect(app.rows.map((item) => item.ID)).toEqual([1]);
    expect(fixture.nativeElement.querySelector('.last-data-refresh')?.textContent).toContain('Last Data Refresh');
    expect(fixture.nativeElement.querySelector('.last-data-refresh')?.textContent).toContain('14 Oct 2026, 7:38:12 PM');
    expect(prescribingButton?.getAttribute('aria-pressed')).toBe('true');

    const ep2Button = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button'))
      .find((button) => button.textContent?.trim() === 'eP2 (Team 4)');
    expect(ep2Button).toBeTruthy();
    expect(ep2Button?.getAttribute('aria-pressed')).toBe('false');

    app.selectArea(app.ep2AreaPath);
    fixture.detectChanges();
    expect(app.rows.map((item) => item.ID)).toEqual([3]);
    expect(ep2Button?.getAttribute('aria-pressed')).toBe('true');

    app.clearFilters();
    app.setMultiSelect(true);
    app.selectArea(app.prescribingAreaPath);
    app.selectArea(app.ep2AreaPath);
    expect(app.selectedAreas).toEqual([app.prescribingAreaPath, app.ep2AreaPath]);
    expect(app.rows.map((item) => item.ID)).toEqual([1, 3]);
    app.setMultiSelect(false);
    expect(app.rows.map((item) => item.ID)).toEqual([1]);

    app.clearFilters();
    const internalButton = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button'))
      .find((button) => button.textContent?.trim() === 'Internal');
    expect(internalButton).toBeTruthy();
    app.selectTag('Internal');
    fixture.detectChanges();
    expect(app.rows.map((item) => item.ID)).toEqual([2]);
    expect(internalButton?.getAttribute('aria-pressed')).toBe('true');
  });

  it('shows Risk Summary inline in the case tracker, scoped to ORCA Scan, Pentest 2026, and ZeroThreat tags', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    httpTesting.expectOne('/api/health').flush({ status: 'ok', database: 'connected' });
    const item = (id: number, tags: string, areaPath = 'Core') => ({
      'Work Item Type': 'Bug',
      ID: id,
      'Salesforce ID': null,
      Title: `Risk case ${id}`,
      'Assigned To': 'Owner',
      State: 'Implementation',
      Priority: '2 - High',
      Tags: tags,
      'Area Path': areaPath,
      'Created Date': '2026-10-07',
      'Created Time': null,
      Age: 7,
      Resolution: null,
      'Comment Count': null,
      'Related Link Count': null,
      'Closing Comment': null,
      'Closed Date': null,
      'Closed Time': null,
    });
    httpTesting.expectOne('/api/metrics').flush({
      items: [item(1, 'External')],
      total: 1,
    });

    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('a[href="/risk-summary"]')).toBeNull();
    expect(compiled.querySelector('.nav-item[href="/"]')?.getAttribute('aria-current')).toBe('page');
    const risksToggle = compiled.querySelector<HTMLButtonElement>('button.risk-toggle');
    expect(risksToggle?.getAttribute('aria-checked')).toBe('false');
    expect(risksToggle?.textContent).toContain('CASES');
    expect(risksToggle?.textContent).toContain('RISKS');
    expect(risksToggle?.textContent?.trim()).not.toBe('CASES');
    expect(risksToggle?.textContent?.trim()).not.toBe('RISKS');
    expect(risksToggle?.parentElement?.querySelector('.view-toggle')?.textContent).toContain('Open Dashboard');
    expect(risksToggle?.parentElement?.querySelector('.view-toggle')?.classList.contains('quick-filter-button')).toBe(true);
    risksToggle?.click();
    const riskMetricsRequest = httpTesting.expectOne((request) => (
      request.url === '/api/metrics' && request.params.get('dataset') === 'riskSummary'
    ));
    riskMetricsRequest.flush({
      items: [
        item(2, 'ZeroThreat;Internal'),
        item(3, 'Pentest 2026'),
        item(4, 'ORCA Scan'),
        item(5, 'Other'),
        item(6, 'ORCA Scan', 'Accounting'),
        item(7, 'Orca-Cloud Assessment'),
      ],
      total: 6,
    });
    expect(app.riskSummaryView).toBe(true);
    expect(app.rows.map((row) => row.ID)).toEqual([2, 3, 4, 6, 7]);
    app.selectTag('Pentest 2026');
    expect(app.rows.map((row) => row.ID)).toEqual([3]);
    app.setMultiSelect(true);
    app.selectTag('ORCA Scan');
    expect(app.rows.map((row) => row.ID)).toEqual([3, 4, 6, 7]);
    app.setMultiSelect(false);
    app.riskSummaryTags = '';
    app.applyFilters();
    app.selectArea('Accounting');
    expect(app.rows.map((row) => row.ID)).toEqual([6]);

    fixture.detectChanges();
    expect(compiled.querySelector('h1')?.textContent).toContain('Risk Summary');
    expect(compiled.querySelector('button.risk-toggle')?.getAttribute('aria-checked')).toBe('true');
    expect(compiled.querySelector('button.risk-toggle')?.textContent).toContain('CASES');
    expect(compiled.querySelector('button.risk-toggle')?.textContent).toContain('RISKS');
    expect(compiled.querySelector('.nav-item[href="/"]')?.getAttribute('aria-current')).toBe('page');
    expect(compiled.querySelector('.view-toggle')?.textContent).toContain('Open Dashboard');
    expect(compiled.querySelector('[aria-label="Filter by tag"]')?.textContent).toContain('ZeroThreat');
    expect(compiled.querySelector('[aria-label="Filter by tag"]')?.textContent).toContain('Pentest 2026');
    expect(compiled.querySelector('[aria-label="Filter by tag"]')?.textContent).toContain('ORCA Scan');
    expect(compiled.querySelector('[aria-label="Filter by tag"]')?.textContent).not.toContain('External');

    app.clearFilters();
    compiled.querySelector<HTMLButtonElement>('button.risk-toggle')?.click();
    httpTesting.expectOne('/api/metrics').flush({ items: [item(1, 'External')], total: 1 });
    fixture.detectChanges();
    expect(app.riskSummaryView).toBe(false);
    expect(compiled.querySelector('button.risk-toggle')?.getAttribute('aria-checked')).toBe('false');
    expect(app.rows.map((row) => row.ID)).toEqual([1]);
  });

  it('imports risk-summary CSV rows into the riskSummary dataset using its ten columns', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    httpTesting.expectOne('/api/health').flush({ status: 'ok', database: 'connected' });
    httpTesting.expectOne('/api/metrics').flush({ items: [], total: 0 });

    app.showRiskSummary();
    httpTesting.expectOne((request) => (
      request.url === '/api/metrics' && request.params.get('dataset') === 'riskSummary'
    )).flush({ items: [], total: 0 });

    const csv = [
      'ID,Work Item Type,Title,Assigned To,State,Tags,Created Date,Due Date,Closed Date,Area Path',
      '123,Bug,Security follow-up,Owner,Active,ZeroThreat,2026-10-01,2026-10-20,,Core',
    ].join('\n');
    const file = new File([csv], 'risk.csv', { type: 'text/csv' });
    Object.defineProperty(file, 'text', { value: async () => csv });
    const input = { files: [file], value: 'risk.csv' } as unknown as HTMLInputElement;
    await app.importFile({ target: input } as unknown as Event);

    const importRequest = httpTesting.expectOne('/api/metrics/import');
    expect(importRequest.request.body.dataset).toBe('riskSummary');
    expect(Object.keys(importRequest.request.body.records[0])).toEqual([
      'ID',
      'Work Item Type',
      'Title',
      'Assigned To',
      'State',
      'Tags',
      'Created Date',
      'Due Date',
      'Closed Date',
      'Area Path',
    ]);
    expect(importRequest.request.body.records[0]['Due Date']).toBe('2026-10-20');
    expect(importRequest.request.body.records[0]['Area Path']).toBe('Core');
    importRequest.flush({ imported: 1 });
    httpTesting.expectOne((request) => (
      request.url === '/api/metrics' && request.params.get('dataset') === 'riskSummary'
    )).flush({ items: [], total: 0 });
  });

  it('filters Ownership by resource, department, and selected area team', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    httpTesting.expectOne('/api/health').flush({ status: 'ok', database: 'connected' });
    httpTesting.expectOne('/api/metrics').flush({
      items: [
        {
          'Work Item Type': 'Bug',
          ID: 1,
          'Salesforce ID': null,
          Title: 'Core developer case',
          'Assigned To': 'Santhosh Kumar Akula',
          State: 'Implementation',
          Priority: '2 - High',
          Tags: 'External',
          'Area Path': 'Core',
          'Created Date': '2026-10-07',
          'Created Time': '11:04:17',
          Age: 10,
          Resolution: null,
          'Comment Count': null,
          'Related Link Count': null,
          'Closing Comment': null,
          'Closed Date': null,
          'Closed Time': null,
        },
        {
          'Work Item Type': 'Bug',
          ID: 2,
          'Salesforce ID': null,
          Title: 'Accounting developer case',
          'Assigned To': 'Vijaya Nerusu',
          State: 'Implementation',
          Priority: '2 - High',
          Tags: 'External',
          'Area Path': 'Accounting',
          'Created Date': '2026-10-07',
          'Created Time': '11:04:17',
          Age: 10,
          Resolution: null,
          'Comment Count': null,
          'Related Link Count': null,
          'Closing Comment': null,
          'Closed Date': null,
          'Closed Time': null,
        },
        {
          'Work Item Type': 'Bug',
          ID: 3,
          'Salesforce ID': null,
          Title: 'Core QA case',
          'Assigned To': 'Rohit Sabarwal',
          State: 'Implementation',
          Priority: '2 - High',
          Tags: 'External',
          'Area Path': 'Core',
          'Created Date': '2026-10-07',
          'Created Time': '11:04:17',
          Age: 10,
          Resolution: null,
          'Comment Count': null,
          'Related Link Count': null,
          'Closing Comment': null,
          'Closed Date': null,
          'Closed Time': null,
        },
        {
          'Work Item Type': 'Bug',
          ID: 4,
          'Salesforce ID': null,
          Title: 'Core App Support case',
          'Assigned To': 'Dayanand Kumar Kasagala',
          State: 'Implementation',
          Priority: '2 - High',
          Tags: 'External',
          'Area Path': 'Core',
          'Created Date': '2026-10-07',
          'Created Time': '11:04:17',
          Age: 10,
          Resolution: null,
          'Comment Count': null,
          'Related Link Count': null,
          'Closing Comment': null,
          'Closed Date': null,
          'Closed Time': null,
        },
      ],
      total: 4,
    });

    app.setMultiSelect(true);
    app.selectArea('Core');
    app.selectOwnership('Developer');
    const resourcesRequest = httpTesting.expectOne('/api/resources');
    resourcesRequest.flush({
      items: [
        { Resource_Name: 'Santhosh Kumar Akula', Department: 'Developer', Team: 'Core', Aliases: [] },
        { Resource_Name: 'Vijaya Nerusu', Department: 'Developer', Team: 'Accounting', Aliases: [] },
        { Resource_Name: 'Rohit', Department: 'QA Lead', Team: 'Core', Aliases: ['Rohit Sabarwal'] },
        { Resource_Name: 'Anand Kumar Nattar', Department: 'QA', Team: 'Team 4', Aliases: ['Anandhakumar Nattar'] },
        { Resource_Name: 'Dayanand Kumar K', Department: 'App Support', Team: 'Overall', Aliases: ['Dayanand Kumar Kasagala'] },
      ],
    });
    expect(app.rows.map((item) => item.ID)).toEqual([1]);
    app.selectOwnership('QA');
    expect(app.selectedOwnership).toEqual(['Developer', 'QA']);
    expect(app.rows.map((item) => item.ID)).toEqual([1, 3]);
    app.selectOwnership('App Support');
    expect(app.selectedOwnership).toEqual(['Developer', 'QA', 'App Support']);
    expect(app.rows.map((item) => item.ID)).toEqual([1, 3, 4]);
  });

  it('filters Unassigned ownership to cases with an empty Assigned To value', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    httpTesting.expectOne('/api/health').flush({ status: 'ok', database: 'connected' });
    httpTesting.expectOne('/api/metrics').flush({
      items: [
        { 'Work Item Type': 'Bug', ID: 1, 'Salesforce ID': null, Title: 'No assignee', 'Assigned To': null, State: 'Active', Priority: '2 - High', Tags: 'External', 'Area Path': 'Core', 'Created Date': '2026-10-07', 'Created Time': null, Age: 7, Resolution: null, 'Comment Count': null, 'Related Link Count': null, 'Closing Comment': null, 'Closed Date': null, 'Closed Time': null },
        { 'Work Item Type': 'Bug', ID: 2, 'Salesforce ID': null, Title: 'Whitespace assignee', 'Assigned To': '   ', State: 'Active', Priority: '2 - High', Tags: 'External', 'Area Path': 'Core', 'Created Date': '2026-10-07', 'Created Time': null, Age: 7, Resolution: null, 'Comment Count': null, 'Related Link Count': null, 'Closing Comment': null, 'Closed Date': null, 'Closed Time': null },
        { 'Work Item Type': 'Bug', ID: 3, 'Salesforce ID': null, Title: 'Assigned case', 'Assigned To': 'Owner', State: 'Active', Priority: '2 - High', Tags: 'External', 'Area Path': 'Core', 'Created Date': '2026-10-07', 'Created Time': null, Age: 7, Resolution: null, 'Comment Count': null, 'Related Link Count': null, 'Closing Comment': null, 'Closed Date': null, 'Closed Time': null },
      ],
      total: 3,
    });

    app.selectOwnership('Unassigned');

    expect(app.rows.map((item) => item.ID)).toEqual([1, 2]);
    expect(httpTesting.match('/api/resources')).toHaveLength(0);
    fixture.detectChanges();
    const unassignedButton = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button'))
      .find((button) => button.textContent?.trim() === 'Unassigned');
    expect(unassignedButton?.getAttribute('aria-pressed')).toBe('true');
  });

  it('applies quick filters locally without additional API requests', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    httpTesting.expectOne('/api/health').flush({ status: 'ok', database: 'connected' });
    const row = (id: number, area: string, tags: string, state: string, age: number, priority = '2 - High', createdDate = '2026-10-07') => ({
      'Work Item Type': 'Bug',
      ID: id,
      'Salesforce ID': null,
      Title: `Case ${id}`,
      'Assigned To': 'Owner',
      State: state,
      Priority: priority,
      Tags: tags,
      'Area Path': area,
      'Created Date': createdDate,
      'Created Time': '11:04:17',
      Age: age,
      Resolution: null,
      'Comment Count': null,
      'Related Link Count': null,
      'Closing Comment': null,
      'Closed Date': null,
      'Closed Time': null,
    });
    httpTesting.expectOne('/api/metrics').flush({
      items: [
        row(1, 'Accounting', 'External;DevFixRequired', 'Implementation', 10, '2 - High', '2026-10-07'),
        row(2, 'Accounting', 'External;Batch4', 'Done', 5),
        row(3, 'Core', 'External;DevFixRequired', 'Closed', 2),
        row(4, 'Core', 'External;Other', 'Removed', 3),
        row(5, 'Core', 'External;Other', 'Delivered to PROD', 4),
        row(6, 'Core', 'External;Other', 'Refinement', 5),
        row(7, 'Core', 'External;Other', 'Implementation', 6, '3 - Medium'),
        row(8, 'Core', 'External;Other', 'Implementation', 7, '1 - Critical', '2026-09-30'),
      ],
      total: 8,
    });

    app.selectArea('Accounting');
    expect(app.rows.map((item) => item.ID)).toEqual([1, 2]);

    app.selectTag('DevFixRequired');
    expect(app.rows.map((item) => item.ID)).toEqual([1]);
    expect(app.monthlyTrendTitle).toBe('DevFixRequired case trend');
    expect(app.monthlyVolumeTitle).toBe('DevFixRequired case volume');
    expect(app.monthlyScopeLabel).toBe('Showing cases tagged: DevFixRequired');
    expect(app.printFilterSummary).toContain('Tag: DevFixRequired');
    expect(app.stateChartTitle).toBe('DevFixRequired Cases by state');
    expect(app.priorityChartTitle).toBe('DevFixRequired Priority mix');
    expect(app.monthlyChart.map((point) => point.count)).toEqual([1]);

    app.selectState('opened');
    expect(app.rows.map((item) => item.ID)).toEqual([1]);
    expect(app.total).toBe(1);

    app.clearFilters();
    app.selectState('resolved');
    expect(app.rows.map((item) => item.ID)).toEqual([2, 4, 5, 6]);
    expect(app.total).toBe(4);
    expect(app.openCount).toBe(0);

    app.clearFilters();
    expect(app.mediumPriorityCount).toBe(1);
    expect(app.criticalPriorityCount).toBe(1);
    app.selectPriority('Medium');
    expect(app.rows.map((item) => item.ID)).toEqual([7]);
    app.selectPriority('Medium');
    expect(app.rows.length).toBe(8);
    app.selectPriority('Critical');
    expect(app.rows.map((item) => item.ID)).toEqual([8]);

    app.clearFilters();
    app.dateFrom = '2026-10-01';
    app.dateTo = '2026-10-31';
    expect(app.dateRangeInvalid).toBe(false);
    app.applyFilters();
    expect(app.rows.map((item) => item.ID)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(app.monthlyChart.map((point) => [point.label, point.count])).toEqual([['Oct 26', 7]]);
    expect(app.monthlyChartTicks.map((tick) => tick.value)).toEqual([8, 6, 4, 2, 0]);
    expect(app.monthlyBarRects[0]).toMatchObject({ count: 7, rectHeight: 131.25 });
    expect(app.monthlyTotal).toBe(7);
    expect(app.monthlyPrintSummary).toContain('busiest month was Oct 26 with 7 cases');
    expect(app.monthlyPrintDetails).toEqual([{ label: 'Oct 26', count: 7, percent: '100.0%' }]);
    expect(app.priorityChart.map((item) => item.value)).toEqual([0, 6, 1, 0]);
    expect(app.highCriticalPriorityCount).toBe(6);
    expect(app.highCriticalPriorityPercent).toBeCloseTo(85.7, 1);
    expect(app.priorityPrintSummary).toContain('High is the most common priority with 6 cases (85.7%)');
    expect(app.stateChart.find((item) => item.label === 'Implementation')?.value).toBe(2);
    expect(app.statePrintSummary).toContain('7 cases are distributed across 6 states');
    expect(app.statePrintDetails.find((item) => item.label === 'Implementation')).toEqual({
      label: 'Implementation',
      count: 2,
      percent: '28.6%',
    });
    app.dateFrom = '2026-11-01';
    expect(app.dateRangeInvalid).toBe(true);
    httpTesting.expectNone((request) => request.url === '/api/metrics');
  });

  it('loads, creates, and summarizes manually logged team activities', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    httpTesting.expectOne('/api/health').flush({ status: 'ok', database: 'connected' });
    httpTesting.expectOne('/api/metrics').flush({ items: [], total: 0 });
    app.selectedActivityDate = '2026-10-14';
    app.showTeamWorkload();
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('h1')?.textContent).toContain('Team workload');
    httpTesting.expectOne((request) => request.url === '/api/team-activities'
      && request.params.get('member') === 'Tuta Mahesh'
      && request.params.get('date') === '2026-10-14').flush({
      items: [
        {
          ID: 1,
          'Team Member': 'Tuta Mahesh',
          'Activity Date': '2026-10-14',
          'Activity Type': 'Case analysis',
          Details: 'Reviewed cases',
          'Start Time': '09:00:00',
          'End Time': '10:30:00',
          'Duration Minutes': 90,
        },
        {
          ID: 2,
          'Team Member': 'Tuta Mahesh',
          'Activity Date': '2026-10-14',
          'Activity Type': 'Break',
          Details: 'Lunch',
          'Start Time': '10:30:00',
          'End Time': '11:00:00',
          'Duration Minutes': 30,
        },
      ],
    });
    expect(app.activityHoursLabel).toBe('1h 30m');
    expect(app.breakHoursLabel).toBe('0h 30m');
    expect(app.formatActivityTime('13:05:00')).toBe('1:05 PM');

    app.activityDetails = 'Fixed an issue';
    app.activityStartTime = '11:00';
    app.activityEndTime = '12:00';
    app.saveTeamActivity();
    const create = httpTesting.expectOne('/api/team-activities');
    expect(create.request.method).toBe('POST');
    expect(create.request.body).toMatchObject({
      member: 'Tuta Mahesh',
      date: '2026-10-14',
      activityType: 'Case analysis',
      details: 'Fixed an issue',
      startTime: '11:00',
      endTime: '12:00',
    });
    create.flush({ ID: 3 });
    httpTesting.expectOne((request) => request.url === '/api/team-activities').flush({ items: [] });
    expect(app.teamActivities).toEqual([]);
  });

  it('creates safe Azure DevOps and Salesforce record links', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    httpTesting.expectOne('/api/health').flush({ status: 'ok', database: 'connected' });
    httpTesting.expectOne('/api/metrics').flush({ items: [], total: 0 });

    expect(app.devOpsWorkItemUrl(112869)).toBe('https://dev.azure.com/healthcode/Central%20Change%20Portfolio/_workitems/edit/112869');
    expect(app.devOpsWorkItemUrl('not-an-id')).toBeNull();
    expect(app.salesforceCaseUrl('500P100000mCcVsIAK')).toBe('https://healthcodeltd.lightning.force.com/lightning/r/Case/500P100000mCcVsIAK/view');
    expect(app.salesforceCaseUrl('invalid')).toBeNull();
  });

  it('formats assignees, batch tags, and IST date/time values for the grid', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    httpTesting.expectOne('/api/health').flush({ status: 'ok', database: 'connected' });
    httpTesting.expectOne('/api/metrics').flush({ items: [], total: 0 });

    expect(app.displayAssignedTo('Case Owner <owner@example.com>')).toBe('Case Owner');
    const badges = app.tagBadges('Batch 1;Batch_1;Batch 2;Batch4ExternalSF;Batch 7');
    expect(badges.map((badge) => badge.label)).toEqual([
      'Batch 1',
      'Batch_1',
      'Batch 2',
      'Batch4ExternalSF',
      'Batch 7',
    ]);
    expect(badges[0].backgroundColor).toBe('hsl(137, 52%, 88%)');
    expect(badges[1].backgroundColor).toBe(badges[0].backgroundColor);
    expect(badges[2].backgroundColor).not.toBe(badges[0].backgroundColor);
    expect(badges[3].backgroundColor).toBe('hsl(188, 52%, 88%)');
    expect(badges[4].backgroundColor).not.toBe(badges[0].backgroundColor);
    expect(app.formatDate('2026-10-07')).toBe('07 Oct 2026');
    expect(app.formatTime('23:04:17')).toBe('11:04:17 PM');
    expect(app.formatTime('11:04:17')).toBe('11:04:17 AM');
    expect(app.ageClass(5)).toBe('priority-medium');
    expect(app.ageClass(20)).toBe('priority-high');
    expect(app.ageClass(45)).toBe('priority-critical');
    const missingAge: string | number | null = null;
    expect(app.ageClass(missingAge)).toBe('priority-low');
  });

  it('shows the empty state when the API is unavailable', () => {
    const fixture = TestBed.createComponent(App);
    httpTesting.expectOne('/api/health').flush({}, { status: 503, statusText: 'Unavailable' });
    httpTesting.expectOne('/api/metrics').flush({}, { status: 503, statusText: 'Unavailable' });
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.database-card strong')?.textContent).toContain('Not connected');
    expect(compiled.querySelector('.loader')).toBeNull();
    expect(compiled.querySelector('.empty-state')?.textContent).toContain('Start PostgreSQL and the API');
  });
});
