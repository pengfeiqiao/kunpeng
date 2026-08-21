import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyVideoPlanningReferencePrefixes,
  buildStoryboardFrameRefBindings,
  buildVideoRefBindings,
  compactStoryboardFrameReferences,
  ensureDirectorConstraintMention,
  remapShotPromptRefs,
  seedance25PromptForShot,
  stripDirectorConstraintMention,
  videoPromptForShot,
  type ShotRefsContext,
} from './shotRefs.ts';
import type { WsShot } from './types.ts';

const ctx: ShotRefsContext = {
  scenes: [{ id: 'scene-1', name: '书房', assetImagePath: '/assets/scene.png' }],
  characters: [{ id: 'char-1', name: '姮氏', assetImagePath: '/assets/character.png' }],
  props: [{ id: 'prop-1', name: '古图', assetImagePath: '/assets/prop.png' }],
  colorPalettes: [{ id: 'palette-1', name: '青铜夜色', assetImagePath: '/assets/palette.png' }],
  globalColorPaletteId: 'palette-1',
};

const shot: WsShot = {
  shotNo: '01-01',
  description: '人物在书房展开古图',
  sceneId: 'scene-1',
  characterIds: ['char-1'],
  propIds: ['prop-1'],
  extraRefImages: ['/assets/extra.png'],
};

test('storyboard canvas refs preserve the canonical asset order', () => {
  const refs = buildStoryboardFrameRefBindings(shot, {}, ctx);

  assert.deepEqual(
    refs.map((ref) => [ref.index, ref.kind, ref.path]),
    [
      [1, 'scene', '/assets/scene.png'],
      [2, 'character', '/assets/character.png'],
      [3, 'prop', '/assets/prop.png'],
      [4, 'extra', '/assets/extra.png'],
      [5, 'palette', '/assets/palette.png'],
    ],
  );
});

test('storyboard canvas refs follow the frame snapshot and keep missing historical assets visible', () => {
  const refs = buildStoryboardFrameRefBindings(
    shot,
    {
      refImagePaths: [
        '/assets/character.png',
        '/assets/scene.png',
        '/assets/legacy-reference.png',
      ],
    },
    ctx,
  );

  assert.deepEqual(
    refs.map((ref) => [ref.index, ref.kind, ref.path]),
    [
      [1, 'character', '/assets/character.png'],
      [2, 'scene', '/assets/scene.png'],
      [3, 'extra', '/assets/legacy-reference.png'],
    ],
  );
  assert.equal(refs[2].label, '历史参考 3');
});

test('storyboard frame references are compacted and renumbered inside the frame', () => {
  const compacted = compactStoryboardFrameReferences(
    shot,
    {
      prompt: '保持@图片一的空间，并让人物参考@图片三进入画面。',
      refImagePaths: [
        '/assets/scene.png',
        '/assets/character.png',
        '/assets/prop.png',
        '/assets/extra.png',
        '/assets/palette.png',
      ],
    },
    ctx,
  );

  assert.equal(compacted.prompt, '保持@图片一的空间，并让人物参考@图片二进入画面。');
  assert.deepEqual(
    compacted.bindings.map((ref) => [ref.index, ref.path]),
    [
      [1, '/assets/scene.png'],
      [2, '/assets/prop.png'],
    ],
  );
});

test('director constraint card is opt-in and appended after normal storyboard refs', () => {
  const withCard: WsShot = {
    ...shot,
    directorConstraintCard: {
      id: 'director-card-1',
      imagePath: '/assets/director-card.png',
      createdAt: 1,
    },
  };

  const disabled = buildStoryboardFrameRefBindings(withCard, {}, ctx);
  assert.equal(disabled.some((ref) => ref.kind === 'directorConstraintCard'), false);

  const enabled = buildStoryboardFrameRefBindings(
    withCard,
    { useDirectorConstraintCard: true },
    ctx,
  );
  assert.deepEqual(enabled[enabled.length - 1], {
    index: 6,
    kind: 'directorConstraintCard',
    label: '导演约束卡',
    path: '/assets/director-card.png',
    id: 'director-card-1',
  });
});

test('video refs place the active director constraint card after storyboard boards', () => {
  const withPlanningAssets: WsShot = {
    ...shot,
    storyboardBoards: [{
      id: 'board-1',
      frameIds: [],
      imagePath: '/assets/board.png',
      createdAt: 1,
      useInVideo: true,
    }],
    directorConstraintCard: {
      id: 'director-card-1',
      imagePath: '/assets/director-card.png',
      createdAt: 1,
      useInVideo: true,
    },
  };

  const refs = buildVideoRefBindings(withPlanningAssets, ctx);
  assert.deepEqual(
    refs.slice(0, 3).map((ref) => [ref.index, ref.kind, ref.path]),
    [
      [1, 'storyboardBoard', '/assets/board.png'],
      [2, 'directorConstraintCard', '/assets/director-card.png'],
      [3, 'scene', '/assets/scene.png'],
    ],
  );
});

