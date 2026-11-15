import { TestBed } from '@angular/core/testing';
import { makeTopic } from '../../testing/fixtures';
import { ScoreBreakdown } from './score-breakdown';

describe('ScoreBreakdown', () => {
  it('renders "missing" for null components and calls them out', () => {
    const fixture = TestBed.createComponent(ScoreBreakdown);
    fixture.componentRef.setInput(
      'topic',
      makeTopic({ missingComponents: ['competition', 'demand'] }),
    );
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const value = (c: string): string | undefined =>
      el.querySelector(`tr[data-component="${c}"] [data-testid="component-value"]`)?.textContent?.trim();

    expect(value('freshness')).toBe('0.90');
    expect(value('competition')).toBe('missing');
    expect(el.querySelector('tr[data-component="competition"]')?.textContent).toContain('YouTube not configured');
    const callout = el.querySelector('[data-testid="missing-components"]')?.textContent;
    expect(callout).toContain('Competition');
    expect(callout).toContain('Demand');
    expect(el.textContent).toContain('80%');
  });

  it('has no callout when all data is present', () => {
    const fixture = TestBed.createComponent(ScoreBreakdown);
    fixture.componentRef.setInput(
      'topic',
      makeTopic({
        missingComponents: [],
        breakdown: [{ component: 'growth', weight: 1, value: 0.5, explanation: 'x' }],
      }),
    );
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="missing-components"]')).toBeNull();
  });
});
