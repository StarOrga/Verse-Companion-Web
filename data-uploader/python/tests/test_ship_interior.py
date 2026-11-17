"""Interior of a ship for the beta holotable (concept 20261117-1810): door filter + kind,
SCU formula, cargo gaps, lift clustering, deck merge, fallback reassignment.

Fixtures are synthetic; the numbers they mirror were measured on LIVE 4.10.2 (Idris-P,
Starlancer MAX) and are named in the comments.
"""

from __future__ import annotations

from sc_extract import ship_interior as si


def _box(x0, y0, x1, y1):
    return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]


def _room(key, floor, size=30.0, connects=None, pos_z=None, x0=0.0):
    r = {"key": key, "floorZ": floor, "height": 3.0, "pos": [x0, 0.0, pos_z if pos_z is not None else floor + 1.0],
         "shapes": [_box(x0, 0.0, x0 + size, size)], "tris": []}
    if connects:
        r["connects"] = connects
    return r


# ── doors ────────────────────────────────────────────────────────────────────
def test_navlinks_and_proximity_sensors_are_no_doors() -> None:
    assert not si.is_real_door("door_navlink")
    assert not si.is_real_door("Door_Ship_Sensor_Proximity_2x5x3")
    assert si.is_real_door("Door_RN_RoomConnector_Breachable_OpenClose")
    assert si.cat_of(si.ENT_CATS, "door_navlink") == "door"  # the category regex still sees it, the filter drops it


def test_door_kinds_follow_the_idris_classes() -> None:
    k = lambda cls, name="", lo=False: si.classify_door(cls, name, lo)  # noqa: E731
    assert k("Door_RN_RoomConnector_Breachable_OpenClose") == {"kind": "room", "breachable": True}
    assert k("Door_RN_NoRoomConnector_Breachable_OpenClose_IP")["kind"] == "inner"
    assert k("Door_RN_NoRoomConnector_Breachable_OpenReverse")["kind"] == "inner"
    assert k("ElevatorDoorDefault_AEGS_Idris_Bridge")["kind"] == "lift"
    assert k("Door_RN_RoomConnector_Breachable_OpenClose_AEGS_Idris_Front", "hardpoint_door_front", True)["kind"] == "hangar"
    assert k("Door_RN_NoRoomConnector_Breachable_OpenClose_AEGS_Idris_Front_Left", "hardpoint_door_front_left", True)["kind"] == "bow"
    assert k("Door_RN_RoomConnector_Breachable_OpenClose_AEGS_Idris_Exterior_Airlock", "hardpoint_door_airlock_front_left", True)["kind"] == "airlock"
    assert k("Door_RN_RoomConnector_Exterior_MISC_Starlancer_Ramp", "hardpoint_ramp", True)["kind"] == "ramp"
    assert k("Door_NoRoomConnector_Template") == {"kind": "inner", "breachable": False}


def test_panel_within_three_metres_attaches_and_a_cell_panel_makes_a_cell_door() -> None:
    doors = [{"pos": [0, 0, 6], "door": {"kind": "room", "breachable": True, "panel": None}},
             {"pos": [20, 0, 6], "door": {"kind": "inner", "breachable": False, "panel": None}},
             {"pos": [40, 0, 6], "door": {"kind": "lift", "breachable": False, "panel": None}}]
    panels = [{"pos": [1.0, 1.0, 6.5], "cls": "ControlPanel_Screen_DoorControl", "name": "x"},
              {"pos": [20.5, 0.0, 6.0], "cls": "ControlPanel_Screen_DoorControl_Physical_AEGS_Brig_Celldoor", "name": "Cell3"},
              {"pos": [45.0, 0.0, 6.0], "cls": "ControlPanel_Screen_DoorControl", "name": "far"}]
    si.attach_panels(doors, panels)
    assert doors[0]["door"]["panel"] == [1.0, 1.0, 6.5] and doors[0]["door"]["kind"] == "room"
    assert doors[1]["door"]["kind"] == "cell"
    assert doors[2]["door"]["panel"] is None


# ── cargo ────────────────────────────────────────────────────────────────────
def test_scu_is_the_floor_product_of_the_1_25_m_cells() -> None:
    assert si.scu_of([5.0, 5.0, 5.0]) == 64            # Idris hangar grid, 16 of them = 1024
    assert si.scu_of([2.5, 10.0, 3.75]) == 48          # Starlancer MAX main grid, two = 96
    assert si.scu_of([3.75, 2.5, 3.75]) == 18
    assert si.scu_of([1.24, 5.0, 5.0]) == 0


