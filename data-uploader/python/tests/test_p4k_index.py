"""The compact P4K index must answer exactly like ``scdatatools.p4k.P4KFile``."""

from __future__ import annotations

import struct
import zipfile

import pytest

zstd = pytest.importorskip("zstandard")
pytest.importorskip("numpy")
scd = pytest.importorskip("scdatatools.p4k")
from Crypto.Cipher import AES  # noqa: E402

from sc_extract.p4k_compat import apply_p4k_compat  # noqa: E402
from sc_extract.p4k_index import open_p4k  # noqa: E402

# (name, payload, encrypted)
ENTRIES = [
    ("Data/Game2.dcb", b"DCB" * 40_000, False),
    ("Data/Objects/Ships/ANVL/Carrack/ANVL_Carrack.cga", bytes(range(256)) * 500, False),
    (r"Data\Objects\backslash\Thing.MTL", b"<Material/>", False),
    ("Data/Textures/Pic.dds.1", b"\x00\x01" * 4096, False),
    ("Data/Localization/English/global.ini", b"a=b\n" * 300, True),
    ("Data/Empty.txt", b"", False),
    ("Data/Dup/Same.txt", b"first", False),
    ("Data/Dup/Same.txt", b"second", False),
    ("Data/Dup/CASE.txt", b"upper", False),
    ("Data/Dup/case.txt", b"lower", False),
    ("Data/Ünï/cödé.xml", b"<x/>", False),
]


def _build(path) -> None:
    out, cd = bytearray(), bytearray()
    cipher_key = scd.DEFAULT_P4K_KEY
    for name, payload, enc in ENTRIES:
        raw = name.encode("utf-8")
        data = zstd.ZstdCompressor().compress(payload)
        if enc:
            data += b"\x00" * (-len(data) % 16)
            data = AES.new(cipher_key, AES.MODE_CBC, b"\x00" * 16).encrypt(data)
        hoff = len(out)
        out += struct.pack("<4sHHHHHLLLHH", b"PK\x03\x04", 45, 0x800, 100, 0, 0, 0,
                           len(data), len(payload), len(raw), 0) + raw + data
        # SC style: sizes/offset in a ZIP64 record at the front of a 206-byte blob
        extra = bytearray(206)
        extra[0:36] = struct.pack("<HHQQQQ", 1, 32, len(payload), len(data), hoff, 0)
        extra[168] = 1 if enc else 0
        cd += struct.pack(zipfile.structCentralDir, b"PK", 45, 0, 45, 0, 0x800, 100,
                          0, 0, 0, 0xFFFFFFFF, 0xFFFFFFFF, len(raw), len(extra), 0, 0, 0, 0,
                          0xFFFFFFFF) + raw + bytes(extra)
    cd_off = len(out)
    out += cd
    out += struct.pack("<4sHHHHLLH", b"PK\x05\x06", 0, 0, len(ENTRIES), len(ENTRIES),
                       len(cd), cd_off, 0)
    path.write_bytes(bytes(out))


@pytest.fixture(scope="module")
def pair(tmp_path_factory):
    apply_p4k_compat()
    path = tmp_path_factory.mktemp("p4k") / "Data.p4k"
    _build(path)
    ref, idx = scd.P4KFile(str(path)), open_p4k(path)
    yield ref, idx
    ref.close()
    idx.close()


def test_namelist_matches(pair):
    ref, idx = pair
    assert list(idx.namelist()) == ref.namelist()
    assert len(idx.namelist()) == len(ref.namelist()) == len(ENTRIES)
    assert idx.namelist()[2] == "Data/Objects/backslash/Thing.MTL"
    assert "Data/Game2.dcb" in idx.namelist()
    assert "data/game2.dcb" not in idx.namelist()


def test_infolist_fields_match(pair):
    ref, idx = pair
    for a, b in zip(ref.infolist(), idx.infolist()):
        assert (a.filename, a.orig_filename, a.file_size, a.compress_size, a.compress_type,
                a.flag_bits, a.is_encrypted, a.header_offset) == (
                b.filename, b.orig_filename, b.file_size, b.compress_size, b.compress_type,
                b.flag_bits, b.is_encrypted, b.header_offset)


@pytest.mark.parametrize("name", [e[0] for e in ENTRIES])
def test_read_is_byte_identical(pair, name):
    ref, idx = pair
    assert idx.open(idx.getinfo(name)).read() == ref.open(ref.getinfo(name)).read()
    assert idx.open(name).read() == ref.open(name).read()


def test_payloads_roundtrip(pair):
    _, idx = pair
    for name, payload, _enc in ENTRIES:
        if name.startswith("Data/Dup/Same") or name.endswith("CASE.txt") or name.endswith("case.txt"):
            continue
        assert idx.read(name) == payload
    assert idx.getinfo("Data/Localization/English/global.ini").is_encrypted


@pytest.mark.parametrize("query", [
    "Data/Game2.dcb", "data/game2.dcb", r"DATA\GAME2.DCB", "Data/Objects/backslash/thing.mtl",
    "Data/Dup/Same.txt", "data/dup/same.txt", "Data/Dup/CASE.txt", "Data/Dup/case.txt",
    "DATA/DUP/Case.TXT", "Data/Ünï/cödé.xml", "DATA/ÜNÏ/CÖDÉ.XML",
])
def test_lookup_matches_scdatatools(pair, query):
    ref, idx = pair
    assert idx.getinfo(query).filename == ref.getinfo(query).filename
    assert idx.getinfo(query).header_offset == ref.getinfo(query).header_offset


def test_missing_name(pair):
    ref, idx = pair
    with pytest.raises(KeyError):
        idx.getinfo("Data/nope.txt")
    assert idx.find("Data/nope.txt") is None
    with pytest.raises(KeyError):
        idx.getinfo("data/game2.dcb", case_insensitive=False)
    assert idx.find("data/game2.dcb").filename == "Data/Game2.dcb"


def test_bad_archive(tmp_path):
    p = tmp_path / "x.p4k"
    p.write_bytes(b"not a zip")
    with pytest.raises(zipfile.BadZipFile):
        open_p4k(p)
