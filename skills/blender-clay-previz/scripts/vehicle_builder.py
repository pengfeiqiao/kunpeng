"""Blender vehicle proxy builder, deliberately no brand geometry or beauty-render claims."""
import math
import bpy
from vehicle_motion import sample_vehicle, follow_camera, orbit_camera


def add_vehicle(spec, mat, scene_spec):
    dimensions = spec.get('dimensions', [4.8, 1.9, 1.5])
    length, width, height = [float(v) for v in dimensions]
    radius = float(spec.get('wheel_radius', .34))
    wheelbase = float(spec.get('wheelbase', length * .6))
    track = float(spec.get('track', width * .82))
    if not all(math.isfinite(v) and v > 0 for v in [length,width,height,radius,wheelbase,track]):
        raise ValueError('vehicle dimensions must be finite and positive')
    if wheelbase + radius * 2 > length or track > width or radius * 2 >= height:
        raise ValueError('wheel geometry does not fit vehicle envelope')
    bpy.ops.object.empty_add()
    root = bpy.context.object
    root.name = spec['id']
    def box(name, size, location):
        bpy.ops.mesh.primitive_cube_add()
        obj = bpy.context.object
        obj.name = root.name + '_' + name
        obj.scale = [v / 2 for v in size]
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        obj.parent = root
        obj.location = location
        obj.data.materials.append(mat)
        bevel = obj.modifiers.new('proxy_edges','BEVEL');bevel.width=.06;bevel.segments=2
        return obj
    lower = radius * .8
    body_top = height * .62
    box('body', [length,width,body_top-lower], [0,0,(lower+body_top)/2])
    box('cabin', [length*.52,width*.85,height-body_top], [-length*.08,0,(height+body_top)/2])
    # Front marker makes vehicle heading legible in a uniform clay scene.
    box('front_marker',[.08,width*.65,.12],[length/2,0,body_top*.9])
    wheels=[]
    for front in [True,False]:
        for side in [-1,1]:
            bpy.ops.object.empty_add()
            steer=bpy.context.object;steer.name=root.name+('_front' if front else '_rear')+str(side)
            steer.parent=root;steer.location=[wheelbase/2*(1 if front else -1),track/2*side,radius]
            bpy.ops.object.empty_add()
            roll=bpy.context.object;roll.parent=steer;roll.location=[0,0,0];roll.name=steer.name+'_roll'
            bpy.ops.mesh.primitive_cylinder_add(vertices=24,radius=radius,depth=width*.12)
            wheel=bpy.context.object;wheel.name=steer.name+'_tire';wheel.parent=roll
            wheel.location=[0,0,0];wheel.rotation_euler=[math.pi/2,0,0];wheel.data.materials.append(mat)
            wheels.append((front,steer,roll))
    path=spec.get('vehicle_path')
    if path:
        if spec.get('motion'):
            raise ValueError('use vehicle_path or motion, not both')
        rows=sample_vehicle(path,scene_spec.get('fps',24),scene_spec.get('duration_sec',5),radius,wheelbase)
        for row in rows:
            frame=row['frame'];root.location=row['position'];root.rotation_euler[2]=row['heading']
            root.keyframe_insert('location',frame=frame);root.keyframe_insert('rotation_euler',frame=frame)
            for front,steer,roll in wheels:
                steer.rotation_euler[2]=row['steering'] if front else 0
                roll.rotation_euler[1]=row['wheel_angle']
                steer.keyframe_insert('rotation_euler',frame=frame);roll.keyframe_insert('rotation_euler',frame=frame)
        camera=scene_spec.get('camera',{})
        rig=camera.get('vehicle_rig')
        if rig and rig.get('target_id')==spec['id']:
            if camera.get('path'):
                raise ValueError('vehicle_rig and explicit camera.path are mutually exclusive')
            mode=rig.get('mode','follow')
            if mode=='follow':
                camera['path']=follow_camera(rows,rig.get('offset',[-6,-4,1.2]),rig.get('look_offset',[0,0,.8]),rig.get('end_offset'))
            elif mode=='orbit':
                camera['path']=orbit_camera(rows,rig.get('radius',7),rig.get('height',2),rig.get('start_degrees',-45),rig.get('end_degrees',45),rig.get('look_offset',[0,0,.8]))
            else:
                raise ValueError('vehicle_rig mode must be follow or orbit')
            for row,key in zip(rows,camera['path']):
                dx=key['location'][0]-row['position'][0];dy=key['location'][1]-row['position'][1]
                x=dx*math.cos(row['heading'])+dy*math.sin(row['heading'])
                y=-dx*math.sin(row['heading'])+dy*math.cos(row['heading'])
                z=key['location'][2]-row['position'][2]
                if abs(x)<length/2+.2 and abs(y)<width/2+.2 and z<height+.2:
                    raise ValueError('exterior camera path intersects vehicle envelope; use an explicit interior rig')
        for obj in [root]+[o for _,a,b in wheels for o in (a,b)]:
            if obj.animation_data and obj.animation_data.action:
                for curve in obj.animation_data.action.fcurves:
                    for key in curve.keyframe_points:key.interpolation='LINEAR'
    else:
        root.location=spec.get('location',[0,0,0]);root.rotation_euler=[math.radians(v) for v in spec.get('rotation',[0,0,0])]
    return root