def test_a_grid_port_without_class_is_a_gap_and_a_located_grid_needs_dims_and_position() -> None:
    loadout = [{"itemPortName": "hardpoint_cargogrid_left", "entityClassName": "MISC_Starlancer_CargoGrid"},
               {"itemPortName": "hardpoint_cargogrid_nodims", "entityClassName": "Unknown_CargoGrid"},
               {"itemPortName": "hardpoint_cargogrid_nopos", "entityClassName": "MISC_Starlancer_CargoGrid"},
               {"itemPortName": "hardpoint_power", "entityClassName": "POWR_X"}]
    transforms = {"hardpoint_cargogrid_left": {"position": [-3.0, -5.04, -4.3]},
                  "hardpoint_cargogrid_left_small": {"position": [-1.0, 0.0, 0.0]}}
    ports = ["hardpoint_cargogrid_left", "hardpoint_cargogrid_left_small", "hardpoint_cargogrid_right_small"]
    dims = {"MISC_Starlancer_CargoGrid": [2.5, 10.0, 3.75]}
    grids, gaps = si.locate_grids(loadout, ports, transforms, lambda c: dims.get(c))
    assert [(g["port"], g["scu"], g["pos"]) for g in grids] == [("hardpoint_cargogrid_left", 48, [-3.0, -5.0, -4.3])]
    assert {(g["port"], g["reason"]) for g in gaps} == {
        ("hardpoint_cargogrid_nodims", "noDims"), ("hardpoint_cargogrid_nopos", "noPos"),
        ("hardpoint_cargogrid_left_small", "noClass"), ("hardpoint_cargogrid_right_small", "noClass")}


# ── lifts ────────────────────────────────────────────────────────────────────
def test_lift_stops_cluster_per_shaft_even_when_the_destination_is_offset_from_the_door() -> None:
    # Idris-P: the bridge lift's two destinations are 4.4 m apart in y; the cargo lifts sit 0.25 m apart in x.
    stops = [(0.0, -40.63, 18.12), (0.0, -45.0, 6.12), (12.5, -16.0, -7.87), (12.75, -16.0, 6.0),
             (-12.5, -16.0, -8.0), (-11.88, -16.0, 6.0)]
    shafts = si.cluster_lifts(stops)
    assert [(s["at"][0], s["stops"]) for s in shafts] == [(-12.2, [-8.0, 6.0]), (0.0, [6.12, 18.12]), (12.6, [-7.87, 6.0])]


def test_destination_and_gateway_of_one_stop_are_one_stop_and_the_destination_height_wins() -> None:
    # Starlancer MAX: destination -4.44 / +0.69, gateway -5.0 / +0.15 on the same shaft.
    stops = [(-4.0, -11.0, -4.44, 0), (-5.4, -11.1, -5.0, 1), (-7.0, -11.0, 0.69, 0), (-5.4, -11.1, 0.15, 1)]
    shafts = si.cluster_lifts(stops)
    assert len(shafts) == 1 and shafts[0]["stops"] == [-4.44, 0.69]


def test_two_lifts_ten_metres_apart_are_two_shafts() -> None:
    assert len(si.cluster_lifts([(-5.0, -11.0, -4.4, 0), (5.0, -11.0, -4.4, 0)])) == 2


def test_a_ladder_pair_is_one_ladder_that_climbs_its_rise() -> None:
    decks = [{"key": "a", "rooms": []}, {"key": "b", "rooms": []}]
    floors = [(-14.95, "a"), (-9.62, "b")]
    ents = [{"cat": "ladder", "cls": "Ladder", "pos": [-23.1, 11.5, -12.0]},
            {"cat": "ladder", "cls": "Ladder_Navlink_3m", "pos": [-23.1, 11.5, -12.0]}]
    out = si.assemble(decks=decks, floors=floors, entities=ents, loadout_pois=[], grids=[], gaps=[])
    ladders = [p for p in out["pois"] if p["cat"] == "ladder"]
    assert len(ladders) == 1 and ladders[0]["connects"] == ["a", "b"]


# ── decks ────────────────────────────────────────────────────────────────────
def _idris_like():
    def deck(key, floor, rooms):
        return {"key": key, "name": {"en": key, "de": key}, "order": 0, "derived": True, "floorZ": floor, "rooms": rooms}
    big = 30.0
    return [
        deck("level_1", -14.95, [_room("ArgoBay_Hangar_Room", -14.95, big), _room("ArgoBay_GravityGenerator_Room", -14.95, big, x0=40)]),
        deck("level_2", -12.25, [_room("ArgoBay_AccessPassage_Left_Room1", -12.25, 5.0)]),
        deck("level_3", -9.62, [_room("Hangar_MainHangar_Room", -9.62, 60.0), _room("ArgoBay_AccessLadder_Left_Room", -9.62, 2.0, connects=["level_3", "level_4"])]),
        deck("level_4", -2.04, [_room("Hangar_PilotReadyRoom_Room", -2.04, 15.0), _room("Hangar_RightControlRoom_Room", -2.04, 15.0, x0=20),
                                _room("ArgoBay_AccessLadder_Left_Room", -2.04, 2.0, connects=["level_3", "level_4"])]),
        deck("level_5", 2.38, [_room("MidDeck_Rear_Engineering_EngineRoom", 2.38, 20.0)]),
        deck("level_6", 5.38, [_room("MidDeck_Center_Messhall_Room", 5.38, 60.0)]),
        deck("level_7", 9.75, [_room("Left_Stairwells_Rear_Turret_Room", 9.75, 14.0), _room("Right_Stairwells_Turret_Room", 9.75, 14.0, x0=20)]),
        deck("level_8", 17.25, [_room("Bridge_MainBridge_Room", 17.25, 20.0)]),
    ]


