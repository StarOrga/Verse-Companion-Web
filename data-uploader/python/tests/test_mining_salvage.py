"""Mining laser / salvage head figures, salvage buffer and the per-item mission flag.

Why: the ship page said "fehlt in den Spieldaten" for an equipped mining or
salvage ship because the extractor dropped every figure of a mining laser
(`SEntityComponentMiningLaserParams`), a salvage head
(`SWeaponActionFireSalvageRepairParams`) and the hull's `SalvageInternalStorage`.

`fixtures/live_mining_salvage.json` holds the trimmed live structs of those
items (LIVE 4.10 `Data/Game2.dcb`, probed 2026-11-26) and, per item and ship,
the values the extractor produced on the real archive.

Not in the game files (verified): a mining or salvage MODULE for a modular hull.
LIVE 4.10 has Galaxy / Retaliator / Aurora Mk2 / Apollo modules but none installs
a laser or head, and `Controller_Salvage_TractorBeamOnly` (Cutlass, Hull, ...) is
a tractor controller. The module path is covered with a synthetic module.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from sc_extract.dataforge_extract import (
    CodexExtractor,
    _attach_def,
    _find_component,
    _mining_laser_params,
    _salvage_controller_params,
    _salvage_head_params,
)

FX = json.loads((Path(__file__).parent / "fixtures" / "live_mining_salvage.json").read_text(encoding="utf-8"))
CLASSES = {k: v["comps"] for k, v in FX["classes"].items()}


def _extractor(extra: dict | None = None) -> CodexExtractor:
    ex = CodexExtractor.__new__(CodexExtractor)
    classes = dict(CLASSES)
    classes.update(extra or {})
    ex._entity_class_comps = lambda name: classes.get(name, [])  # type: ignore[method-assign]
    ex.on_log = lambda *_: None
    return ex


def _weapon(name: str) -> dict:
    return _find_component(CLASSES[name], "SCItemWeaponComponentParams") or {}


class TestMiningLaser:
    def test_arbor_s1_figures(self) -> None:
        out = _mining_laser_params(CLASSES["Mining_Laser_GRIN_Arbor_S1"], _weapon("Mining_Laser_GRIN_Arbor_S1"))
        assert out["mining.laserInstability"] == -35.0
        assert out["mining.optimalChargeWindowSize"] == 40.0
        assert out["mining.resistance"] == 25.0
        assert out["mining.filter"] == 30.0
        assert out["mining.beamPower"] == 2340.0
        assert out["mining.optimalRangeM"] == 60.0
        assert out["mining.maxRangeM"] == 180.0
        assert out["mining.throttleMinimum"] == pytest.approx(0.05)

    def test_modifier_the_laser_leaves_alone_stays_absent(self) -> None:
        # Arbor S1 has no charge-rate or shatter modifier: null in the data.
        out = _mining_laser_params(CLASSES["Mining_Laser_GRIN_Arbor_S1"], _weapon("Mining_Laser_GRIN_Arbor_S1"))
        assert "mining.optimalChargeWindowRate" not in out
        assert "mining.shatterDamage" not in out

    def test_hofstede_has_a_negative_resistance_and_a_rate_modifier(self) -> None:
        out = _mining_laser_params(CLASSES["Mining_Laser_SHIN_Hofstede_S2"], _weapon("Mining_Laser_SHIN_Hofstede_S2"))
        assert out["mining.resistance"] == -30.0
        assert out["mining.optimalChargeWindowRate"] == 20.0
        assert out["mining.beamPower"] == 4060.0

    def test_every_fixture_laser_matches_the_live_run(self) -> None:
        for name, exp in FX["expected"]["items"].items():
            if exp["type"] != "WeaponMining":
                continue
            assert _mining_laser_params(CLASSES[name], _weapon(name)) == exp["mining"], name

    def test_non_laser_yields_nothing(self) -> None:
        assert _mining_laser_params(CLASSES["Salvage_Head_standard"], _weapon("Salvage_Head_standard")) == {}


class TestSalvageHead:
    def test_standard_head_figures(self) -> None:
        out = _salvage_head_params(_weapon("Salvage_Head_standard"))
        assert out["salvage.mode"] == "Salvage"
        assert out["salvage.materialEfficiency"] == 1.0
        assert out["salvage.maxBeamDistance"] == 150.0
        assert out["salvage.maxHealthRepairRate"] == 10.0
        assert out["salvage.rampUpTime"] == 1.0
        assert out["salvage.maxVehicleDamageRatio"] == pytest.approx(0.9)

    def test_every_fixture_head_matches_the_live_run(self) -> None:
        for name, exp in FX["expected"]["items"].items():
            if exp["type"] == "SalvageHead":
                assert _salvage_head_params(_weapon(name)) == exp["salvage"], name

    def test_laser_yields_nothing(self) -> None:
        assert _salvage_head_params(_weapon("Mining_Laser_GRIN_Arbor_S1")) == {}


class TestSalvageController:
    def test_vulture_controller_carries_the_grinder_figures(self) -> None:
        ctrl = _find_component(CLASSES["Controller_Salvage_DRAK_Vulture"], "SCItemSalvageControllerParams")
        out = _salvage_controller_params(ctrl)
        assert out["fractureTimePerRadiusMetre"] == pytest.approx(2.496)
        assert out["maxFracturableRadius"] == 40.5
        assert out["maxDisintegratableRadius"] == pytest.approx(44.55)
        assert out["fieldAlignmentMaxSpeedMultiplier"] == 3.0

    def test_tractor_only_controller_has_no_figures(self) -> None:
        ctrl = _find_component(CLASSES["Controller_Salvage_TractorBeamOnly"], "SCItemSalvageControllerParams")
        assert _salvage_controller_params(ctrl) == {}


class TestSalvageBuffer:
    @pytest.mark.parametrize("ship,scu", [("DRAK_Vulture", 16.0), ("AEGS_Reclaimer", 448.0), ("GAMA_Hyun", 40.0)])
    def test_ship_buffer_scu(self, ship: str, scu: float) -> None:
        assert _extractor()._mining_salvage_scan(FX["loadouts"][ship])[1] == scu

    def test_hull_without_a_buffer_reads_none_not_zero(self) -> None:
        assert _extractor()._mining_salvage_scan(FX["loadouts"]["MISC_Prospector"])[1] is None
        assert _extractor()._mining_salvage_scan(FX["loadouts"]["DRAK_Cutlass_Black"])[1] is None

    def test_storage_item_capacity(self) -> None:
        ex = _extractor()
        assert ex._hold_scu(CLASSES["SalvageInternalStorage_DRAK_Vulture"]) == 16.0
        assert (_attach_def(CLASSES["SalvageInternalStorage_DRAK_Vulture"]) or {})["Type"] == "SalvageInternalStorage"


class TestProvidesMission:
    @pytest.mark.parametrize("ship", sorted(FX["expected"]["ships"]))
    def test_ship_matches_the_live_run(self, ship: str) -> None:
        exp = FX["expected"]["ships"][ship]
        missions, scu = _extractor()._mining_salvage_scan(FX["loadouts"][ship])
        assert missions == exp["providesMission"]
        assert scu == exp["salvageScu"]

    def test_the_documented_cases(self) -> None:
        ex = _extractor()
        scan = lambda s: ex._mining_salvage_scan(FX["loadouts"][s])[0]  # noqa: E731
        assert scan("MISC_Prospector") == ["mining"]
        assert scan("DRAK_Vulture") == ["salvage"]
        assert scan("AEGS_Reclaimer") == ["salvage"]
        assert scan("GAMA_Hyun") == ["mining", "salvage"]

    def test_tractor_only_controller_is_not_a_salvage_ship(self) -> None:
        # Cutlass Black carries Controller_Salvage_Crus_C1 (tractor), no head.
        assert _extractor()._mining_salvage_scan(FX["loadouts"]["DRAK_Cutlass_Black"])[0] == []

    def test_laser_and_head_items_flag_themselves(self) -> None:
        ex = _extractor()
        assert ex._item_missions(CLASSES["Mining_Laser_GRIN_Arbor_S1"], "WeaponMining") == ["mining"]
        assert ex._item_missions(CLASSES["Salvage_Head_standard"], "SalvageHead") == ["salvage"]

    def test_real_galaxy_cargo_module_enables_nothing(self) -> None:
        ex = _extractor()
        assert ex._item_missions(CLASSES["RSI_Galaxy_Module_Cargo"], "Module") == []

    def test_a_module_that_installs_a_head_enables_salvage(self) -> None:
        # Synthetic (no such LIVE 4.10 module): modular hulls get the Einsatz of
        # the module that is fitted, read from the module's own stock loadout.
        module = [
            {"_Type_": "SAttachableComponentParams", "AttachDef": {"Type": "Module", "SubType": "UNDEFINED", "Size": 1}},
            {"_Type_": "SEntityComponentDefaultLoadoutParams",
             "loadout": {"_Type_": "SItemPortLoadoutManualParams", "entries": [
                 {"itemPortName": "hardpoint_salvage_head", "entityClassName": "Salvage_Head_standard",
                  "entityClassReference": None, "loadout": None},
             ]}},
        ]
        ex = _extractor({"Test_Salvage_Module": module})
        assert ex._item_missions(module, "Module") == ["salvage"]

    def test_a_module_that_installs_a_laser_through_a_mount_enables_mining(self) -> None:
        module = [
            {"_Type_": "SAttachableComponentParams", "AttachDef": {"Type": "Module", "SubType": "UNDEFINED", "Size": 1}},
            {"_Type_": "SEntityComponentDefaultLoadoutParams",
             "loadout": {"_Type_": "SItemPortLoadoutManualParams", "entries": [
                 {"itemPortName": "hardpoint_mining_arm", "entityClassName": "Mount_Gimbal_Mining",
                  "entityClassReference": None,
                  "loadout": {"_Type_": "SItemPortLoadoutManualParams", "entries": [
                      {"itemPortName": "hardpoint_class_2", "entityClassName": "Mining_Laser_GRIN_Arbor_S1",
                       "entityClassReference": None, "loadout": None}]}},
             ]}},
        ]
        ex = _extractor({"Test_Mining_Module": module})
        assert ex._item_missions(module, "Module") == ["mining"]

    def test_repair_head_is_not_salvage(self) -> None:
        comps = json.loads(json.dumps(CLASSES["Salvage_Head_standard"]))
        wcp = _find_component(comps, "SCItemWeaponComponentParams")
        wcp["fireActions"][0]["salvageRepairMode"] = "Repair"
        assert _extractor()._item_missions(comps, "SalvageHead") == []
