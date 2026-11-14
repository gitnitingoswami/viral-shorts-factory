import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTableModule } from '@angular/material/table';
import type { JobDto, Page } from '@vsf/contracts';
import { JobsApiService } from '../../core/api/jobs-api.service';
import { AuthService } from '../../core/auth/auth.service';
import { apiErrorMessage } from '../../core/http/api-error';
import { NotificationService } from '../../core/http/notification.service';

@Component({
  selector: 'app-jobs',
  imports: [DatePipe, MatButtonModule, MatTableModule, MatProgressBarModule, MatProgressSpinnerModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './jobs.html',
  styleUrl: './jobs.scss',
})
export class Jobs implements OnInit {
  private readonly api = inject(JobsApiService);
  private readonly notifications = inject(NotificationService);

  protected readonly isOwner = inject(AuthService).isOwner;
  protected readonly page = signal<Page<JobDto> | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly enqueuing = signal(false);
  protected readonly columns = ['type', 'status', 'progress', 'attempt', 'createdAt', 'error'];

  ngOnInit(): void {
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.api.list().subscribe({
      next: (page) => {
        this.page.set(page);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        this.error.set(apiErrorMessage(err, 'Could not load jobs.'));
        this.loading.set(false);
      },
    });
  }

  protected enqueuePing(): void {
    if (this.enqueuing()) {
      return;
    }
    this.enqueuing.set(true);
    this.api.enqueuePing(crypto.randomUUID()).subscribe({
      next: () => {
        this.enqueuing.set(false);
        this.notifications.success('Ping job enqueued.');
        this.load();
      },
      error: () => this.enqueuing.set(false),
    });
  }
}