test('Seedance 2.5 hides storyboard boards but keeps and renumbers the director card', () => {
  const seedance25Shot: WsShot = {
    ...shot,
    storyboardBoards: [
      { id: 'board-1', frameIds: [], imagePath: '/assets/board-1.png', createdAt: 1, useInVideo: true },
      { id: 'board-2', frameIds: [], imagePath: '/assets/board-2.png', createdAt: 2, useInVideo: true },
    ],
    directorConstraintCard: {
      id: 'director-card-1',
      imagePath: '/assets/director-card.png',
      createdAt: 1,
      useInVideo: true,
    },
    videoPrompt: '以分镜板 @图片一、@图片二作为画面参考。\n以 @导演约束卡（对应 @图片三）锁定调度。\n人物参考 @图片五。',
  };

  const refs = buildVideoRefBindings(seedance25Shot, ctx, { includeStoryboardBoards: false });
  const prompt = seedance25PromptForShot(seedance25Shot, ctx);

  assert.deepEqual(refs.slice(0, 3).map((ref) => [ref.index, ref.kind, ref.path]), [
    [1, 'directorConstraintCard', '/assets/director-card.png'],
    [2, 'scene', '/assets/scene.png'],
    [3, 'character', '/assets/character.png'],
  ]);
  assert.equal(refs.some((ref) => ref.kind === 'storyboardBoard'), false);
  assert.doesNotMatch(prompt, /分镜板/);
  assert.match(prompt, /^以 @导演约束卡（对应 @图片一）/);
  assert.match(prompt, /人物参考 @图片三/);
});

test('Seedance 2.5 keeps its own rewritten prompt without changing the normal prompt', () => {
  const seedance25Shot: WsShot = {
    ...shot,
    storyboardBoards: [{ id: 'board-1', frameIds: [], imagePath: '/assets/board.png', createdAt: 1, useInVideo: true }],
    videoPrompt: '普通模型继续使用 @图片一 分镜板。',
    seedance25VideoPrompt: '【素材描述】@图片一为书房；@图片二为姮氏。',
  };

  const prompt = seedance25PromptForShot(seedance25Shot, ctx);
  assert.equal(seedance25Shot.videoPrompt, '普通模型继续使用 @图片一 分镜板。');
  assert.match(prompt, /@图片一为书房/);
  assert.match(prompt, /@图片二为姮氏/);
});

test('director constraint prompt mention is stable and removable', () => {
  const once = ensureDirectorConstraintMention('第1格：人物走向桌边。', 6);
  const twice = ensureDirectorConstraintMention(once, 7);

  assert.match(twice, /^参考 @导演约束卡（对应 @图片七）/);
  assert.equal(twice.match(/@导演约束卡/g)?.length, 1);
  assert.equal(stripDirectorConstraintMention(twice), '第1格：人物走向桌边。');
});

test('video planning prefixes mention both storyboard board and director constraint card once', () => {
  const withPlanningAssets: WsShot = {
    ...shot,
    storyboardBoards: [{
      id: 'board-1',
      frameIds: [],
      imagePath: '/assets/board.png',
      createdAt: 1,
      useInVideo: true,
    }],
    directorConstraintCard: {
      id: 'director-card-1',
      imagePath: '/assets/director-card.png',
      createdAt: 1,
      useInVideo: true,
    },
  };
  const once = applyVideoPlanningReferencePrefixes(withPlanningAssets, '人物走向桌边。');
  const twice = applyVideoPlanningReferencePrefixes(withPlanningAssets, once);

  assert.equal(twice.match(/以分镜板/g)?.length, 1);
  assert.equal(twice.match(/@导演约束卡/g)?.length, 1);
  assert.match(twice, /@导演约束卡（对应 @图片二）/);
  assert.match(twice, /人物走向桌边。$/);
});

