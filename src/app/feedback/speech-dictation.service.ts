import { InjectionToken, Injectable, Injector, computed, inject, signal } from '@angular/core';
import { AnalyticsService } from '../core/analytics.service';
import { logWarn } from '../core/log';

/**
 * Speech-to-text dictation for the feedback composers (admin feedback #359:
 * "feedbacks nicht nur geschrieben sondern auch gesprochen").
 *
 * Built on the browser's Web Speech API (`SpeechRecognition`, called
 * `webkitSpeechRecognition` in Chrome, Edge and Safari). Firefox has none —
 * `supported` is false there and the mic button explains why instead of
 * pretending to listen. No audio passes through this app: the browser runs the
 * recognition itself, so the CSP needs no extra `connect-src`.
 *
 * ONE session at a time across the whole app — two composers on one screen (the
 * board's new-topic box and an opened topic's reply) share one microphone, so a
 * second `start` hands the session over and the first owner simply stops.
 *
 * The text is reported cumulatively per session (`onText(final, interim)`):
 * the owner keeps the field's content from before the session and rewrites the
 * spoken part on every event, so interim words appear live and are replaced by
 * the final ones without the owner having to diff anything.
 */

/** What the composer shows when a session could not run — one i18n key each. */
export type DictationError = 'denied' | 'noMic' | 'noSpeech' | 'network' | 'failed';

/** How a session was started — the analytics event's only property. */
export type DictationTrigger = 'button' | 'hotkey';

export interface DictationHandlers {
  /** Everything said in this session so far: settled words and the live guess behind them. */
  onText(finalText: string, interim: string): void;
  /** The session ended — stopped, timed out on silence, or failed. Not called after `abort`. */
  onEnd?(): void;
  /** The session failed; the key is the composer's to translate. */
  onError?(error: DictationError): void;
}

/** The slice of the Web Speech API this service uses. */
export interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((ev: SpeechResultEventLike) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

export interface SpeechResultEventLike {
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
}

export type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

/** The recognizer constructor, or null where the browser has none. A token so specs can hand in a fake. */
export const SPEECH_RECOGNITION = new InjectionToken<SpeechRecognitionCtor | null>('SPEECH_RECOGNITION', {
  providedIn: 'root',
  factory: () => {
    if (typeof window === 'undefined') return null;
    const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor };
    return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
  },
});

/** Browser error code → the composer's message. `aborted` is our own stop and is no error at all. */
export function dictationErrorFor(code: string): DictationError | null {
  switch (code) {
    case 'aborted':
      return null;
    case 'not-allowed':
    case 'service-not-allowed':
      return 'denied';
    case 'audio-capture':
      return 'noMic';
    case 'no-speech':
      return 'noSpeech';
    case 'network':
      return 'network';
    default:
      return 'failed';
  }
}

/** BCP-47 tag for the recognizer from the app language ("de" → "de-DE"). */
export function recognitionLang(appLang: string | null | undefined): string {
  const l = (appLang ?? '').toLowerCase();
  if (l.startsWith('en')) return 'en-US';
  return 'de-DE';
}

/** True on Apple platforms, where the hotkey reads ⌥ instead of Alt. */
export function isApplePlatform(nav: { platform?: string; userAgentData?: { platform?: string } } | undefined): boolean {
  const p = (nav?.userAgentData?.platform ?? nav?.platform ?? '').toLowerCase();
  return p.startsWith('mac') || p.startsWith('iphone') || p.startsWith('ipad') || p === 'ios' || p === 'macos';
}

/**
 * The dictation hotkey: Alt+M (⌥M on a Mac) — "M" for microphone. Ctrl+Shift+M
 * was the obvious pick and is taken by the browsers (Chrome's profile switcher,
 * Firefox's responsive mode), which a page cannot reliably override. Matched on
 * `code`, so ⌥M on a Mac (which types "µ") and any keyboard layout hit it; Ctrl
 * must be up, so AltGr (reported as Ctrl+Alt) keeps typing characters.
 */
export function isDictationHotkey(e: KeyboardEvent): boolean {
  return e.code === 'KeyM' && e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.repeat;
}

@Injectable({ providedIn: 'root' })
export class SpeechDictationService {
  private readonly Ctor = inject(SPEECH_RECOGNITION);
  private readonly injector = inject(Injector);

  /** The browser can dictate at all. */
  readonly supported = !!this.Ctor;

  /** The hotkey as the user's keyboard spells it. */
  readonly hotkeyLabel = isApplePlatform(typeof navigator === 'undefined' ? undefined : (navigator as never)) ? '⌥M' : 'Alt+M';

  private readonly _owner = signal<object | null>(null);
  /** Whoever holds the microphone right now; null while nobody dictates. */
  readonly owner = this._owner.asReadonly();
  readonly listening = computed(() => this._owner() !== null);

  private rec: SpeechRecognitionLike | null = null;
  private handlers: DictationHandlers | null = null;

  /** Is `owner` the one dictating? */
  isListening(owner: object): boolean {
    return this._owner() === owner;
  }

  /**
   * Begin a session for `owner`. Any other owner's session is aborted first.
   * Returns false where the browser cannot dictate or refused to start.
   */
  start(owner: object, lang: string, handlers: DictationHandlers, via: DictationTrigger = 'button'): boolean {
    if (!this.Ctor) return false;
    this.abortCurrent();
    let rec: SpeechRecognitionLike;
    try {
      rec = new this.Ctor();
    } catch (err) {
      logWarn('dictation', 'recognizer construction failed', err);
      handlers.onError?.('failed');
      return false;
    }
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (ev) => {
      if (this.rec !== rec) return;
      let finalText = '';
      let interim = '';
      for (let i = 0; i < ev.results.length; i++) {
        const r = ev.results[i];
        const t = r[0]?.transcript ?? '';
        if (r.isFinal) finalText += t;
        else interim += t;
      }
      this.handlers?.onText(finalText, interim);
    };
    rec.onerror = (ev) => {
      if (this.rec !== rec) return;
      const error = dictationErrorFor(ev.error);
      if (!error) return;
      if (error === 'failed' || error === 'network') logWarn('dictation', 'recognition error', { code: ev.error });
      this.handlers?.onError?.(error);
    };
    rec.onend = () => {
      if (this.rec !== rec) return;
      const h = this.handlers;
      this.clear();
      h?.onEnd?.();
    };
    this.rec = rec;
    this.handlers = handlers;
    this._owner.set(owner);
    try {
      rec.start();
    } catch (err) {
      logWarn('dictation', 'recognition start failed', err);
      this.clear();
      handlers.onError?.('failed');
      return false;
    }
    this.injector.get(AnalyticsService).track('feedback:dictation_start', { via });
    return true;
  }

  /** End `owner`'s session gracefully: the words still in flight arrive, then `onEnd`. */
  stop(owner: object): void {
    if (this._owner() !== owner || !this.rec) return;
    try {
      this.rec.stop();
    } catch {
      this.abortCurrent();
    }
  }

  /** Drop `owner`'s session at once, without any further callback. */
  abort(owner: object): void {
    if (this._owner() !== owner) return;
    this.abortCurrent();
  }

  private abortCurrent(): void {
    const rec = this.rec;
    this.clear();
    if (!rec) return;
    try {
      rec.abort();
    } catch {
      /* already ended */
    }
  }

  private clear(): void {
    this.rec = null;
    this.handlers = null;
    this._owner.set(null);
  }
}
