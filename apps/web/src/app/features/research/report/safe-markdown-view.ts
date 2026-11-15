import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { type MdInline, parseMarkdown } from './safe-markdown';

/**
 * Renders Markdown through {@link parseMarkdown} into Angular template nodes. No HTML from the
 * source is ever interpreted; headings are shifted down one level beneath the page's h1.
 */
@Component({
  selector: 'app-safe-markdown',
  imports: [NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-template #inline let-inlines>
      @for (part of asInlines(inlines); track $index) {
        @switch (part.kind) {
          @case ('link') {
            <a [href]="hrefOf(part)" target="_blank" rel="noopener noreferrer">{{ part.text }}</a>
          }
          @case ('code') {
            <code>{{ part.text }}</code>
          }
          @case ('strong') {
            <strong>{{ part.text }}</strong>
          }
          @default {
            {{ part.text }}
          }
        }
      }
    </ng-template>

    @for (block of blocks(); track $index) {
      @switch (block.kind) {
        @case ('heading') {
          @switch (headingLevel(block)) {
            @case (2) {
              <h2><ng-container *ngTemplateOutlet="inline; context: { $implicit: inlinesOf(block) }" /></h2>
            }
            @case (3) {
              <h3><ng-container *ngTemplateOutlet="inline; context: { $implicit: inlinesOf(block) }" /></h3>
            }
            @case (4) {
              <h4><ng-container *ngTemplateOutlet="inline; context: { $implicit: inlinesOf(block) }" /></h4>
            }
            @case (5) {
              <h5><ng-container *ngTemplateOutlet="inline; context: { $implicit: inlinesOf(block) }" /></h5>
            }
            @default {
              <h6><ng-container *ngTemplateOutlet="inline; context: { $implicit: inlinesOf(block) }" /></h6>
            }
          }
        }
        @case ('paragraph') {
          <p><ng-container *ngTemplateOutlet="inline; context: { $implicit: inlinesOf(block) }" /></p>
        }
        @case ('quote') {
          <blockquote>
            <ng-container *ngTemplateOutlet="inline; context: { $implicit: inlinesOf(block) }" />
          </blockquote>
        }
        @case ('pre') {
          <pre class="md-pre">{{ textOf(block) }}</pre>
        }
        @case ('rule') {
          <hr />
        }
        @case ('list') {
          @if (block.ordered) {
            <ol>
              @for (item of block.items; track $index) {
                <li><ng-container *ngTemplateOutlet="inline; context: { $implicit: item }" /></li>
              }
            </ol>
          } @else {
            <ul>
              @for (item of block.items; track $index) {
                <li><ng-container *ngTemplateOutlet="inline; context: { $implicit: item }" /></li>
              }
            </ul>
          }
        }
      }
    }
  `,
  styles: `
    :host {
      display: block;
      overflow-wrap: anywhere;
    }
    .md-pre {
      white-space: pre-wrap;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      background: var(--mat-sys-surface-container);
      padding: 12px;
      border-radius: 8px;
      overflow-x: auto;
    }
    blockquote {
      margin: 8px 0;
      padding-left: 12px;
      border-left: 4px solid var(--mat-sys-outline-variant);
    }
  `,
})
export class SafeMarkdownView {
  readonly markdown = input.required<string>();
  protected readonly blocks = computed(() => parseMarkdown(this.markdown()));

  protected asInlines(value: unknown): MdInline[] {
    return value as MdInline[];
  }

  protected hrefOf(part: MdInline): string | null {
    return part.kind === 'link' ? part.href : null;
  }

  protected headingLevel(block: { level?: number }): number {
    return Math.min(6, (block.level ?? 1) + 1);
  }

  protected inlinesOf(block: { inlines?: MdInline[] }): MdInline[] {
    return block.inlines ?? [];
  }

  protected textOf(block: { text?: string }): string {
    return block.text ?? '';
  }
}
