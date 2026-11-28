import { describe, expect, it } from 'vitest';
import { fixedSystemArea } from './fixed-system-area';

const at = (rawPort: string, className: string | null = null, typeLabel: string | null = null) =>
  fixedSystemArea({ rawPort, port: rawPort, className, typeLabel });

describe('fixedSystemArea (#411)', () => {
  it('files flight hardware under Bewegung', () => {
    expect(at('hardpoint_thruster_main_left')).toBe('movement');
    expect(at('hardpoint_quantum_fuel_tank')).toBe('movement');
    expect(at('hardpoint_controller_flight')).toBe('movement');
    expect(at('hardpoint_x', null, 'Maneuver Thruster')).toBe('movement');
  });

  it('files the fire-group controller and turret furniture under Offensive', () => {
    expect(at('hardpoint_controller_weapon')).toBe('offensive');
    expect(at('hardpoint_turret_seataccess')).toBe('offensive');
  });

  it('files sensors and emission under Signatur', () => {
    expect(at('hardpoint_transponder')).toBe('signature');
  });

  it('keeps the airframe and anything unknown under Verteidigung', () => {
    expect(at('hardpoint_controller_shield')).toBe('defensive');
    expect(at('hardpoint_door_rear')).toBe('defensive');
    expect(at('hardpoint_weapon_rack_cabin')).toBe('defensive');
    expect(at('hardpoint_seat_pilot')).toBe('defensive');
    expect(at('hardpoint_class_2')).toBe('defensive');
  });
});
