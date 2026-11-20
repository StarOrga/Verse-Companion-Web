"""Compact, read-only index over a Star Citizen ``Data.p4k``.

WHY
---
``scdatatools.p4k.P4KFile`` builds one ``P4KInfo`` (a ``ZipInfo`` subclass with
a ~206-byte ``extra`` blob, a filename in three dicts, a date tuple, ...) per
central-directory entry. The live archive has ~1.4 M entries, so every sidecar
process that opens it carries ~2.5 GB of Python objects before it does any
work, and every 3D worker pays that again.

This module parses the same central directory into packed storage instead:

* every entry's name in one ``bytearray`` plus a ``uint64`` offset array,
* header offset, sizes, compression method, flag bits and the encryption flag
  as ``array`` columns (typed, ~60 MB for the whole archive),
* a sorted case-folded name hash (numpy) for exact and case-insensitive lookup.

Entries are materialised only on demand (:class:`P4KEntry`, a slotted object
with the attributes callers and scdatatools' reader use). Data is read through
scdatatools' own ``P4KExtFile`` (decryption + zstd), so bytes are identical to
``P4KFile.open(info).read()``; the ZIP64 / SC-trailer decoding mirrors
:mod:`sc_extract.p4k_compat` exactly.

Use :func:`open_p4k` -- it applies the compat patch first.
"""

from __future__ import annotations

import struct
import threading
import zipfile
from array import array
from collections.abc import Sequence
from typing import Iterator, List, Optional

try:  # numpy ships with the uploader's Python; only P4KIndex needs it
    import numpy as np
except ImportError:  # pragma: no cover
    np = None  # type: ignore[assignment]

from .p4k_compat import apply_p4k_compat

_CD = struct.Struct(zipfile.structCentralDir)
_CD_SIZE = zipfile.sizeCentralDir
_H = struct.Struct("<HH")
_Q3 = struct.Struct("<QQQ")
_Q2 = struct.Struct("<QQ")
_Q1 = struct.Struct("<Q")
_CHUNK = 32 * 1024 * 1024
_SENT64 = (0xFFFFFFFFFFFFFFFF, 0xFFFFFFFF)


def _norm(path: str) -> str:
    return path.replace("\\", "/")


class P4KEntry:
    """Lightweight stand-in for ``P4KInfo`` (only what readers/callers use)."""

    __slots__ = (
        "index", "orig_filename", "filename", "file_size", "compress_size",
        "compress_type", "flag_bits", "is_encrypted", "header_offset",
    )

    def __init__(self, index, orig_filename, file_size, compress_size,
                 compress_type, flag_bits, is_encrypted, header_offset):
        self.index = index
        self.orig_filename = orig_filename
        self.filename = _norm(orig_filename)
        self.file_size = file_size
        self.compress_size = compress_size
        self.compress_type = compress_type
        self.flag_bits = flag_bits
        self.is_encrypted = is_encrypted
        self.header_offset = header_offset

    def is_dir(self) -> bool:
        return self.filename.endswith("/")

    def __repr__(self) -> str:  # pragma: no cover
        return f"<P4KEntry {self.filename!r} size={self.file_size}>"


class _NameSeq(Sequence):
    """``namelist()`` without a 1.4 M-element list of str: decodes on access."""

    def __init__(self, idx: "P4KIndex") -> None:
        self._i = idx

    def __len__(self) -> int:
        return self._i._n

    def __getitem__(self, k):
        if isinstance(k, slice):
            return [self._i._name(j) for j in range(*k.indices(len(self)))]
        if k < 0:
            k += len(self)
        if not 0 <= k < len(self):
            raise IndexError(k)
        return self._i._name(k)

    def __iter__(self) -> Iterator[str]:
        i = self._i
        buf, offs = i._names, i._offs
        for j in range(i._n):
            yield _norm(buf[offs[j]:offs[j + 1]].decode("utf-8"))

    def __contains__(self, item) -> bool:
        return isinstance(item, str) and self._i._find(item, exact_only=True) is not None


