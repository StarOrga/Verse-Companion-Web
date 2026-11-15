"""The cause of a failed cgf-converter run, as one short log fragment.

The converter's exit line is always ``[ERR:Program] Failed to convert 1 file(s).``
— the reason sits above it as a .NET exception chain::

    [ERR:Program] Failed to render: Data/.../rsi_galaxy.cga
      AggregateException: One or more errors occurred. (...)
        AggregateException: One or more errors occurred. (...)
          OverflowException: Arithmetic operation resulted in an overflow.
             at System.Linq.Enumerable.Sum[...]
             at CgfConverter.Renderers.Gltf.BaseGltfRenderer.Compile()

Logging only the exit line (field log 2026-11-15: 25 ships, every one
"Failed to convert 1 file(s)") hid that all of them were the same converter
bug. This picks the innermost exception plus the converter frame it came from.
"""
from __future__ import annotations

import re
from typing import Any

_EXC = re.compile(r"^\s*([A-Za-z_.]*Exception):\s*(.*)$")
_FRAME = re.compile(r"^\s*at\s+(CgfConverter\.[\w.`]+)")
_SUMMARY = re.compile(r"Failed to convert \d+ file", re.I)


def _text(raw: Any) -> str:
    if raw is None:
        return ""
    if isinstance(raw, (bytes, bytearray)):
        return raw.decode("utf-8", "replace")
    return str(raw)


def converter_reason(r: Any, limit: int = 200) -> str:
    """``": <cause>"`` for a finished ``subprocess.run`` result, ``""`` when
    the output names nothing. Ready to splice after ``rc=N``."""
    text = _text(getattr(r, "stdout", None)) + "\n" + _text(getattr(r, "stderr", None))
    lines = [ln.rstrip() for ln in text.splitlines() if ln.strip()]
    inner = None
    inner_at = -1
    for i, ln in enumerate(lines):
        m = _EXC.match(ln)
        if m and m.group(1) != "AggregateException":
            inner, inner_at = f"{m.group(1)}: {m.group(2).strip()}", i
    if inner is None:
        # An aggregate with nothing inside still says more than the summary.
        for i, ln in enumerate(lines):
            m = _EXC.match(ln)
            if m:
                inner, inner_at = f"{m.group(1)}: {m.group(2).strip()}", i
    if inner is not None:
        frame = next((m.group(1) for ln in lines[inner_at + 1:]
                      if (m := _FRAME.match(ln))), None)
        out = f"{inner} in {frame}" if frame else inner
        return f": {out[:limit]}"
    errs = [ln.strip() for ln in lines if "[ERR" in ln and not _SUMMARY.search(ln)]
    if errs:
        return f": {errs[-1][:limit]}"
    return f": {lines[-1].strip()[:limit]}" if lines else ""


__all__ = ["converter_reason"]
