import { Injectable, computed, inject, signal } from '@angular/core';
import type { LlmStatusDto } from '@vsf/contracts';
import { Subscription } from 'rxjs';
import { ContentApiService } from './content-api.service';

/**
 * Cached LLM provider status. Loaded once per session on demand; failures are silent
 * (no banner) and retried on the next {@link LlmStatusService.load} call.
 */
@Injectable({ providedIn: 'root' })
export class LlmStatusService {
  private readonly api = inject(ContentApiService);
  private request: Subscription | null = null;
  private readonly state = signal<LlmStatusDto | null>(null);

  readonly status = this.state.asReadonly();
  readonly isMock = computed(() => this.state()?.provider === 'mock');

  load(): void {
    if (this.state() !== null || (this.request && !this.request.closed)) {
      return;
    }
    this.request = this.api.llmStatus().subscribe({
      next: (s) => this.state.set(s),
      error: () => undefined,
    });
  }
}
