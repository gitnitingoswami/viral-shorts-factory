import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { RouterOutlet } from '@angular/router';
import { LoadingService } from './core/http/loading.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, MatProgressBarModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="global-progress" [attr.aria-busy]="loading.isLoading()">
      @if (loading.isLoading()) {
        <mat-progress-bar mode="indeterminate" aria-label="Loading" />
      }
    </div>
    <router-outlet />
  `,
  styleUrl: './app.scss',
})
export class App {
  protected readonly loading = inject(LoadingService);
}
