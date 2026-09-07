import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyWorkshopData, type WorkshopData, type WsShot } from '../workshop/types.ts';
import { migrateWorkshopProjectObjects } from './migrate.ts';
import {
  registerCanvasGeneration,
  selectAssetVersion,
  setMediaPurpose,
} from './selectors.ts';

function legacyProject(): WorkshopData {
  const data = emptyWorkshopData('project-1');
  const shot: WsShot = {
    id: 'shot-1',
    shotNo: '01-01',
    description: '姮氏在书房展开古图',
    sceneId: 'scene-1',
    characterIds: ['character-1'],
    propIds: ['prop-1'],
    extraRefImages: ['/assets/extra.png'],
    imagePath: '/outputs/shot.png',
    videoPath: '/outputs/shot.mp4',
    storyboardFrames: [{
      id: 'frame-1',
      prompt: '旧分镜',
      imagePath: '/legacy/frame.png',
      candidates: [{ path: '/legacy/frame-candidate.png', source: 'generate', createdAt: 2 }],
    }],
    storyboardBoards: [{
      id: 'board-1',
      frameIds: ['frame-1'],
      imagePath: '/legacy/board.png',
      createdAt: 3,
      useInVideo: true,
    }],
    directorConstraintCard: {
      id: 'card-1',
      imagePath: '/assets/card.png',
      createdAt: 4,
      useInVideo: true,
    },
    videoPrompt: '以分镜板@图片一作为画面参考。\n以 @导演约束卡（对应 @图片二）锁定调度。\n@图片三是书房，@图片四是姮氏，@图片五是古图。',
    universalVideoPrompt: '以分镜板@图片一作为画面参考。\n以 @导演约束卡（对应 @图片二）锁定调度。\n新版：@图片四保持人物一致。',
  };
  return {
    ...data,
    schemaVersion: undefined,
    projectObjects: undefined,
    scenes: [{ id: 'scene-1', name: '书房', description: '', assetImagePath: '/assets/scene.png' }],
    characters: [{ id: 'character-1', name: '姮氏', personality: '', appearance: '', assetImagePath: '/assets/character.png' }],
    props: [{ id: 'prop-1', name: '古图', description: '', assetImagePath: '/assets/prop.png' }],
    shots: [shot],
  };
}

test('legacy storyboards migrate to historical media without entering generation refs', () => {
  const migrated = migrateWorkshopProjectObjects(legacyProject(), 100);
  const historicalPaths = migrated.projectObjects?.media
    .filter((item) => item.purpose === 'historical')
    .map((item) => item.path)
    .sort();

  assert.deepEqual(historicalPaths, [
    '/legacy/board.png',
    '/legacy/frame-candidate.png',
    '/legacy/frame.png',
  ]);
  assert.ok(migrated.projectObjects!.media.filter((item) => item.source === 'legacy-storyboard').every((item) => item.purpose === 'historical'));
  assert.equal(migrated.shots[0].storyboardBoards?.[0]?.imagePath, '/legacy/board.png');
  assert.equal(migrated.shots[0].storyboardFrames?.[0]?.imagePath, '/legacy/frame.png');
});

test('legacy prompt references are compacted once when storyboard stops participating', () => {
  const migrated = migrateWorkshopProjectObjects(legacyProject(), 100);
  const prompt = migrated.shots[0].videoPrompt ?? '';
  const universal = migrated.shots[0].universalVideoPrompt ?? '';

  assert.doesNotMatch(prompt, /分镜板/);
  assert.match(prompt, /^以 @导演约束卡（对应 @图片一）/);
  assert.match(prompt, /@图片二是书房，@图片三是姮氏，@图片四是古图/);
  assert.match(universal, /新版：@图片三保持人物一致/);

  const reopened = migrateWorkshopProjectObjects(migrated, 200);
  assert.equal(reopened.shots[0].videoPrompt, prompt);
  assert.equal(reopened.shots[0].universalVideoPrompt, universal);
  assert.equal(reopened.projectObjects?.updatedAt, migrated.projectObjects?.updatedAt);
});

test('generated outputs are candidates; project-wide purpose cannot opt them into references', () => {
  const migrated = migrateWorkshopProjectObjects(legacyProject(), 100);
  const output = migrated.projectObjects?.media.find((item) => item.path === '/outputs/shot.mp4');

  assert.equal(output?.purpose, 'candidate-version');
  assert.equal(output?.includeAsReference, undefined);

  const optedIn = setMediaPurpose(migrated, output!.id, 'generation-reference', 110);
  assert.equal(optedIn, migrated);
});

