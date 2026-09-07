import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as types from '../lib/workshop/types.ts';
import * as migration from '../lib/projectObjects/migrate.ts';
import * as registryTypes from '../lib/projectObjects/types.ts';
import { canOpenProjectWorkspace } from '../lib/workspace/entryPolicy.ts';
import * as creation from '../lib/projects/projectCreation.ts';

const compile = (relative) => ts.transpileModule(readFileSync(new URL(relative, import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
}).outputText;
const paletteExports = {};
runInNewContext(compile('../lib/workshop/colorPalettes.ts'), { exports: paletteExports, require: (id) => {
  assert.equal(id, '@/lib/canvas/imageSource');
  return { loadImageBitmap: () => { throw new Error('image decoding is outside this test'); } };
} });

function fixture(initial, cachedDefaults = false, hooks = {}) {
  let state;
  const writes = [], fileChecks = [];
  const files = new Map(initial === undefined ? [] : [['p', JSON.stringify(initial)]]);
  const project = { id: 'p', name: 'Fake project', stats: {} };
  const listeners = new Set();
  const set = (patch) => { state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }; listeners.forEach((listener) => listener(state)); };
  const store = { getState: () => state, setState: set, subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); } };
  const modules = {
    zustand: { create: (init) => { state = init(set, store.getState, store); return store; } },
    './unifiedProjectStore': { useUnifiedProjectStore: { getState: () => ({ activeId: 'p' }) } },
    '@/lib/workshop/types': types, '@/lib/workshop/colorPalettes': paletteExports,
    '@/lib/projectObjects/types': registryTypes, '@/lib/projectObjects/migrate': migration,
    '@/lib/projects/projectCreation': creation,
    '@tauri-apps/api/path': { homeDir: async () => '/fake-home/' },
    '@tauri-apps/api/fs': { BaseDirectory: { Home: 'fake' }, exists: async (path) => { fileChecks.push(path); return cachedDefaults; } },
    '@/lib/aigc/projectStore': {
      readProject: async () => structuredClone(project), createProject: async () => { await hooks.create?.(); return structuredClone(project); },
      readProjectFile: async (id) => files.get(id) ?? null,
      writeProjectFile: async (id, name, text) => { await hooks.write?.(); assert.equal(name, 'workshop.json'); files.set(id, text); writes.push(JSON.parse(text)); },
      writeProject: async () => {},
    },
  };
  runInNewContext(compile('./workshopStore.ts'), { exports: {}, require: (id) => modules[id] ?? {}, crypto,
    setTimeout: () => { throw new Error('unexpected timer'); }, clearTimeout() {} });
  set({ scheduleSave() {} });
  return { store, files, writes, fileChecks };
}

function assertEmpty(data) {
  for (const key of ['characters', 'scenes', 'props', 'colorPalettes', 'shots']) assert.equal(data[key].length, 0, key);
  assert.equal(data.globalColorPaletteId, undefined);
  if (data.projectObjects) {
    assert.equal(canOpenProjectWorkspace(data.projectId, data.projectId, data), true, 'blank project keeps its new workspace entry');
    assert.equal(data.projectObjects.objects.filter((item) => ['character', 'scene', 'prop', 'scene-asset', 'shot'].includes(item.kind)).length, 0);
    assert.equal(data.projectObjects.media.length, 0); assert.equal(data.projectObjects.versions.length, 0);
  }
}

test('empty factory and repeated registry migration contain no default assets', () => {
  const empty = types.emptyWorkshopData('p'); assertEmpty(empty);
  const migrated = migration.migrateWorkshopProjectObjects(empty, 1); assertEmpty(migrated);
  assertEmpty(migration.migrateWorkshopProjectObjects(migrated, 2));
});

test('palette hydration is non-seeding and preserves old defaults, edits and ordering', () => {
  assert.equal(paletteExports.ensureDefaultColorPalettes(undefined).length, 0);
  const existing = [
    { id: 'custom', source: 'custom', name: 'User palette', createdAt: 5 },
    { id: 'master-cold-industrial', source: 'default', name: 'Old preset', createdAt: 3 },
    { ...structuredClone(paletteExports.DEFAULT_MASTER_COLOR_PALETTES[0]), name: 'Edited preset', assetPrompt: 'user prompt',
      usagePrompt: 'user usage', assetEngine: 'user-engine', assetImagePath: '/fake/user.png', candidates: [{ path: '/fake/history.png', source: 'upload', createdAt: 1 }] },
  ];
  const before = structuredClone(existing);
  assert.equal(paletteExports.ensureDefaultColorPalettes(existing), existing);
  assert.deepEqual(existing, before);
  assert.ok(paletteExports.DEFAULT_MASTER_COLOR_PALETTES.length > 0, 'preset definitions remain available for explicit use');
});

test('real create/save/reload/open paths stay blank even when cached default images exist', async () => {
  const f = fixture(undefined, true);
  assert.equal(await f.store.getState().createAndOpen('Blank'), 'p'); assertEmpty(f.store.getState().data);
  await f.store.getState().save(); assertEmpty(JSON.parse(f.files.get('p')));
  await f.store.getState().reloadCurrent(); assertEmpty(f.store.getState().data);
  await f.store.getState().openProject('p'); assertEmpty(f.store.getState().data);
  assert.equal(f.fileChecks.length, 0); assert.ok(f.writes.every((data) => data.colorPalettes.length === 0));
});

