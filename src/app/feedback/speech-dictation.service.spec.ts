import { TestBed } from '@angular/core/testing';
import { AnalyticsService } from '../core/analytics.service';
import {
  SPEECH_RECOGNITION,
  SpeechDictationService,
  SpeechRecognitionLike,
  SpeechResultEventLike,
  dictationErrorFor,
  isDictationHotkey,
  recognitionLang,
} from './speech-dictation.service';

/** A recognizer that never touches a microphone — the spec drives its callbacks. */
class FakeRecognition implements SpeechRecognitionLike {
  static instances: FakeRecognition[] = [];
  lang = '';
  continuous = false;
  interimResults = false;
  onresult: ((ev: SpeechResultEventLike) => void) | null = null;
  onerror: ((ev: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  started = 0;
  stopped = 0;
  aborted = 0;
  constructor() {
    FakeRecognition.instances.push(this);
  }
  start(): void {
    this.started++;
  }
  stop(): void {
    this.stopped++;
  }
  abort(): void {
    this.aborted++;
  }
  emit(results: [string, boolean][]): void {
    this.onresult?.({ results: results.map(([t, isFinal]) => ({ isFinal, 0: { transcript: t } })) });
  }
}

describe('SpeechDictationService', () => {
  const track = vi.fn();

  function setup(ctor: unknown = FakeRecognition): SpeechDictationService {
    FakeRecognition.instances = [];
    track.mockReset();
    TestBed.configureTestingModule({
      providers: [
        { provide: SPEECH_RECOGNITION, useValue: ctor },
        { provide: AnalyticsService, useValue: { track } },
      ],
    });
    return TestBed.inject(SpeechDictationService);
  }

  it('is unsupported without a recognizer and refuses to start', () => {
    const svc = setup(null);
    expect(svc.supported).toBe(false);
    expect(svc.start({}, 'de-DE', { onText: () => undefined })).toBe(false);
    expect(svc.listening()).toBe(false);
  });

  it('starts a continuous session with interim results in the given language', () => {
    const svc = setup();
    const owner = {};
    expect(svc.start(owner, 'en-US', { onText: () => undefined }, 'hotkey')).toBe(true);
    const rec = FakeRecognition.instances[0];
    expect(rec.lang).toBe('en-US');
    expect(rec.continuous).toBe(true);
    expect(rec.interimResults).toBe(true);
    expect(rec.started).toBe(1);
    expect(svc.isListening(owner)).toBe(true);
    expect(track).toHaveBeenCalledWith('feedback:dictation_start', { via: 'hotkey' });
  });

  it('reports settled and live words cumulatively', () => {
    const svc = setup();
    const onText = vi.fn();
    svc.start({}, 'de-DE', { onText });
    const rec = FakeRecognition.instances[0];
    rec.emit([['Hallo', false]]);
    expect(onText).toHaveBeenLastCalledWith('', 'Hallo');
    rec.emit([['Hallo Welt', true], [' und', false]]);
    expect(onText).toHaveBeenLastCalledWith('Hallo Welt', ' und');
  });

  it('stop lets the session end on its own and then frees the microphone', () => {
    const svc = setup();
    const owner = {};
    const onEnd = vi.fn();
    svc.start(owner, 'de-DE', { onText: () => undefined, onEnd });
    const rec = FakeRecognition.instances[0];
    svc.stop(owner);
    expect(rec.stopped).toBe(1);
    expect(svc.listening()).toBe(true);
    rec.onend?.();
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(svc.listening()).toBe(false);
  });

  it('abort drops the session without further callbacks', () => {
    const svc = setup();
    const owner = {};
    const onText = vi.fn();
    const onEnd = vi.fn();
    svc.start(owner, 'de-DE', { onText, onEnd });
    const rec = FakeRecognition.instances[0];
    svc.abort(owner);
    expect(rec.aborted).toBe(1);
    rec.emit([['spät', true]]);
    rec.onend?.();
    expect(onText).not.toHaveBeenCalled();
    expect(onEnd).not.toHaveBeenCalled();
    expect(svc.listening()).toBe(false);
  });

  it('a second owner takes the microphone over; stop/abort from the first is ignored', () => {
    const svc = setup();
    const a = {};
    const b = {};
    svc.start(a, 'de-DE', { onText: () => undefined });
    svc.start(b, 'de-DE', { onText: () => undefined });
    expect(FakeRecognition.instances[0].aborted).toBe(1);
    expect(svc.isListening(b)).toBe(true);
    svc.abort(a);
    svc.stop(a);
    expect(FakeRecognition.instances[1].aborted).toBe(0);
    expect(FakeRecognition.instances[1].stopped).toBe(0);
  });

  it('maps browser errors to message keys and ignores its own abort', () => {
    const svc = setup();
    const onError = vi.fn();
    svc.start({}, 'de-DE', { onText: () => undefined, onError });
    const rec = FakeRecognition.instances[0];
    rec.onerror?.({ error: 'aborted' });
    expect(onError).not.toHaveBeenCalled();
    rec.onerror?.({ error: 'not-allowed' });
    expect(onError).toHaveBeenLastCalledWith('denied');
    rec.onerror?.({ error: 'no-speech' });
    expect(onError).toHaveBeenLastCalledWith('noSpeech');
  });

  it('reports a recognizer that refuses to start as failed', () => {
    class Throwing extends FakeRecognition {
      override start(): void {
        throw new Error('InvalidStateError');
      }
    }
    const svc = setup(Throwing);
    const onError = vi.fn();
    expect(svc.start({}, 'de-DE', { onText: () => undefined, onError })).toBe(false);
    expect(onError).toHaveBeenCalledWith('failed');
    expect(svc.listening()).toBe(false);
    expect(track).not.toHaveBeenCalled();
  });
});

describe('dictation helpers', () => {
  it('maps error codes', () => {
    expect(dictationErrorFor('service-not-allowed')).toBe('denied');
    expect(dictationErrorFor('audio-capture')).toBe('noMic');
    expect(dictationErrorFor('network')).toBe('network');
    expect(dictationErrorFor('language-not-supported')).toBe('failed');
  });

  it('picks the recognizer language from the app language', () => {
    expect(recognitionLang('en')).toBe('en-US');
    expect(recognitionLang('de')).toBe('de-DE');
    expect(recognitionLang(undefined)).toBe('de-DE');
  });

  it('matches Alt+M only, never AltGr or a held repeat', () => {
    const k = (init: KeyboardEventInit) => new KeyboardEvent('keydown', { code: 'KeyM', key: 'm', ...init });
    expect(isDictationHotkey(k({ altKey: true }))).toBe(true);
    expect(isDictationHotkey(k({ altKey: true, ctrlKey: true }))).toBe(false);
    expect(isDictationHotkey(k({ altKey: true, repeat: true }))).toBe(false);
    expect(isDictationHotkey(k({}))).toBe(false);
  });
});
