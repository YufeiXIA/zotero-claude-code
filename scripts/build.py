"""Package the add-on.

    python scripts/build.py

Writes build/zotero-claude-code-<version>.xpi and build/update.json.
Attach both files to the GitHub release tagged v<version>; Zotero checks
update.json (see update_url in addon/manifest.json) for new versions.
"""
import json
import pathlib
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
ADDON = ROOT / "addon"
BUILD = ROOT / "build"
REPO = "YufeiXIA/zotero-claude-code"


def main():
    manifest = json.loads((ADDON / "manifest.json").read_text(encoding="utf-8"))
    version = manifest["version"]
    addon_id = manifest["applications"]["zotero"]["id"]
    BUILD.mkdir(exist_ok=True)

    xpi_name = f"zotero-claude-code-{version}.xpi"
    xpi = BUILD / xpi_name
    files = sorted(p for p in ADDON.rglob("*") if p.is_file())
    with zipfile.ZipFile(xpi, "w", zipfile.ZIP_DEFLATED) as zf:
        for path in files:
            zf.write(path, path.relative_to(ADDON).as_posix())

    update = {
        "addons": {
            addon_id: {
                "updates": [{
                    "version": version,
                    "update_link": f"https://github.com/{REPO}/releases/download/v{version}/{xpi_name}",
                    "applications": {"zotero": {"strict_min_version": manifest["applications"]["zotero"]["strict_min_version"]}},
                }]
            }
        }
    }
    (BUILD / "update.json").write_text(json.dumps(update, indent=2) + "\n", encoding="utf-8")
    print(f"{xpi} ({len(files)} files, {xpi.stat().st_size // 1024} KB)")
    print(BUILD / "update.json")


if __name__ == "__main__":
    main()
