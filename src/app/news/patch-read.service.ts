import { Injectable, computed, inject, signal } from '@angular/core';
import { AccountPrefsService } from '../core/account-prefs.service';
import { AuthService } from '../auth/auth.service';
import {
  PATCH_READ_PREF_KEY, baselineCutoff, isRead, parseReadState, serializeReadState, withRead, withUnread,
  type PatchChannel, type ReadState,
} from './patch-read';

function readLocal(): string | null {
  try {
    return localStorage.getItem(PATCH_READ_PREF_KEY);
  } catch {
    return null;
  }
}

/**
 * Which patch notes this reader has confirmed ("Gelesen"). Same storage as
 * `ReleaseSeenService`: `ui_prefs.patchNotesRead` in the account, localStorage
 * while signed out; no migration. The pure rules live in `patch-read.ts`.
 */
@Injectable({ providedIn: 'root' })
export class PatchReadService {
  private readonly prefs = inject(AccountPrefsService);
  private readonly auth = inject(AuthService);
  private readonly local = signal<string | null>(readLocal());
  private readonly session = signal<ReadState | null>(null);

  /** Stored state; null while the account's prefs have not loaded yet. */
  readonly state = computed<ReadState | null>(() => {
    const s = this.session();
    if (s) return s;
    if (this.auth.user()) {
      const p = this.prefs.prefs();
      return p === null ? null : parseReadState(p[PATCH_READ_PREF_KEY]);
    }
    return parseReadState(this.local());
  });

  isRead(channel: PatchChannel, publishedMs: number): boolean {
    const st = this.state();
    return st === null ? true : isRead(st, channel, publishedMs);
  }

  /** When the channel was confirmed (ms), or null. */
  readAt(channel: PatchChannel): number | null {
    return this.state()?.[channel]?.at ?? null;
  }

  /** First contact: write the baseline once, the newest note stays unread. */
  ensureBaseline(channel: PatchChannel, times: readonly number[]): void {
    const st = this.state();
    if (st === null || st[channel] || times.length === 0) return;
    this.persist({ ...st, [channel]: { upTo: baselineCutoff(times), at: null } });
  }

  markRead(channel: PatchChannel, times: readonly number[]): void {
    const st = this.state();
    if (st !== null) this.persist(withRead(st, channel, times, Date.now()));
  }

  markUnread(channel: PatchChannel, noteMs: number, times: readonly number[]): void {
    const st = this.state();
    if (st !== null) this.persist(withUnread(st, channel, noteMs, times));
  }

  private persist(next: ReadState): void {
    const raw = serializeReadState(next);
    this.session.set(next);
    if (this.auth.user()) {
      this.prefs.set(PATCH_READ_PREF_KEY, raw);
      return;
    }
    try {
      localStorage.setItem(PATCH_READ_PREF_KEY, raw);
    } catch {
      /* private mode: the badge returns next visit, nothing breaks */
    }
    this.local.set(raw);
  }
}
