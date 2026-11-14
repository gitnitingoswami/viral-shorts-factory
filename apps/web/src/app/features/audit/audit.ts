import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTableModule } from '@angular/material/table';
import type { AuditEventDto, Page } from '@vsf/contracts';
import { Subscription } from 'rxjs';
import { AuditApiService } from '../../core/api/audit-api.service';
import { apiErrorMessage } from '../../core/http/api-error';

@Component({
  selector: 'app-audit',
  imports: [DatePipe, MatButtonModule, MatTableModule, MatPaginatorModule, MatProgressSpinnerModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './audit.html',
})
export class Audit implements OnInit {
  private readonly api = inject(AuditApiService);
  private request: Subscription | null = null;

  protected readonly pageSizeOptions = [10, 25, 50, 100];
  protected readonly pageSize = signal(25);
  protected readonly pageIndex = signal(0);
  protected readonly page = signal<Page<AuditEventDto> | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly columns = ['occurredAt', 'actor', 'action', 'subject', 'outcome', 'correlationId'];

  ngOnInit(): void {
    this.load();
  }

  protected onPage(event: PageEvent): void {
    this.pageSize.set(event.pageSize);
    this.pageIndex.set(event.pageIndex);
    this.load();
  }

  protected load(): void {
    this.request?.unsubscribe();
    this.loading.set(true);
    this.error.set(null);
    const limit = this.pageSize();
    this.request = this.api.list(limit, this.pageIndex() * limit).subscribe({
      next: (page) => {
        this.page.set(page);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        this.error.set(apiErrorMessage(err, 'Could not load audit events.'));
        this.loading.set(false);
      },
    });
  }
}
