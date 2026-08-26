#!/usr/bin/env python3
"""Rewrite one ZIP/JAR with sorted, deterministic, loader-safe metadata."""

from __future__ import annotations

import os
import stat
import sys
import zipfile
from pathlib import Path, PurePosixPath


FIXED_TIMESTAMP = (2000, 1, 1, 0, 0, 0)
FIXED_CLASS_TIMESTAMP = (2000, 1, 1, 0, 0, 2)
MANIFEST_PATH = "META-INF/MANIFEST.MF"
EXECUTABLE_PATHS = {"bootstrap"}


def validate_name(name: str) -> None:
    parts = PurePosixPath(name).parts
    if (
        not name
        or "\\" in name
        or name.startswith("/")
        or any(part in {"", ".", ".."} for part in parts)
    ):
        raise ValueError(f"archive contains unsafe entry name: {name!r}")


def normalized_mode(name: str, original: zipfile.ZipInfo) -> int:
    source_mode = (original.external_attr >> 16) & 0xFFFF
    if stat.S_ISLNK(source_mode):
        raise ValueError(f"archive contains forbidden symlink: {name}")
    if original.is_dir():
        return 0o40755
    return 0o100755 if name in EXECUTABLE_PATHS else 0o100644


def normalized_timestamp(name: str) -> tuple[int, int, int, int, int, int]:
    # Clojure only loads an AOT namespace when its __init.class resource is
    # strictly newer than the corresponding .clj/.cljc source. Equal ZIP
    # timestamps force dynamic recompilation and can split generated protocol
    # and proxy classes across classloaders. ZIP timestamps have two-second
    # resolution, so keep every class at one deterministic tick after sources.
    return FIXED_CLASS_TIMESTAMP if name.endswith(".class") else FIXED_TIMESTAMP


def normalized_contents(name: str, contents: bytes) -> bytes:
    if name != MANIFEST_PATH:
        return contents
    # tools.build records the host JDK feature version even though javac uses
    # --release. It is environmental metadata, not an artifact input.
    lines = contents.decode("utf-8").replace("\r\n", "\n").splitlines()
    kept = [line for line in lines if not line.startswith("Build-Jdk-Spec:")]
    while kept and not kept[-1]:
        kept.pop()
    return ("\r\n".join(kept) + "\r\n\r\n").encode("utf-8")


def normalize(archive_path: Path, stored: bool = False) -> None:
    temporary = archive_path.with_suffix(f"{archive_path.suffix}.normalized")
    try:
        with zipfile.ZipFile(archive_path, "r") as source, zipfile.ZipFile(
            temporary,
            "w",
            compression=zipfile.ZIP_DEFLATED,
            compresslevel=9,
            strict_timestamps=True,
        ) as target:
            names = sorted(source.namelist())
            if len(names) != len(set(names)):
                raise ValueError("archive contains duplicate entry names")
            for name in names:
                original = source.getinfo(name)
                validate_name(name)
                info = zipfile.ZipInfo(name, normalized_timestamp(name))
                info.compress_type = (
                    zipfile.ZIP_STORED
                    if stored or original.is_dir()
                    else zipfile.ZIP_DEFLATED
                )
                info.create_system = 3
                info.external_attr = normalized_mode(name, original) << 16
                info.flag_bits = 0x800
                target.writestr(info, normalized_contents(name, source.read(name)))
        os.replace(temporary, archive_path)
    finally:
        temporary.unlink(missing_ok=True)


def main() -> int:
    arguments = sys.argv[1:]
    stored = False
    if arguments[:1] == ["--stored"]:
        stored = True
        arguments = arguments[1:]
    if len(arguments) != 1:
        print("usage: normalize-zip.py [--stored] ARCHIVE", file=sys.stderr)
        return 64
    archive_path = Path(arguments[0]).resolve(strict=True)
    normalize(archive_path, stored=stored)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
