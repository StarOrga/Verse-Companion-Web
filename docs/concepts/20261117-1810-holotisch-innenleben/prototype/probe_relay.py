"""Probe 4: does Data.p4k carry relay -> component wiring (resource network)?"""
import json
import re
import sys
import time

from sc_extract.p4k_compat import apply_p4k_compat
from sc_extract.extract import _find_dcb_entry
from sc_extract.dataforge import DataForge
from sc_extract import dataforge_extract as dx

apply_p4k_compat()
from scdatatools.p4k import P4KFile  # noqa: E402

p4k_path, out = sys.argv[1:3]
t0 = time.time()
p4k = P4KFile(p4k_path)
with p4k.open(p4k.getinfo(_find_dcb_entry(p4k))) as f:
    df = DataForge(f.read())
ents = {r.name.split(".", 1)[-1].lower(): r for r in df.records_by_type_name("EntityClassDefinition")}
KEY = re.compile(r"relay|fuse|network|connection|resource|power|link|breaker", re.I)
res = {"types_with_network": sorted({t for t in df.record_types if re.search(r"network|relay|fuse|breaker", str(t), re.I)})[:80]}

def walk(o, path, hits, depth=0):
    if depth > 14 or len(hits) > 400:
        return
    if isinstance(o, dict):
        for k, v in o.items():
            p = f"{path}.{k}"
            if KEY.search(str(k)) and not isinstance(v, (dict, list)):
                hits.append((p, str(v)[:120]))
            elif KEY.search(str(k)):
                hits.append((p, f"<{type(v).__name__} len={len(v)}>"))
            walk(v, p, hits, depth + 1)
    elif isinstance(o, list):
        for i, v in enumerate(o[:60]):
            walk(v, f"{path}[{i}]", hits, depth + 1)

for name in ("AEGS_Idris_P", "RELAY_3slot", "RELAY_1slot", "POWR_AEGS_S04_Idris_SCItem", "Door_RN_RoomConnector_Breachable_OpenClose_AEGS_Idris_Front", "MISC_Starlancer_Max"):
    r = ents.get(name.lower())
    if r is None:
        res[name] = "missing"
        continue
    d = df.record_to_dict(r, max_depth=10)
    comps = dx._components_of(d)
    hits = []
    walk(d, name, hits)
    res[name] = {"components": [c.get("_Type_") for c in comps if isinstance(c, dict)], "hits": hits[:150]}
json.dump(res, open(out, "w", encoding="utf-8"), indent=1, default=str)
print("done", time.time() - t0)
