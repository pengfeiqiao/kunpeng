# clay_render.py — 白模（clay previz）场景构建与渲染（headless bpy）
#
# 用法:
#   "<Blender 二进制>" -b --factory-startup -P clay_render.py -- /abs/path/spec.json
#
# spec.json 字段（所有路径必须绝对路径，坐标单位米，旋转单位度）:
# {
#   "output": "/abs/path/out.mp4",          // 必填；.mp4 或 .png（png 输出序列帧目录前缀）
#   "fps": 24, "duration_sec": 5,
#   "resolution": [1280, 720],
#   "engine": "eevee",                       // eevee（默认，失败自动回退 workbench）| workbench
#   "ground": true,                          // 默认 true：加一块大地面
#   "objects": [
#     {"id": "wall",  "shape": "box",      "location": [0,2,1.5], "scale": [4,0.2,3], "rotation": [0,0,0], "color": [0.85,0.85,0.85]},
#     {"id": "car",   "shape": "box",      "location": [1,0,0.6], "scale": [2,0.9,1.2],
#      "motion": [{"frame": 1, "location": [1,0,0.6]}, {"frame": 48, "location": [-3,0,0.6]}]},
#     {"id": "a",     "shape": "person",   "location": [0,0,0], "rotation": [0,0,90], "height": 1.75, "detail": 1},
#     {"id": "b",     "shape": "person",   "location": [1,0,0], "height": 1.7, "detail": 2,
#      "limbs": {"left_arm": [0,0,-30], "right_arm": [0,0,45], "left_leg": [15,0,0], "right_leg": [-10,0,0]}}
#   ],
#   "camera": {
#     "lens": 35,
#     "path": [
#       {"frame": 1,   "location": [8,-8,3], "look_at": [0,0,1]},
#       {"frame": 120, "location": [4,-4,2], "look_at": [0,0,1.2]}
#     ],
#     "interpolation": "bezier"              // bezier（默认）| linear
#   },
#   "lights": [                              // 可选；缺省用三点柔光
#     {"type": "AREA", "location": [4,-4,6], "energy": 1000, "size": 5, "rotation": [0,0,0]}
#   ]
# }
#
# person 档位（对应视频方法论的动作精度三档）:
#   detail 1 = 极简（胶囊身+球头，站位/粗略移动）
#   detail 2 = 四肢人形（+圆柱手臂/腿，limbs 可摆特定姿态，角度单位度 [x,y,z]）
#   detail 3 不在脚本内：需要骨骼级精准动作时按 SKILL.md 指引分镜拆解后用多条 detail 2 近似
#
# 运行日志打印 JSON 行，便于 agent 解析：{"status": "..."}。

import json
import math
import os
import sys
import traceback

import bpy
from mathutils import Vector


def log(payload):
    payload.setdefault("status", "info")
    print("CLAY_RENDER " + json.dumps(payload, ensure_ascii=False), flush=True)


def parse_args():
    argv = sys.argv
    if "--" not in argv:
        raise SystemExit("usage: blender -b --factory-startup -P clay_render.py -- spec.json")
    spec_path = argv[argv.index("--") + 1]
    with open(spec_path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def radians(deg_tuple):
    return tuple(math.radians(float(v)) for v in (deg_tuple or (0, 0, 0)))


def clay_material(name, color):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    c = color or [0.82, 0.82, 0.82]
    bsdf.inputs["Base Color"].default_value = (float(c[0]), float(c[1]), float(c[2]), 1.0)
    bsdf.inputs["Roughness"].default_value = 0.9
    if "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = 0.2
    return mat


def finish_object(obj, spec, mat):
    obj.location = Vector(spec.get("location", [0, 0, 0]))
    obj.rotation_euler = radians(spec.get("rotation"))
    if mat:
        obj.data.materials.append(mat)
    # 白模的柔和倒角（clay 感的关键，不要锐利边）
    bevel = obj.modifiers.new("clay_bevel", "BEVEL")
    bevel.width = float(spec.get("bevel", 0.03))
    bevel.segments = 2
    return obj


def add_box(spec, mat):
    bpy.ops.mesh.primitive_cube_add(location=(0, 0, 0))
    obj = bpy.context.active_object
    obj.name = spec["id"]
    s = spec.get("scale", [1, 1, 1])
    obj.scale = (s[0] / 2.0, s[1] / 2.0, s[2] / 2.0)
    bpy.ops.object.transform_apply(scale=True)
    return finish_object(obj, spec, mat)


def add_cylinder(spec, mat):
    bpy.ops.mesh.primitive_cylinder_add(radius=float(spec.get("radius", 0.5)), depth=float(spec.get("depth", 1.0)))
    obj = bpy.context.active_object
    obj.name = spec["id"]
    return finish_object(obj, spec, mat)


def add_sphere(spec, mat):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=float(spec.get("radius", 0.5)), segments=24, ring_count=16)
    obj = bpy.context.active_object
    obj.name = spec["id"]
    bpy.ops.object.shade_smooth()
    return finish_object(obj, spec, mat)


