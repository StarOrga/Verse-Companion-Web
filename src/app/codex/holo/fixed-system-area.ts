import type { Perspective } from '../codex-build-compare';
import type { LayoutSlot } from '../codex-hardpoint-layout.component';

/**
 * Which Holotable area a FIXED system (the `structure` section: thrusters,
 * tanks, seats, controllers, doors …) belongs to (#411: *"diese festen Systeme
 * … auf die vier Bereiche jeweils verteilen"*). The airframe used to sit as one
 * folded block under Verteidigung; now each part stands in the column whose
 * question it answers.
 *
 * Read from the raw port name, the occupant's class and its type label — the
 * same words the section classifier reads. First match wins, so the more
 * specific rule comes first ("controller_weapon" is armament, not a seat).
 * Whatever names nothing we know is airframe and stays under Verteidigung,
 * where the whole block lived before.
 */
const AREA_RULES: readonly [RegExp, Perspective][] = [
  // Personal weapon racks are cabin storage, not armament — airframe.
  [/weapon_?rack/i, 'defensive'],
  // Flight: thrusters, engines, fuel and its intake, the flight controller, landing gear.
  [/thruster|engine|retro|vtol|maneuv|(^|_)mav(_|$)|fuel|intake|tank|flight|landing|gear|quantum|jump/i, 'movement'],
  // Armament: the fire-group / missile / turret controllers and ammunition stores.
  [/weapon|(^|_)gun|turret|missile|torpedo|bomb|rocket|ammo|target/i, 'offensive'],
  // Detection and emission: sensors, transponder, comms, cooling, life support.
  [/radar|scanner|(^|_)ping|transponder|(^|_)comms?(_|$)|antenna|sensor|cooler|cooling|life_?support|emission/i, 'signature'],
  // Protection: shields' control module, armour, hull, self-destruct.
  [/shield|armou?r|hull|self_?destruct|countermeasure/i, 'defensive'],
];

export function fixedSystemArea(slot: Pick<LayoutSlot, 'rawPort' | 'port' | 'className' | 'typeLabel'>): Perspective {
  const words = [slot.rawPort, slot.port, slot.className, slot.typeLabel]
    .filter((w): w is string => !!w)
    // "Main Thruster" → "main_thruster", so one rule set reads labels and raw names alike.
    .map((w) => w.trim().replace(/[\s-]+/g, '_'));
  for (const [rule, area] of AREA_RULES) {
    if (words.some((w) => rule.test(w))) return area;
  }
  return 'defensive';
}
