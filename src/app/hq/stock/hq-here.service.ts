// #354 storage search (concept d83b72d8, round 4 a): "Mein Standort" — live from the app, else set by hand.
import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { AccountPrefsService } from '../../core/account-prefs.service';
import { HqLiveService } from '../now/hq-live.service';
import { formatLocationName, readLocation } from '../now/hq-live.util';
import { placeOfName } from '../plan/map/hq-places';
import type { MapPlace } from '../plan/map/hq-map.types';

const LOCAL_KEY = 'sc.hq.here';
const PREF_KEY = 'hq.here';

export type HereSource = 'app' | 'manual';

export interface Here {
  /** The stored / logged name ("Stanton4_PortTressler" or "Port Tressler"). */
  name: string;
  label: string;
  source: HereSource;
  place: MapPlace | null;
}

/**
 * The reader's position for the storage search. The connected app always wins; a hand-set place holds until the
 * reader changes it or the app reports one (decision s-keep), kept in the account (with a local copy for the
 * instant start). Booking never moves it (decision s-book).
 */
@Injectable({ providedIn: 'root' })
export class HqHereService {
  private readonly live = inject(HqLiveService);
  private readonly prefs = inject(AccountPrefsService);
  private readonly manualState = signal<string | null>(readLocal());

  readonly manual = this.manualState.asReadonly();

  readonly current = computed<Here | null>(() => {
    const at = readLocation(this.live.state());
    if (at) return { name: at.name, label: formatLocationName(at.name), source: 'app', place: placeOfName(at.name, at.system) };
    const m = this.manualState();
    return m ? { name: m, label: formatLocationName(m), source: 'manual', place: placeOfName(m) } : null;
  });

  constructor() {
    effect(() => {
      const p = this.prefs.prefs();
      if (!p || !(PREF_KEY in p)) return;
      const v = p[PREF_KEY];
      const next = typeof v === 'string' && v.trim() ? v : null;
      untracked(() => {
        if (next !== this.manualState()) {
          this.manualState.set(next);
          writeLocal(next);
        }
      });
    });
  }

  setManual(name: string | null): void {
    const v = name?.trim() || null;
    this.manualState.set(v);
    writeLocal(v);
    this.prefs.set(PREF_KEY, v);
  }
}

function readLocal(): string | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(LOCAL_KEY);
  } catch {
    return null;
  }
}

function writeLocal(v: string | null): void {
  try {
    if (v) localStorage.setItem(LOCAL_KEY, v);
    else localStorage.removeItem(LOCAL_KEY);
  } catch {
    /* private mode — the signal still holds it this session */
  }
}
