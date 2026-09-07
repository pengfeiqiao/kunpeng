import test from 'node:test';
import assert from 'node:assert/strict';
import { collectReferencesFromSnapshot, type ReferenceNode } from './collectRefsModel.ts';

const image = (id: string): ReferenceNode => ({ id, type: 'image', data: { generatedImageUrl: `/${id}.png` } });
const target: ReferenceNode = { id: 'target', type: 'video', data: { generatedVideoUrl: '/output.mp4' } };

test('only explicit reference relations participate; ordering ignores ownership and shot sequence', () => {
  const nodes = [image('one'), image('two'), image('three'), target];
  const edge = (source: string, relation: string) => ({ id: `${source}-${relation}`, source, target: 'target', data: { relation } });
  const edges = [edge('one', 'ownership'), edge('two', 'sequence'), edge('three', 'reference'), edge('one', 'reference')];
  const collect = (list: typeof edges) => collectReferencesFromSnapshot('target', { nodes, edges: list }).images.map((ref) => ref.submitUrl);
  assert.deepEqual(collect(edges.slice(0, 2)), []);
  assert.deepEqual(collect(edges), ['/three.png', '/one.png']);
  assert.deepEqual(collect([edges[1], edges[0], ...edges.slice(2)]), ['/three.png', '/one.png']);
  assert.deepEqual(collect([edges[0], edges[1], edges[3], edges[2]]), ['/one.png', '/three.png']);
});

test('legacy untyped/workshop reference edges retain order and group expands in place', () => {
  const nodes = [image('one'), image('two'), { id: 'group', type: 'group', data: {} }, target];
  const edges = [
    { id: 'legacy', source: 'two', target: 'target' },
    { id: 'group', source: 'group', target: 'target', data: { relation: 'workshop-reference' } },
    { id: 'last', source: 'one', target: 'target' },
  ];
  const refs = collectReferencesFromSnapshot('target', { nodes, edges }, { groupImages: () => ['/group-a.png', '/group-b.png'] });
  assert.deepEqual(refs.images.map((ref) => ref.url), ['/two.png', '/group-a.png', '/group-b.png', '/one.png']);
  assert.deepEqual(edges.map((edge) => edge.id), ['legacy', 'group', 'last']);
});

test('candidate outputs and global metadata never opt into reference collection', () => {
  const candidate = { ...image('candidate'), data: { ...image('candidate').data, includeAsReference: true, purpose: 'current-version' } };
  const nodes = [candidate, target];
  assert.deepEqual(collectReferencesFromSnapshot('target', { nodes, edges: [] }).images, []);
  const references = collectReferencesFromSnapshot('target', { nodes, edges: [{ id: 'explicit', source: candidate.id, target: 'target', data: { relation: 'reference' } }] });
  assert.equal(references.images[0].submitUrl, '/candidate.png');
});

test('explicit request refs append after edges; original paths preserved and own video output excluded', () => {
  const nodes = [image('one'), { ...target, data: { ...target.data, referenceImages: [{ url: '/full-resolution-original.png' }] } },
    { id: 'same-output', type: 'video', data: { localPath: '/output.mp4' } }];
  const edges = [{ id: 'a', source: 'one', target: 'target' }, { id: 'b', source: 'same-output', target: 'target' }];
  const refs = collectReferencesFromSnapshot('target', { nodes, edges });
  assert.deepEqual(refs.images.map((ref) => ref.submitUrl), ['/one.png', '/full-resolution-original.png']);
  assert.deepEqual(refs.videos, []);
});
