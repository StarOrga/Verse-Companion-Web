import { Injectable, Injector, effect, inject, untracked } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { AuthService } from '../../auth/auth.service';
import { RoleService } from '../../auth/role.service';
import { hqPageOfFragment } from '../../hq/hq-routes';
import { AnalyticsService } from '../analytics.service';

/** A catalogue event derived from a router URL: name + properties, or null when the page carries no domain meaning. */
export interface PageEvent {
  run: (a: AnalyticsService) => void;
  key: string;
}

/** Codex single-segment sections under `/codex/<section>`. */
const CODEX_SECTIONS = ['fps', 'keybinds', 'upcoming'] as const;

/**
 * Maps a router URL (path + fragment, never the query) to the one catalogue
 * event the page means, or null. Pure, so the table is testable and the
 * "which page is which event" knowledge lives in one place instead of a
 * `track()` in every component. Only ids of public game data and fixed enums
 * go into properties — never a share/invite token.
 */
export function pageEventOf(url: string): PageEvent | null {
  const [pathAndQuery, fragment] = url.split('#');
  const path = pathAndQuery.split('?')[0];
  const segs = path.split('/').filter(Boolean).map((s) => safeDecode(s));
  const [a, b, c] = segs;
  const ev = (key: string, run: PageEvent['run']): PageEvent => ({ key, run });

  switch (a) {
    case 'login':
      return ev('login', (x) => x.track('auth:login_view'));
    case 'codex': {
      if (segs.length === 3 && b !== 'upcoming') {
        return ev(`codex/${b}/${c}`, (x) => x.track('codex:entry_view', { kind: b, class_name: c }));
      }
      if (segs.length === 3 && b === 'upcoming') return ev('codex/upcoming/entry', (x) => x.track('codex:section_view', { section: 'upcoming_entry' }));
      if (segs.length === 2 && (CODEX_SECTIONS as readonly string[]).includes(b)) {
        const section = b as (typeof CODEX_SECTIONS)[number];
        return ev(`codex/${section}`, (x) => x.track('codex:section_view', { section }));
      }
      return null;
    }
    case 'hq': {
      const page = b ?? hqPageOfFragment(fragment ?? null) ?? 'start';
      return ev(`hq/${page}`, (x) => x.track('hq:page_view', { page }));
    }
    case 'verse':
      if (segs.length === 1) return ev('verse', (x) => x.track('verse:briefing_view'));
      if (b === 'explorer') return ev('verse/explorer', (x) => x.track('verse:starmap_open', { page: 'explorer' }));
      if (b === 'gallery' && c === 'constellations') return ev('verse/constellations', (x) => x.track('verse:starmap_open', { page: 'constellations' }));
      if (b === 'patches' && c) return ev(`verse/patch/${c}`, (x) => x.track('verse:patch_open', { line: c }));
      if (b === 'news' && c) return ev('verse/news/article', (x) => x.track('news:article_open'));
      return null;
    case 'apps':
      if (segs.length === 1) return ev('apps', (x) => x.track('desktop:apps_view', { app: 'hub' }));
      if (b === 'uploader' && !c) return ev('apps/uploader', (x) => x.track('desktop:apps_view', { app: 'uploader' }));
      if (b === 'starscape' && !c) return ev('apps/starscape', (x) => x.track('desktop:apps_view', { app: 'starscape' }));
      if (b === 'extension') return ev('apps/extension', (x) => x.track('desktop:apps_view', { app: 'extension' }));
      return null;
    case 'admin': {
      const tool = b ?? 'console';
      return ev(`admin/${tool}`, (x) => x.track('admin:tool_open', { tool }));
    }
    case 'invite':
      return ev('invite', (x) => x.track('social:invite_view'));
    case 'shared':
      return b === 'loadout' ? ev('shared/loadout', (x) => x.track('social:shared_open', { kind: 'loadout' })) : null;
    case 'hangar':
      return b === 'shared' ? ev('hangar/shared', (x) => x.track('social:shared_open', { kind: 'hangar_loadout' })) : null;
    case 'badge':
      return b === 'kartograph' ? ev('badge/kartograph', (x) => x.track('social:shared_open', { kind: 'kartograph_badge' })) : null;
    default:
      return null;
  }
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * The one central hook for "this page was opened" events: a router listener
 * turns the URL into a catalogue event (see {@link pageEventOf}), so no
 * component needs its own call. Also reports the start of a signed-in session
 * once per page load. Started from the root component.
 */
@Injectable({ providedIn: 'root' })
export class PageEventsService {
  private readonly router = inject(Router);
  private readonly analytics = inject(AnalyticsService);
  private readonly auth = inject(AuthService);
  private readonly roles = inject(RoleService);
  private readonly injector = inject(Injector);
  private started = false;
  private lastKey: string | null = null;
  private sessionReported = false;

  start(): void {
    if (this.started) return;
    this.started = true;
    this.fire(this.router.url);
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => this.fire(e.urlAfterRedirects));
    effect(() => {
      const user = this.auth.realUser();
      const role = this.roles.realRole();
      if (!user || !role || this.sessionReported) return;
      this.sessionReported = true;
      untracked(() => this.analytics.track('auth:session_start', { role }));
    }, { injector: this.injector });
  }

  private fire(url: string): void {
    const ev = pageEventOf(url);
    // A query-only change on the same page is not a new view.
    if (!ev || ev.key === this.lastKey) {
      if (!ev) this.lastKey = null;
      return;
    }
    this.lastKey = ev.key;
    ev.run(this.analytics);
  }
}
