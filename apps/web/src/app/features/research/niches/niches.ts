import { COMMA, ENTER } from '@angular/cdk/keycodes';
import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import {
  AbstractControl,
  NonNullableFormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipInputEvent, MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { RouterLink } from '@angular/router';
import type { NicheDto, UpsertNicheRequest } from '@vsf/contracts';
import { NichesApiService } from '../../../core/api/niches-api.service';
import { AuthService } from '../../../core/auth/auth.service';
import { apiErrorMessage } from '../../../core/http/api-error';
import { NotificationService } from '../../../core/http/notification.service';

export const MAX_KEYWORD_LENGTH = 60;

/** Requires a non-empty array value. */
export function atLeastOneKeyword(control: AbstractControl<string[]>): ValidationErrors | null {
  return Array.isArray(control.value) && control.value.length > 0 ? null : { required: true };
}

/** Splits user input on commas, lower-cases, trims and drops blanks/over-long entries. */
export function normalizeKeywords(raw: string): string[] {
  return raw
    .split(',')
    .map((k) => k.trim().toLowerCase())
    .filter((k) => k.length > 0 && k.length <= MAX_KEYWORD_LENGTH);
}

type KeywordField = 'keywords' | 'excludeKeywords';

@Component({
  selector: 'app-niches',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    MatButtonModule,
    MatCardModule,
    MatChipsModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSlideToggleModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './niches.html',
  styleUrl: './niches.scss',
})
export class Niches implements OnInit {
  private readonly api = inject(NichesApiService);
  private readonly notifications = inject(NotificationService);

  protected readonly isOwner = inject(AuthService).isOwner;
  protected readonly niches = signal<NicheDto[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly editingId = signal<string | null>(null);
  protected readonly separatorKeys = [ENTER, COMMA] as const;

  protected readonly form = inject(NonNullableFormBuilder).group({
    name: ['', [Validators.required, Validators.maxLength(100)]],
    description: ['', [Validators.maxLength(500)]],
    keywords: [[] as string[], [atLeastOneKeyword]],
    excludeKeywords: [[] as string[]],
    active: [true],
  });

  ngOnInit(): void {
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.api.list().subscribe({
      next: (items) => {
        this.niches.set(items);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        this.error.set(apiErrorMessage(err, 'Could not load niches.'));
        this.loading.set(false);
      },
    });
  }

  protected addKeyword(field: KeywordField, event: MatChipInputEvent): void {
    const control = this.form.controls[field];
    const next = [...control.value];
    for (const k of normalizeKeywords(event.value ?? '')) {
      if (!next.includes(k)) {
        next.push(k);
      }
    }
    control.setValue(next);
    control.markAsTouched();
    event.chipInput.clear();
  }

  protected removeKeyword(field: KeywordField, keyword: string): void {
    const control = this.form.controls[field];
    control.setValue(control.value.filter((k) => k !== keyword));
    control.markAsTouched();
  }

  protected edit(niche: NicheDto): void {
    this.editingId.set(niche.id);
    this.form.reset({
      name: niche.name,
      description: niche.description,
      keywords: [...niche.keywords],
      excludeKeywords: [...niche.excludeKeywords],
      active: niche.active,
    });
  }

  protected cancelEdit(): void {
    this.editingId.set(null);
    this.form.reset();
  }

  protected save(): void {
    if (this.form.invalid || this.saving()) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    const body: UpsertNicheRequest = {
      name: v.name.trim(),
      description: v.description.trim(),
      keywords: v.keywords,
      excludeKeywords: v.excludeKeywords,
      active: v.active,
    };
    const id = this.editingId();
    const request = id ? this.api.update(id, body) : this.api.create(body);
    this.saving.set(true);
    request.subscribe({
      next: (niche) => {
        this.niches.update((list) =>
          id ? list.map((n) => (n.id === niche.id ? niche : n)) : [...list, niche],
        );
        this.saving.set(false);
        this.editingId.set(null);
        this.form.reset();
        this.notifications.success(`Niche "${niche.name}" ${id ? 'updated' : 'created'}.`);
      },
      error: () => this.saving.set(false),
    });
  }
}
