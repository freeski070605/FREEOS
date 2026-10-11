import importlib
import os
import sys

import bpy


def _operator_ready():
    try:
        bpy.ops.mpfb.create_human.get_rna_type()
        return True
    except Exception:
        return False


def _enable(module_name):
    errors = []
    try:
        result = bpy.ops.preferences.addon_enable(module=module_name)
        if "FINISHED" in set(result) and _operator_ready():
            return True, errors
        errors.append(f"preferences.addon_enable returned {result}")
    except Exception as exc:
        errors.append(f"preferences.addon_enable: {exc}")

    try:
        import addon_utils
        addon_utils.enable(module_name, default_set=False, persistent=False)
        if _operator_ready():
            return True, errors
        errors.append("addon_utils.enable completed but mpfb.create_human is unavailable")
    except Exception as exc:
        errors.append(f"addon_utils.enable: {exc}")
    return False, errors


def main():
    runtime_home = os.environ.get("FREEOS_MPFB_USER_HOME", "").strip()
    if not runtime_home:
        raise RuntimeError("FREEOS_MPFB_USER_HOME is required")
    os.makedirs(runtime_home, exist_ok=True)

    # MPFB derives its log/config root from bpy.utils.resource_path('USER')
    # during module import. Redirect only that lookup while MPFB registers so
    # governed background jobs never depend on a constrained Windows C: drive.
    original_resource_path = bpy.utils.resource_path

    def redirected_resource_path(resource_type, *args, **kwargs):
        if resource_type == "USER":
            return runtime_home
        return original_resource_path(resource_type, *args, **kwargs)

    bpy.utils.resource_path = redirected_resource_path
    errors = []
    try:
        if _operator_ready():
            print("FREEOS_MPFB_BOOTSTRAP=already-ready", flush=True)
            return

        for module_name in ("bl_ext.blender_org.mpfb", "mpfb"):
            ok, attempt_errors = _enable(module_name)
            errors.extend(f"{module_name}: {item}" for item in attempt_errors)
            if ok:
                print(f"FREEOS_MPFB_BOOTSTRAP={module_name}", flush=True)
                return

        # Factory startup may not expose the extension repository as a Python
        # package. Add only the known installed Blender extension parent and
        # retry MPFB as a direct package; no arbitrary paths are accepted.
        appdata = os.environ.get("APPDATA", "")
        major_minor = f"{bpy.app.version[0]}.{bpy.app.version[1]}"
        extension_parent = os.path.join(
            appdata,
            "Blender Foundation",
            "Blender",
            major_minor,
            "extensions",
            "blender_org",
        )
        mpfb_dir = os.path.join(extension_parent, "mpfb")
        if appdata and os.path.isdir(mpfb_dir):
            if extension_parent not in sys.path:
                sys.path.insert(0, extension_parent)
            importlib.invalidate_caches()
            ok, attempt_errors = _enable("mpfb")
            errors.extend(f"direct-mpfb: {item}" for item in attempt_errors)
            if ok:
                print("FREEOS_MPFB_BOOTSTRAP=direct-mpfb", flush=True)
                return
        else:
            errors.append(f"installed MPFB path not found: {mpfb_dir}")
    finally:
        bpy.utils.resource_path = original_resource_path

    raise RuntimeError("Could not bootstrap MPFB in isolated Blender startup: " + " | ".join(errors))


if __name__ == "__main__":
    main()
