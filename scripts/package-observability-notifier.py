#!/usr/bin/env python3
"""Build the notifier ZIP with stable path, timestamp, mode, and compression."""

import hashlib
import json
import pathlib
import zipfile


ROOT = pathlib.Path(__file__).resolve().parents[1]
SOURCE = ROOT / "infra" / "observability" / "notifier" / "index.py"
OUTPUT = ROOT / "dist" / "infra" / "observability" / "notifier.zip"


def main():
    payload = SOURCE.read_bytes()
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    info = zipfile.ZipInfo("index.py", date_time=(1980, 1, 1, 0, 0, 0))
    info.compress_type = zipfile.ZIP_DEFLATED
    info.external_attr = 0o100644 << 16
    with zipfile.ZipFile(OUTPUT, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(info, payload, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
    artifact = OUTPUT.read_bytes()
    print(
        json.dumps(
            {
                "path": str(OUTPUT.relative_to(ROOT)),
                "sha256": hashlib.sha256(artifact).hexdigest(),
                "size": len(artifact),
            },
            separators=(",", ":"),
        )
    )


if __name__ == "__main__":
    main()
