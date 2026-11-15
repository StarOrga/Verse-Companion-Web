import { Injectable, Injector, effect, inject } from '@angular/core';
import { AuthService } from '../../auth/auth.service';
import { RoleService } from '../../auth/role.service';
import { AnalyticsService } from '../analytics.service';
import { ConsentService } from '../consent.service';

/**
 * Fixed, public salt: it only makes the hash specific to this product, so the
 * pseudonymous id cannot be matched against account ids of another system. It is
 * not a secret — the account id itself never leaves the browser.
 */
export const IDENTITY_SALT = 'verse-companion/analytics/v1';

/** `sha256(userId + salt)` as lowercase hex — the PostHog distinct id of a signed-in user. */
export async function hashUserId(userId: string, salt: string = IDENTITY_SALT): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  const bytes = new TextEncoder().encode(userId + salt);
  const digest = await subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Identifies a signed-in user for analytics — only with statistics consent, by a
 * salted hash of the account id and the account's real role (viewer /
 * collaborator / admin) as the one person property. Never e-mail, never name.
 * Sign-out and a consent revoke return the visitor to anonymous (`reset()`).
 *
 * Uses the REAL role (`realRole`), not the "view as" preview: a preview must not
 * change who the person is in the statistics.
 */
@Injectable({ providedIn: 'root' })
export class AnalyticsIdentityService {
  private readonly auth = inject(AuthService);
  private readonly roles = inject(RoleService);
  private readonly analytics = inject(AnalyticsService);
  private readonly consent = inject(ConsentService);
  private readonly injector = inject(Injector);
  private started = false;
  /** Guards against an older, slower hash overwriting a newer sign-in/out. */
  private generation = 0;

  /** Called once from AppComponent. */
  init(): void {
    if (this.started) return;
    this.started = true;
    effect(() => {
      const userId = this.auth.realUser()?.id ?? null;
      const role = this.roles.realRole();
      const allowed = this.consent.statisticsAllowed();
      const gen = ++this.generation;
      if (!allowed || !userId || !role) {
        // Role still loading for a signed-in user: wait, do not reset a fresh identity.
        if (userId && allowed && !role) return;
        this.analytics.resetIdentity();
        return;
      }
      void hashUserId(userId).then((hash) => {
        if (hash && gen === this.generation) this.analytics.identify(hash, role);
      });
    }, { injector: this.injector });
  }
}
