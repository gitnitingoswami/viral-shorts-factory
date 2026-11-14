import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import type { ChannelDto } from '@vsf/contracts';
import { ChannelsApiService } from '../../core/api/channels-api.service';
import { AuthService } from '../../core/auth/auth.service';
import { apiErrorMessage } from '../../core/http/api-error';
import { NotificationService } from '../../core/http/notification.service';

@Component({
  selector: 'app-channels',
  imports: [
    DatePipe,
    ReactiveFormsModule,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressSpinnerModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './channels.html',
  styleUrl: './channels.scss',
})
export class Channels implements OnInit {
  private readonly api = inject(ChannelsApiService);
  private readonly notifications = inject(NotificationService);

  protected readonly isOwner = inject(AuthService).isOwner;
  protected readonly channels = signal<ChannelDto[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly saving = signal(false);

  protected readonly form = inject(NonNullableFormBuilder).group({
    handle: [
      '',
      [Validators.required, Validators.maxLength(100), Validators.pattern(/^@?[A-Za-z0-9._-]{3,100}$/)],
    ],
    title: ['', [Validators.required, Validators.maxLength(100)]],
  });

  ngOnInit(): void {
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.api.list().subscribe({
      next: (items) => {
        this.channels.set(items);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        this.error.set(apiErrorMessage(err, 'Could not load channels.'));
        this.loading.set(false);
      },
    });
  }

  protected create(): void {
    if (this.form.invalid || this.saving()) {
      this.form.markAllAsTouched();
      return;
    }
    const { handle, title } = this.form.getRawValue();
    this.saving.set(true);
    this.api.create({ platform: 'youtube', handle: handle.trim(), title: title.trim() }).subscribe({
      next: (channel) => {
        this.channels.update((list) => [...list, channel]);
        this.form.reset();
        this.saving.set(false);
        this.notifications.success(`Channel "${channel.title}" created.`);
      },
      error: () => this.saving.set(false),
    });
  }
}
