import argparse
import importlib
import json
import os
import re
import sys

import bpy
from mathutils import Vector


def parse_args():
    argv = sys.argv
    argv = argv[argv.index("--") + 1:] if "--" in argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True)
    parser.add_argument("--job-key", required=True)
    parser.add_argument("--nose-volume", type=float, required=True)
    parser.add_argument("--nose-width", type=float, required=True)
    parser.add_argument("--chin-prominence", type=float, required=True)
    parser.add_argument("--chin-height", type=float, required=True)
    parser.add_argument("--cupid-bow", type=float, required=True)
    parser.add_argument("--cupid-bow-width", type=float, required=True)
    return parser.parse_args(argv)


def safe_job_key(value):
    if not re.fullmatch(r"[A-Za-z0-9._-]{1,80}", value or ""):
        raise RuntimeError("Invalid MPFB detail-test job key")
    return value


def ensure_inside(root, candidate):
    root = os.path.abspath(root)
    candidate = os.path.abspath(candidate)
    if os.path.commonpath([root, candidate]) != root:
        raise RuntimeError("MPFB detail-test output escaped FREEOS root")
    return candidate


def dynamic_import(absolute_package_str, key):
    for module_name in list(sys.modules.keys()):
        if module_name.endswith(absolute_package_str):
            module = importlib.import_module(module_name)
            if hasattr(module, key):
                return getattr(module, key), module_name
    raise RuntimeError(f"No loaded MPFB module ending with {absolute_package_str} exposes {key}")


def clear_scene():
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        try:
            bpy.ops.object.mode_set(mode="OBJECT")
        except Exception:
            pass
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)


def operator_registered(namespace, name):
    try:
        operator = getattr(getattr(bpy.ops, namespace), name)
        operator.get_rna_type()
        return operator
    except Exception as exc:
        raise RuntimeError(f"Required Blender operator {namespace}.{name} is not registered: {exc}")


def load_new_human_properties():
    candidates = [
        "mpfb.ui.new_human.newhuman.newhumanpanel",
        "bl_ext.blender_org.mpfb.ui.new_human.newhuman.newhumanpanel",
    ]
    errors = []
    for module_name in candidates:
        try:
            module = importlib.import_module(module_name)
            props = getattr(module, "NEW_HUMAN_PROPERTIES", None)
            if props is not None:
                return props, module_name
        except Exception as exc:
            errors.append(f"{module_name}: {exc}")
    raise RuntimeError("Could not load MPFB NEW_HUMAN_PROPERTIES: " + " | ".join(errors))


def bounds_for_objects(objects):
    points = []
    for obj in objects:
        try:
            for corner in obj.bound_box:
                points.append(obj.matrix_world @ Vector(corner))
        except Exception:
            continue
    if not points:
        raise RuntimeError("Could not calculate character bounds")
    minimum = Vector((min(p.x for p in points), min(p.y for p in points), min(p.z for p in points)))
    maximum = Vector((max(p.x for p in points), max(p.y for p in points), max(p.z for p in points)))
    center = (minimum + maximum) * 0.5
    size = maximum - minimum
    radius = max(size.x, size.y, size.z) * 0.5
    return minimum, maximum, center, max(radius, 0.5), size


def aim_at(obj, target):
    direction = Vector(target) - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def apply_diagnostic_material(meshes):
    material = bpy.data.materials.get("FREEOS_MPFB_DetailDiagnostic")
    if material is None:
        material = bpy.data.materials.new("FREEOS_MPFB_DetailDiagnostic")
    material.use_nodes = True
    principled = material.node_tree.nodes.get("Principled BSDF") if material.node_tree else None
    if principled is not None:
        principled.inputs["Base Color"].default_value = (0.28, 0.13, 0.07, 1.0)
        principled.inputs["Roughness"].default_value = 0.52
        if "Emission Color" in principled.inputs:
            principled.inputs["Emission Color"].default_value = (0.014, 0.005, 0.003, 1.0)
        if "Emission Strength" in principled.inputs:
            principled.inputs["Emission Strength"].default_value = 0.08
    applied = 0
    for obj in meshes:
        if obj.type == "MESH" and len(obj.data.materials) == 0:
            obj.data.materials.append(material)
            applied += 1
    return material.name, applied


