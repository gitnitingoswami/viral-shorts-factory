import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { makeTopicDetail, signInAs } from '../../../testing/fixtures';
import { TopicDetail } from './topic-detail';

describe('TopicDetail', () => {
  let fixture: ComponentFixture<TopicDetail>;
  let httpMock: HttpTestingController;
  let el: HTMLElement;

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
  }

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [TopicDetail],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    httpMock = TestBed.inject(HttpTestingController);
    signInAs('reviewer');
    fixture = TestBed.createComponent(TopicDetail);
    fixture.componentRef.setInput('id', 't1');
    el = fixture.nativeElement as HTMLElement;
    await settle();
  });

  afterEach(() => httpMock.verify());

  it('renders evidence links safely, provenance and missing components', async () => {
    httpMock.expectOne('/api/research/topics/t1').flush(
      makeTopicDetail({
        signals: [
          ...makeTopicDetail().signals,
          {
            id: 's2',
            source: 'rss',
            title: 'Evil',
            url: 'javascript:alert(1)',
            publishedAt: null,
            retrievedAt: '2026-11-15T00:00:00.000Z',
            metrics: {},
          },
        ],
      }),
    );
    await settle();
    const links = el.querySelectorAll('[data-testid="evidence"] a');
    expect(links.length).toBe(1);
    expect(links[0].getAttribute('href')).toBe('https://news.ycombinator.com/item?id=1');
    expect(links[0].getAttribute('rel')).toBe('noopener noreferrer');
    expect(links[0].getAttribute('target')).toBe('_blank');
    expect(el.querySelector('[data-testid="evidence"]')?.textContent).toContain('Evil');
    expect(el.querySelector('[data-testid="evidence"]')?.textContent).toContain('points');
    expect(el.querySelector('[data-testid="metrics"]')?.textContent).toContain('Hacker News');
    expect(el.querySelector('[data-testid="missing-components"]')?.textContent).toContain('Competition');
  });

  it('rolls back an optimistic decision on error', async () => {
    httpMock.expectOne('/api/research/topics/t1').flush(makeTopicDetail());
    await settle();
    (el.querySelector('[data-testid="approve"]') as HTMLButtonElement).click();
    await settle();
    expect(el.querySelector('[data-testid="topic-status"]')?.textContent?.trim()).toBe('approved');
    httpMock
      .expectOne('/api/research/topics/t1/decision')
      .flush({ statusCode: 500, error: 'x', message: 'boom' }, { status: 500, statusText: 'Error' });
    await settle();
    expect(el.querySelector('[data-testid="topic-status"]')?.textContent?.trim()).toBe('new');
  });
});
