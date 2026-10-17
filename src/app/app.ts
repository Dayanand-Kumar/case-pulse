import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { ChangeDetectorRef, Component, ElementRef, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { parseCsv } from './csv';

const METRIC_COLUMNS = [
  'Work Item Type',
  'ID',
  'Salesforce ID',
  'Title',
  'Assigned To',
  'State',
  'Priority',
  'Tags',
  'Area Path',
  'Created Date',
  'Comment Count',
  'Related Link Count',
  'Closing Comment',
  'Closed Date',
] as const;
const RISK_SUMMARY_COLUMNS = [
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
] as const;

type MetricColumn = (typeof METRIC_COLUMNS)[number];
type RiskSummaryColumn = (typeof RISK_SUMMARY_COLUMNS)[number];
type MetricValue = string | number | null | undefined;
type WorkbookRow = Partial<Record<MetricColumn | RiskSummaryColumn, MetricValue>> & Record<string, MetricValue>;
type MetricRow = WorkbookRow & {
  'Created Time': MetricValue;
  'Closed Time': MetricValue;
  Age: MetricValue;
  Resolution: MetricValue;
};
const DISPLAY_COLUMNS = [
  'ID',
  'Salesforce ID',
  'Title',
  'Assigned To',
  'State',
  'Priority',
  'Tags',
  'Created Date',
  'Created Time',
  'Age',
  'Resolution',
  'Comment Count',
  'Related Link Count',
  'Closing Comment',
  'Closed Date',
  'Closed Time',
] as const;
const RISK_SUMMARY_DISPLAY_COLUMNS = RISK_SUMMARY_COLUMNS;
type ApiResponse = { items: MetricRow[]; total: number; lastDataRefreshByArea?: Record<string, string> };
type DatabaseState = 'checking' | 'connected' | 'disconnected';
type Resource = { Resource_Name: string; Department: string; Team: string; Aliases?: string[] };
type TeamActivity = {
  ID: number;
  'Team Member': string;
  'Activity Date': string;
  'Activity Type': string;
  Details: string;
  'Start Time': string;
  'End Time': string;
  'Duration Minutes': number;
};
type ChartItem = { label: string; value: number; percent: number; color: string };
type BatchResolutionItem = { label: string; resolved: number; total: number; rate: number; color: string };
type MonthlyItem = { label: string; count: number; x: number; y: number };
type ChartTick = { value: number; y: number };
type ReportTab = 'invoices' | 'patients' | 'appointments' | 'patientNotes';
type InvoiceReportRow = {
  batch: string;
  online: number;
  electronic: number;
  paper: number;
  generatedSites: string;
  releasedSites: number;
};
type ReportMetric = { label: string; count: number };
const PRIORITY_CHART_COLORS = ['#bd694d', '#d9a257', '#7c9b74', '#8194ad'];
const TEAM_MEMBERS = ['Tuta Mahesh', 'Madala Koteswar Rao', 'Dayanand Kumar K.'];
const REPORT_TABS: { id: ReportTab; label: string; count: number }[] = [
  { id: 'invoices', label: 'Invoices', count: 45971 },
  { id: 'patients', label: 'Patient count', count: 47949 },
  { id: 'appointments', label: 'Appointment count', count: 40613 },
  { id: 'patientNotes', label: 'Patient note count', count: 50092 },
];
const INVOICE_REPORT_ROWS: InvoiceReportRow[] = [
  { batch: 'PILOT_SITES', online: 213, electronic: 5699, paper: 35, generatedSites: '3/3', releasedSites: 3 },
  { batch: 'BATCH_1', online: 176, electronic: 5024, paper: 167, generatedSites: '67/92', releasedSites: 92 },
  { batch: 'BATCH_2', online: 38, electronic: 11543, paper: 467, generatedSites: '153/225', releasedSites: 225 },
  { batch: 'BATCH_3', online: 204, electronic: 11666, paper: 1107, generatedSites: '233/297', releasedSites: 297 },
  { batch: 'BATCH_4', online: 113, electronic: 8212, paper: 511, generatedSites: '231/340', releasedSites: 340 },
  { batch: 'BATCH_5', online: 20, electronic: 696, paper: 22, generatedSites: '76/306', releasedSites: 306 },
  { batch: 'Hospital Sites', online: 0, electronic: 58, paper: 0, generatedSites: '3/10', releasedSites: 10 },
];
const INVOICE_REPORT_TOTAL = { online: 764, electronic: 42898, paper: 2309, generatedSites: '766/1273', releasedSites: 1273 };
const REPORT_METRICS: Partial<Record<ReportTab, ReportMetric>> = {
  patients: { label: 'Total number of patients', count: 47949 },
  appointments: { label: 'Total number of appointments', count: 40613 },
  patientNotes: { label: 'Total number of clinic notes', count: 50092 },
};
const PRESCRIBING_AREA_PATH = String.raw`Central Change Portfolio\EHR\Prescribing`;
const EP2_AREA_PATH = String.raw`Central Change Portfolio\v1 - ePractice`;
const AREA_RESOURCE_TEAMS: Record<string, string> = {
  Accounting: 'Accounting',
  Core: 'Core',
  [PRESCRIBING_AREA_PATH]: 'Prescribing',
  [EP2_AREA_PATH]: 'Team 4',
};
const TEAM_ACTIVITY_TYPES = [
  'Case analysis',
  'Development / fix',
  'Testing / validation',
  'Code review',
  'Team meeting',
  'Documentation',
  'Support',
  'Break',
  'Other',
];
const monthlyAxisMaximum = (points: { count: number }[]) => (
  Math.ceil(Math.max(1, ...points.map((point) => point.count)) / 4) * 4
);

@Component({
  imports: [FormsModule],
  selector: 'app-root',
  styleUrl: './app.css',
  templateUrl: './app.html',
})
export class App {
  @ViewChild('fileInput') private fileInput?: ElementRef<HTMLInputElement>;

  get columns(): readonly string[] {
    return this.riskSummaryView ? RISK_SUMMARY_DISPLAY_COLUMNS : DISPLAY_COLUMNS;
  }

  get lastDataRefreshLabel(): string | null {
    if (!this.selectedAreas.length) return null;
    const timestamps = Object.entries(this.lastDataRefreshByArea)
      .filter(([area]) => this.selectedAreas.some((selected) => (
        area.toLocaleLowerCase().includes(selected.toLocaleLowerCase())
      )))
      .map(([, timestamp]) => Date.parse(timestamp))
      .filter(Number.isFinite);
    if (!timestamps.length) return 'Not available';
    const latestTimestamp = timestamps.reduce((latest, timestamp) => Math.max(latest, timestamp));
    const parts = new Intl.DateTimeFormat('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
      timeZone: 'Asia/Kolkata',
    }).formatToParts(new Date(latestTimestamp));
    const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
    return `${values['day']} ${values['month']} ${values['year']}, ${values['hour']}:${values['minute']}:${values['second']} ${values['dayPeriod'].toUpperCase()}`;
  }
  readonly teamMembers = TEAM_MEMBERS;
  readonly activityTypes = TEAM_ACTIVITY_TYPES;
  readonly todayLabel = new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  private allRows: MetricRow[] = [];
  private lastDataRefreshByArea: Record<string, string> = {};
  private resources: Resource[] = [];
  private resourcesLoaded = false;
  private resourcesLoading = false;
  rows: MetricRow[] = [];
  total = 0;
  loading = false;
  importing = false;
  message = '';
  messageKind: 'error' | 'success' = 'error';
  databaseState: DatabaseState = 'checking';
  areaPath = '';
  readonly prescribingAreaPath = PRESCRIBING_AREA_PATH;
  readonly ep2AreaPath = EP2_AREA_PATH;
  dashboardView = false;
  teamWorkloadView = false;
  riskSummaryView = false;
  documentationView = false;
  reportsView = false;
  selectedReportTab: ReportTab = 'invoices';
  reportDateFrom = '';
  reportDateTo = '';
  reportRangeApplied = false;
  reportRangeError = '';
  readonly reportTabs = REPORT_TABS;
  readonly invoiceReportRows = INVOICE_REPORT_ROWS;
  readonly invoiceReportTotal = INVOICE_REPORT_TOTAL;
  selectedTeamMember = TEAM_MEMBERS[0];
  selectedActivityDate = this.localDateValue(new Date());
  teamActivities: TeamActivity[] = [];
  activityType = TEAM_ACTIVITY_TYPES[0];
  activityDetails = '';
  activityStartTime = '09:00';
  activityEndTime = '10:00';
  activitySaving = false;
  ageMinDays: number | null = null;
  ageMaxDays: number | null = null;
  dateFrom = '';
  dateTo = '';
  tags = 'External';
  riskSummaryTags = '';
  ownership = '';
  multiSelect = false;
  stateFilter = '';
  severity = '';
  assignedTo = '';

  constructor(private readonly http: HttpClient, private readonly changeDetector: ChangeDetectorRef) {
    this.checkDatabase();
    this.loadMetrics();
  }

  get openCount(): number {
    return this.rows.filter((row) => !this.isClosed(row['State'])).length;
  }

  get reportRangeInvalid(): boolean {
    return !this.reportDateFrom
      || !this.reportDateTo
      || !/^\d{4}-\d{2}-\d{2}$/.test(this.reportDateFrom)
      || !/^\d{4}-\d{2}-\d{2}$/.test(this.reportDateTo)
      || this.reportDateFrom > this.reportDateTo;
  }

  get selectedReportMetric(): ReportMetric | null {
    return REPORT_METRICS[this.selectedReportTab] ?? null;
  }

  get reportTotalInvoices(): number {
    return this.invoiceReportRows.reduce(
      (total, row) => total + row.online + row.electronic + row.paper,
      0,
    );
  }

  get reportTotalReleasedSites(): number {
    return this.invoiceReportRows.reduce((total, row) => total + row.releasedSites, 0);
  }

  get nonBreakMinutes(): number {
    return this.teamActivities
      .filter((activity) => activity['Activity Type'] !== 'Break')
      .reduce((sum, activity) => sum + Number(activity['Duration Minutes']), 0);
  }

  get breakMinutes(): number {
    return this.teamActivities
      .filter((activity) => activity['Activity Type'] === 'Break')
      .reduce((sum, activity) => sum + Number(activity['Duration Minutes']), 0);
  }

  get activityHoursLabel(): string {
    return this.formatDuration(this.nonBreakMinutes);
  }

  get breakHoursLabel(): string {
    return this.formatDuration(this.breakMinutes);
  }

  get teamWorkloadTitle(): string {
    return `${this.selectedTeamMember} Â· Team workload`;
  }

  get priorityCount(): number {
    return this.rows.filter((row) => /critical|high|^1$|^2$/i.test(String(row['Priority'] ?? ''))).length;
  }

  get mediumPriorityCount(): number {
    return this.rows.filter((row) => /medium|^3$/i.test(String(row['Priority'] ?? ''))).length;
  }

  get criticalPriorityCount(): number {
    return this.rows.filter((row) => /critical|^1$/i.test(String(row['Priority'] ?? ''))).length;
  }

  get stateChart(): ChartItem[] {
    const counts = this.rows.reduce<Record<string, number>>((result, row) => {
      const state = String(row['State'] ?? '').trim() || 'Unspecified';
      result[state] = (result[state] ?? 0) + 1;
      return result;
    }, {});
    const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const max = Math.max(1, ...entries.map(([, count]) => count));
    return entries.map(([label, value], index) => ({
      label,
      value,
      percent: (value / max) * 100,
      color: `hsl(${(index * 53 + 145) % 360}, 30%, 48%)`,
    }));
  }

  get priorityChart(): ChartItem[] {
    const labels = ['Critical', 'High', 'Medium', 'Low'];
    const counts = labels.map((label) => this.rows.filter((row) => this.priorityLabel(row['Priority']) === label).length);
    const total = counts.reduce((sum, value) => sum + value, 0);
    return labels.map((label, index) => ({
      label,
      value: counts[index],
      percent: total ? (counts[index] / total) * 100 : 0,
      color: PRIORITY_CHART_COLORS[index],
    }));
  }

  get highCriticalPriorityCount(): number {
    return this.priorityChart.slice(0, 2).reduce((sum, item) => sum + item.value, 0);
  }

  get highCriticalPriorityPercent(): number {
    return this.total ? (this.highCriticalPriorityCount / this.total) * 100 : 0;
  }

  get resolutionRateCount(): number {
    return this.rows.filter((row) => {
      const state = String(row['State'] ?? '').trim().toLowerCase();
      return state === 'delivered to prod' || state === 'done';
    }).length;
  }

  get resolutionRate(): number {
    return this.total ? (this.resolutionRateCount / this.total) * 100 : 0;
  }

  get monthlyTrendTitle(): string {
    return this.tags.trim() ? `${this.tags.trim()} case trend` : 'Monthly case trend';
  }

  get monthlyVolumeTitle(): string {
    return this.tags.trim() ? `${this.tags.trim()} case volume` : 'Monthly case volume';
  }

  get monthlyScopeLabel(): string {
    return this.tags.trim() ? `Showing cases tagged: ${this.tags.trim()}` : 'Showing all cases matching current filters';
  }

  get monthlyPrintSummary(): string {
    const months = this.monthlyChart;
    if (!months.length) return 'No dated cases are available for this selection.';
    const peak = months.reduce((largest, month) => month.count > largest.count ? month : largest);
    const average = this.monthlyTotal / months.length;
    return `${this.monthlyTotal} dated cases across ${months.length} month${months.length === 1 ? '' : 's'}, averaging ${average.toFixed(1)} cases per month. `
      + `The busiest month was ${peak.label} with ${peak.count} cases (${this.shareOfTotal(peak.count)} of the dated total).`;
  }

  get statePrintSummary(): string {
    const states = this.stateChart;
    if (!states.length) return 'No cases are available for this selection.';
    const leading = states[0];
    return `${this.total} cases are distributed across ${states.length} state${states.length === 1 ? '' : 's'}. `
      + `${leading.label} is the most common state with ${leading.value} cases (${((leading.value / this.total) * 100).toFixed(1)}% of filtered cases).`;
  }

  get priorityPrintSummary(): string {
    if (!this.total) return 'No cases are available for this selection.';
    const leader = this.priorityChart.reduce((largest, item) => item.value > largest.value ? item : largest);
    return `${leader.label} is the most common priority with ${leader.value} cases (${leader.percent.toFixed(1)}%). `
      + `${this.highCriticalPriorityCount} cases (${this.highCriticalPriorityPercent.toFixed(1)}%) are High or Critical; `
      + `${this.total - this.highCriticalPriorityCount} cases are Medium or Low.`;
  }

  get monthlyPrintDetails(): { label: string; count: number; percent: string }[] {
    return this.monthlyChart.map((month) => ({
      label: month.label,
      count: month.count,
      percent: this.monthlyTotal ? `${((month.count / this.monthlyTotal) * 100).toFixed(1)}%` : '0.0%',
    }));
  }

  get statePrintDetails(): { label: string; count: number; percent: string }[] {
    return this.stateChart.map((item) => ({
      label: item.label,
      count: item.value,
      percent: this.total ? `${((item.value / this.total) * 100).toFixed(1)}%` : '0.0%',
    }));
  }

  private shareOfTotal(count: number): string {
    return `${this.monthlyTotal ? ((count / this.monthlyTotal) * 100).toFixed(1) : '0.0'}%`;
  }

  get dateRangeInvalid(): boolean {
    return Boolean(this.dateFrom && this.dateTo && this.dateFrom > this.dateTo);
  }

  get printFilterSummary(): string {
    const filters = [
      this.areaPath.trim() ? `Area: ${this.areaPath.trim()}` : '',
      this.tags.trim() ? `Tag: ${this.tags.trim()}` : '',
      this.stateFilter ? `State: ${this.stateFilter}` : '',
      this.severity.trim() ? `Priority: ${this.severity.trim()}` : '',
      this.assignedTo.trim() ? `Assigned to: ${this.assignedTo.trim()}` : '',
      this.ageMinDays !== null || this.ageMaxDays !== null
        ? `Age: ${this.ageMinDays ?? 0}â€“${this.ageMaxDays ?? 'any'} days`
        : '',
      this.dateFrom || this.dateTo
        ? `Created: ${this.dateFrom || 'any'} to ${this.dateTo || 'any'}`
        : '',
    ].filter(Boolean);
    return filters.length ? filters.join(' Â· ') : 'All matching cases';
  }

  printDashboard(): void {
    if (!this.dateRangeInvalid) window.print();
  }

  get stateChartTitle(): string {
    return this.tags.trim() ? `${this.tags.trim()} Cases by state` : 'Cases by state';
  }

  get priorityChartTitle(): string {
    return this.tags.trim() ? `${this.tags.trim()} Priority mix` : 'Priority mix';
  }

  private get monthlyCounts(): { label: string; count: number }[] {
    const counts = new Map<string, number>();
    for (const row of this.rows) {
      const date = this.dateKey(row['Created Date']);
      if (date) {
        const month = date.slice(0, 7);
        counts.set(month, (counts.get(month) ?? 0) + 1);
      }
    }

    const first = this.dateFrom ? this.dateFrom.slice(0, 7) : [...counts.keys()].sort()[0];
    const last = this.dateTo ? this.dateTo.slice(0, 7) : [...counts.keys()].sort().at(-1);
    if (!first || !last || first > last) return [];

    const months: { key: string; count: number }[] = [];
    const start = new Date(`${first}-01T00:00:00Z`);
    const end = new Date(`${last}-01T00:00:00Z`);
    while (start <= end) {
      const key = start.toISOString().slice(0, 7);
      months.push({ key, count: counts.get(key) ?? 0 });
      start.setUTCMonth(start.getUTCMonth() + 1);
    }

    const visible = !this.dateFrom && !this.dateTo ? months.slice(-12) : months;
    return visible.map((month) => ({
      label: new Intl.DateTimeFormat('en', { month: 'short', year: '2-digit', timeZone: 'UTC' })
        .format(new Date(`${month.key}-01T00:00:00Z`)),
      count: month.count,
    }));
  }

  get monthlyChart(): MonthlyItem[] {
    const visible = this.monthlyCounts;
    const countMax = Math.max(1, ...visible.map((month) => month.count));
    const max = Math.ceil(countMax / 4) * 4;
    const left = 72;
    const width = Math.max(640, 104 + visible.length * 44) - 104;
    const top = 32;
    const height = 150;
    return visible.map((month, index) => {
      const x = left + ((index + 0.5) * width) / visible.length;
      const y = top + height - (month.count / max) * height;
      return { ...month, x, y };
    });
  }

  get monthlyTrendPoints(): string {
    return this.monthlyChart.map((point) => `${point.x},${point.y}`).join(' ');
  }

  get monthlyTrendAreaPoints(): string {
    const chart = this.monthlyChart;
    if (!chart.length) return '';
    return `${chart[0].x},182 ${this.monthlyTrendPoints} ${chart[chart.length - 1].x},182`;
  }

  get monthlyPeak(): MonthlyItem | null {
    return this.monthlyChart.reduce<MonthlyItem | null>((peak, point) => !peak || point.count > peak.count ? point : peak, null);
  }

  get monthlyAverage(): number {
    const chart = this.monthlyChart;
    return chart.length ? Math.round(this.monthlyTotal / chart.length) : 0;
  }

  get monthlyChartWidth(): number {
    return Math.max(640, 104 + this.monthlyChart.length * 44);
  }

  get monthlyChartAxisRight(): number {
    return this.monthlyChartWidth - 28;
  }

  get monthlyTotal(): number {
    return this.monthlyChart.reduce((sum, point) => sum + point.count, 0);
  }

  get monthlyChartTicks(): ChartTick[] {
    const top = 32;
    const height = 150;
    const maximum = monthlyAxisMaximum(this.monthlyChart);
    const step = maximum / 4;
    return Array.from({ length: 5 }, (_, index) => {
      const value = maximum - index * step;
      return { value, y: top + (index * height) / 4 };
    });
  }

  get monthlyBarRects(): (MonthlyItem & { rectX: number; rectY: number; rectWidth: number; rectHeight: number })[] {
    const chart = this.monthlyChart;
    const slotWidth = (this.monthlyChartWidth - 104) / chart.length;
    const baseline = 182;
    const chartHeight = 150;
    const max = monthlyAxisMaximum(chart);
    const barWidth = Math.min(30, slotWidth * 0.62);
    return chart.map((point) => {
      const rectHeight = (point.count / max) * chartHeight;
      return {
        ...point,
        rectX: point.x - barWidth / 2,
        rectY: baseline - rectHeight,
        rectWidth: barWidth,
        rectHeight,
      };
    });
  }

  get batchResolutionChart(): BatchResolutionItem[] {
    const batches = new Map<string, { total: number; resolved: number }>();
    for (const row of this.rows) {
      const state = String(row['State'] ?? '').trim().toLowerCase();
      const resolved = state === 'delivered to prod' || state === 'done';
      const labels = new Set(
        String(row['Tags'] ?? '')
          .split(';')
          .flatMap((tag) => {
            const normalized = tag.trim();
            const batch = normalized.match(/^batch[\s_-]*(\d+)$/i)?.[1];
            if (batch) return [`Batch ${Number(batch)}`];
            if (/^pilot(?: case)?$/i.test(normalized)) return ['Pilot'];
            if (/^hospitals?$/i.test(normalized)) return ['Hospitals'];
            return [];
          }),
      );
      for (const label of labels) {
        const current = batches.get(label) ?? { total: 0, resolved: 0 };
        current.total += 1;
        if (resolved) current.resolved += 1;
        batches.set(label, current);
      }
    }
    return [...batches.entries()]
      .sort(([left], [right]) => {
        const sortKey = (label: string): number => label === 'Pilot' ? 1000 : label === 'Hospitals' ? 1001 : Number(label.replace(/\D/g, ''));
        return sortKey(left) - sortKey(right);
      })
      .map(([label, values], index) => ({
        label,
        resolved: values.resolved,
        total: values.total,
        rate: values.total ? (values.resolved / values.total) * 100 : 0,
        color: `hsl(${(index * 37 + 138) % 360}, 32%, 46%)`,
      }));
  }
  get priorityDonutSegments(): (ChartItem & { dash: string; offset: number })[] {
    const circumference = 2 * Math.PI * 70;
    let offset = 0;
    return this.priorityChart.map((item) => {
      const length = (item.percent / 100) * circumference;
      const segment = { ...item, dash: `${length} ${circumference - length}`, offset: -offset };
      offset += length;
      return segment;
    });
  }
  loadMetrics(): void {
    this.loading = true;
    let params = new HttpParams();
    const filters: Record<string, string | number | null> = {
      areaPath: this.areaPath,
      ageMinDays: this.ageMinDays,
      ageMaxDays: this.ageMaxDays,
      severity: this.severity,
      assignedTo: this.assignedTo,
      stateFilter: this.stateFilter,
    };
    for (const [key, value] of Object.entries(filters)) {
      if (value !== null && String(value).trim() !== '') {
        params = params.set(key, String(value).trim());
      }
    }
    if (this.riskSummaryView) params = params.set('dataset', 'riskSummary');
    this.http.get<ApiResponse>('/api/metrics', { params }).subscribe({
      next: (response) => {
        this.allRows = response.items;
        this.lastDataRefreshByArea = response.lastDataRefreshByArea ?? {};
        this.filterLoadedMetrics();
        this.loading = false;
        this.changeDetector.markForCheck();
      },
      error: (error: HttpErrorResponse) => {
        this.allRows = [];
        this.lastDataRefreshByArea = {};
        this.rows = [];
        this.total = 0;
        this.loading = false;
        this.databaseState = 'disconnected';
        this.setMessage(error.error?.error ?? 'Could not load metrics. Check the API and PostgreSQL connection.');
        this.changeDetector.markForCheck();
      },
    });
  }

  applyFilters(): void {
    this.message = '';
    this.filterLoadedMetrics();
    this.changeDetector.markForCheck();
  }

  clearFilters(): void {
    this.areaPath = '';
    this.ageMinDays = null;
    this.ageMaxDays = null;
    this.tags = 'External';
    this.riskSummaryTags = '';
    this.ownership = '';
    this.multiSelect = false;
    this.stateFilter = '';
    this.severity = '';
    this.assignedTo = '';
    this.dateFrom = '';
    this.dateTo = '';
    this.message = '';
    this.filterLoadedMetrics();
    this.changeDetector.markForCheck();
  }

  chooseFile(): void {
    this.fileInput?.nativeElement.click();
  }

  selectArea(area: string): void {
    this.areaPath = this.toggleFilterSelection(this.areaPath, area);
    this.applyFilters();
  }

  selectTag(tag: string): void {
    if (this.riskSummaryView) {
      this.riskSummaryTags = this.toggleFilterSelection(this.riskSummaryTags, tag);
    } else {
      this.tags = this.toggleFilterSelection(this.tags, tag);
    }
    this.applyFilters();
  }

  setTagFilter(value: string): void {
    if (this.riskSummaryView) this.riskSummaryTags = value;
    else this.tags = value;
  }

  selectOwnership(value: string): void {
    this.ownership = this.toggleFilterSelection(this.ownership, value);
    if (this.hasResourceOwnershipSelection) this.loadResources();
    this.applyFilters();
  }

  private toggleFilterSelection(current: string, value: string): string {
    if (!this.multiSelect) return current === value ? '' : value;
    const selected = current.split(',').map((item) => item.trim()).filter(Boolean);
    const exists = selected.some((item) => item.toLocaleLowerCase() === value.toLocaleLowerCase());
    return (exists
      ? selected.filter((item) => item.toLocaleLowerCase() !== value.toLocaleLowerCase())
      : [...selected, value]
    ).join(', ');
  }

  get selectedTags(): string[] {
    const tags = this.riskSummaryView ? this.riskSummaryTags : this.tags;
    return this.multiSelect
      ? tags.split(',').map((tag) => tag.trim()).filter(Boolean)
      : tags.trim() ? [tags.trim()] : [];
  }

  get selectedAreas(): string[] {
    return this.multiSelect
      ? this.areaPath.split(',').map((area) => area.trim()).filter(Boolean)
      : this.areaPath.trim() ? [this.areaPath.trim()] : [];
  }

  get selectedOwnership(): string[] {
    return this.multiSelect
      ? this.ownership.split(',').map((value) => value.trim()).filter(Boolean)
      : this.ownership.trim() ? [this.ownership.trim()] : [];
  }

  private get hasResourceOwnershipSelection(): boolean {
    return this.selectedOwnership.some((owner) => owner.toLocaleLowerCase() !== 'unassigned');
  }

  isTagSelected(tag: string): boolean {
    return this.selectedTags.some((selected) => selected.toLocaleLowerCase() === tag.toLocaleLowerCase());
  }

  isAreaSelected(area: string): boolean {
    return this.selectedAreas.some((selected) => selected.toLocaleLowerCase() === area.toLocaleLowerCase());
  }

  isOwnershipSelected(value: string): boolean {
    return this.selectedOwnership.some((selected) => selected.toLocaleLowerCase() === value.toLocaleLowerCase());
  }

  setMultiSelect(enabled: boolean): void {
    const selectedAreas = this.selectedAreas;
    const selectedTags = this.selectedTags;
    const selectedOwnership = this.selectedOwnership;
    this.multiSelect = enabled;
    if (!enabled) {
      this.areaPath = selectedAreas[0] ?? '';
      if (this.riskSummaryView) this.riskSummaryTags = selectedTags.join(', ');
      else this.tags = selectedTags[0] ?? '';
      this.ownership = selectedOwnership[0] ?? '';
    }
    if (this.hasResourceOwnershipSelection) this.loadResources();
    this.applyFilters();
  }

  private loadResources(): void {
    if (this.resourcesLoaded || this.resourcesLoading) return;
    this.resourcesLoading = true;
    this.http.get<{ items: Resource[] }>('/api/resources').subscribe({
      next: (response) => {
        this.resources = response.items;
        this.resourcesLoaded = true;
        this.resourcesLoading = false;
        this.applyFilters();
      },
      error: (error: HttpErrorResponse) => {
        this.resourcesLoading = false;
        this.setMessage(error.error?.error ?? 'Could not load ownership resources.');
      },
    });
  }

  selectState(state: string): void {
    this.stateFilter = this.stateFilter === state ? '' : state;
    this.applyFilters();
  }

  selectPriority(priority: 'Medium' | 'Critical'): void {
    this.severity = this.severity.toLowerCase() === priority.toLowerCase() ? '' : priority;
    this.applyFilters();
  }

  showDashboard(): void {
    const reloadMetrics = this.riskSummaryView;
    this.dashboardView = true;
    this.teamWorkloadView = false;
    this.riskSummaryView = false;
    this.documentationView = false;
    this.reportsView = false;
    if (reloadMetrics) this.loadMetrics();
    else this.applyFilters();
  }

  showRiskSummary(): void {
    this.dashboardView = false;
    this.teamWorkloadView = false;
    this.riskSummaryView = true;
    this.documentationView = false;
    this.reportsView = false;
    this.loadMetrics();
  }

  showCases(): void {
    const reloadMetrics = this.riskSummaryView;
    this.dashboardView = false;
    this.teamWorkloadView = false;
    this.riskSummaryView = false;
    this.documentationView = false;
    this.reportsView = false;
    if (reloadMetrics) this.loadMetrics();
    else this.applyFilters();
  }

  showTeamWorkload(): void {
    this.dashboardView = false;
    this.teamWorkloadView = true;
    this.riskSummaryView = false;
    this.documentationView = false;
    this.reportsView = false;
    this.loadTeamActivities();
  }

  showDocumentation(): void {
    this.dashboardView = false;
    this.teamWorkloadView = false;
    this.riskSummaryView = false;
    this.documentationView = true;
    this.reportsView = false;
  }

  showReports(): void {
    this.dashboardView = false;
    this.teamWorkloadView = false;
    this.riskSummaryView = false;
    this.documentationView = false;
    this.reportsView = true;
  }

  selectReportTab(tab: ReportTab): void {
    this.selectedReportTab = tab;
  }

  applyReportDateRange(): void {
    if (this.reportRangeInvalid) {
      this.reportRangeApplied = false;
      this.reportRangeError = !this.reportDateFrom || !this.reportDateTo
        ? 'Select both a start date and an end date to view report data.'
        : 'The start date must be on or before the end date.';
      return;
    }
    this.reportRangeError = '';
    this.reportRangeApplied = true;
  }

  clearReportDateRange(): void {
    this.reportDateFrom = '';
    this.reportDateTo = '';
    this.reportRangeApplied = false;
    this.reportRangeError = '';
  }

  loadTeamActivities(): void {
    this.http.get<{ items: TeamActivity[] }>('/api/team-activities', {
      params: { member: this.selectedTeamMember, date: this.selectedActivityDate },
    }).subscribe({
      next: (response) => {
        this.teamActivities = response.items;
        this.changeDetector.markForCheck();
      },
      error: (error: HttpErrorResponse) => {
        this.teamActivities = [];
        this.setMessage(error.error?.error ?? 'Could not load team activities. Check the API and PostgreSQL connection.');
      },
    });
  }

  saveTeamActivity(): void {
    if (this.activitySaving) return;
    if (!this.activityDetails.trim()) {
      this.setMessage('Enter a short description of the activity.');
      return;
    }
    if (!this.activityStartTime || !this.activityEndTime || this.activityStartTime >= this.activityEndTime) {
      this.setMessage('Enter a valid time range with the end after the start.');
      return;
    }
    this.message = '';
    this.activitySaving = true;
    this.http.post<TeamActivity>('/api/team-activities', {
      member: this.selectedTeamMember,
      date: this.selectedActivityDate,
      activityType: this.activityType,
      details: this.activityDetails.trim(),
      startTime: this.activityStartTime,
      endTime: this.activityEndTime,
    }).subscribe({
      next: () => {
        this.activityDetails = '';
        this.activitySaving = false;
        this.messageKind = 'success';
        this.message = 'Activity saved to the team workload log.';
        this.loadTeamActivities();
      },
      error: (error: HttpErrorResponse) => {
        this.activitySaving = false;
        this.setMessage(error.error?.error ?? 'Could not save the activity. Check the API and PostgreSQL connection.');
      },
    });
  }

  deleteTeamActivity(id: number): void {
    this.http.delete(`/api/team-activities/${id}`).subscribe({
      next: () => {
        this.teamActivities = this.teamActivities.filter((activity) => activity.ID !== id);
        this.messageKind = 'success';
        this.message = 'Activity entry deleted.';
        this.changeDetector.markForCheck();
      },
      error: (error: HttpErrorResponse) => {
        this.setMessage(error.error?.error ?? 'Could not delete the activity entry.');
      },
    });
  }

  formatDuration(minutes: number): string {
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h ${String(remainingMinutes).padStart(2, '0')}m`;
  }

  formatActivityTime(value: string): string {
    const match = value.match(/^(\d{1,2}):(\d{2})/);
    if (!match) return value;
    const hour = Number(match[1]);
    const suffix = hour >= 12 ? 'PM' : 'AM';
    return `${hour % 12 || 12}:${match[2]} ${suffix}`;
  }

  clearDateRange(): void {
    this.dateFrom = '';
    this.dateTo = '';
    this.applyFilters();
  }

  private priorityLabel(value: MetricValue): string {
    const priority = String(value ?? '').trim().toLowerCase();
    if (!priority || priority.includes('medium') || priority === '3') return 'Medium';
    if (priority.includes('critical') || priority === '1') return 'Critical';
    if (priority.includes('high') || priority === '2') return 'High';
    return 'Low';
  }

  private dateKey(value: MetricValue): string {
    const date = String(value ?? '');
    return /^\d{4}-\d{2}-\d{2}/.test(date) ? date.slice(0, 10) : '';
  }

  private localDateValue(date: Date): string {
    const pad = (part: number) => String(part).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  private filterLoadedMetrics(): void {
    const containsText = (value: MetricValue, filter: string) => (
      !filter.trim() || String(value ?? '').toLocaleLowerCase().includes(filter.trim().toLocaleLowerCase())
    );
    const state = this.stateFilter.toLowerCase();
    this.rows = this.allRows.filter((row) => {
      const tagNames = String(row['Tags'] ?? '').split(';').map((tag) => tag.trim().toLocaleLowerCase());
      const eligibleTags = this.riskSummaryView
        ? ['orca scan', 'pentest 2026', 'zerothreat']
        : ['external', 'internal'];
      const hasEligibleTag = this.riskSummaryView
        ? tagNames.some((tag) => tag.includes('orca') || ['pentest 2026', 'zerothreat'].includes(tag))
        : tagNames.some((tag) => eligibleTags.includes(tag));
      if (!hasEligibleTag) return false;
      const matchesTag = (filter: string) => {
        const normalizedFilter = filter.toLocaleLowerCase();
        if (this.riskSummaryView && normalizedFilter === 'orca scan') {
          return tagNames.some((tag) => tag.includes('orca'));
        }
        return eligibleTags.includes(normalizedFilter)
          ? tagNames.includes(normalizedFilter)
          : String(row['Tags'] ?? '').toLocaleLowerCase().includes(normalizedFilter);
      };
      const tagFilters = this.selectedTags;
      if (tagFilters.length && (this.multiSelect
        ? !tagFilters.some(matchesTag)
        : !matchesTag(tagFilters[0]))) return false;
      const areaFilters = this.selectedAreas;
      if (areaFilters.length && !areaFilters.some((filter) => (
        String(row['Area Path'] ?? '').toLocaleLowerCase().includes(filter.toLocaleLowerCase())
      ))) return false;
      const ownershipFilters = this.selectedOwnership;
      if (ownershipFilters.length) {
        const assignedToValue = String(row['Assigned To'] ?? '').trim();
        const isUnassigned = assignedToValue === '';
        const selectedTeams = areaFilters
          .map((area) => AREA_RESOURCE_TEAMS[area])
          .filter((team): team is string => Boolean(team))
          .map((team) => team.toLocaleLowerCase());
        const ownedBySelectedResource = ownershipFilters.some((owner) => (
          owner.toLocaleLowerCase() === 'unassigned' && isUnassigned
        )) || this.resources.some((resource) => {
          const assignedTo = this.normalizeResourceName(this.displayAssignedTo(assignedToValue));
          const resourceNames = [resource.Resource_Name, ...(resource.Aliases ?? [])]
            .map((name) => this.normalizeResourceName(name));
          if (!resourceNames.includes(assignedTo)) return false;
          const department = resource.Department.trim().toLocaleLowerCase();
          const matchesOwnership = ownershipFilters.some((owner) => (
            owner.toLocaleLowerCase() === 'qa'
              ? department === 'qa' || department === 'qa lead'
              : department === owner.toLocaleLowerCase()
          ));
          if (!matchesOwnership) return false;
          const team = resource.Team.trim().toLocaleLowerCase();
          return selectedTeams.length === 0 || team === 'overall' || selectedTeams.includes(team);
        });
        if (!ownedBySelectedResource) return false;
      }
      const createdDate = this.dateKey(row['Created Date']);
      if (this.dateFrom && (!createdDate || createdDate < this.dateFrom)) return false;
      if (this.dateTo && (!createdDate || createdDate > this.dateTo)) return false;
      if (!this.riskSummaryView && !containsText(row['Priority'], this.severity)) return false;
      if (!containsText(row['Assigned To'], this.assignedTo)) return false;
      const age = row.Age == null ? null : Number(row.Age);
      if (this.ageMinDays !== null && (age === null || age < this.ageMinDays)) return false;
      if (this.ageMaxDays !== null && (age === null || age > this.ageMaxDays)) return false;
      const itemState = String(row['State'] ?? '').trim().toLowerCase();
      if (state === 'resolved' && !['removed', 'done', 'delivered to prod', 'refinement'].includes(itemState)) return false;
      if (state === 'opened' && ['resolved', 'closed', 'removed', 'done', 'delivered to prod', 'refinement'].includes(itemState)) return false;
      if (state === 'awaitingimplementation' && itemState !== 'awaiting implementation') return false;
      return true;
    });
    this.total = this.rows.length;
  }

  async importFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    this.message = '';
    this.importing = true;
    try {
      const extension = file.name.split('.').pop()?.toLowerCase();
      let matrix: unknown[][];
      if (extension === 'csv') {
        matrix = parseCsv(await file.text());
      } else if (extension === 'xlsx') {
        const { readSheet } = await import('read-excel-file/browser');
        matrix = await readSheet(file);
      } else {
        throw new Error('Choose a .csv or .xlsx file to import.');
      }
      const columns = this.riskSummaryView ? RISK_SUMMARY_COLUMNS : METRIC_COLUMNS;
      const headers = (matrix[0] ?? []).map((value) => String(value));
      if (headers.length !== columns.length || headers.some((header, index) => header !== columns[index])) {
        const description = this.riskSummaryView ? 'risk summary export' : 'DevOps export';
        throw new Error(`Column names and order must match the ${description}: ${columns.join(', ')}.`);
      }

      const records = matrix.slice(1)
        .filter((cells) => cells.some((cell) => String(cell).trim() !== ''))
        .map((cells) => {
          if (extension === 'csv' && cells.length !== columns.length) {
            throw new Error(`Each CSV row must contain exactly ${columns.length} columns.`);
          }
          return Object.fromEntries(columns.map((column, index) => [
            column,
            this.riskSummaryView && (column === 'Created Date' || column === 'Due Date' || column === 'Closed Date')
              ? this.normalizeDateOnly(cells[index])
              : column === 'Created Date' || column === 'Closed Date'
              ? this.normalizeDateTime(cells[index])
              : this.normalizeCell(cells[index]),
          ])) as WorkbookRow;
        });
      if (records.length === 0) throw new Error(extension === 'csv' ? 'No data rows were found in the CSV file.' : 'No data rows were found in the first worksheet.');

      this.http.post<{ imported: number }>('/api/metrics/import', {
        dataset: this.riskSummaryView ? 'riskSummary' : 'cases',
        records,
      }).subscribe({
        next: (result) => {
          this.importing = false;
          this.messageKind = 'success';
          this.message = `${result.imported.toLocaleString()} rows imported or updated.`;
          this.databaseState = 'connected';
          this.changeDetector.markForCheck();
          this.loadMetrics();
        },
        error: (error: HttpErrorResponse) => {
          this.importing = false;
          this.setMessage(error.error?.error ?? 'Import failed. Check the file and database connection.');
        },
      });
    } catch (error) {
      this.importing = false;
      this.setMessage(error instanceof Error ? error.message : 'Could not read this file.');
    }
  }

  async exportFile(): Promise<void> {
    if (!this.rows.length) return;
    const writeExcelFile = (await import('write-excel-file/browser')).default;
    const columns = this.riskSummaryView ? RISK_SUMMARY_COLUMNS : METRIC_COLUMNS;
    const sheetData = [
      [...columns],
      ...this.rows.map((row) => columns.map((column) => {
        if (column !== 'Closed Date' && column !== 'Created Date') return row[column];
        const date = row[column];
        const time = row[column === 'Created Date' ? 'Created Time' : 'Closed Time'];
        return date && time ? `${date} ${time}` : date;
      })),
    ];
    const exportName = this.riskSummaryView ? 'risk-summary' : 'deployment-metrics';
    const sheetName = this.riskSummaryView ? 'Risk Summary' : 'Deployment Metrics';
    await writeExcelFile(sheetData, { sheet: sheetName }).toFile(`${exportName}-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  priorityClass(value: MetricValue): string {
    const priority = String(value ?? '').toLowerCase();
    if (priority.includes('critical') || priority === '1') return 'priority-critical';
    if (priority.includes('high') || priority === '2') return 'priority-high';
    if (priority.includes('medium') || priority === '3') return 'priority-medium';
    return 'priority-low';
  }

  ageClass(value: MetricValue): string {
    if (value === null || value === '') return 'priority-low';
    const age = Number(value);
    if (!Number.isFinite(age)) return 'priority-low';
    if (age <= 7) return 'priority-medium';
    if (age <= 30) return 'priority-high';
    return 'priority-critical';
  }

  displayAssignedTo(value: MetricValue): string {
    return String(value ?? '').replace(/<[^>]*>/g, '').trim() || '-';
  }

  private normalizeResourceName(value: string): string {
    return value.toLocaleLowerCase().replace(/[.]/g, '').replace(/\s+/g, ' ').trim();
  }

  tagBadges(value: MetricValue): { label: string; backgroundColor: string }[] {
    return String(value ?? '')
      .split(';')
      .map((tag) => tag.trim())
      .filter(Boolean)
      .map((label) => {
        const batch = label.match(/\bbatch[\s_-]*(\d+)/i);
        const hue = batch ? (Number(batch[1]) * 137) % 360 : null;
        return { label, backgroundColor: hue === null ? '#edf2ee' : `hsl(${hue}, 52%, 88%)` };
      });
  }

  formatDate(value: MetricValue): string {
    const date = String(value ?? '');
    const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return date || '-';
    const parsed = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    return new Intl.DateTimeFormat('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(parsed);
  }

  formatTime(value: MetricValue): string {
    const match = String(value ?? '').match(/^(\d{1,2}):(\d{2}):(\d{2})(?:\.\d+)?/);
    if (!match) return String(value ?? '-') || '-';
    const parsed = new Date(Date.UTC(1970, 0, 1, Number(match[1]), Number(match[2]), Number(match[3])));
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
      timeZone: 'UTC',
    }).format(parsed).toUpperCase();
  }

  devOpsWorkItemUrl(value: MetricValue): string | null {
    const id = String(value ?? '');
    if (!/^\d+$/.test(id)) return null;
    return `https://dev.azure.com/healthcode/Central%20Change%20Portfolio/_workitems/edit/${id}`;
  }

  salesforceCaseUrl(value: MetricValue): string | null {
    const id = String(value ?? '');
    if (!/^[a-zA-Z0-9]{15,18}$/.test(id)) return null;
    return `https://healthcodeltd.lightning.force.com/lightning/r/Case/${encodeURIComponent(id)}/view`;
  }

  private checkDatabase(): void {
    this.http.get<{ database: string }>('/api/health').subscribe({
      next: () => {
        this.databaseState = 'connected';
        this.changeDetector.markForCheck();
      },
      error: () => {
        this.databaseState = 'disconnected';
        this.changeDetector.markForCheck();
      },
    });
  }

  private normalizeCell(value: unknown): string | number | null {
    if (value === undefined || value === null || String(value).trim() === '') return null;
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    return String(value).trim();
  }

  private normalizeDateTime(value: unknown): string | number | null {
    if (!(value instanceof Date)) return this.normalizeCell(value);
    const pad = (part: number) => String(part).padStart(2, '0');
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`;
  }

  private normalizeDateOnly(value: unknown): string | number | null {
    if (value instanceof Date) {
      const pad = (part: number) => String(part).padStart(2, '0');
      return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
    }
    const normalized = this.normalizeCell(value);
    if (typeof normalized !== 'string') return normalized;
    return normalized.match(/^(\d{4}-\d{2}-\d{2})/)?.[1] ?? normalized;
  }

  isClosed(value: MetricValue): boolean {
    return /closed|done|resolved|removed|delivered to prod|refinement/i.test(String(value ?? ''));
  }

  private setMessage(message: string): void {
    this.messageKind = 'error';
    this.message = message;
    this.changeDetector.markForCheck();
  }
}