def add_portrait_camera_and_lights(character_objects):
    minimum, maximum, center, radius, size = bounds_for_objects(character_objects)
    head_center = Vector((center.x, center.y, maximum.z - size.z * 0.12))
    bpy.ops.object.camera_add()
    camera = bpy.context.object
    camera.name = "FREEOS_MpfbDetail_Camera"
    distance = max(size.z * 0.52, size.x * 2.6, 1.4)
    camera.location = (head_center.x, head_center.y - distance, head_center.z + size.z * 0.015)
    camera.data.lens = 72
    camera.data.clip_start = 0.01
    camera.data.clip_end = max(100.0, distance * 20.0)
    aim_at(camera, head_center)
    bpy.context.scene.camera = camera

    light_specs = [
        ("FREEOS_Detail_Key", (-radius * 0.75, -radius * 1.05, head_center.z + radius * 0.45), 900.0, max(size.x * 0.7, 0.7)),
        ("FREEOS_Detail_Fill", (radius * 0.9, -radius * 0.7, head_center.z + radius * 0.15), 480.0, max(size.x * 0.8, 0.8)),
        ("FREEOS_Detail_Rim", (0.0, radius * 0.8, head_center.z + radius * 0.65), 650.0, max(size.x * 0.65, 0.65)),
    ]
    for name, location, energy, size_value in light_specs:
        bpy.ops.object.light_add(type="AREA", location=location)
        light = bpy.context.object
        light.name = name
        light.data.energy = energy
        light.data.shape = "DISK"
        light.data.size = size_value
        aim_at(light, head_center)


