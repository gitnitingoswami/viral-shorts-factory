import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';
import { LlmStatusService } from '../../core/api/llm-status.service';
import { MOCK_BANNER_TEXT } from './content-labels';

/** Visible notice when no real LLM provider is configured. Renders nothing otherwise. */
@Component({
  selector: 'app-mock-banner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (llm.isMock()) {
      <p class="mock-banner" role="status" data-testid="mock-banner">
        <strong>Mock mode:</strong> {{ text }}
        @if (llm.status(); as s) {
          <span class="model">(model: {{ s.model }})</span>
        }
      </p>
    }
  `,
  styles: `
    .mock-banner {
      margin: 0 0 16px;
      padding: 10px 14px;
      border-radius: 8px;
      border: 1px solid var(--app-status-warn);
      color: var(--app-status-warn);
      background: var(--mat-sys-surface-container);
      overflow-wrap: anywhere;
    }
    .model {
      margin-left: 4px;
    }
  `,
})
export class MockBanner implements OnInit {
  protected readonly llm = inject(LlmStatusService);
  protected readonly text = MOCK_BANNER_TEXT;

  ngOnInit(): void {
    this.llm.load();
  }
}
