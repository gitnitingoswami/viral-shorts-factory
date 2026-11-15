import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ResearchReport } from './report';

describe('ResearchReport', () => {
  let fixture: ComponentFixture<ResearchReport>;
  let httpMock: HttpTestingController;
  let el: HTMLElement;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [ResearchReport],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    httpMock = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(ResearchReport);
    fixture.componentRef.setInput('id', 'c1');
    el = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
  });

  afterEach(() => httpMock.verify());

  it('renders limitations and markdown as text', async () => {
    httpMock.expectOne('/api/research/collections/c1/report').flush({
      collectionId: 'c1',
      generatedAt: '2026-11-15T00:00:00.000Z',
      markdown: '# Top topics\n\n<script>alert(1)</script>',
      limitations: ['YouTube not configured'],
    });
    await fixture.whenStable();
    expect(el.querySelector('[data-testid="report-limitations"]')?.textContent).toContain('YouTube not configured');
    expect(el.querySelector('[data-testid="report-body"] script')).toBeNull();
    expect(el.querySelector('[data-testid="report-body"]')?.textContent).toContain('<script>alert(1)</script>');
  });

  it('shows a not-ready state on 404', async () => {
    httpMock
      .expectOne('/api/research/collections/c1/report')
      .flush({ statusCode: 404, error: 'Not Found', message: 'x' }, { status: 404, statusText: 'Not Found' });
    await fixture.whenStable();
    expect(el.querySelector('[data-testid="report-not-ready"]')).not.toBeNull();
  });
});
