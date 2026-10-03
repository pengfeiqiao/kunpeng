import importlib.util
import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('depth_convert', Path(__file__).with_name('convert.py'))
converter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(converter)

class WorkflowTests(unittest.TestCase):
    def test_duration_uses_video_not_audio_tail(self):
        source = {'format': {'duration': '9'}}
        video = {'duration': '2'}
        actual = {'duration': '2.066', 'nb_frames': '31'}
        self.assertAlmostEqual(converter.validate_result(source, video, {}, actual, 15)['duration_error_seconds'], .066)
        with self.assertRaises(ValueError):
            converter.validate_result(source, video, {}, {'duration': '1', 'nb_frames': '15'}, 15)
        with self.assertRaises(ValueError):
            converter.validate_result(source, video, {}, {'duration': '2', 'nb_frames': '0'}, 15)

    @unittest.skipUnless(importlib.util.find_spec('numpy'), 'requires numpy')
    def test_normalization_is_global_robust_and_rejects_invalid_depth(self):
        import numpy as np
        depths = np.ones((10, 80, 80), dtype=np.float32)
        depths[0] = 0
        depths[-1, 0, 0] = 1000
        lo, hi, raw = converter.normalization_bounds(depths)
        self.assertEqual((lo, hi, raw), (0, 1, 1000))
        with self.assertRaises(ValueError): converter.normalization_bounds(np.ones((2,16,16)))
        depths[0,0,0] = np.nan
        with self.assertRaises(ValueError): converter.normalization_bounds(depths)

    @unittest.skipUnless(shutil.which('ffmpeg') and shutil.which('ffprobe'), 'requires FFmpeg')
    def test_real_ffmpeg_pipeline_preserves_timeline_audio_and_no_clobber(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source, output = root/'input.mp4', root/'output.mp4'
            repo = root/'repo'
            (repo/'video_depth_anything').mkdir(parents=True)
            (repo/'video_depth_anything'/'video_depth.py').write_text('')
            (repo/'checkpoints').mkdir()
            (repo/'checkpoints'/'video_depth_anything_vits.pth').write_bytes(b'test')
            converter.run(['ffmpeg','-v','error','-f','lavfi','-i','testsrc2=size=160x90:rate=30:duration=1',
                           '-f','lavfi','-i','sine=frequency=440:duration=1.5','-vf',"setpts='if(lt(N,15),N/(30*TB),(N+10)/(30*TB))'",
                           '-fps_mode','vfr','-c:v','libx264','-c:a','aac',source])
            def fake_infer(prepared, raw, repo, checkpoint, args):
                # Only orchestration is mocked; no claim that a grayscale filter estimates depth.
                info, video = converter.probe(prepared, 'ffprobe')
                self.assertEqual(video['avg_frame_rate'], '15/1')
                converter.run(['ffmpeg','-v','error','-i',prepared,'-vf','format=gray','-c:v','libx264','-pix_fmt','yuv420p',raw])
                return {'device':'test-stub'}
            argv = ['convert.py',str(source),'--output',str(output),'--repo',str(repo)]
            with patch.object(sys, 'argv', argv), patch.object(converter, 'infer', fake_infer), patch('importlib.util.find_spec', return_value=True):
                converter.main()
                receipt = json.loads(output.with_suffix('.depth.json').read_text())
                self.assertTrue(receipt['audio'])
                self.assertLess(receipt['duration_error_seconds'], .15)
                self.assertFalse(output.with_suffix('.mp4.lock').exists())
                original = output.read_bytes()
                with self.assertRaisesRegex(ValueError, '输出已存在'):
                    converter.main()
                self.assertEqual(output.read_bytes(), original)
            failed = root/'failed.mp4'
            argv[3] = str(failed)
            with patch.object(sys,'argv',argv), patch.object(converter,'infer',side_effect=RuntimeError('model failure')), patch('importlib.util.find_spec',return_value=True):
                with self.assertRaises(RuntimeError): converter.main()
            self.assertFalse(failed.exists())
            self.assertFalse(failed.with_suffix('.mp4.lock').exists())

if __name__ == '__main__': unittest.main()
