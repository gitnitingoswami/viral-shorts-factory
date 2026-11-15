import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { makeAsset } from '../../../testing/fixtures';
import { AssetLibrary } from './asset-library';

const LIST = '/api/video/assets';
const signed = (id: string) => ({ url: `/api/video/media/${id}?exp=1&sig=s`, expiresAt: '2026-11-15T03:00:00.000Z' });

describe('AssetLibrary', () => {
  let fixture: ComponentFixture<AssetLibrary>;
  let httpMock: HttpTestingController;
  let el: HTMLElement;
  const q = <T extends Element = HTMLElement>(sel: string): T | null => el.querySelector<T>(sel);

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [AssetLibrary],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    httpMock = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(AssetLibrary);
    el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    const req = httpMock.expectOne((r) => r.url === LIST);
    expect(req.request.params.toString()).toBe('limit=25&offset=0');
    req.flush({
      items: [
        makeAsset(),
        makeAsset({ id: 'a-audio', kind: 'audio', mime: 'audio/wav', licenseUrl: 'javascript:alert(1)', license: 'Custom' }),
      ],
      total: 2,
      limit: 25,
      offset: 0,
    });
    // Image thumbnails are requested with the page; audio is not.
    httpMock.expectOne('/api/video/assets/a-img/url').flush(signed('a-img'));
    httpMock.expectNone('/api/video/assets/a-audio/url');
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
    httpMock.verify();
  });

  it('shows rights metadata and image thumbnails; unsafe license URLs are not linked', () => {
    const img = q('[data-asset="a-img"]') as HTMLElement;
    expect(img.querySelector('img')?.getAttribute('src')).toBe('/api/video/media/a-img?exp=1&sig=s');
    expect(img.querySelector('img')?.getAttribute('alt')).toContain('Image');
    expect(img.textContent).toContain('CC0-1.0');
    expect(img.textContent).toContain('Original work; unrestricted use');
    expect(img.querySelector('[data-testid="license-link"]')?.getAttribute('rel')).toBe('noopener noreferrer');
    const audio = q('[data-asset="a-audio"]') as HTMLElement;
    expect(audio.textContent).toContain('Custom');
    expect(audio.querySelector('a')).toBeNull();
  });

  it('fetches audio previews on demand', () => {
    expect(q('[data-testid="asset-audio"]')).toBeNull();
    (q('[data-asset="a-audio"] [data-testid="audio-preview"]') as HTMLButtonElement).click();
    httpMock.expectOne('/api/video/assets/a-audio/url').flush(signed('a-audio'));
    fixture.detectChanges();
    const audio = q<HTMLAudioElement>('[data-testid="asset-audio"]') as HTMLAudioElement;
    expect(audio.getAttribute('src')).toBe('/api/video/media/a-audio?exp=1&sig=s');
    expect(audio.hasAttribute('controls')).toBe(true);
  });

  it('filters by kind', () => {
    const select = q('[data-testid="asset-kind"]') as HTMLSelectElement;
    select.value = 'music';
    select.dispatchEvent(new Event('change'));
    const req = httpMock.expectOne((r) => r.url === LIST);
    expect(req.request.params.toString()).toBe('kind=music&limit=25&offset=0');
    req.flush({ items: [], total: 0, limit: 25, offset: 0 });
    fixture.detectChanges();
    expect(q('[data-testid="assets-empty"]')).not.toBeNull();
  });
});
