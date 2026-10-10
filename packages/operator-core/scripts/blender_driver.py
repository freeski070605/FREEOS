import argparse
import json
import math
import os
import re
import sys

import bpy

JOB_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,79}$")
NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 _.-]{0,79}$")
FILE_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$")


def fail(message):
    raise RuntimeError(message)


def vector(value, length, label, minimum=None, maximum=None):
    if not isinstance(value, list) or len(value) != length:
        fail(f"{label} must contain {length} numbers")
    result = []
    for item in value:
        if not isinstance(item, (int, float)) or not math.isfinite(float(item)):
            fail(f"{label} contains an invalid number")
        number = float(item)
        if minimum is not None and number < minimum:
            fail(f"{label} is below the allowed range")
        if maximum is not None and number > maximum:
            fail(f"{label} is above the allowed range")
        result.append(number)
    return result


def safe_name(value, label):
    if not isinstance(value, str) or not NAME_RE.fullmatch(value):
        fail(f"Invalid {label}")
    return value


def safe_filename(value, label):
    if not isinstance(value, str) or not FILE_RE.fullmatch(value) or value in (".", ".."):
        fail(f"Invalid {label}")
    return value


def make_material(spec):
    name = safe_name(spec.get("name"), "material name")
    color = vector(spec.get("baseColor", [0.5, 0.5, 0.5, 1.0]), 4, "baseColor", 0.0, 1.0)
    metallic = float(spec.get("metallic", 0.0))
    roughness = float(spec.get("roughness", 0.5))
    emission = vector(spec.get("emissionColor", [0.0, 0.0, 0.0, 1.0]), 4, "emissionColor", 0.0, 1.0)
    emission_strength = float(spec.get("emissionStrength", 0.0))
    if not (0.0 <= metallic <= 1.0 and 0.0 <= roughness <= 1.0 and 0.0 <= emission_strength <= 50.0):
        fail("Material numeric values are outside the allowed range")
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    principled = mat.node_tree.nodes.get("Principled BSDF")
    if principled:
        principled.inputs["Base Color"].default_value = color
        principled.inputs["Metallic"].default_value = metallic
        principled.inputs["Roughness"].default_value = roughness
        if "Emission Color" in principled.inputs:
            principled.inputs["Emission Color"].default_value = emission
            principled.inputs["Emission Strength"].default_value = emission_strength
        elif "Emission" in principled.inputs:
            principled.inputs["Emission"].default_value = emission
            if "Emission Strength" in principled.inputs:
                principled.inputs["Emission Strength"].default_value = emission_strength
    return mat


def add_primitive(spec):
    kind = spec.get("type")
    name = safe_name(spec.get("name"), "object name")
    location = vector(spec.get("location", [0, 0, 0]), 3, "location", -10000, 10000)
    rotation = vector(spec.get("rotation", [0, 0, 0]), 3, "rotation", -3600, 3600)
    scale = vector(spec.get("scale", [1, 1, 1]), 3, "scale", 0.001, 10000)
    rotation_radians = [math.radians(v) for v in rotation]

    if kind == "cube":
        bpy.ops.mesh.primitive_cube_add(location=location, rotation=rotation_radians)
    elif kind == "uv_sphere":
        segments = int(spec.get("segments", 48))
        rings = int(spec.get("rings", 24))
        if not (8 <= segments <= 128 and 4 <= rings <= 64):
            fail("Sphere segments/rings are outside the allowed range")
        bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, location=location, rotation=rotation_radians)
    elif kind == "ico_sphere":
        subdivisions = int(spec.get("subdivisions", 3))
        if not (1 <= subdivisions <= 6):
            fail("Icosphere subdivisions are outside the allowed range")
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdivisions, location=location, rotation=rotation_radians)
    elif kind == "cylinder":
        vertices = int(spec.get("vertices", 48))
        if not (8 <= vertices <= 128):
            fail("Cylinder vertices are outside the allowed range")
        bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, location=location, rotation=rotation_radians)
    elif kind == "cone":
        vertices = int(spec.get("vertices", 48))
        radius1 = float(spec.get("radius1", 1.0))
        radius2 = float(spec.get("radius2", 0.0))
        depth = float(spec.get("depth", 2.0))
        if not (8 <= vertices <= 128 and 0 <= radius1 <= 1000 and 0 <= radius2 <= 1000 and 0.001 <= depth <= 2000):
            fail("Cone settings are outside the allowed range")
        bpy.ops.mesh.primitive_cone_add(vertices=vertices, radius1=radius1, radius2=radius2, depth=depth, location=location, rotation=rotation_radians)
    elif kind == "torus":
        major_segments = int(spec.get("majorSegments", 48))
        minor_segments = int(spec.get("minorSegments", 16))
        major_radius = float(spec.get("majorRadius", 1.0))
        minor_radius = float(spec.get("minorRadius", 0.25))
        if not (12 <= major_segments <= 128 and 6 <= minor_segments <= 64 and 0.001 <= minor_radius <= major_radius <= 1000):
            fail("Torus settings are outside the allowed range")
        bpy.ops.mesh.primitive_torus_add(major_segments=major_segments, minor_segments=minor_segments, major_radius=major_radius, minor_radius=minor_radius, location=location, rotation=rotation_radians)
    else:
        fail(f"Unsupported primitive type: {kind}")

    obj = bpy.context.active_object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bool(spec.get("smooth", True)) and getattr(obj.data, "polygons", None):
        for polygon in obj.data.polygons:
            polygon.use_smooth = True
    bevel = float(spec.get("bevel", 0.0))
    if bevel > 0:
        if bevel > 10:
            fail("Bevel is outside the allowed range")
        modifier = obj.modifiers.new(name="FREEOS_Bevel", type="BEVEL")
        modifier.width = bevel
        modifier.segments = min(max(int(spec.get("bevelSegments", 3)), 1), 8)
    return obj


