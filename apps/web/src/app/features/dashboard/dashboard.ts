import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { HealthStatus } from '../health/health-status';

@Component({
  selector: 'app-dashboard',
  imports: [MatCardModule, RouterLink, HealthStatus],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 class="page-title">Dashboard</h1>
    <div class="grid">
      <mat-card appearance="outlined">
        <mat-card-content>
          <h2 class="card-title">Signed in as</h2>
          @if (user(); as u) {
            <p class="user" data-testid="dashboard-user">{{ u.email }}</p>
            <p>Role: <strong class="role">{{ u.role }}</strong></p>
          }
        </mat-card-content>
      </mat-card>
      <mat-card appearance="outlined">
        <mat-card-content>
          <app-health-status [compact]="true" />
          <a routerLink="/health">View health details</a>
        </mat-card-content>
      </mat-card>
    </div>
  `,
  styles: `
    .grid {
      display: grid;
      gap: 16px;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    }
    .card-title {
      margin: 0 0 8px;
      font: var(--mat-sys-title-medium);
    }
    .user {
      font: var(--mat-sys-body-large);
      word-break: break-all;
    }
    .role {
      text-transform: capitalize;
    }
  `,
})
export class Dashboard {
  protected readonly user = inject(AuthService).currentUser;
}