def add_plane(spec, mat):
    bpy.ops.mesh.primitive_plane_add(size=float(spec.get("size", 2.0)))
    obj = bpy.context.active_object
    obj.name = spec["id"]
    return finish_object(obj, spec, mat)


def _limb(name, radius, length, location, rotation, mat, parent):
    bpy.ops.mesh.primitive_cylinder_add(radius=radius, depth=length, location=location, rotation=rotation)
    obj = bpy.context.active_object
    obj.name = name
    obj.data.materials.append(mat)
    bevel = obj.modifiers.new("clay_bevel", "BEVEL")
    bevel.width = min(radius * 0.4, 0.02)
    bevel.segments = 2
    if parent:
        parent.update_tag()
        bpy.context.view_layer.update()
        obj.parent = parent
        # 保持世界坐标：直接 parent 会把已设好的位置当成局部坐标叠加父级变换，
        # 部件会"漂移"离开身体。
        obj.matrix_parent_inverse = parent.matrix_world.inverted()
    return obj


def add_person(spec, mat):
    """胶囊小人。detail 1=胶囊身+球头；detail 2 再加四肢圆柱（可用 limbs 摆姿态）。"""
    height = float(spec.get("height", 1.75))
    detail = int(spec.get("detail", 1))
    base = Vector(spec.get("location", [0, 0, 0]))
    facing = radians(spec.get("rotation"))

    body_h = height * 0.52
    body_r = height * 0.11
    # 身体（圆柱 + 大倒角近似胶囊；vanilla Blender 无胶囊基本体，不能依赖插件）
    bpy.ops.mesh.primitive_cylinder_add(radius=body_r, depth=body_h,
                                        location=(base.x, base.y, base.z + body_h / 2 + height * 0.17))
    body = bpy.context.active_object
    body.name = spec["id"]
    body.rotation_euler = facing
    body.data.materials.append(mat)
    bevel = body.modifiers.new("clay_bevel", "BEVEL")
    bevel.width = body_r * 0.6
    bevel.segments = 3
    # 头
    head_r = height * 0.075
    head_z = base.z + height * 0.17 + body_h + head_r * 0.9
    bpy.ops.mesh.primitive_uv_sphere_add(radius=head_r, segments=24, ring_count=16,
                                         location=(base.x, base.y, head_z))
    head = bpy.context.active_object
    head.name = spec["id"] + "_head"
    head.data.materials.append(mat)
    bpy.context.view_layer.update()
    head.parent = body
    head.matrix_parent_inverse = body.matrix_world.inverted()
    bpy.ops.object.shade_smooth()

    if detail >= 2:
        limbs = spec.get("limbs", {})
        shoulder_z = base.z + height * 0.17 + body_h * 0.85
        hip_z = base.z + height * 0.2
        arm_len = height * 0.3
        leg_len = height * 0.32
        for key, side, z, ln, r in (
            ("left_arm", -1, shoulder_z, arm_len, body_r * 0.45),
            ("right_arm", 1, shoulder_z, arm_len, body_r * 0.45),
            ("left_leg", -1, hip_z, leg_len, body_r * 0.55),
            ("right_leg", 1, hip_z, leg_len, body_r * 0.55),
        ):
            rot = radians(limbs.get(key, [0, 0, 0]))
            offset = body_r * 1.6 * side
            loc = (base.x + offset * math.cos(facing[2]), base.y + offset * math.sin(facing[2]), z - ln / 2)
            _limb(spec["id"] + "_" + key, r, ln, loc, rot, mat, body)
    return body


