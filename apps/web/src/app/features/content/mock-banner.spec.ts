import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { makeLlmStatus } from '../../testing/fixtures';
import { MOCK_BANNER_TEXT } from './content-labels';
import { MockBanner } from './mock-banner';

describe('MockBanner', () => {
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [MockBanner],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  function render(provider: 'mock' | 'claude'): HTMLElement {
    const fixture = TestBed.createComponent(MockBanner);
    fixture.detectChanges();
    httpMock.expectOne('/api/content/llm-status').flush(makeLlmStatus(provider));
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('shows a status banner when the provider is mock', () => {
    const banner = render('mock').querySelector('[data-testid="mock-banner"]');
    expect(banner?.getAttribute('role')).toBe('status');
    expect(banner?.textContent).toContain(MOCK_BANNER_TEXT);
  });

  it('renders nothing when a real provider is configured', () => {
    expect(render('claude').querySelector('[data-testid="mock-banner"]')).toBeNull();
  });
});
