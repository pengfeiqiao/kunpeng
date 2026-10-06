"""Run with Blender --background --python tests/smoke_vehicle_builder.py."""
import pathlib
import sys
import bpy
sys.path.insert(0, str(pathlib.Path(__file__).parents[1] / 'scripts'))
from vehicle_builder import add_vehicle

mat = bpy.data.materials.new('smoke-clay')
path = [{'time': 0, 'position': [0, 0, 0]}, {'time': 2, 'position': [8, 0, 0]}]

def rejects(spec, scene):
    try:
        add_vehicle(spec, mat, scene)
    except ValueError:
        return
    raise AssertionError('invalid vehicle/rig accepted')

rejects({'id': 'bad-dim', 'dimensions': [1, 1, 1], 'wheelbase': 4}, {})
rejects({'id': 'crossing', 'vehicle_path': path}, {
    'fps': 12, 'duration_sec': 2,
    'camera': {'vehicle_rig': {'target_id': 'crossing', 'offset': [-5, 0, 1], 'end_offset': [5, 0, 1]}}})
rejects({'id': 'ambiguous', 'vehicle_path': path, 'motion': [{'frame': 1}]}, {})
scene = {'fps': 12, 'duration_sec': 2, 'camera': {'vehicle_rig': {'target_id': 'valid', 'offset': [7, -6, 2]}}}
vehicle = add_vehicle({'id': 'valid', 'vehicle_path': path}, mat, scene)
assert len(scene['camera']['path']) == 24
bpy.context.scene.frame_set(24)
assert abs(vehicle.location.x - 8) < 1e-5
assert len([o for o in bpy.data.objects if o.name.startswith('valid_') and o.name.endswith('_tire')]) == 4
print('VEHICLE_BUILDER_SMOKE_OK')
