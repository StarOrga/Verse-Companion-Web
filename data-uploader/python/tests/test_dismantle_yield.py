"""Dismantle yield + dismantlable, derived the way the LIVE Data/Game2.dcb lays it out.

VERIFIED 2026-11-21 against LIVE Data.p4k (#1058): no record carries a per-item
yield. ``CraftingBlueprintRecord.GlobalGenericDismantle`` holds the one
``GenericCraftingProcess_Dismantle`` (efficiency 0.5), ``CraftingGlobalParams``
the resource and entity blacklists, and each item's own fabrication blueprint
its resource composition. The blueprints below are trimmed copies of live
records (gameplay-property contexts dropped, quantities as in the archive).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Optional

import pytest

from sc_extract.dataforge_extract import CodexExtractor
from sc_extract.localization import Localizer


def _stub(type_name: str, cls: str) -> Dict[str, str]:
    return {"_RecordId_": f"guid-{cls}", "_RecordName_": f"{type_name}.{cls}"}


def _res(material: str, scu: float, multiplier: Optional[float] = None) -> Dict[str, Any]:
    leaf: Dict[str, Any] = {
        "_Type_": "CraftingCost_Resource",
        "resource": _stub("ResourceType", material),
        "quantity": {"_Type_": "SStandardCargoUnit", "standardCargoUnits": scu},
        "minQuality": 0,
    }
    if multiplier is not None:
        leaf["context"] = [{"_Type_": "CraftingCostContext_QuantityMultiplier",
                            "multiplier": multiplier}]
    return leaf


def _item(cls: str, qty: int) -> Dict[str, Any]:
    return {"_Type_": "CraftingCost_Item",
            "entityClass": _stub("EntityClassDefinition", cls),
            "quantity": qty, "minQuality": 0}


def _slot(name: str, leaf: Dict[str, Any]) -> Dict[str, Any]:
    return {"_Type_": "CraftingCost_Select",
            "nameInfo": {"_Type_": "CraftingNameInfo", "debugName": name},
            "count": 1, "options": [leaf]}


def _blueprint(output: str, slots: List[Dict[str, Any]], *, inclusion: str = "Include",
               count: Optional[int] = None) -> Dict[str, Any]:
    return {"_RecordValue_": {
        "_Type_": "CraftingBlueprintRecord",
        "blueprint": {
            "_Type_": "CraftingBlueprint",
            "processSpecificData": {"_Type_": "CraftingProcess_Creation",
                                    "entityClass": _stub("EntityClassDefinition", output)},
            "tiers": [{"_Type_": "CraftingBlueprintTier", "recipe": {
                "_Type_": "CraftingRecipe",
                "costs": {"_Type_": "CraftingRecipeCosts", "mandatoryCost": {
                    "_Type_": "CraftingCost_Select",
                    "context": [{"_Type_": "CraftingCostContext_ResultCompositionInclusion",
                                 "option": inclusion}],
                    "nameInfo": {"_Type_": "CraftingNameInfo", "debugName": "ASPECTS"},
                    "count": len(slots) if count is None else count,
                    "options": slots,
                }},
            }}],
        },
    }}


GLOBAL_DISMANTLE = {"_RecordValue_": {
    "_Type_": "CraftingBlueprintRecord",
    "blueprint": {"_Type_": "GenericCraftingBlueprint", "processSpecificData": {
        "_Type_": "GenericCraftingProcess_Dismantle", "efficiency": 0.5,
        "dismantleTime": {"_Type_": "TimeValue_Partitioned", "days": 0, "hours": 0,
                          "minutes": 0, "seconds": 15.0},
    }},
}}

GLOBAL_PARAMS = {"_RecordValue_": {
    "_Type_": "CraftingGlobalParams",
    "defaultCompositionQuality": 500,
    "dismantleBlacklistResources": [_stub("ResourceType", m) for m in (
        "Quantanium", "Stileron", "Savrilium", "Lindinium", "Riccite", "Ouratite")],
    "dismantleBlacklistEntityClasses": [
        _stub("EntityClassDefinition", "Harvestable_Mineral_1H_Janalite"),
        _stub("EntityClassDefinition", "Harvestable_Ore_1H_SaldyniumOre"),
    ],
}}

BLUEPRINTS: Dict[str, Dict[str, Any]] = {
    # Iron in two slots is summed: (0.35 + 0.14) * 0.5
    "BP_CRAFT_QDRV_TARS_S01_Voyage_SCItem": _blueprint("QDRV_TARS_S01_Voyage_SCItem", [
        _slot("CASE", _res("Iron", 0.35)),
        _slot("INJECTOR NOZZLES", _res("Iron", 0.14)),
        _slot("CONTAINMENT MATRIX", _res("Laranite", 0.14)),
    ]),
    # Stileron is on the resource blacklist and is never handed back
    "BP_CRAFT_APAR_BallisticScatterGun_S2": _blueprint("APAR_BallisticScatterGun_S2", [
        _slot("FRAME", _res("Torite", 0.64)),
        _slot("ANCHOR PINS", _res("Stileron", 0.1)),
        _slot("BARREL", _res("Titanium", 0.32)),
    ]),
    # Made only of blacklisted resources: dismantlable, but nothing comes back
    "BP_CRAFT_utfl_crossbow_ballistic_01": _blueprint("utfl_crossbow_ballistic_01", [
        _slot("FRAME", _res("Riccite", 0.05)),
        _slot("LIMBS", _res("Lindinium", 0.02)),
    ]),
    # The multiplier context scales the cost the item is made of
    "BP_CRAFT_slaver_armor_medium_arms_01_01_01": _blueprint("slaver_armor_medium_arms_01_01_01", [
        _slot("ARMOURED CARAPACE", _res("Aslarite", 0.04, multiplier=1.15)),
        _slot("INSULATIVE LINER", _res("Aslarite", 0.02)),
    ]),
    # Magazines exclude their costs from the result's composition: unknown
    "BP_CRAFT_ksar_rifle_energy_01_mag": _blueprint("ksar_rifle_energy_01_mag", [
        _slot("MAGAZINE", _res("Hephaestanite", 0.02)),
        _slot("CONDUIT CHANNEL", _res("Copper", 0.02)),
    ], inclusion="Exclude"),
    # 2 of 3 slots: which two the crafter picked is not in the data
    "BP_CRAFT_thp_light_legs_01_01_01": _blueprint("thp_light_legs_01_01_01", [
        _slot("SEGMENT PANELING", _res("Taranite", 0.03)),
        _slot("INSULATIVE LINER", _res("Aslarite", 0.02)),
        _slot("PANEL COVERING", _res("Lindinium", 0.03)),
    ], count=2),
    # An item-type cost has no resource composition of its own here: unknown
    "BP_CRAFT_volt_sniper_energy_01": _blueprint("volt_sniper_energy_01", [
        _slot("FRAME", _res("Taranite", 0.06)),
        _slot("REGULATOR", _item("Harvestable_Mineral_1H_Janalite", 1)),
    ]),
    # A blacklisted entity class can never be dismantled
    "BP_CRAFT_Harvestable_Ore_1H_SaldyniumOre": _blueprint("Harvestable_Ore_1H_SaldyniumOre", [
        _slot("ORE", _res("Iron", 0.1)),
    ]),
}


class _Rec:
    def __init__(self, type_name: str, cls: str) -> None:
        self.name = f"{type_name}.{cls}"
        self.type = type_name
        self.guid = f"guid-{cls}"
        self.filename = f"libs/foundry/records/{cls.lower()}.xml"
        self.tag = None


class _FakeDF:
    def __init__(self, records: Dict[_Rec, Dict[str, Any]]) -> None:
        self._records = records

    def records_by_type_name(self, t: str) -> List[_Rec]:
        return [r for r in self._records if r.type == t]

    def record_to_dict(self, r: _Rec, max_depth: int = 64) -> Dict[str, Any]:
        return self._records[r]

    def record_by_id(self, guid: str) -> None:
        return None


def _extract(tmp_path: Path, *, with_global: bool = True) -> Dict[str, Dict[str, Any]]:
    records: Dict[_Rec, Dict[str, Any]] = {
        _Rec("CraftingBlueprintRecord", cls): rv for cls, rv in BLUEPRINTS.items()}
    if with_global:
        records[_Rec("CraftingBlueprintRecord", "GlobalGenericDismantle")] = GLOBAL_DISMANTLE
        records[_Rec("CraftingGlobalParams", "CraftingGlobalParams")] = GLOBAL_PARAMS
    CodexExtractor(
        _FakeDF(records), Localizer({"en": {}, "de": {}}), tmp_path,
        {"channel": "TEST", "patch": "0.0.0", "build": "0"},
        extract_assets=False,
    ).extract_blueprints()
    out = {}
    for f in (tmp_path / "blueprints").glob("*.json"):
        bp = json.loads(f.read_text(encoding="utf-8"))
        out[bp["className"]] = bp
    return out


@pytest.fixture
def bps(tmp_path: Path) -> Dict[str, Dict[str, Any]]:
    return _extract(tmp_path)


def _yield(bp: Dict[str, Any]) -> Dict[str, float]:
    return {line["material"]: line["amount"] for line in bp["dismantleYield"]}


def test_yield_is_composition_times_global_efficiency(bps) -> None:
    bp = bps["BP_CRAFT_QDRV_TARS_S01_Voyage_SCItem"]
    assert bp["dismantlable"] is True
    assert [line["material"] for line in bp["dismantleYield"]] == ["Iron", "Laranite"]
    assert _yield(bp) == {"Iron": pytest.approx(0.245), "Laranite": pytest.approx(0.07)}


def test_blacklisted_resources_are_not_handed_back(bps) -> None:
    bp = bps["BP_CRAFT_APAR_BallisticScatterGun_S2"]
    assert _yield(bp) == {"Torite": pytest.approx(0.32), "Titanium": pytest.approx(0.16)}


def test_only_blacklisted_resources_gives_an_empty_yield(bps) -> None:
    bp = bps["BP_CRAFT_utfl_crossbow_ballistic_01"]
    assert bp["dismantleYield"] == []
    assert bp["dismantlable"] is True


def test_quantity_multiplier_scales_the_cost(bps) -> None:
    bp = bps["BP_CRAFT_slaver_armor_medium_arms_01_01_01"]
    assert _yield(bp) == {"Aslarite": pytest.approx((0.04 * 1.15 + 0.02) * 0.5)}


@pytest.mark.parametrize("cls", [
    "BP_CRAFT_ksar_rifle_energy_01_mag",      # composition excluded
    "BP_CRAFT_thp_light_legs_01_01_01",       # 2 of 3 slots
    "BP_CRAFT_volt_sniper_energy_01",         # item-type cost
])
def test_unsettled_composition_stays_unknown(bps, cls: str) -> None:
    assert bps[cls]["dismantleYield"] is None
    assert bps[cls]["dismantlable"] is True


def test_blacklisted_entity_is_not_dismantlable(bps) -> None:
    assert bps["BP_CRAFT_Harvestable_Ore_1H_SaldyniumOre"]["dismantlable"] is False


def test_global_dismantle_row_keeps_time_and_efficiency_only(bps) -> None:
    bp = bps["GlobalGenericDismantle"]
    assert bp["dismantleTimeSeconds"] == pytest.approx(15.0)
    assert bp["dismantleEfficiency"] == pytest.approx(0.5)
    assert bp["dismantleYield"] is None
    assert bp["dismantlable"] is None


def test_without_a_global_dismantle_process_everything_is_unknown(tmp_path: Path) -> None:
    for bp in _extract(tmp_path, with_global=False).values():
        assert bp["dismantleYield"] is None
        assert bp["dismantlable"] is None