test('creation returns its exact id and never publishes over a project switched during creation', async () => {
  let release;
  const barrier = new Promise((resolve) => { release = resolve; });
  const f = fixture(undefined, false, { create: () => barrier });
  const pending = f.store.getState().createAndOpen('Blank');
  const other = types.emptyWorkshopData('other');
  f.store.setState({ project: { id: 'other' }, data: other });
  release();
  await assert.rejects(pending, (error) => error instanceof creation.ProjectCreationInterrupted && error.projectId === 'p');
  assert.equal(f.store.getState().data, other); assertEmpty(JSON.parse(f.files.get('p')));
});

test('switch away and back during initial save is permanently invalidated', async () => {
  let release;
  const barrier = new Promise((resolve) => { release = resolve; });
  const f = fixture(undefined, false, { write: () => barrier });
  const pending = f.store.getState().createAndOpen('Blank');
  await new Promise((resolve) => setImmediate(resolve));
  const created = f.store.getState();
  f.store.setState({ project: { id: 'other' }, data: types.emptyWorkshopData('other') });
  f.store.setState({ project: created.project, data: created.data });
  release();
  await assert.rejects(pending, (error) => error.projectId === 'p');
});

test('initial save failure retains the created id for explicit recovery instead of creating a duplicate', async () => {
  const f = fixture(undefined, false, { write: () => { throw new Error('fake write failure'); } });
  await assert.rejects(f.store.getState().createAndOpen('Blank'), (error) => error.projectId === 'p');
});

test('opening a new project with no workshop file or a legacy missing palette field does not seed', async () => {
  const missingField = types.emptyWorkshopData('p'); delete missingField.colorPalettes;
  for (const initial of [undefined, missingField, types.emptyWorkshopData('p')]) {
    const f = fixture(initial, true); await f.store.getState().openProject('p');
    assertEmpty(f.store.getState().data); assert.equal(f.fileChecks.length, 0);
  }
});

test('existing legacy defaults and user palettes survive open/reload/save with references and history', async () => {
  const palettes = [
    { id: 'master-cold-industrial', name: 'Retired default', source: 'default', createdAt: 1, assetImagePath: '/fake/old.png',
      candidates: [{ path: '/fake/old.png', source: 'default', createdAt: 1 }, { path: '/fake/older.png', source: 'upload', createdAt: 2 }] },
    { id: 'film-in-the-mood-for-love', name: 'My edited preset', source: 'default', createdAt: 2,
      assetPrompt: 'do not replace', usagePrompt: 'keep usage', colors: [{ hex: '#123456', label: 'user color' }] },
    { id: 'custom', name: 'User palette', source: 'custom', createdAt: 3 },
  ];
  const initial = { ...types.emptyWorkshopData('p'), colorPalettes: palettes, globalColorPaletteId: palettes[0].id,
    shots: [{ id: 's', shotNo: '1', characterIds: [], colorPaletteId: palettes[1].id }] };
  const f = fixture(initial);
  await f.store.getState().openProject('p'); await f.store.getState().save(); await f.store.getState().reloadCurrent();
  const data = f.store.getState().data;
  assert.deepEqual(JSON.parse(f.files.get('p')).colorPalettes, palettes);
  assert.equal(data.globalColorPaletteId, palettes[0].id); assert.equal(data.shots[0].colorPaletteId, palettes[1].id);
  assert.equal(data.projectObjects.objects.filter((item) => item.kind === 'scene-asset').length, palettes.length);
  assert.ok(data.projectObjects.media.some((item) => item.path === '/fake/older.png'));
});

test('existing default palette can recover its cached image without introducing other presets', async () => {
  const f = fixture({ ...types.emptyWorkshopData('p'), colorPalettes: [{ id: 'master-cold-industrial', name: 'Old', source: 'default', createdAt: 1 }] }, true);
  await f.store.getState().openProject('p');
  assert.equal(f.store.getState().data.colorPalettes.length, 1);
  assert.equal(f.store.getState().data.colorPalettes[0].candidates.length, 1);
  assert.deepEqual(f.fileChecks, ['.kunpeng/default-palettes/master-cold-industrial.png']);
});

test('explicit palette creation remains usable and persists without adding presets', async () => {
  const f = fixture(); await f.store.getState().createAndOpen('Blank');
  f.store.getState().upsertColorPalette({ id: 'explicit', name: 'User created', source: 'custom', colors: [{ hex: '#123456', label: 'main' }], createdAt: 5 });
  await f.store.getState().save(); await f.store.getState().reloadCurrent();
  const data = f.store.getState().data;
  assert.equal(data.colorPalettes.length, 1); assert.equal(data.colorPalettes[0].id, 'explicit');
  assert.ok(data.colorPalettes[0].assetPrompt.includes('#123456'));
  assert.equal(data.projectObjects.objects.filter((item) => item.kind === 'scene-asset').length, 1);
});

test('explicitly removed presets are not resurrected by save or reopen', async () => {
  const f = fixture({ ...types.emptyWorkshopData('p'), colorPalettes: [structuredClone(paletteExports.DEFAULT_MASTER_COLOR_PALETTES[0])] });
  await f.store.getState().openProject('p');
  f.store.getState().removeColorPalette(paletteExports.DEFAULT_MASTER_COLOR_PALETTES[0].id);
  await f.store.getState().save(); await f.store.getState().openProject('p');
  assertEmpty(f.store.getState().data);
});