def render_and_verify(path):
    scene = bpy.context.scene
    scene.render.resolution_x = 720
    scene.render.resolution_y = 720
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = path
    try:
        scene.render.engine = "BLENDER_EEVEE_NEXT"
    except Exception:
        pass
    if scene.world is None:
        scene.world = bpy.data.worlds.new("FREEOS_MPFB_DetailWorld")
    scene.world.color = (0.045, 0.045, 0.06)
    try:
        scene.view_settings.look = "AgX - Medium High Contrast"
    except Exception:
        pass
    bpy.ops.render.render(write_still=True)
    if not os.path.isfile(path) or os.path.getsize(path) < 2048:
        raise RuntimeError("MPFB detail-test render was not created")

    image = bpy.data.images.load(path, check_existing=False)
    try:
        pixels = image.pixels
        total_pixels = max(1, len(pixels) // 4)
        stride = max(1, total_pixels // 1024)
        values = []
        for index in range(0, total_pixels, stride):
            offset = index * 4
            if offset + 2 >= len(pixels):
                break
            r, g, b = pixels[offset], pixels[offset + 1], pixels[offset + 2]
            values.append(0.2126 * r + 0.7152 * g + 0.0722 * b)
            if len(values) >= 1024:
                break
        if not values or max(values) - min(values) < 0.02 or max(values) < 0.08:
            raise RuntimeError("MPFB detail-test render is not useful diagnostic evidence")
    finally:
        bpy.data.images.remove(image)


def main():
    args = parse_args()
    values = {
        "noseVolume": args.nose_volume,
        "noseWidth": args.nose_width,
        "chinProminence": args.chin_prominence,
        "chinHeight": args.chin_height,
        "cupidBow": args.cupid_bow,
        "cupidBowWidth": args.cupid_bow_width,
    }
    for name, value in values.items():
        if not -1.0 <= value <= 1.0:
            raise RuntimeError(f"{name} must be between -1 and 1")

    root = os.path.abspath(args.root)
    job_key = safe_job_key(args.job_key)
    job_dir = ensure_inside(root, os.path.join(root, "generated", "operators", "blender", "mpfb-detail", job_key))
    os.makedirs(job_dir, exist_ok=True)

    props, props_module = load_new_human_properties()
    scene = bpy.context.scene
    phenotype_values = {
        "add_phenotype": True,
        "add_breast": False,
        "phenotype_gender": "male",
        "phenotype_age": "young",
        "phenotype_muscle": "averagemuscle",
        "phenotype_weight": "averageweight",
        "phenotype_height": "average",
        "phenotype_proportions": "max",
        "phenotype_race": "universal",
        "phenotype_influence": 0.8,
        "scale_factor": "METER",
        "detailed_helpers": True,
        "extra_vertex_groups": True,
        "mask_helpers": True,
        "preselect_group": "body",
    }
    for name, value in phenotype_values.items():
        props.set_value(name, value, entity_reference=scene)

    create_human = operator_registered("mpfb", "create_human")
    clear_scene()
    result = create_human()
    if "FINISHED" not in set(result):
        raise RuntimeError(f"mpfb.create_human did not finish successfully: {result}")

    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        try:
            bpy.ops.object.mode_set(mode="OBJECT")
        except Exception:
            pass

    meshes = [obj for obj in bpy.data.objects if obj.type == "MESH"]
    if not meshes:
        raise RuntimeError("MPFB detail base creation produced no mesh")
    basemesh = max(meshes, key=lambda obj: len(obj.data.vertices))
    if len(basemesh.data.vertices) < 1000 or len(basemesh.data.polygons) < 1000:
        raise RuntimeError("MPFB detail result did not meet minimum mesh evidence")

    TargetService, target_service_module = dynamic_import("mpfb.services.targetservice", "TargetService")
    LocationService, location_service_module = dynamic_import("mpfb.services.locationservice", "LocationService")
    targets_root = LocationService.get_mpfb_data("targets")

    mapping = {
        "noseVolume": ("nose/nose-volume-decr.target.gz", "nose/nose-volume-incr.target.gz"),
        "noseWidth": ("nose/nose-scale-horiz-decr.target.gz", "nose/nose-scale-horiz-incr.target.gz"),
        "chinProminence": ("chin/chin-prominent-decr.target.gz", "chin/chin-prominent-incr.target.gz"),
        "chinHeight": ("chin/chin-height-decr.target.gz", "chin/chin-height-incr.target.gz"),
        "cupidBow": ("mouth/mouth-cupidsbow-decr.target.gz", "mouth/mouth-cupidsbow-incr.target.gz"),
        "cupidBowWidth": ("mouth/mouth-cupidsbow-width-decr.target.gz", "mouth/mouth-cupidsbow-width-incr.target.gz"),
    }

    applied_targets = []
    for control, value in values.items():
        if abs(value) < 0.0001:
            continue
        negative_path, positive_path = mapping[control]
        relative_path = positive_path if value > 0 else negative_path
        target_path = os.path.join(targets_root, *relative_path.split("/"))
        if not os.path.isfile(target_path):
            raise RuntimeError(f"MPFB built-in target is missing for {control}: {relative_path}")
        TargetService.load_target(basemesh, target_path, weight=abs(value))
        applied_targets.append({"control": control, "value": value, "target": relative_path})

    bpy.context.view_layer.update()
    shape_keys = basemesh.data.shape_keys
    active_detail_shape_keys = []
    if shape_keys:
        for key in shape_keys.key_blocks:
            if key.name == "Basis" or key.name.startswith("$md-"):
                continue
            if abs(float(key.value)) > 0.0001:
                active_detail_shape_keys.append({"name": key.name, "value": round(float(key.value), 6)})
    if not applied_targets or not active_detail_shape_keys:
        raise RuntimeError("MPFB detail controls produced no active non-macro target evidence")

    source_material_count = len(basemesh.data.materials)
    diagnostic_material, diagnostic_applied = apply_diagnostic_material(meshes)
    add_portrait_camera_and_lights(meshes)

    render_path = ensure_inside(root, os.path.join(job_dir, "mpfb_detail_preview.png"))
    blend_path = ensure_inside(root, os.path.join(job_dir, "mpfb_detail.blend"))
    manifest_path = ensure_inside(root, os.path.join(job_dir, "manifest.json"))

    render_and_verify(render_path)
    bpy.ops.wm.save_as_mainfile(filepath=blend_path)

    manifest = {
        "ok": True,
        "jobKey": job_key,
        "adapter": "mpfb-detail-targets-v1",
        "operator": "mpfb.create_human+TargetService.load_target",
        "detailTargetsVerified": True,
        "renderVerified": True,
        "propertyModule": props_module,
        "targetServiceModule": target_service_module,
        "locationServiceModule": location_service_module,
        "requestedControls": values,
        "appliedTargets": applied_targets,
        "blendFile": os.path.relpath(blend_path, root).replace("\\", "/"),
        "renderFile": os.path.relpath(render_path, root).replace("\\", "/"),
        "basemesh": basemesh.name,
        "vertexCount": len(basemesh.data.vertices),
        "polygonCount": len(basemesh.data.polygons),
        "shapeKeyCount": len(shape_keys.key_blocks) if shape_keys else 0,
        "activeDetailShapeKeys": active_detail_shape_keys,
        "materialCount": source_material_count,
        "diagnosticMaterial": diagnostic_material,
        "diagnosticMaterialAppliedCount": diagnostic_applied,
    }
    with open(manifest_path, "w", encoding="utf-8") as handle:
        json.dump(manifest, handle, indent=2)
        handle.flush()
        os.fsync(handle.fileno())
    print("FREEOS_MPFB_DETAIL_RESULT=" + json.dumps(manifest, separators=(",", ":")), flush=True)


if __name__ == "__main__":
    main()
