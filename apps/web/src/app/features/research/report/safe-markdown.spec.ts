import { TestBed } from '@angular/core/testing';
import { parseInline, parseMarkdown, safeHref } from './safe-markdown';
import { SafeMarkdownView } from './safe-markdown-view';

describe('safe markdown', () => {
  describe('safeHref', () => {
    it('accepts only absolute http/https URLs', () => {
      expect(safeHref('https://example.test/a?b=1')).toBe('https://example.test/a?b=1');
      expect(safeHref('http://example.test')).toBe('http://example.test/');
      expect(safeHref('javascript:alert(1)')).toBeNull();
      expect(safeHref('JaVaScRiPt:alert(1)')).toBeNull();
      expect(safeHref('data:text/html,<script>alert(1)</script>')).toBeNull();
      expect(safeHref('//evil.test')).toBeNull();
      expect(safeHref('/relative')).toBeNull();
    });
  });

  describe('parser', () => {
    it('parses headings, lists, links and code', () => {
      const blocks = parseMarkdown('# Title\n\nIntro **bold** `x`\n\n- [HN](https://news.ycombinator.com) item\n- two\n\n1. first\n\n---');
      expect(blocks.map((b) => b.kind)).toEqual(['heading', 'paragraph', 'list', 'list', 'rule']);
      expect(blocks[2]).toMatchObject({
        kind: 'list',
        ordered: false,
        items: [[{ kind: 'link', text: 'HN', href: 'https://news.ycombinator.com/' }, { kind: 'text', text: ' item' }], [{ kind: 'text', text: 'two' }]],
      });
      expect(blocks[3]).toMatchObject({ kind: 'list', ordered: true });
    });

    it('drops javascript: links to plain text', () => {
      expect(parseInline('[click](javascript:alert(1))')).toEqual([{ kind: 'text', text: 'click' }]);
    });

    it('keeps tables and fenced code as preformatted text', () => {
      const blocks = parseMarkdown('| a | b |\n|---|---|\n| 1 | 2 |\n\n```\n<b>x</b>\n```');
      expect(blocks).toEqual([
        { kind: 'pre', text: '| a | b |\n|---|---|\n| 1 | 2 |' },
        { kind: 'pre', text: '<b>x</b>' },
      ]);
    });
  });

  describe('SafeMarkdownView', () => {
    function render(markdown: string): HTMLElement {
      const fixture = TestBed.createComponent(SafeMarkdownView);
      fixture.componentRef.setInput('markdown', markdown);
      fixture.detectChanges();
      return fixture.nativeElement as HTMLElement;
    }

    it('never turns markdown HTML into elements', () => {
      const el = render(
        '# <img src=x onerror=alert(1)>\n\n<script>alert("x")</script>\n\n- <iframe src="https://evil.test"></iframe>\n\n> <b>q</b>',
      );
      expect(el.querySelector('script, img, iframe, b')).toBeNull();
      expect(el.textContent).toContain('<script>alert("x")</script>');
      expect(el.querySelector('h2')?.textContent).toContain('<img src=x onerror=alert(1)>');
    });

    it('renders safe links with noopener and rejects javascript: links', () => {
      const el = render('See [docs](https://example.test/docs) and [bad](javascript:alert(1)).');
      const links = el.querySelectorAll('a');
      expect(links.length).toBe(1);
      expect(links[0].getAttribute('href')).toBe('https://example.test/docs');
      expect(links[0].getAttribute('rel')).toBe('noopener noreferrer');
      expect(links[0].getAttribute('target')).toBe('_blank');
      expect(el.textContent).toContain('bad');
    });

    it('shifts headings below the page h1', () => {
      const el = render('# One\n## Two');
      expect(el.querySelector('h1')).toBeNull();
      expect(el.querySelector('h2')?.textContent?.trim()).toBe('One');
      expect(el.querySelector('h3')?.textContent?.trim()).toBe('Two');
    });
  });
});