SHAPE_BUILDERS = {}


def build_object(spec, mat):
    shape = spec.get("shape", "box")
    if shape == "box":
        return add_box(spec, mat)
    if shape == "cylinder":
        return add_cylinder(spec, mat)
    if shape == "sphere":
        return add_sphere(spec, mat)
    if shape == "plane":
        return add_plane(spec, mat)
    if shape == "person":
        return add_person(spec, mat)
    raise ValueError(f"unknown shape: {shape}")


def keyframe_motion(obj, motion, interpolation):
    if not motion:
        return
    for key in motion:
        frame = int(key["frame"])
        if "location" in key:
            obj.location = Vector(key["location"])
            obj.keyframe_insert("location", frame=frame)
        if "rotation" in key:
            obj.rotation_euler = radians(key["rotation"])
            obj.keyframe_insert("rotation_euler", frame=frame)
    set_interpolation(obj, interpolation)


def set_interpolation(obj, interpolation):
    if not obj.animation_data or not obj.animation_data.action:
        return
    mode = "LINEAR" if interpolation == "linear" else "BEZIER"
    for fcurve in obj.animation_data.action.fcurves:
        for point in fcurve.keyframe_points:
            point.interpolation = mode


def setup_camera(spec, interpolation):
    cam_spec = spec.get("camera", {})
    bpy.ops.object.camera_add()
    cam = bpy.context.active_object
    cam.name = "ClayCamera"
    cam.data.lens = float(cam_spec.get("lens", 35))
    bpy.context.scene.camera = cam

    # look_at 目标用 Empty + Track To，路径上的每个关键帧同时驱动两者
    bpy.ops.object.empty_add()
    target = bpy.context.active_object
    target.name = "ClayCameraTarget"
    constraint = cam.constraints.new("TRACK_TO")
    constraint.target = target
    constraint.track_axis = "TRACK_NEGATIVE_Z"
    constraint.up_axis = "UP_Y"

    path = cam_spec.get("path") or []
    if not path:
        cam.location = Vector([8, -8, 3])
        target.location = Vector([0, 0, 1])
        cam.keyframe_insert("location", frame=1)
        target.keyframe_insert("location", frame=1)
    else:
        for key in path:
            frame = int(key["frame"])
            cam.location = Vector(key["location"])
            cam.keyframe_insert("location", frame=frame)
            target.location = Vector(key.get("look_at", [0, 0, 1]))
            target.keyframe_insert("location", frame=frame)
    set_interpolation(cam, interpolation)
    set_interpolation(target, interpolation)
    return cam


def setup_lights(spec):
    lights = spec.get("lights")
    if not lights:
        lights = [
            {"type": "AREA", "location": [5, -5, 7], "energy": 1200, "size": 5},
            {"type": "AREA", "location": [-4, -2, 4], "energy": 600, "size": 4},
            {"type": "AREA", "location": [0, 5, 5], "energy": 900, "size": 3},
        ]
    for i, item in enumerate(lights):
        data = bpy.data.lights.new(f"ClayLight{i}", type=item.get("type", "AREA"))
        data.energy = float(item.get("energy", 1000))
        if data.type == "AREA":
            data.shape = "DISK"
            data.size = float(item.get("size", 5))
        obj = bpy.data.objects.new(f"ClayLight{i}", data)
        bpy.context.collection.objects.link(obj)
        obj.location = Vector(item.get("location", [4, -4, 6]))
        obj.rotation_euler = radians(item.get("rotation"))
        if "look_at" in item:
            direction = Vector(item["look_at"]) - obj.location
            obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def setup_world():
    world = bpy.data.worlds.new("ClayWorld") if not bpy.data.worlds else bpy.data.worlds[0]
    bpy.context.scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    bg.inputs[0].default_value = (0.9, 0.9, 0.92, 1.0)   # 亮灰白背景，突出白模
    bg.inputs[1].default_value = 0.6


