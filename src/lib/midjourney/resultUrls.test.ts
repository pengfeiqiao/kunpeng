import test from 'node:test';
import assert from 'node:assert/strict';
import { collectResultUrls } from './resultUrls.ts';
test('MJ echoed reference/request URLs never become candidate output images', () => {
  assert.deepEqual(collectResultUrls({ input: { images: ['https://input/ref.png'] },
    data: { status: 'completed', reference_images: ['https://input/ref.png'],
      result: { images: [{ url: 'https://output/new.png' }], input: { image_url: 'https://input/ref.png' } } } }), ['https://output/new.png']);
  assert.deepEqual(collectResultUrls({ data: [{ outputs: ['https://output/a.png', 'https://output/a.png'] }] }), ['https://output/a.png']);
});
