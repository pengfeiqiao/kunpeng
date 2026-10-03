import { comparePixels } from './diff';
self.onmessage = (event) => {
  try {
    const { before, after, width, height, region, threshold } = event.data;
    const result = comparePixels(before, after, width, height, region, threshold);
    self.postMessage({ result }, { transfer: [result.heatmap.buffer] });
  } catch (error) { self.postMessage({ error: String(error) }); }
};