def add_light(spec):
    name = safe_name(spec.get("name"), "light name")
    kind = str(spec.get("type", "AREA")).upper()
    if kind not in ("AREA", "POINT", "SUN", "SPOT"):
        fail("Unsupported light type")
    location = vector(spec.get("location", [0, 0, 5]), 3, "light location", -10000, 10000)
    rotation = [math.radians(v) for v in vector(spec.get("rotation", [0, 0, 0]), 3, "light rotation", -3600, 3600)]
    color = vector(spec.get("color", [1, 1, 1]), 3, "light color", 0, 1)
    energy = float(spec.get("energy", 1000))
    if not (0 <= energy <= 100000):
        fail("Light energy is outside the allowed range")
    data = bpy.data.lights.new(name=name, type=kind)
    data.color = color
    data.energy = energy
    if kind == "AREA":
        data.shape = "DISK"
        data.size = float(spec.get("size", 5.0))
    obj = bpy.data.objects.new(name=name, object_data=data)
    bpy.context.collection.objects.link(obj)
    obj.location = location
    obj.rotation_euler = rotation
    return obj


def add_camera(spec):
    name = safe_name(spec.get("name", "Camera"), "camera name")
    location = vector(spec.get("location", [0, -12, 5]), 3, "camera location", -10000, 10000)
    rotation = [math.radians(v) for v in vector(spec.get("rotation", [70, 0, 0]), 3, "camera rotation", -3600, 3600)]
    lens = float(spec.get("lens", 50))
    if not (1 <= lens <= 500):
        fail("Camera lens is outside the allowed range")
    data = bpy.data.cameras.new(name=name)
    data.lens = lens
    obj = bpy.data.objects.new(name=name, object_data=data)
    bpy.context.collection.objects.link(obj)
    obj.location = location
    obj.rotation_euler = rotation
    bpy.context.scene.camera = obj
    return obj


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True)
    parser.add_argument("--plan", required=True)
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])

    root = os.path.abspath(args.root)
    plans_root = os.path.abspath(os.path.join(root, "generated", "operators", "blender", "plans"))
    plan_path = os.path.abspath(args.plan)
    if os.path.commonpath([plans_root, plan_path]) != plans_root:
        fail("Plan path is outside the governed Blender plan directory")
    if not plan_path.lower().endswith(".json"):
        fail("Plan must be JSON")

    with open(plan_path, "r", encoding="utf-8") as handle:
        plan = json.load(handle)
    if not isinstance(plan, dict):
        fail("Plan root must be an object")

    job_key = plan.get("jobKey")
    if not isinstance(job_key, str) or not JOB_RE.fullmatch(job_key):
        fail("Invalid jobKey")
    job_dir = os.path.abspath(os.path.join(root, "generated", "operators", "blender", "jobs", job_key))
    jobs_root = os.path.abspath(os.path.join(root, "generated", "operators", "blender", "jobs"))
    if os.path.commonpath([jobs_root, job_dir]) != jobs_root:
        fail("Invalid job directory")
    os.makedirs(job_dir, exist_ok=True)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = str(plan.get("renderEngine", "BLENDER_EEVEE_NEXT")) if str(plan.get("renderEngine", "BLENDER_EEVEE_NEXT")) in ("BLENDER_EEVEE_NEXT", "BLENDER_WORKBENCH") else "BLENDER_EEVEE_NEXT"

    scene_spec = plan.get("scene", {}) if isinstance(plan.get("scene", {}), dict) else {}
    resolution = vector(scene_spec.get("resolution", [768, 768]), 2, "resolution", 64, 4096)
    scene.render.resolution_x = int(resolution[0])
    scene.render.resolution_y = int(resolution[1])
    scene.render.resolution_percentage = 100
    world_color = vector(scene_spec.get("worldColor", [0.03, 0.03, 0.03]), 3, "worldColor", 0, 1)
    scene.world.color = world_color

    material_map = {}
    materials = plan.get("materials", [])
    if not isinstance(materials, list) or len(materials) > 64:
        fail("materials must be a list with at most 64 entries")
    for spec in materials:
        if not isinstance(spec, dict):
            fail("Invalid material entry")
        mat = make_material(spec)
        material_map[mat.name] = mat

    object_map = {}
    objects = plan.get("objects", [])
    if not isinstance(objects, list) or len(objects) > 512:
        fail("objects must be a list with at most 512 entries")
    for spec in objects:
        if not isinstance(spec, dict):
            fail("Invalid object entry")
        obj = add_primitive(spec)
        material_name = spec.get("material")
        if material_name is not None:
            if material_name not in material_map:
                fail(f"Unknown material: {material_name}")
            obj.data.materials.append(material_map[material_name])
        object_map[obj.name] = obj

    for spec in objects:
        parent_name = spec.get("parent") if isinstance(spec, dict) else None
        if parent_name:
            child = object_map.get(spec.get("name"))
            parent = object_map.get(parent_name)
            if not child or not parent:
                fail("Unknown parent relationship")
            child.parent = parent

    lights = plan.get("lights", [])
    if not isinstance(lights, list) or len(lights) > 32:
        fail("lights must be a list with at most 32 entries")
    for spec in lights:
        if not isinstance(spec, dict):
            fail("Invalid light entry")
        add_light(spec)

    camera_spec = plan.get("camera", {"name": "Camera"})
    if not isinstance(camera_spec, dict):
        fail("camera must be an object")
    add_camera(camera_spec)

    blend_name = safe_filename(plan.get("blendFile", "character.blend"), "blendFile")
    if not blend_name.lower().endswith(".blend"):
        fail("blendFile must end in .blend")
    blend_path = os.path.join(job_dir, blend_name)
    bpy.ops.wm.save_as_mainfile(filepath=blend_path)

    render_spec = plan.get("render", {}) if isinstance(plan.get("render", {}), dict) else {}
    render_path = None
    if bool(render_spec.get("enabled", True)):
        render_name = safe_filename(render_spec.get("fileName", "preview.png"), "render fileName")
        if not render_name.lower().endswith(".png"):
            fail("render fileName must end in .png")
        render_path = os.path.join(job_dir, render_name)
        scene.render.filepath = render_path
        scene.render.image_settings.file_format = "PNG"
        bpy.ops.render.render(write_still=True)

    manifest = {
        "ok": True,
        "jobKey": job_key,
        "blendFile": os.path.relpath(blend_path, root).replace("\\", "/"),
        "renderFile": os.path.relpath(render_path, root).replace("\\", "/") if render_path else None,
        "objectCount": len(objects),
        "materialCount": len(materials),
        "lightCount": len(lights),
    }
    manifest_path = os.path.join(job_dir, "manifest.json")
    with open(manifest_path, "w", encoding="utf-8") as handle:
        json.dump(manifest, handle, indent=2)
    print("FREEOS_OPERATOR_RESULT=" + json.dumps(manifest, separators=(",", ":")))


if __name__ == "__main__":
    main()
