import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AuthService } from '../../auth/auth.service';
import { FakeCall, FakeResult, chainArgs, fakeSupabase } from '../../testing/fake-supabase';
import { HqSpot, HqSpotsService } from './hq-spots.service';

const spot = (id: string, patch: Partial<HqSpot> = {}): HqSpot => ({
  id,
  name: `Spot ${id}`,
  system_code: 'STANTON',
  parent_body: 'Crusader',
  note: '',
  created_at: '2026-11-01T10:00:00.000Z',
  updated_at: '2026-11-01T10:00:00.000Z',
  ...patch,
});

describe('HqSpotsService', () => {
  let fake: ReturnType<typeof fakeSupabase>;
  let rows: HqSpot[];
  let answerWrite: (call: FakeCall) => FakeResult;

  function setup(user: { id: string } | null = { id: 'u1' }) {
    fake = fakeSupabase({
      answer: (call) => {
        if (call.target !== 'user_spots') return { data: null };
        return chainArgs(call, 'update') ? answerWrite(call) : { data: rows };
      },
    });
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [fake.provider, { provide: AuthService, useValue: { user: signal(user) } }] });
    return TestBed.inject(HqSpotsService);
  }

  beforeEach(() => {
    rows = [spot('a'), spot('b')];
    answerWrite = () => ({ data: [{ id: 'x' }] });
  });

  it('loads only the own, non-deleted spots newest first', async () => {
    const s = setup();
    await s.load();
    expect(s.spots().map((x) => x.id)).toEqual(['a', 'b']);
    const call = fake.calls[0];
    expect(chainArgs(call, 'eq')).toEqual(['user_id', 'u1']);
    expect(chainArgs(call, 'is')).toEqual(['deleted_at', null]);
    expect(chainArgs(call, 'order')).toEqual(['created_at', { ascending: false }]);
  });

  it('turns a load failure into an error key, not an empty list', async () => {
    const s = setup();
    fake.calls.length = 0;
    rows = undefined as never;
    const f = fakeSupabase({ answer: () => ({ error: { message: 'boom', status: 500 } }) });
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [f.provider, { provide: AuthService, useValue: { user: signal({ id: 'u1' }) } }] });
    const s2 = TestBed.inject(HqSpotsService);
    await s2.load();
    expect(s2.loadError()).toMatch(/^errors\./);
    expect(s2.loaded()).toBe(false);
    expect(s).toBeTruthy();
  });

  it('rename bumps updated_at past the stored value, even one in the future', async () => {
    const future = new Date(Date.now() + 2 * 60_000).toISOString();
    rows = [spot('a', { updated_at: future })];
    const s = setup();
    await s.load();
    expect(await s.rename('a', '  New name ')).toBe(true);
    const patch = chainArgs(fake.calls.at(-1)!, 'update')![0] as { name: string; updated_at: string };
    expect(patch.name).toBe('New name');
    expect(Date.parse(patch.updated_at)).toBeGreaterThan(Date.parse(future));
    expect(s.spots()[0].name).toBe('New name');
  });

  it('delete writes a tombstone with the same bumped updated_at, never a hard delete', async () => {
    const s = setup();
    await s.load();
    expect(await s.remove('a')).toBe(true);
    const call = fake.calls.at(-1)!;
    const patch = chainArgs(call, 'update')![0] as { deleted_at: string; updated_at: string };
    expect(patch.deleted_at).toBe(patch.updated_at);
    expect(call.chain.some(([m]) => m === 'delete')).toBe(false);
    expect(s.spots().map((x) => x.id)).toEqual(['b']);
  });

  it('treats 0 written rows (trigger skipped the write) as a failure and reloads', async () => {
    const s = setup();
    await s.load();
    answerWrite = () => ({ data: [] });
    expect(await s.remove('a')).toBe(false);
    expect(s.writeError()).toMatch(/^errors\./);
    await new Promise((r) => setTimeout(r, 0));
    expect(fake.calls.filter((c) => !chainArgs(c, 'update')).length).toBe(2);
    expect(s.spots().map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('refuses blank or overlong names and does nothing signed out', async () => {
    const s = setup();
    await s.load();
    const before = fake.calls.length;
    expect(await s.rename('a', '   ')).toBe(false);
    expect(await s.rename('a', 'x'.repeat(121))).toBe(false);
    expect(fake.calls.length).toBe(before);
    const out = setup(null);
    await out.load();
    expect(fake.calls.length).toBe(0);
  });
});