def test_idris_levels_merge_to_six_decks_with_landings_in_the_deck_above() -> None:
    decks = _idris_like()
    mapping = si.merge_derived_decks(decks, stops=[-8.0, 6.0, 6.12, 18.12])
    assert [d["key"] for d in decks] == ["level_1", "level_3", "level_4", "level_6", "level_7", "level_8"]
    # level_5 (2.38) is the landing under the main deck -> deck above; level_2 shares the Argo bay name with level_1 -> deck below
    assert mapping["level_5"] == "level_6" and mapping["level_2"] == "level_1"
    assert [d["name"]["en"] for d in decks] == ["Argo Bay", "Hangar", "Upper Hangar", "Main Deck", "Turrets", "Bridge"]
    assert [d["order"] for d in decks] == [0, 1, 2, 3, 4, 5]
    main = next(d for d in decks if d["key"] == "level_6")
    assert {r["key"] for r in main["rooms"]} == {"MidDeck_Rear_Engineering_EngineRoom", "MidDeck_Center_Messhall_Room"}


def test_a_ladder_listed_on_two_levels_keeps_one_row_with_the_merged_keys() -> None:
    decks = _idris_like()
    si.merge_derived_decks(decks, stops=[-8.0, 6.0, 18.12])
    lower = next(d for d in decks if d["key"] == "level_3")
    ladder = [r for r in lower["rooms"] if r["key"] == "ArgoBay_AccessLadder_Left_Room"]
    assert len(ladder) == 1 and ladder[0]["connects"] == ["level_3", "level_4"]


def test_a_hull_that_forms_one_deck_is_left_alone() -> None:
    decks = [{"key": "level_1", "derived": True, "floorZ": 0.0, "rooms": [_room("A_Room", 0.0, 30.0)]},
             {"key": "level_2", "derived": True, "floorZ": 6.0, "rooms": [_room("B_Room", 6.0, 3.0)]}]
    assert si.merge_derived_decks(decks, stops=[]) == {}
    assert len(decks) == 2


def test_rooms_of_the_catch_all_deck_land_on_the_deck_they_stand_on() -> None:
    # Starlancer MAX: decks at -5.3 / -0.1, lift stops -4.4 / +0.7; the lower rooms' origin sits 0.7 m up and fell into "Weitere".
    decks = [{"key": "Deck_1", "rooms": [_room("L1", -5.3), _room("L2", -5.3, x0=40)]},
             {"key": "Deck_2", "rooms": [_room("U1", -0.1), _room("U2", -0.1, x0=40)]},
             {"key": "unassigned", "fallback": True, "rooms": [_room("Cargo", -3.67, pos_z=-2.97), _room("Cockpit", 0.2)]}]
    si.reassign_fallback(decks)
    assert [d["key"] for d in decks] == ["Deck_1", "Deck_2"]
    assert "Cargo" in {r["key"] for r in decks[0]["rooms"]} and "Cockpit" in {r["key"] for r in decks[1]["rooms"]}
    floors = si.deck_floors(decks)
    assert si.level_of(-4.4, floors) == "Deck_1" and si.level_of(0.69, floors) == "Deck_2"


def test_assemble_places_elements_on_decks_rooms_and_names_the_lift_decks() -> None:
    decks = [{"key": "Deck_1", "rooms": [_room("L1", -5.3, 20.0)]}, {"key": "Deck_2", "rooms": [_room("U1", -0.1, 20.0)]}]
    floors = si.deck_floors(decks)
    ents = [{"cat": "weaponRack", "cls": "Weapon_Rack", "name": "w", "pos": [5.0, 5.0, -4.9]},
            {"cat": "lift", "cls": "TransitDestination", "name": "t", "pos": [-30.0, 0.0, -4.4]},
            {"cat": "lift", "cls": "TransitDestination", "name": "t", "pos": [-31.0, 0.0, 0.69]},
            {"cat": "console", "cls": "Console_X", "name": "c", "pos": [0.0, 0.0, 0.0]}]
    out = si.assemble(decks=decks, floors=floors, entities=ents, loadout_pois=[], grids=[
        {"port": "g", "cls": "G", "dims": [5.0, 5.0, 5.0], "pos": [5.0, 5.0, -5.3], "scu": 64}], gaps=[])
    rack = next(p for p in out["pois"] if p["cat"] == "weaponRack")
    assert rack["deck"] == "Deck_1" and rack["room"] == "L1"
    assert all(p["cat"] != "console" for p in out["pois"])
    assert out["lifts"] == [{"at": [-30.5, 0.0], "stops": [-4.4, 0.69], "decks": ["Deck_1", "Deck_2"]}]
    assert out["cargoScuLocated"] == 64 and out["cargoGrids"][0]["deck"] == "Deck_1"
