import { Component, Input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { App } from '../../app';

@Component({
  imports: [FormsModule],
  selector: 'app-reports',
  templateUrl: './reports.component.html',
})
export class ReportsComponent {
  @Input({ required: true }) vm!: App;
}
