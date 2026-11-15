import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { StoryboardSceneDto } from '@vsf/contracts';
import { CodeBlock } from '../code-block';

/** Read-only storyboard: one card per scene. All text is interpolated (no HTML rendering). */
@Component({
  selector: 'app-storyboard',
  imports: [CodeBlock],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ol class="scenes" data-testid="storyboard">
      @for (s of scenes(); track s.index) {
        <li class="scene" [attr.data-scene]="s.index">
          <article [attr.aria-label]="'Scene ' + (s.index + 1)">
            <header class="scene-head">
              <h3>Scene {{ s.index + 1 }}</h3>
              <span class="chip">{{ s.durationSec }} s</span>
              <span class="chip">{{ s.transition }}</span>
            </header>
            <dl>
              <dt>Narration</dt>
              <dd class="narration">{{ s.narration }}</dd>
              <dt>On-screen text</dt>
              <dd>{{ s.onScreenText || '—' }}</dd>
              <dt>Visual concept</dt>
              <dd>{{ s.visualConcept || '—' }}</dd>
              <dt>Asset brief</dt>
              <dd>{{ s.assetBrief || '—' }}</dd>
            </dl>
            @if (s.code; as code) {
              <app-code-block [code]="code" />
            }
          </article>
        </li>
      }
    </ol>
  `,
  styles: `
    .scenes {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(min(100%, 320px), 1fr));
      gap: 12px;
    }
    .scene {
      padding: 12px 14px;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 12px;
      background: var(--mat-sys-surface-container-low);
      overflow-wrap: anywhere;
      min-width: 0;
    }
    .scene-head {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    h3 {
      margin: 0;
      flex: 1;
      font: var(--mat-sys-title-small);
    }
    dl {
      margin: 8px 0 0;
    }
    dt {
      font: var(--mat-sys-label-medium);
      color: var(--mat-sys-on-surface-variant);
      margin-top: 6px;
    }
    dd {
      margin: 0;
    }
    .narration {
      font: var(--mat-sys-body-large);
    }
  `,
})
export class Storyboard {
  readonly scenes = input.required<StoryboardSceneDto[]>();
}