class _InfoSeq(Sequence):
    """``infolist()`` that builds each :class:`P4KEntry` as it is visited."""

    def __init__(self, idx: "P4KIndex") -> None:
        self._i = idx

    def __len__(self) -> int:
        return self._i._n

    def __getitem__(self, k):
        if isinstance(k, slice):
            return [self._i.entry(j) for j in range(*k.indices(len(self)))]
        if k < 0:
            k += len(self)
        if not 0 <= k < len(self):
            raise IndexError(k)
        return self._i.entry(k)

    def __iter__(self) -> Iterator[P4KEntry]:
        for j in range(self._i._n):
            yield self._i.entry(j)


class P4KIndex:
    """Read-only ``P4KFile`` look-alike: ``namelist/infolist/getinfo/open``."""

    def __init__(self, path, key: Optional[bytes] = None) -> None:
        from scdatatools.p4k import DEFAULT_P4K_KEY

        self.filename = str(path)
        self.key = DEFAULT_P4K_KEY if key is None else key
        self._dds_h = None
        self._dds_i = None
        self._lock = threading.RLock()
        self._fileRefCnt = 1
        self.fp = open(self.filename, "rb")
        try:
            self._load()
        except BaseException:
            self.fp.close()
            raise

    # ---- central directory ------------------------------------------------
    def _load(self) -> None:
        fp = self.fp
        try:
            endrec = zipfile._EndRecData(fp)
        except OSError:
            raise zipfile.BadZipFile("File is not a valid p4k file")
        if not endrec:
            raise zipfile.BadZipFile("File is not a valid p4k file")
        size_cd = endrec[zipfile._ECD_SIZE]
        offset_cd = endrec[zipfile._ECD_OFFSET]
        concat = endrec[zipfile._ECD_LOCATION] - size_cd - offset_cd
        if endrec[zipfile._ECD_SIGNATURE] == zipfile.stringEndArchive64:
            concat -= zipfile.sizeEndCentDir64 + zipfile.sizeEndCentDir64Locator

        names = bytearray()
        offs = array("Q", [0])
        hoff = array("Q")
        fsz = array("Q")
        csz = array("Q")
        ctype = array("H")
        flags = array("H")
        enc = array("B")
        hashes = array("q")

        fp.seek(offset_cd + concat, 0)
        remaining = size_cd
        buf = b""
        pos = 0
        unpack_cd = _CD.unpack_from
        while True:
            # refill: keep the unread tail, append the next chunk
            if remaining > 0 and len(buf) - pos < 1024 * 1024:
                more = fp.read(min(_CHUNK, remaining))
                if not more:
                    raise zipfile.BadZipFile("Truncated central directory")
                remaining -= len(more)
                buf = buf[pos:] + more
                pos = 0
            if pos >= len(buf):
                break
            if len(buf) - pos < _CD_SIZE:
                raise zipfile.BadZipFile("Truncated central directory")
            c = unpack_cd(buf, pos)
            if c[zipfile._CD_SIGNATURE] != zipfile.stringCentralDir:
                raise zipfile.BadZipFile("Bad magic number for central directory")
            nlen = c[zipfile._CD_FILENAME_LENGTH]
            elen = c[zipfile._CD_EXTRA_FIELD_LENGTH]
            clen = c[zipfile._CD_COMMENT_LENGTH]
            end = pos + _CD_SIZE + nlen + elen + clen
            if end > len(buf):
                if remaining <= 0:
                    raise zipfile.BadZipFile("Truncated central directory")
                more = fp.read(min(_CHUNK, remaining))
                remaining -= len(more)
                buf = buf[pos:] + more
                pos = 0
                continue
            nstart = pos + _CD_SIZE
            raw = buf[nstart:nstart + nlen]
            flag = c[5]
            if c[3] > zipfile.MAX_EXTRACT_VERSION:
                raise NotImplementedError("zip file version %.1f" % (c[3] / 10))
            if flag & 0x800:
                uname = raw.decode("utf-8")
                raw8 = bytes(raw)
            else:
                uname = raw.decode("cp437")
                raw8 = uname.encode("utf-8")
            file_size = c[11]
            comp_size = c[10]
            header_offset = c[zipfile._CD_LOCAL_HEADER_OFFSET]
            is_enc = False

            # ---- extra field (mirrors p4k_compat._decodeExtra_tolerant) ----
            ebase = nstart + nlen
            if elen > 168 and buf[ebase + 168] > 0:
                is_enc = True
            off = 0
            while off + 4 < elen:
                tp, ln = _H.unpack_from(buf, ebase + off)
                if tp == 0x0001:
                    p = ebase + off + 4
                    if ln >= 24:
                        if off + 4 + 24 > elen:
                            raise zipfile.BadZipFile("Corrupt extra field")
                        counts = _Q3.unpack_from(buf, p)
                    elif ln == 16:
                        if off + 4 + 16 > elen:
                            raise zipfile.BadZipFile("Corrupt extra field")
                        counts = _Q2.unpack_from(buf, p)
                    elif ln == 8:
                        if off + 4 + 8 > elen:
                            raise zipfile.BadZipFile("Corrupt extra field")
                        counts = _Q1.unpack_from(buf, p)
                    elif ln == 0:
                        counts = ()
                    else:
                        break
                    k = 0
                    if file_size in _SENT64:
                        file_size = counts[k]
                        k += 1
                    if comp_size == 0xFFFFFFFF:
                        comp_size = counts[k]
                        k += 1
                    if header_offset == 0xFFFFFFFF:
                        header_offset = counts[k]
                        k += 1
                off += ln + 4

            names += raw8
            offs.append(len(names))
            hoff.append(header_offset + concat)
            fsz.append(file_size)
            csz.append(comp_size)
            ctype.append(c[6])
            flags.append(flag)
            enc.append(1 if is_enc else 0)
            hashes.append(hash(_norm(uname).casefold()))
            pos = end

        self._n = len(hoff)
        self._names = names
        self._offs = offs
        self._hoff, self._fsz, self._csz = hoff, fsz, csz
        self._ctype, self._flags, self._enc = ctype, flags, enc
        h = np.frombuffer(hashes, dtype=np.int64)
        order = np.argsort(h, kind="stable")  # equal hashes stay in archive order
        self._sorted_h = h[order]
        self._order = order.astype(np.int32)

    # ---- lookups ----------------------------------------------------------
    def _name(self, j: int) -> str:
        return _norm(self._names[self._offs[j]:self._offs[j + 1]].decode("utf-8"))

    def entry(self, j: int) -> P4KEntry:
        return P4KEntry(
            j,
            self._names[self._offs[j]:self._offs[j + 1]].decode("utf-8"),
            self._fsz[j], self._csz[j], self._ctype[j], self._flags[j],
            bool(self._enc[j]), self._hoff[j],
        )

    def _cands(self, cf: str) -> List[int]:
        """Archive-ordered indices whose case-folded name hashes like ``cf``."""
        h = hash(cf)
        lo = int(np.searchsorted(self._sorted_h, h, side="left"))
        hi = int(np.searchsorted(self._sorted_h, h, side="right"))
        return [int(self._order[k]) for k in range(lo, hi)]

    def _find(self, name: str, exact_only: bool = False) -> Optional[int]:
        """Index of ``name``: last exact match, else last case-insensitive one."""
        key = _norm(name)
        cf = key.casefold()
        exact = fold = None
        for j in self._cands(cf):
            n = self._name(j)
            if n == key:
                exact = j  # ascending archive order -> the last one wins
            elif n.casefold() == cf:
                fold = j
        if exact is not None:
            return exact
        if exact_only:
            return None
        # a duplicate that differs only in case: last one in archive order wins
        return fold

    # ---- the three name maps hull3d / silhouette / ship discovery used ----
    def exact(self, key: str) -> Optional[P4KEntry]:
        """``{filename: info}.get(key)``: stored names are '/'-normalised, last wins."""
        if "\\" in key:
            return None
        j = self._find(key, exact_only=True)
        return None if j is None else self.entry(j)

    def lower_last(self, key: str) -> Optional[P4KEntry]:
        """``{filename.lower(): info}.get(key)``: the last entry whose lower-cased name is ``key``."""
        hit = None
        for j in self._cands(key.casefold()):
            if self._name(j).lower() == key:
                hit = j
        return None if hit is None else self.entry(hit)

    def lower_first(self, key: str) -> Optional[P4KEntry]:
        """``setdefault`` map over the exact map: the first-seen name whose lower
        case is ``key.lower()``, resolved to its last entry."""
        want = key.lower()
        first = {}
        last = {}
        for j in self._cands(want.casefold()):
            n = self._name(j)
            if n.lower() == want:
                first.setdefault(n, j)
                last[n] = j
        if not first:
            return None
        return self.entry(last[min(first, key=first.__getitem__)])

    def _dds_cands(self, key: str) -> List[int]:
        """Archive-ordered indices of every ``.dds`` piece whose
        ``<lower name up to the first '.dds'>.dds`` is ``key``."""
        if self._dds_h is None:
            hs, ix = array("q"), array("i")
            for j in range(self._n):
                fn = self._name(j).lower()
                if ".dds" in fn:
                    hs.append(hash(fn.split(".dds")[0] + ".dds"))
                    ix.append(j)
            h = np.frombuffer(hs, dtype=np.int64)
            o = np.argsort(h, kind="stable")
            self._dds_h = h[o]
            self._dds_i = np.frombuffer(ix, dtype=np.int32)[o]
        h = hash(key)
        lo = int(np.searchsorted(self._dds_h, h, side="left"))
        hi = int(np.searchsorted(self._dds_h, h, side="right"))
        out = []
        for k in range(lo, hi):
            j = int(self._dds_i[k])
            fn = self._name(j).lower()
            if fn.split(".dds")[0] + ".dds" == key:
                out.append(j)
        return out

    def dds(self, key: str) -> Optional[P4KEntry]:
        """First entry (archive order) of the mip-split family ``key`` (hull3d's ``_ddsidx``)."""
        c = self._dds_cands(key)
        return self.entry(c[0]) if c else None

    def dds_parts(self, info) -> dict:
        """``scdatatools.engine.textures.dds.collect_parts`` for an entry of this
        index, without scanning the archive: ``{file name: entry}`` of the pieces."""
        from pathlib import Path

        from scdatatools.engine.textures.dds import is_glossmap

        fp = Path(info.filename)
        basename = (fp.parent / fp.stem.split(".")[0]).with_suffix(".dds").as_posix().casefold()
        parts = {}
        for j in self._dds_cands(basename.lower()):
            e = self.entry(j)
            if e.filename.casefold().startswith(basename):
                parts[Path(e.filename).name] = e
        if is_glossmap(fp):
            return {k: v for k, v in parts.items() if k.endswith("a")}
        return {k: v for k, v in parts.items() if not k.endswith("a")}

    def namelist(self) -> Sequence:
        return _NameSeq(self)

    def infolist(self) -> Sequence:
        return _InfoSeq(self)

    def __len__(self) -> int:
        return self._n

    def getinfo(self, name, case_insensitive: bool = True) -> P4KEntry:
        if isinstance(name, P4KEntry):
            return name
        j = self._find(name, exact_only=not case_insensitive)
        if j is None:
            raise KeyError("There is no item named %r in the archive" % name)
        return self.entry(j)

    def find(self, name: str) -> Optional[P4KEntry]:
        """Like :meth:`getinfo` but ``None`` instead of ``KeyError``."""
        j = self._find(name)
        return None if j is None else self.entry(j)

    # ---- reading ----------------------------------------------------------
    def open(self, name, mode: str = "r", pwd=None, *, force_zip64: bool = False):
        from scdatatools.p4k import P4KExtFile, _P4KDecrypter, _SharedFile, p4kFileHeader

        if mode.strip("b") != "r":
            raise ValueError("P4KIndex is read-only")
        zinfo = name if isinstance(name, P4KEntry) else self.getinfo(name)
        if not self.fp:
            raise ValueError("Attempt to use P4K archive that was already closed")
        with self._lock:
            self._fileRefCnt += 1
        zef_file = _SharedFile(self.fp, zinfo.header_offset, self._fpclose,
                               self._lock, lambda: False)
        try:
            fheader = zef_file.read(zipfile.sizeFileHeader)
            if len(fheader) != zipfile.sizeFileHeader:
                raise zipfile.BadZipFile("Truncated file header")
            fheader = struct.unpack(zipfile.structFileHeader, fheader)
            if (fheader[zipfile._FH_SIGNATURE] != p4kFileHeader
                    and fheader[zipfile._FH_SIGNATURE] != zipfile.stringFileHeader):
                raise zipfile.BadZipFile("Bad magic number for file header")
            fname = zef_file.read(fheader[zipfile._FH_FILENAME_LENGTH])
            if fheader[zipfile._FH_EXTRA_FIELD_LENGTH]:
                zef_file.read(fheader[zipfile._FH_EXTRA_FIELD_LENGTH])
            if zinfo.flag_bits & 0x20:
                raise NotImplementedError("compressed patched data (flag bit 5)")
            if zinfo.flag_bits & 0x40:
                raise NotImplementedError("strong encryption (flag bit 6)")
            fname_str = fname.decode("utf-8" if zinfo.flag_bits & 0x800 else "cp437")
            if fname_str != zinfo.orig_filename:
                raise zipfile.BadZipFile(
                    "File name in directory %r and header %r differ."
                    % (zinfo.orig_filename, fname))
            zd = _P4KDecrypter(self.key) if (self.key and zinfo.is_encrypted) else None
            return P4KExtFile(zef_file, mode, zinfo, zd, True)
        except BaseException:
            zef_file.close()
            raise

    def read(self, name) -> bytes:
        with self.open(name) as f:
            return f.read()

    def _fpclose(self, fp) -> None:
        with self._lock:
            self._fileRefCnt -= 1
            if not self._fileRefCnt:
                fp.close()

    def close(self) -> None:
        fp = self.fp
        if fp is None:
            return
        self.fp = None
        self._fpclose(fp)

    def __enter__(self) -> "P4KIndex":
        return self

    def __exit__(self, *exc) -> None:
        self.close()


