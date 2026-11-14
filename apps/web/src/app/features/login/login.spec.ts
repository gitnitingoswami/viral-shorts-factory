import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { AUTH_URLS } from '../../core/auth/auth.service';
import { makeTokenResponse } from '../../testing/fixtures';
import { Login } from './login';

describe('Login', () => {
  let fixture: ComponentFixture<Login>;
  let el: HTMLElement;
  let httpMock: HttpTestingController;
  let router: Router;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [Login],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    httpMock = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    fixture = TestBed.createComponent(Login);
    el = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
  });

  afterEach(() => httpMock.verify());

  async function type(selector: string, value: string): Promise<void> {
    const input = el.querySelector(selector) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('blur'));
    await fixture.whenStable();
  }

  async function submit(): Promise<void> {
    (el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await fixture.whenStable();
  }

  const submitButton = (): HTMLButtonElement => el.querySelector('button[type="submit"]') as HTMLButtonElement;

  it('has accessible labels for both fields', () => {
    const labels = Array.from(el.querySelectorAll('mat-label')).map((l) => l.textContent?.trim());
    expect(labels).toEqual(['Email', 'Password']);
    expect(el.querySelector('input[type="email"]')?.getAttribute('autocomplete')).toBe('username');
  });

  it('shows required errors and does not call the API when submitted empty', async () => {
    await submit();
    expect(el.textContent).toContain('Email is required.');
    expect(el.textContent).toContain('Password is required.');
    httpMock.expectNone(AUTH_URLS.login);
  });

  it('validates the email format', async () => {
    await type('#login-email', 'not-an-email');
    await type('#login-password', 'pw');
    await submit();
    expect(el.textContent).toContain('Enter a valid email address.');
    httpMock.expectNone(AUTH_URLS.login);
  });

  it('disables submit while pending and navigates to the safe returnUrl on success', async () => {
    fixture.componentRef.setInput('returnUrl', '/jobs');
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    await type('#login-email', 'owner@example.test');
    await type('#login-password', 'correct horse');
    await submit();

    expect(submitButton().disabled).toBe(true);
    expect(submitButton().textContent).toContain('Signing in');

    const req = httpMock.expectOne(AUTH_URLS.login);
    expect(req.request.body).toEqual({ email: 'owner@example.test', password: 'correct horse' });
    req.flush(makeTokenResponse());
    await fixture.whenStable();

    expect(submitButton().disabled).toBe(false);
    expect(navigate).toHaveBeenCalledWith('/jobs');
  });

  it('ignores external returnUrls', async () => {
    fixture.componentRef.setInput('returnUrl', '//evil.test');
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    await type('#login-email', 'owner@example.test');
    await type('#login-password', 'pw');
    await submit();
    httpMock.expectOne(AUTH_URLS.login).flush(makeTokenResponse());
    expect(navigate).toHaveBeenCalledWith('/dashboard');
  });

  it('shows the API error message on failure', async () => {
    await type('#login-email', 'owner@example.test');
    await type('#login-password', 'wrong');
    await submit();
    httpMock
      .expectOne(AUTH_URLS.login)
      .flush(
        { statusCode: 401, error: 'Unauthorized', message: 'Invalid email or password' },
        { status: 401, statusText: 'Unauthorized' },
      );
    await fixture.whenStable();

    const alert = el.querySelector('[data-testid="login-error"]');
    expect(alert?.textContent).toContain('Invalid email or password');
    expect(alert?.getAttribute('role')).toBe('alert');
    expect(submitButton().disabled).toBe(false);
  });
});
