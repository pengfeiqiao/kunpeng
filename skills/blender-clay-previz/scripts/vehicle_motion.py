"""Pure vehicle path sampler. Metres, seconds, radians internally; X forward/Y left/Z up.
This is blocking, not vehicle dynamics or a claim about a filmed camera rig.
"""
import math


def finite(value, name):
    value = float(value)
    if not math.isfinite(value):
        raise ValueError(name + ' must be finite')
    return value


def sample_vehicle(path, fps, duration, wheel_radius=0.34, wheelbase=2.8):
    fps = int(fps)
    duration = finite(duration, 'duration')
    radius = finite(wheel_radius, 'wheel_radius')
    wheelbase = finite(wheelbase, 'wheelbase')
    if not 1 <= fps <= 120 or not 0 < duration <= 180 or radius <= 0 or wheelbase <= 0:
        raise ValueError('invalid timing or vehicle dimensions')
    if len(path) < 2:
        raise ValueError('vehicle path needs at least two timed positions')
    keys = []
    for key in path:
        t = finite(key['time'], 'time')
        pos = [finite(v, 'position') for v in key['position']]
        if len(pos) != 3 or pos[2] < 0:
            raise ValueError('position must be [x,y,z] above ground')
        if keys and t <= keys[-1][0]:
            raise ValueError('path times must increase')
        keys.append((t, pos))
    if abs(keys[0][0]) > 1e-6 or abs(keys[-1][0] - duration) > 1e-6:
        raise ValueError('path must cover time 0 through duration')
    result = []
    distance = 0.0
    segment = 0
    frame_count = max(2, round(duration * fps))
    for index in range(frame_count):
        t = index * duration / (frame_count - 1)
        while segment < len(keys) - 2 and t > keys[segment + 1][0]:
            segment += 1
        a, b = keys[segment:segment + 2]
        u = (t - a[0]) / (b[0] - a[0])
        pos = [x + (y - x) * u for x, y in zip(a[1], b[1])]
        dx, dy = b[1][0] - a[1][0], b[1][1] - a[1][1]
        heading = math.atan2(dy, dx) if abs(dx) + abs(dy) > 1e-8 else (result[-1]['heading'] if result else 0)
        if result:
            prior = result[-1]
            heading = prior['heading'] + math.atan2(math.sin(heading - prior['heading']), math.cos(heading - prior['heading']))
            step = math.dist(pos, prior['position'])
            distance += step
            steering = math.atan(wheelbase * (heading - prior['heading']) / step) if step > 1e-8 else 0
            if abs(steering) > math.radians(45):
                raise ValueError('path corner too sharp; add a smooth turning arc')
        else:
            steering = 0
        result.append(dict(frame=index + 1, time=t, position=pos, heading=heading,
                           wheel_angle=distance / radius, steering=steering))
    return result


def relative_point(position, heading, offset):
    x, y, z = offset
    return [position[0] + x * math.cos(heading) - y * math.sin(heading),
            position[1] + x * math.sin(heading) + y * math.cos(heading), position[2] + z]


def follow_camera(samples, offset=(-6, -4, 1.2), target=(0, 0, 0.8), end_offset=None):
    if len(offset) != 3 or len(target) != 3 or (end_offset is not None and len(end_offset) != 3):
        raise ValueError('camera offsets must have three coordinates')
    if any(not math.isfinite(float(v)) for values in [offset, target, end_offset or offset] for v in values):
        raise ValueError('camera offsets must be finite')
    result = []
    for i, row in enumerate(samples):
        u = i / max(1, len(samples) - 1)
        local = [a + (b - a) * u for a, b in zip(offset, end_offset or offset)]
        loc = relative_point(row['position'], row['heading'], local)
        look = relative_point(row['position'], row['heading'], target)
        if loc[2] <= 0 or math.dist(loc, look) < 0.05:
            raise ValueError('camera must be above ground and separate from target')
        result.append(dict(frame=row['frame'], location=loc, look_at=look))
    return result


def orbit_camera(samples, radius=7, height=2, start_degrees=-45, end_degrees=45, target=(0,0,.8)):
    radius=finite(radius,'orbit radius');height=finite(height,'orbit height')
    start=math.radians(finite(start_degrees,'orbit start'));end=math.radians(finite(end_degrees,'orbit end'))
    if radius <= 0 or height <= 0 or abs(end-start) > 2*math.pi:
        raise ValueError('orbit needs positive radius/height and at most one revolution')
    result=[]
    for i,row in enumerate(samples):
        angle=start+(end-start)*i/max(1,len(samples)-1)
        result.extend(follow_camera([row],(radius*math.cos(angle),radius*math.sin(angle),height),target))
    return result
