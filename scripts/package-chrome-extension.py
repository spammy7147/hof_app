import json
import re
import sys
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile


def package_extension(source: Path, output: Path, version: str):
    if not re.fullmatch(r"\d+(\.\d+){0,3}", version) or any(int(part) > 65535 for part in version.split(".")):
        raise ValueError("Chrome extension version must contain up to four integers between 0 and 65535")
    manifest = json.loads((source / "manifest.json").read_text())
    manifest["version"] = version
    for name in (manifest["background"]["service_worker"], manifest["side_panel"]["default_path"]):
        if not (source / name).is_file():
            raise ValueError(f"Missing extension entry point: {name}")
    for name in re.findall(r'<script[^>]+src="([^"]+)"', (source / "index.html").read_text()):
        if not (source / name.lstrip("/")).is_file():
            raise ValueError(f"Missing extension script: {name}")

    # Explicit export roots keep retained APKs and previous ZIPs out of the extension.
    roots = [source / name for name in ("index.html", "service-worker.js", "favicon.ico", "metadata.json", "assets", "expo")]
    output.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(output, "w", ZIP_DEFLATED, compresslevel=9) as archive:
        archive.writestr("HOF_Chrome_Extension/manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
        for root in roots:
            for path in sorted(root.rglob("*")) if root.is_dir() else [root]:
                if path.is_file():
                    archive.write(path, Path("HOF_Chrome_Extension") / path.relative_to(source))
    with ZipFile(output) as archive:
        if archive.testzip() is not None:
            raise ValueError("Extension ZIP integrity check failed")
    print(f"Packaged Chrome extension {version}: {output} ({output.stat().st_size} bytes)")


if __name__ == "__main__":
    package_extension(Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3])
