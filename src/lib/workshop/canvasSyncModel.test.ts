import test from 'node:test';
import assert from 'node:assert/strict';
import type { Edge, Node } from 'reactflow';
import { applySelectedProjectVersion, computePendingCanvasPositions, pruneManagedShotReferences } from './canvasSyncModel.ts';

function node(id: string, data: Record<string, unknown>, x = 0, y = 0): Node {
  return { id, type: 'image', position: { x, y }, data } as Node;
}

test('pending canvas positions append without moving existing layout', () => {
  const nodes = [
    { ...node('a', {}, 40, 30), width: 200 },
    { ...node('b', {}, 500, 140), style: { width: '320px' } },
  ];

  assert.deepEqual(computePendingCanvasPositions(nodes, 4), [
    { x: 916, y: 30 },
    { x: 1196, y: 30 },
    { x: 1476, y: 30 },
    { x: 916, y: 250 },
  ]);
  assert.deepEqual(nodes.map((item) => item.position), [{ x: 40, y: 30 }, { x: 500, y: 140 }]);
});

test('workshop ref refresh preserves user edges, output media and node placement', () => {
  const nodes: Node[] = [
    node('managed', { generatedImageUrl: '/managed.png', workshopPromptRefTarget: 'video' }),
    node('manual', { generatedImageUrl: '/manual.png' }),
    {
      ...node('video', {
        generatedVideoUrl: '/output.mp4',
        localPath: '/output.mp4',
        referenceImages: [{ url: '/managed.png' }, { url: '/manual.png' }],
        referenceVideos: [{ url: '/manual-video.mp4' }],
      }, 720, 360),
      type: 'video',
    },
  ];
  const edges: Edge[] = [
    { id: 'managed-edge', source: 'managed', target: 'video', data: { relation: 'workshop-reference' } },
    { id: 'manual-edge', source: 'manual', target: 'video' },
  ];

  const result = pruneManagedShotReferences(nodes, edges, 'video');
  const video = result.nodes.find((item) => item.id === 'video')!;

  assert.equal(result.nodes.some((item) => item.id === 'managed'), false);
  assert.deepEqual(result.edges.map((item) => item.id), ['manual-edge']);
  assert.deepEqual((video.data as Record<string, unknown>).referenceImages, [{ url: '/manual.png' }]);
  assert.equal((video.data as Record<string, unknown>).generatedVideoUrl, '/output.mp4');
  assert.equal((video.data as Record<string, unknown>).localPath, '/output.mp4');
  assert.deepEqual((video.data as Record<string, unknown>).referenceVideos, [{ url: '/manual-video.mp4' }]);
  assert.deepEqual(video.position, { x: 720, y: 360 });
});

test('version projection updates linked canvas media without moving nodes or touching unrelated nodes', () => {
  const nodes = [
    node('linked', { projectObjectId: 'character:a', generatedImageUrl: '/v1.png' }, 120, 80),
    node('other', { projectObjectId: 'character:b', generatedImageUrl: '/b.png' }, 500, 240),
  ];
  const result = applySelectedProjectVersion(nodes, {
    ownerObjectId: 'character:a',
    mediaObjectId: 'media:v2',
    versionObjectId: 'version:v2',
    path: '/v2.png',
    mediaType: 'image',
  });

  assert.equal((result[0].data as Record<string, unknown>).generatedImageUrl, '/v2.png');
  assert.equal((result[0].data as Record<string, unknown>).versionObjectId, 'version:v2');
  assert.deepEqual(result[0].position, { x: 120, y: 80 });
  assert.equal(result[1], nodes[1]);
});