test('Seedance 2.0 keeps storyboard and director prefixes for both prompt templates', () => {
  const plannedShot: WsShot = {
    ...shot,
    storyboardBoards: [{
      id: 'board-1',
      frameIds: [],
      imagePath: '/assets/board.png',
      createdAt: 1,
      useInVideo: true,
    }],
    directorConstraintCard: {
      id: 'director-card-1',
      imagePath: '/assets/director-card.png',
      createdAt: 1,
      useInVideo: true,
    },
    videoPrompt: '原有模板正文。',
    universalVideoPrompt: '【素材身份】通用模板正文。',
  };

  const legacy = videoPromptForShot(plannedShot, ctx, {
    template: 'legacy',
    includeStoryboardBoards: true,
  });
  const universal = videoPromptForShot(plannedShot, ctx, {
    template: 'universal',
    includeStoryboardBoards: true,
  });

  for (const prompt of [legacy, universal]) {
    assert.match(prompt, /^以分镜板@图片一/);
    assert.match(prompt, /@导演约束卡（对应 @图片二）/);
  }
  assert.match(legacy, /原有模板正文。$/);
  assert.match(universal, /【素材身份】通用模板正文。$/);
});

test('template switching preserves both saved prompt variants', () => {
  const dualPromptShot: WsShot = {
    ...shot,
    videoPrompt: '原有版本保持不变。',
    universalVideoPrompt: '【素材身份】通用版本保持不变。',
  };

  const legacy = videoPromptForShot(dualPromptShot, ctx, {
    template: 'legacy',
    includeStoryboardBoards: true,
  });
  const universal = videoPromptForShot(dualPromptShot, ctx, {
    template: 'universal',
    includeStoryboardBoards: true,
  });

  assert.equal(legacy, '原有版本保持不变。');
  assert.equal(universal, '【素材身份】通用版本保持不变。');
  assert.equal(dualPromptShot.videoPrompt, '原有版本保持不变。');
  assert.equal(dualPromptShot.universalVideoPrompt, '【素材身份】通用版本保持不变。');
});

test('universal Seedance 2.5 prefers the new prompt, hides storyboards and keeps the director card', () => {
  const plannedShot: WsShot = {
    ...shot,
    storyboardBoards: [{
      id: 'board-1',
      frameIds: [],
      imagePath: '/assets/board.png',
      createdAt: 1,
      useInVideo: true,
    }],
    directorConstraintCard: {
      id: 'director-card-1',
      imagePath: '/assets/director-card.png',
      createdAt: 1,
      useInVideo: true,
    },
    universalVideoPrompt: '参考 @图片四 完成人物动作。',
    seedance25VideoPrompt: '【素材身份】@图片一为导演约束卡，@图片三为人物。',
  };

  const prompt = videoPromptForShot(plannedShot, ctx, {
    template: 'universal',
    includeStoryboardBoards: false,
  });

  assert.doesNotMatch(prompt, /分镜板/);
  assert.match(prompt, /^以 @导演约束卡（对应 @图片一）/);
  assert.match(prompt, /参考 @图片三 完成人物动作/);
  assert.doesNotMatch(prompt, /【素材身份】@图片一为导演约束卡/);
});

test('universal Seedance 2.5 falls back to the historical no-storyboard prompt', () => {
  const plannedShot: WsShot = {
    ...shot,
    directorConstraintCard: {
      id: 'director-card-1',
      imagePath: '/assets/director-card.png',
      createdAt: 1,
      useInVideo: true,
    },
    universalVideoPrompt: '',
    seedance25VideoPrompt: '【素材身份】@图片一为导演约束卡，@图片二为人物。',
  };

  const prompt = videoPromptForShot(plannedShot, ctx, {
    template: 'universal',
    includeStoryboardBoards: false,
  });

  assert.match(prompt, /^以 @导演约束卡（对应 @图片一）/);
  assert.match(prompt, /【素材身份】@图片一为导演约束卡/);
});

test('video planning prefix keeps the director constraint card visible as the third reference', () => {
  const withTwoBoards: WsShot = {
    ...shot,
    storyboardBoards: [
      { id: 'board-1', frameIds: [], imagePath: '/assets/board-1.png', createdAt: 1, useInVideo: true },
      { id: 'board-2', frameIds: [], imagePath: '/assets/board-2.png', createdAt: 2, useInVideo: true },
    ],
    directorConstraintCard: {
      id: 'director-card-1',
      imagePath: '/assets/director-card.png',
      createdAt: 1,
      useInVideo: true,
    },
  };

  const refs = buildVideoRefBindings(withTwoBoards, ctx);
  const prompt = applyVideoPlanningReferencePrefixes(withTwoBoards, '人物走向桌边。');

  assert.equal(refs[2]?.kind, 'directorConstraintCard');
  assert.match(prompt, /@导演约束卡（对应 @图片三）/);
  assert.equal(prompt.match(/@图片三/g)?.length, 1);
});