test('version selection preserves history without changing reference membership; locked current blocks replacement', () => {
  const base = emptyWorkshopData('project-versions');
  const withAsset: WorkshopData = {
    ...base,
    characters: [{
      id: 'character-1',
      name: '姮氏',
      personality: '',
      appearance: '',
      assetImagePath: '/assets/v1.png',
      candidates: [
        { path: '/assets/v1.png', source: 'upload', createdAt: 1 },
        { path: '/assets/v2.png', source: 'generate', createdAt: 2 },
      ],
    }],
  };
  const migrated = migrateWorkshopProjectObjects(withAsset, 100);
  const ownerId = 'character:character-1';
  const target = migrated.projectObjects!.versions.find((item) => item.ownerObjectId === ownerId && !item.selected)!;
  const explicitRef = setMediaPurpose(migrated, target.mediaObjectId, 'generation-reference', 105);
  const switched = selectAssetVersion(explicitRef, ownerId, target.id, 110);

  assert.equal(switched.projectObjects!.versions.length, 2);
  assert.equal(switched.projectObjects!.versions.find((item) => item.id === target.id)?.selected, true);
  assert.equal(switched.projectObjects!.media.find((item) => item.id === target.mediaObjectId)?.includeAsReference, undefined);
  assert.equal(switched.characters[0].assetImagePath, '/assets/v2.png');

  const current = switched.projectObjects!.versions.find((item) => item.selected)!;
  const other = switched.projectObjects!.versions.find((item) => item.id !== current.id)!;
  const locked: WorkshopData = {
    ...switched,
    projectObjects: {
      ...switched.projectObjects!,
      versions: switched.projectObjects!.versions.map((item) => item.id === current.id ? { ...item, locked: true } : item),
    },
  };
  const blocked = selectAssetVersion(locked, ownerId, other.id, 120);
  assert.equal(blocked, locked);
});

test('canvas generation registers aligned candidate versions without automatic references', () => {
  const migrated = migrateWorkshopProjectObjects({
    ...emptyWorkshopData('project-canvas-output'),
    characters: [{
      id: 'character-1',
      name: '姮氏',
      personality: '',
      appearance: '',
      assetImagePath: '/assets/original.png',
    }],
  }, 100);
  const result = registerCanvasGeneration(migrated, {
    nodeId: 'node-main',
    nodeIds: ['node-main', 'node-variant'],
    taskId: 'task-1',
    paths: ['/outputs/a.png', '/outputs/b.png'],
    mediaType: 'image',
    ownerObjectId: 'character:character-1',
    prompt: '候选人物版本',
    engineId: 'image-engine',
  }, 110);

  assert.equal(result.mediaIds.length, 2);
  assert.equal(result.versionIds.length, 2);
  assert.ok(result.versionIds.every(Boolean));
  result.mediaIds.forEach((mediaId, index) => {
    const media = result.data.projectObjects!.media.find((item) => item.id === mediaId)!;
    assert.equal(media.purpose, 'candidate-version');
    assert.equal(media.includeAsReference, undefined);
    assert.equal(media.canvasNodeId, index === 0 ? 'node-main' : 'node-variant');
    assert.equal(media.versionObjectId, result.versionIds[index]);
  });

  const reopened = migrateWorkshopProjectObjects(result.data, 120);
  assert.equal(reopened.projectObjects!.media.filter((item) => result.mediaIds.includes(item.id)).length, 2);
});

test('blank generation enters unclassified inbox; classification does not create global reference membership', () => {
  const result = registerCanvasGeneration(emptyWorkshopData('project-blank-output'), {
    nodeId: 'node-blank',
    taskId: 'task-blank',
    paths: ['/outputs/blank.mp4'],
    mediaType: 'video',
  }, 100);
  const media = result.data.projectObjects!.media.find((item) => item.id === result.mediaIds[0])!;

  assert.equal(media.purpose, 'unclassified');
  assert.equal(media.includeAsReference, undefined);
  assert.deepEqual(result.versionIds, [undefined]);
  const promoted = setMediaPurpose(result.data, media.id, 'generation-reference', 110);
  assert.equal(promoted, result.data);
});

test('legacy unused global reference flags migrate idempotently without changing IDs or shot refs', () => {
  const initial = migrateWorkshopProjectObjects(legacyProject(), 100);
  const old = { ...initial, projectObjects: {
    ...initial.projectObjects!,
    media: initial.projectObjects!.media.map((item) => ({ ...item, includeAsReference: true })),
  } };
  const migrated = migrateWorkshopProjectObjects(old, 200);
  assert.deepEqual(migrated.projectObjects!.media.map((item) => item.id), old.projectObjects.media.map((item) => item.id));
  assert.ok(migrated.projectObjects!.media.every((item) => !('includeAsReference' in item)));
  assert.deepEqual(migrated.shots[0].extraRefImages, old.shots[0].extraRefImages);
  assert.deepEqual(migrateWorkshopProjectObjects(migrated, 300), migrated);
});
