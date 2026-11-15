import { BreakpointObserver, Breakpoints } from '@angular/cdk/layout';
import { ChangeDetectionStrategy, Component, computed, inject, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatListModule } from '@angular/material/list';
import { MatSidenav, MatSidenavModule } from '@angular/material/sidenav';
import { MatToolbarModule } from '@angular/material/toolbar';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { map } from 'rxjs';
import { AuthService } from '../auth/auth.service';

interface NavItem {
  path: string;
  label: string;
  ownerOnly?: boolean;
}

const NAV_ITEMS: readonly NavItem[] = [
  { path: '/dashboard', label: 'Dashboard' },
  { path: '/health', label: 'System health' },
  { path: '/channels', label: 'Channels' },
  { path: '/jobs', label: 'Jobs' },
  { path: '/research', label: 'Research' },
  { path: '/content', label: 'Content' },
  { path: '/video', label: 'Video' },
  { path: '/audit', label: 'Audit log', ownerOnly: true },
];

@Component({
  selector: 'app-shell',
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    MatToolbarModule,
    MatSidenavModule,
    MatListModule,
    MatButtonModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './shell.html',
  styleUrl: './shell.scss',
})
export class Shell {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly sidenav = viewChild.required(MatSidenav);

  protected readonly user = this.auth.currentUser;
  protected readonly isHandset = toSignal(
    inject(BreakpointObserver)
      .observe([Breakpoints.XSmall, Breakpoints.Small])
      .pipe(map((r) => r.matches)),
    { initialValue: false },
  );
  protected readonly navItems = computed(() =>
    NAV_ITEMS.filter((item) => !item.ownerOnly || this.auth.isOwner()),
  );

  protected onNavigate(): void {
    if (this.isHandset()) {
      void this.sidenav().close();
    }
  }

  protected logout(): void {
    this.auth.logout().subscribe(() => {
      void this.router.navigate(['/login']);
    });
  }
}
