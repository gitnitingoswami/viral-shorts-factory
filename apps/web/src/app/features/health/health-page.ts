import { ChangeDetectionStrategy, Component } from '@angular/core';
import { HealthStatus } from './health-status';

@Component({
  selector: 'app-health-page',
  imports: [HealthStatus],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<app-health-status />`,
})
export class HealthPage {}
