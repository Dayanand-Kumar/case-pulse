import { NgClass } from '@angular/common';
import { Component, Input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { App } from '../../app';

@Component({
  imports: [FormsModule, NgClass],
  selector: 'app-categories',
  templateUrl: './categories.component.html',
})
export class CategoriesComponent {
  @Input({ required: true }) vm!: App;
}