test('director constraint card works as the only video reference without storyboard boards', () => {
  const cardOnlyShot: WsShot = {
    shotNo: '01-02',
    description: '只按导演约束卡完成调度',
    characterIds: [],
    directorConstraintCard: {
      id: 'director-card-only',
      imagePath: '/assets/director-card-only.png',
      createdAt: 1,
      useInVideo: true,
    },
  };

  const refs = buildVideoRefBindings(cardOnlyShot, {
    scenes: [],
    characters: [],
    props: [],
    colorPalettes: [],
  });
  const prompt = applyVideoPlanningReferencePrefixes(cardOnlyShot, '按卡片中的人物动线完成镜头。');

  assert.deepEqual(refs.map((ref) => [ref.index, ref.kind, ref.path]), [
    [1, 'directorConstraintCard', '/assets/director-card-only.png'],
  ]);
  assert.match(prompt, /^以 @导演约束卡（对应 @图片一）/);
});

test('replacing a director constraint card removes the previous card from frame snapshots', () => {
  const oldShot: WsShot = {
    ...shot,
    directorConstraintCard: {
      id: 'director-card-1',
      imagePath: '/assets/director-card-old.png',
      createdAt: 1,
    },
    storyboardFrames: [{
      id: 'frame-1',
      prompt: ensureDirectorConstraintMention('第1格：人物走向桌边。', 6),
      refImagePaths: [
        '/assets/scene.png',
        '/assets/character.png',
        '/assets/prop.png',
        '/assets/extra.png',
        '/assets/palette.png',
        '/assets/director-card-old.png',
      ],
      useDirectorConstraintCard: true,
    }],
  };
  const nextShot: WsShot = {
    ...oldShot,
    directorConstraintCard: {
      ...oldShot.directorConstraintCard!,
      imagePath: '/assets/director-card-new.png',
    },
  };
  const remapped = remapShotPromptRefs(oldShot, nextShot, ctx);
  const frame = remapped.storyboardFrames?.[0];

  assert.equal(frame?.refImagePaths?.includes('/assets/director-card-old.png'), false);
  assert.equal(frame?.refImagePaths?.[(frame.refImagePaths?.length ?? 1) - 1], '/assets/director-card-new.png');
  assert.equal(frame?.refImagePaths?.length, 6);
});

test('asset image replacement preserves semantic @ order even when the file path changes', () => {
  const oldShot: WsShot = {
    ...shot,
    imagePrompt: '@图片一是书房，姮氏@图片二展开古图@图片三。',
    videoPrompt: '姮氏@图片二在书房@图片一展开古图@图片三。',
  };
  const nextCtx: ShotRefsContext = {
    ...ctx,
    characters: [{ id: 'char-1', name: '姮氏', assetImagePath: '/assets/character-v2.png' }],
  };
  const remapped = remapShotPromptRefs(oldShot, oldShot, ctx, nextCtx);

  assert.equal(remapped.imagePrompt, oldShot.imagePrompt);
  assert.equal(remapped.videoPrompt, oldShot.videoPrompt);
  assert.equal(remapped.referenceRevision, 1);
});

test('removed assets do not leave a stale @图片N pointing at the next asset', () => {
  const oldShot: WsShot = {
    ...shot,
    imagePrompt: '姮氏@图片二拿起古图@图片三，参考@图片四。',
  };
  const nextShot: WsShot = {
    ...oldShot,
    propIds: [],
  };
  const remapped = remapShotPromptRefs(oldShot, nextShot, ctx);

  assert.doesNotMatch(remapped.imagePrompt ?? '', /古图@图片三/);
  assert.match(remapped.imagePrompt ?? '', /参考@图片三/);
});

test('reordering multi-angle scene images follows the image paths', () => {
  const oldCtx: ShotRefsContext = {
    ...ctx,
    scenes: [{
      id: 'scene-1',
      name: '书房',
      selectedImagePaths: ['/assets/scene-wide.png', '/assets/scene-close.png'],
      sceneReferenceMode: 'multi',
    }],
  };
  const nextCtx: ShotRefsContext = {
    ...oldCtx,
    scenes: [{
      id: 'scene-1',
      name: '书房',
      selectedImagePaths: ['/assets/scene-close.png', '/assets/scene-wide.png'],
      sceneReferenceMode: 'multi',
    }],
  };
  const multiShot: WsShot = {
    ...shot,
    imagePrompt: '@图片一提供全景，@图片二提供近景，姮氏参考@图片三。',
  };
  const remapped = remapShotPromptRefs(multiShot, multiShot, oldCtx, nextCtx);

  assert.equal(remapped.imagePrompt, '@图片二提供全景，@图片一提供近景，姮氏参考@图片三。');
});
