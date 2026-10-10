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


def safe_poll(operator):
    try:
        return bool(operator.poll())
    except Exception:
        return False


def discover_operator_ids():
    """Read-only discovery of registered bpy operators relevant to detected production addons."""
    keywords = {
        "MPFB / MakeHuman": ("mpfb", "makehuman"),
        "KeenTools": ("keentools", "facebuilder", "geotracker", "facetracker"),
        "Rigify": ("rigify",),
        "Node Wrangler": ("node_wrangler", "nodewrangler"),
    }
    found = {label: [] for label in keywords}

    try:
        namespaces = [name for name in dir(bpy.ops) if name and not name.startswith("_")]
    except Exception:
        namespaces = []

    for namespace_name in namespaces:
        try:
            namespace = getattr(bpy.ops, namespace_name)
            operation_names = [name for name in dir(namespace) if name and not name.startswith("_")]
        except Exception:
            continue
        for operation_name in operation_names:
            operator_id = f"{namespace_name}.{operation_name}"
            lowered = operator_id.lower()
            for label, needles in keywords.items():
                if any(needle in lowered for needle in needles):
                    if len(found[label]) < 120:
                        found[label].append(operator_id)

    # MPFB uses its own bpy.ops.mpfb namespace, so preserve a useful focused subset even
    # when Blender's dynamic dir() implementation does not enumerate every operator.
    mpfb_focus = [
        "create_human",
        "human_from_presets",
        "human_from_mhm",
        "refit_human",
        "load_library_clothes",
        "load_library_material",
        "load_library_skin",
    ]
    mpfb_details = []
    try:
        namespace = getattr(bpy.ops, "mpfb")
        for name in mpfb_focus:
            try:
                operator = getattr(namespace, name)
                operator.get_rna_type()
                operator_id = f"mpfb.{name}"
                if operator_id not in found["MPFB / MakeHuman"]:
                    found["MPFB / MakeHuman"].append(operator_id)
                mpfb_details.append({"id": operator_id, "registered": True, "pollNow": safe_poll(operator)})
            except Exception:
                mpfb_details.append({"id": f"mpfb.{name}", "registered": False, "pollNow": False})
    except Exception:
        mpfb_details = [{"id": f"mpfb.{name}", "registered": False, "pollNow": False} for name in mpfb_focus]

    return {
        "byCapability": {label: sorted(values) for label, values in found.items() if values},
        "mpfbFocusedOperators": mpfb_details,
    }


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

    operator_discovery = discover_operator_ids()
    payload = {
        "blenderVersion": bpy.app.version_string,
        "pythonVersion": sys.version.split()[0],
        "enabledAddonModules": sorted(enabled),
        "addons": sorted(addons, key=lambda item: (not bool(item.get("enabled")), item.get("name", "").lower())),
        "capabilitySignals": signals,
        "operatorDiscovery": operator_discovery,
    }
    print("FREEOS_OPERATOR_INVENTORY=" + json.dumps(payload, separators=(",", ":")))


if __name__ == "__main__":
    main()
