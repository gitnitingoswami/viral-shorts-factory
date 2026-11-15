import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { SceneCode } from '@vsf/contracts';

/**
 * Monospace code with highlighted lines. Source is rendered via interpolation only, so markup in
 * the code (e.g. `<script>`) stays literal text; highlighting is pure CSS.
 */
@Component({
  selector: 'app-code-block',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <figure class="code" [attr.aria-label]="'Code sample (' + code().language + ')'">
      <figcaption class="lang">{{ code().language }}</figcaption>
      <pre data-testid="code-block"><code>@for (line of lines(); track $index) {<span class="line" [class.hl]="line.highlighted" [attr.data-highlighted]="line.highlighted || null"><span class="ln" aria-hidden="true">{{ $index + 1 }}</span>{{ line.text }}
</span>}</code></pre>
      @if (highlightedText(); as h) {
        <p class="visually-hidden">Highlighted lines: {{ h }}</p>
      }
    </figure>
  `,
  styles: `
    .code {
      margin: 8px 0;
    }
    .lang {
      font: var(--mat-sys-label-small);
      text-transform: uppercase;
      color: var(--mat-sys-on-surface-variant);
    }
    pre {
      margin: 4px 0 0;
      padding: 8px 0;
      overflow-x: auto;
      border-radius: 6px;
      background: var(--mat-sys-surface-container-highest);
      font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }
    .line {
      display: block;
      padding: 0 12px 0 0;
      white-space: pre;
    }
    .line.hl {
      background: var(--mat-sys-tertiary-container);
      color: var(--mat-sys-on-tertiary-container);
      box-shadow: inset 3px 0 0 var(--mat-sys-tertiary);
    }
    .ln {
      display: inline-block;
      width: 2.5em;
      padding-right: 8px;
      text-align: right;
      color: var(--mat-sys-on-surface-variant);
      user-select: none;
    }
  `,
})
export class CodeBlock {
  readonly code = input.required<SceneCode>();

  protected readonly lines = computed(() => {
    const { source, highlightLines } = this.code();
    const hl = new Set(highlightLines);
    return source
      .replace(/\n$/, '')
      .split('\n')
      .map((text, i) => ({ text, highlighted: hl.has(i + 1) }));
  });
  protected readonly highlightedText = computed(() => this.code().highlightLines.join(', '));
}
