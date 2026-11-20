"""Silhouette candidates and skips from the extractor (#1004): every kind without a
traceable mesh gets a `no_mesh` skip, naming the mesh format when the record has one.

Run via: PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python -m pytest data-uploader/python/tests/test_silhouette_candidates.py
"""
from __future__ import annotations

from sc_extract.dataforge_extract import CodexExtractor


def _extractor() -> CodexExtractor:
    ex = object.__new__(CodexExtractor)
    ex._silhouette_candidates = []
    ex._silhouette_skips = []
    return ex


def _geom(path: str) -> dict:
    return {"Geometry": {"Geometry": {"Geometry": {"path": path}}}}


def test_cga_mesh_is_a_candidate_for_every_kind() -> None:
    ex = _extractor()
    for kind in ("ship", "weapon", "component", "item", "ammo"):
        ex._note_silhouette_candidate(kind, f"C_{kind}", [_geom("objects/x/body.cga")])
    assert [c["kind"] for c in ex._silhouette_candidates] == ["ship", "weapon", "component", "item", "ammo"]
    assert ex._silhouette_skips == []
    assert ex._silhouette_candidates[0]["mesh"] == "Data/objects/x/body.cga"


def test_every_kind_without_a_mesh_records_a_no_mesh_skip() -> None:
    ex = _extractor()
    for kind in ("ship", "weapon", "component", "item", "ammo"):
        ex._note_silhouette_candidate(kind, f"N_{kind}", [{"SAttachableComponentParams": {}}])
    assert ex._silhouette_candidates == []
    assert [(s["kind"], s["reason"]) for s in ex._silhouette_skips] == [
        ("ship", "no_mesh"), ("weapon", "no_mesh"), ("component", "no_mesh"), ("item", "no_mesh"), ("ammo", "no_mesh"),
    ]
    assert all(s["detail"] == "no .cga/.cgf geometry path on the entity record" for s in ex._silhouette_skips)
    assert ex._silhouette_skips[1]["className"] == "N_weapon"


def test_a_skinned_mesh_names_its_format_in_the_skip() -> None:
    ex = _extractor()
    ex._note_silhouette_candidate("item", "ArmorHelmet_A23", [_geom("objects/characters/human/helmet_a23.skin")])
    ex._note_silhouette_candidate("item", "Armor_Torso", [{"Params": [{"file": "Objects/Characters/armor_torso.cdf"}]}])
    ex._note_silhouette_candidate("weapon", "Gun_Chr", [{"Geometry": {"Geometry": {"Geometry": {"path": "objects/fps/gun.chr"}}}}])
    details = [s["detail"] for s in ex._silhouette_skips]
    assert details[0].startswith(".skin mesh is not traced yet: ")
    assert details[0].endswith("helmet_a23.skin")
    assert details[1].startswith(".cdf mesh is not traced yet: ")
    assert details[2].startswith(".chr mesh is not traced yet: ")
    assert all(s["reason"] == "no_mesh" for s in ex._silhouette_skips)


def test_a_cga_wins_over_a_skin_on_the_same_record() -> None:
    ex = _extractor()
    ex._note_silhouette_candidate("weapon", "Both", [_geom("objects/fps/gun.cga"), _geom("objects/fps/hands.skin")])
    assert len(ex._silhouette_candidates) == 1
    assert ex._silhouette_skips == []


def test_a_very_long_path_keeps_the_detail_within_the_server_cap() -> None:
    ex = _extractor()
    ex._note_silhouette_candidate("item", "Long", [_geom("objects/" + "a/" * 200 + "x.skin")])
    assert len(ex._silhouette_skips[0]["detail"]) <= 300
