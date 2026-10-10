import argparse
import json
import math
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
    return parser.parse_args(argv)


def safe_job_key(value):
    if not re.fullmatch(r"[A-Za-z0-9._-]{1,80}", value or ""):
        raise RuntimeError("Invalid MPFB smoke-test job key")
    return value


def ensure_inside(root, candidate):
    root = os.path.abspath(root)
    candidate = os.path.abspath(candidate)
    if os.path.commonpath([root, candidate]) != root:
        raise RuntimeError("MPFB smoke-test output escaped FREEOS root")
    return candidate


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
    return center, max(radius, 0.5), size


def aim_at(obj, target):
    direction = Vector(target) - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def apply_diagnostic_material(meshes):
    material = bpy.data.materials.get("FREEOS_MPFB_Diagnostic")
    if material is None:
        material = bpy.data.materials.new("FREEOS_MPFB_Diagnostic")
    material.use_nodes = True
    principled = material.node_tree.nodes.get("Principled BSDF") if material.node_tree else None
    if principled is not None:
        principled.inputs["Base Color"].default_value = (0.34, 0.18, 0.10, 1.0)
        principled.inputs["Roughness"].default_value = 0.58
        if "Emission Color" in principled.inputs:
            principled.inputs["Emission Color"].default_value = (0.028, 0.012, 0.006, 1.0)
        if "Emission Strength" in principled.inputs:
            principled.inputs["Emission Strength"].default_value = 0.16

    applied = 0
    for obj in meshes:
        if obj.type != "MESH":
            continue
        if len(obj.data.materials) == 0:
            obj.data.materials.append(material)
            applied += 1
    return material.name, applied


def add_camera_and_lights(character_objects):
    center, radius, size = bounds_for_objects(character_objects)
    bpy.ops.object.camera_add()
    camera = bpy.context.object
    camera.name = "FREEOS_MpfbSmoke_Camera"
    distance = max(radius * 3.1, size.z * 1.55, 5.5)
    camera.location = (center.x, center.y - distance, center.z + size.z * 0.03)
    camera.data.lens = 60
    camera.data.clip_start = 0.01
    camera.data.clip_end = max(100.0, distance * 10.0)
    aim_at(camera, center)
    bpy.context.scene.camera = camera

    light_specs = [
        ("FREEOS_Key", (-radius * 2.0, -radius * 2.2, center.z + radius * 2.2), 1800.0, radius * 1.8),
        ("FREEOS_Fill", (radius * 2.0, -radius * 1.2, center.z + radius * 1.0), 1050.0, radius * 1.6),
        ("FREEOS_Rim", (0.0, radius * 2.2, center.z + radius * 2.0), 1200.0, radius * 1.4),
    ]
    for name, location, energy, size_value in light_specs:
        bpy.ops.object.light_add(type="AREA", location=location)
        light = bpy.context.object
        light.name = name
        light.data.energy = energy
        light.data.shape = "DISK"
        light.data.size = max(size_value, 1.0)
        aim_at(light, center)


def render_and_verify(path):
    scene = bpy.context.scene
    scene.render.resolution_x = 640
    scene.render.resolution_y = 900
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = path
    try:
        scene.render.engine = "BLENDER_EEVEE_NEXT"
    except Exception:
        pass
    if scene.world is None:
        scene.world = bpy.data.worlds.new("FREEOS_MPFB_World")
    scene.world.color = (0.055, 0.055, 0.070)
    try:
        scene.view_settings.look = "AgX - Medium High Contrast"
    except Exception:
        pass
    bpy.ops.render.render(write_still=True)
    if not os.path.isfile(path) or os.path.getsize(path) < 2048:
        raise RuntimeError("MPFB smoke-test render was not created")

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
        if not values or max(values) - min(values) < 0.02:
            raise RuntimeError("MPFB smoke-test render appears blank or nearly uniform")
        if max(values) < 0.08:
            raise RuntimeError("MPFB smoke-test render is too dark to serve as useful diagnostic evidence")
    finally:
        bpy.data.images.remove(image)


def main():
    args = parse_args()
    root = os.path.abspath(args.root)
    job_key = safe_job_key(args.job_key)
    job_dir = ensure_inside(root, os.path.join(root, "generated", "operators", "blender", "mpfb-smoke", job_key))
    os.makedirs(job_dir, exist_ok=True)

    create_human = operator_registered("mpfb", "create_human")
    clear_scene()
    before = {obj.name for obj in bpy.data.objects}
    result = create_human()
    if "FINISHED" not in set(result):
        raise RuntimeError(f"mpfb.create_human did not finish successfully: {result}")

    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        try:
            bpy.ops.object.mode_set(mode="OBJECT")
        except Exception:
            pass

    created = [obj for obj in bpy.data.objects if obj.name not in before]
    meshes = [obj for obj in created if obj.type == "MESH"]
    if not meshes:
        meshes = [obj for obj in bpy.data.objects if obj.type == "MESH"]
    if not meshes:
        raise RuntimeError("MPFB create_human finished but no mesh object was found")

    basemesh = max(meshes, key=lambda obj: len(obj.data.vertices))
    vertex_count = len(basemesh.data.vertices)
    polygon_count = len(basemesh.data.polygons)
    if vertex_count < 1000 or polygon_count < 1000:
        raise RuntimeError(f"MPFB base human did not meet minimum mesh evidence: {vertex_count} vertices / {polygon_count} polygons")

    shape_keys = basemesh.data.shape_keys
    shape_key_count = len(shape_keys.key_blocks) if shape_keys else 0
    source_material_count = len(basemesh.data.materials)
    diagnostic_material_name, diagnostic_material_applied_count = apply_diagnostic_material(meshes)

    add_camera_and_lights(meshes)
    render_path = ensure_inside(root, os.path.join(job_dir, "mpfb_base_preview.png"))
    blend_path = ensure_inside(root, os.path.join(job_dir, "mpfb_base.blend"))
    manifest_path = ensure_inside(root, os.path.join(job_dir, "manifest.json"))

    render_and_verify(render_path)
    bpy.ops.wm.save_as_mainfile(filepath=blend_path)

    manifest = {
        "ok": True,
        "jobKey": job_key,
        "adapter": "mpfb-base-smoke-v2",
        "operator": "mpfb.create_human",
        "baseHumanVerified": True,
        "renderVerified": True,
        "blendFile": os.path.relpath(blend_path, root).replace("\\", "/"),
        "renderFile": os.path.relpath(render_path, root).replace("\\", "/"),
        "basemesh": basemesh.name,
        "vertexCount": vertex_count,
        "polygonCount": polygon_count,
        "shapeKeyCount": shape_key_count,
        "materialCount": source_material_count,
        "diagnosticMaterial": diagnostic_material_name,
        "diagnosticMaterialAppliedCount": diagnostic_material_applied_count,
        "createdObjectCount": len(created),
    }
    with open(manifest_path, "w", encoding="utf-8") as handle:
        json.dump(manifest, handle, indent=2)
        handle.flush()
        os.fsync(handle.fileno())
    print("FREEOS_MPFB_SMOKE_RESULT=" + json.dumps(manifest, separators=(",", ":")), flush=True)


if __name__ == "__main__":
    main()
