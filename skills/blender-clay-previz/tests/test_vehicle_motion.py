import math
import pathlib
import sys
import unittest
sys.path.insert(0, str(pathlib.Path(__file__).parents[1] / 'scripts'))
from vehicle_motion import sample_vehicle, follow_camera, orbit_camera

class VehicleTests(unittest.TestCase):
    def line(self):
        return sample_vehicle([{'time':0,'position':[0,0,0]},{'time':2,'position':[10,0,0]}],24,2)
    def test_distance_roll_and_duration(self):
        rows=self.line()
        self.assertEqual(len(rows),48)
        self.assertAlmostEqual(rows[-1]['wheel_angle'] * .34,10)
        self.assertEqual(rows[-1]['position'],[10,0,0])
    def test_follow_preserves_relative_distance(self):
        rows=self.line();cam=follow_camera(rows)
        for r,c in zip(rows,cam):
            self.assertAlmostEqual(c['location'][0]-r['position'][0],-6)
            self.assertAlmostEqual(c['look_at'][0],r['position'][0])
    def test_arc_heading_and_turn(self):
        path=[{'time':i/10,'position':[20*math.sin(i*.02),20*(1-math.cos(i*.02)),0]} for i in range(21)]
        rows=sample_vehicle(path,24,2)
        self.assertGreater(rows[-1]['heading'],rows[0]['heading'])
        self.assertTrue(all(abs(r['steering'])<math.pi/4 for r in rows))
    def test_reject_invalid_and_sharp_corner(self):
        for path in [[],[{'time':0,'position':[0,0,0]},{'time':0,'position':[1,0,0]}],
            [{'time':0,'position':[0,0,0]},{'time':1,'position':[1,0,0]},{'time':2,'position':[1,1,0]}]]:
            with self.assertRaises(ValueError):sample_vehicle(path,24,2)
    def test_orbit_radius_and_endpoints(self):
        rows=self.line();cam=orbit_camera(rows,radius=8,height=3,start_degrees=0,end_degrees=90)
        for r,c in zip(rows,cam):
            self.assertAlmostEqual(math.hypot(c["location"][0]-r["position"][0],c["location"][1]-r["position"][1]),8)
        self.assertAlmostEqual(cam[-1]["location"][1],8)
        with self.assertRaises(ValueError):orbit_camera(rows,radius=float("nan"))
        with self.assertRaises(ValueError):orbit_camera(rows,end_degrees=800)
    def test_invalid_camera(self):
        with self.assertRaises(ValueError):follow_camera(self.line(),offset=(0,0,-1))

if __name__=='__main__':unittest.main()
