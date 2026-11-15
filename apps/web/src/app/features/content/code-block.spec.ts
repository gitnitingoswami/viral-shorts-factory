import { TestBed } from '@angular/core/testing';
import { CodeBlock } from './code-block';

describe('CodeBlock', () => {
  it('renders source as text and highlights lines with CSS only', () => {
    const fixture = TestBed.createComponent(CodeBlock);
    fixture.componentRef.setInput('code', {
      language: 'javascript',
      source: '<script>alert(1)</script>\nconst a = 1;\n<img src=x onerror=alert(2)>',
      highlightLines: [2],
    });
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const pre = el.querySelector('[data-testid="code-block"]') as HTMLElement;
    expect(pre.querySelector('script')).toBeNull();
    expect(pre.querySelector('img')).toBeNull();
    expect(pre.textContent).toContain('<script>alert(1)</script>');
    expect(pre.textContent).toContain('<img src=x onerror=alert(2)>');
    const lines = pre.querySelectorAll('.line');
    expect(lines.length).toBe(3);
    expect(lines[1].classList.contains('hl')).toBe(true);
    expect(lines[0].classList.contains('hl')).toBe(false);
    expect(el.textContent).toContain('Highlighted lines: 2');
  });
});
