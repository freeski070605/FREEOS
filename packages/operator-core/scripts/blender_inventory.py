import json
import sys

import bpy

try:
    import addon_utils
except Exception:
    addon_utils = None


def safe_version(value):
    if isinstance(value, (list, tuple)):
        return ".".join(str(part) for part in value)
    return str(value or "")


def main():
    enabled = set()
    try:
        enabled = set(bpy.context.preferences.addons.keys())
    except Exception:
        pass

    addons = []
    if addon_utils is not None:
        try:
            for module in addon_utils.modules(refresh=False):
                module_name = getattr(module, "__name__", "")
                info = getattr(module, "bl_info", {}) or {}
                addons.append({
                    "module": module_name,
                    "name": str(info.get("name") or module_name),
                    "version": safe_version(info.get("version")),
                    "category": str(info.get("category") or ""),
                    "enabled": module_name in enabled,
                })
        except Exception:
            pass

    for module_name in sorted(enabled):
        if not any(item.get("module") == module_name for item in addons):
            addons.append({
                "module": module_name,
                "name": module_name,
                "version": "",
                "category": "",
                "enabled": True,
            })

    signals = []
    searchable = " ".join(
        f"{item.get('module', '')} {item.get('name', '')}".lower()
        for item in addons
    )
    known = {
        "mpfb": "MPFB / MakeHuman",
        "makehuman": "MPFB / MakeHuman",
        "keentools": "KeenTools",
        "rigify": "Rigify",
        "node_wrangler": "Node Wrangler",
    }
    for needle, label in known.items():
        if needle in searchable and label not in signals:
            signals.append(label)

    payload = {
        "blenderVersion": bpy.app.version_string,
        "pythonVersion": sys.version.split()[0],
        "enabledAddonModules": sorted(enabled),
        "addons": sorted(addons, key=lambda item: (not bool(item.get("enabled")), item.get("name", "").lower())),
        "capabilitySignals": signals,
    }
    print("FREEOS_OPERATOR_INVENTORY=" + json.dumps(payload, separators=(",", ":")))


if __name__ == "__main__":
    main()