def open_p4k(path, key: Optional[bytes] = None) -> P4KIndex:
    """Open ``Data.p4k`` as a compact index (applies the scdatatools compat shim)."""
    apply_p4k_compat()
    return P4KIndex(path, key)


class P4KNames:
    """The name maps the 3D / discovery code keeps over an archive.

    Over a :class:`P4KIndex` every lookup is answered from the packed index, so
    nothing 1.4 M entries large is built. Over any other object with
    ``infolist()`` (tests, ``P4KFile``) it builds the dicts those modules used to
    build themselves, lazily, with the same semantics.
    """

    def __init__(self, p4k) -> None:
        self._p4k = p4k
        self._ix = p4k if isinstance(p4k, P4KIndex) else None
        self._by = self._lw = self._lf = self._dd = None

    def _byname(self):
        if self._by is None:
            self._by = {i.filename.replace("\\", "/"): i for i in self._p4k.infolist()}
        return self._by

    def exact(self, key: str):
        return self._ix.exact(key) if self._ix else self._byname().get(key)

    def lower_first(self, key: str):
        """Case-insensitive fallback of ``_info`` (first-seen name wins)."""
        if self._ix:
            return self._ix.lower_first(key)
        if self._lf is None:
            self._lf = {}
            for fn, i in self._byname().items():
                self._lf.setdefault(fn.lower(), i)
        return self._lf.get(key.lower())

    def lower_last(self, key: str):
        """A dict of lower-cased, '/'-normalised names (last wins), looked up by key."""
        if self._ix:
            return self._ix.lower_last(key)
        if self._lw is None:
            self._lw = {i.filename.lower().replace("\\", "/"): i for i in self._p4k.infolist()}
        return self._lw.get(key)

    def dds(self, key: str):
        if self._ix:
            return self._ix.dds(key)
        if self._dd is None:
            self._dd = {}
            for i in self._p4k.infolist():
                fn = i.filename.lower().replace("\\", "/")
                if ".dds" in fn:
                    self._dd.setdefault(fn.split(".dds")[0] + ".dds", i)
        return self._dd.get(key)