def setup_render(spec, engine):
    scene = bpy.context.scene
    fps = int(spec.get("fps", 24))
    duration = float(spec.get("duration_sec", 5))
    scene.render.fps = fps
    scene.frame_start = 1
    scene.frame_end = max(2, int(round(fps * duration)) + 1)
    res = spec.get("resolution", [1280, 720])
    scene.render.resolution_x = int(res[0])
    scene.render.resolution_y = int(res[1])

    output = spec["output"]
    os.makedirs(os.path.dirname(output), exist_ok=True)
    if output.lower().endswith(".mp4"):
        scene.render.image_settings.file_format = "FFMPEG"
        scene.render.ffmpeg.format = "MPEG4"
        scene.render.ffmpeg.codec = "H264"
        scene.render.ffmpeg.constant_rate_factor = "HIGH"
        scene.render.ffmpeg.ffmpeg_preset = "GOOD"
    else:
        scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = output

    if engine == "workbench":
        scene.render.engine = "BLENDER_WORKBENCH"
        shading = scene.display.shading
        shading.light = "STUDIO"
        shading.color_type = "SINGLE"
        shading.single_color = (0.85, 0.85, 0.85)
        shading.show_shadows = True
        shading.show_cavity = True
        shading.cavity_type = "WORLD"
    else:
        scene.render.engine = "BLENDER_EEVEE_NEXT" if bpy.app.version >= (4, 2, 0) else "BLENDER_EEVEE"
        # EEVEE Next（4.3+）内置光线追踪 AO，老的 GTAO 开关已移除；逐属性探测，
        # 哪个版本有哪项就开哪项。
        eevee = getattr(scene, "eevee", None)
        if eevee and hasattr(eevee, "use_gtao"):
            eevee.use_gtao = True
            if hasattr(eevee, "gtao_distance"):
                eevee.gtao_distance = 3
            if hasattr(eevee, "gtao_factor"):
                eevee.gtao_factor = 1.4
    return scene


def main():
    spec = parse_args()
    log({"status": "start", "spec_output": spec.get("output"), "blender": bpy.app.version_string})

    # 清场
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (bpy.data.meshes, bpy.data.materials, bpy.data.cameras, bpy.data.lights):
        for block in list(datablocks):
            if block.users == 0:
                datablocks.remove(block)

    if spec.get("ground", True):
        ground_mat = clay_material("clay_ground", [0.78, 0.78, 0.78])
        add_plane({"id": "ground", "size": float(spec.get("ground_size", 60)), "bevel": 0.0}, ground_mat)

    interpolation = spec.get("camera", {}).get("interpolation", "bezier")
    count = 0
    for obj_spec in spec.get("objects", []):
        mat = clay_material("clay_" + obj_spec.get("id", f"obj{count}"), obj_spec.get("color"))
        obj = build_object(obj_spec, mat)
        keyframe_motion(obj, obj_spec.get("motion"), interpolation)
        count += 1
    log({"status": "built", "objects": count})

    setup_camera(spec, interpolation)
    setup_lights(spec)
    setup_world()

    engine = spec.get("engine", "eevee")
    scene = setup_render(spec, engine)
    blend_output = spec.get("blend_output") or os.path.splitext(spec["output"])[0] + ".blend"
    if not os.path.isabs(blend_output) or not blend_output.lower().endswith(".blend"):
        raise ValueError("blend_output must be an absolute .blend path")
    os.makedirs(os.path.dirname(blend_output), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=blend_output)
    log({"status": "saved", "blend_output": blend_output})
    try:
        log({"status": "rendering", "engine": scene.render.engine,
             "frames": scene.frame_end - scene.frame_start + 1})
        bpy.ops.render.render(animation=True)
    except Exception as err:
        if engine == "eevee":
            log({"status": "engine_fallback", "from": scene.render.engine, "error": str(err)[:300]})
            scene = setup_render(spec, "workbench")
            bpy.ops.render.render(animation=True)
        else:
            raise

    bpy.ops.wm.save_as_mainfile(filepath=blend_output)
    log({"status": "done", "output": spec["output"], "blend_output": blend_output,
         "frames": scene.frame_end - scene.frame_start + 1})


try:
    main()
except Exception as err:  # 非零退出 + JSON 错误行，agent 按 returncode/stderr 排障
    log({"status": "error", "error": str(err)[:500], "trace": traceback.format_exc()[-800:]})
    sys.exit(1)
