import { Component, Input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { App } from '../../app';

@Component({
  imports: [FormsModule],
  selector: 'app-monitoring',
  templateUrl: './monitoring.component.html',
})
export class MonitoringComponent {
  @Input({ required: true }) vm!: App;
}
