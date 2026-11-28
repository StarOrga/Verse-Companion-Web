import {
  resolveShipCapabilities,
  MISSIONS,
  detectShipCapabilities,
  foldedSectionsFor,
  loadStoredMission,
  missionById,
  missionDisabledReasonKey,
  missionStorageKey,
  storeMission,
} from './codex-mission';

describe('codex-mission', () => {
  it('has exactly the seven prototype mission profiles, in chip order', () => {
    expect(MISSIONS.map((m) => m.id)).toEqual([
      'all',
      'combat',
      'transport',
      'travel',
      'stealth',
      'mining',
      'salvage',
    ]);
  });

  it('resolves an unknown id to "all" (never throws)', () => {
    expect(missionById('bogus').id).toBe('all');
    expect(missionById(null).id).toBe('all');
  });

  it('maps combat to the loadout-order group and empty fold set', () => {
    const combat = missionById('combat');
    expect(combat.order).toEqual(['weapons', 'remoteTurrets', 'mannedTurrets', 'missiles', 'shields', 'powerPlants', 'quantum', 'coolers', 'radar', 'lifeSupport', 'pod']);
    expect(foldedSectionsFor(combat).size).toBe(0);
  });

  it('folds weapons+missiles for transport, travel and stealth', () => {
    for (const id of ['transport', 'travel', 'stealth'] as const) {
      const folded = foldedSectionsFor(missionById(id));
      expect(folded.has('weapons')).toBe(true);
      expect(folded.has('remoteTurrets')).toBe(true);
      expect(folded.has('mannedTurrets')).toBe(true);
      expect(folded.has('missiles')).toBe(true);
    }
  });

  it('resets the folded set per mission — mining folds weapons/missiles too', () => {
    const mining = missionById('mining');
    expect(mining.fold).toContain('weapons');
    expect(mining.fold).toContain('missiles');
  });

  describe('detectShipCapabilities', () => {
    it('detects cargo, quantum, mining and salvage from port/class hints', () => {
      const caps = detectShipCapabilities(
        [
          { portName: 'hardpoint_cargo_grid_01', types: [] },
          { portName: 'hardpoint_quantum_drive', types: [] },
        ],
        ['MiningLaser_S1', 'SalvageHead_S1'],
      );
      expect(caps).toEqual({ hasCargo: true, hasQuantum: true, hasMining: true, hasSalvage: true });
    });

    it('reports no capabilities for a bare combat hull with none of the hints', () => {
      const caps = detectShipCapabilities(
        [{ portName: 'hardpoint_weapon_left', types: ['Gun'] }],
        ['KLWE_LaserRepeater_S3'],
      );
      expect(caps).toEqual({ hasCargo: false, hasQuantum: false, hasMining: false, hasSalvage: false });
    });
  });

  describe('missionDisabledReasonKey', () => {
    const noCaps = { hasCargo: false, hasQuantum: false, hasMining: false, hasSalvage: false };

    it('names the missing capability for each cut-off mission', () => {
      expect(missionDisabledReasonKey('mining', noCaps)).toBe('codex.mission.disabled.noMining');
      expect(missionDisabledReasonKey('salvage', noCaps)).toBe('codex.mission.disabled.noSalvage');
      expect(missionDisabledReasonKey('transport', noCaps)).toBe('codex.mission.disabled.noCargo');
    });

    it('never disables all/combat/stealth/travel on capability grounds', () => {
      expect(missionDisabledReasonKey('all', noCaps)).toBeNull();
      expect(missionDisabledReasonKey('combat', noCaps)).toBeNull();
      expect(missionDisabledReasonKey('stealth', noCaps)).toBeNull();
      expect(missionDisabledReasonKey('travel', noCaps)).toBeNull();
    });

    it('clears the reason once the hull has the capability', () => {
      expect(
        missionDisabledReasonKey('transport', { ...noCaps, hasCargo: true }),
      ).toBeNull();
    });
  });

  describe('mission persistence', () => {
    const shipClass = 'CNOU_Nomad';

    beforeEach(() => localStorage.removeItem(missionStorageKey(shipClass)));

    it('round-trips a stored mission per ship', () => {
      expect(loadStoredMission(shipClass)).toBeNull();
      storeMission(shipClass, 'travel');
      expect(loadStoredMission(shipClass)).toBe('travel');
    });

    it('ignores a corrupted/unknown stored value', () => {
      localStorage.setItem(missionStorageKey(shipClass), 'not-a-mission');
      expect(loadStoredMission(shipClass)).toBeNull();
    });
  });
});

describe('resolveShipCapabilities (schema 7 providesMission)', () => {
  const detected = { hasCargo: true, hasQuantum: true, hasMining: true, hasSalvage: false };
  it('keeps the regex result on an old extract without the key', () => {
    expect(resolveShipCapabilities(detected, {}, [])).toBe(detected);
  });
  it('follows the ship and its fitted items: a mining module enables Bergbau', () => {
    expect(resolveShipCapabilities(detected, { providesMission: [] }, [])).toEqual({ ...detected, hasMining: false, hasSalvage: false });
    expect(resolveShipCapabilities(detected, { providesMission: [] }, [{ providesMission: ['mining'] }, null]).hasMining).toBe(true);
    expect(resolveShipCapabilities(detected, { providesMission: ['salvage'] }, []).hasSalvage).toBe(true);
  });
});
