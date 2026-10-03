import { test } from 'node:test';
import assert from 'node:assert/strict';
import { comparePixels, validateRegion } from './diff.ts';
test('identical images and bounded changes are distinguished', () => {
 const a = new Uint8ClampedArray(16), b = new Uint8ClampedArray(16);
 assert.equal(comparePixels(a,b,2,2).metrics.changed_pixels,0);
 b[0]=12; b[12]=255;
 const r=comparePixels(a,b,2,2,{x:0,y:0,width:1,height:1});
 assert.equal(r.metrics.changed_pixels,2); assert.equal(r.metrics.outside_region_changed_pixels,1);
 assert.deepEqual(r.metrics.changed_bounds,{x:0,y:0,width:2,height:2});
 assert.equal(comparePixels(a,b,2,2,undefined,12).metrics.changed_pixels,1);
});
test('invalid dimensions, thresholds and regions cannot silently pass', () => {
 assert.throws(()=>comparePixels(new Uint8ClampedArray(4),new Uint8ClampedArray(8),1,1));
 assert.throws(()=>comparePixels(new Uint8ClampedArray(4),new Uint8ClampedArray(4),1,1,undefined,256));
 assert.throws(()=>validateRegion({x:1,y:0,width:1,height:1},1,1));
});
