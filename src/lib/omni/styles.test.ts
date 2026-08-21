import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_MG_MOTION_RECIPE,
  MG_STYLE_CATEGORIES,
  MG_STYLE_PRESETS,
  buildOmniMgPrompt,
  buildOmniMgPolishSystemPrompt,
  getMgStyleCategoryId,
  getMgStylePreview,
} from './styles.ts';

test('Omni style library keeps unique presets across all eight categories', () => {
  assert.equal(MG_STYLE_PRESETS.length, 72);
  assert.equal(new Set(MG_STYLE_PRESETS.map((style) => style.id)).size, MG_STYLE_PRESETS.length);
  assert.equal(MG_STYLE_CATEGORIES.length, 8);

  for (const category of MG_STYLE_CATEGORIES) {
    assert.ok(
      MG_STYLE_PRESETS.some((style) => getMgStyleCategoryId(style) === category.id),
      `category ${category.id} should have at least one style`,
    );
  }
});

test('every style resolves to an independent generated preview card', () => {
  for (const style of MG_STYLE_PRESETS) {
    const preview = getMgStylePreview(style);
    assert.equal(preview.src, `/omni-style-cards/${style.id}.jpg`);
    assert.ok(existsSync(join(process.cwd(), 'public', preview.src)), `missing ${preview.src}`);
  }
});

test('Omni prompt compiler enforces the ten-second multi-element choreography', () => {
  const prompt = buildOmniMgPrompt({
    userPrompt: '展示三个步骤，准确保留文字“开始创作”',
    styleId: 'kinetic-infographic',
    accentStyleId: 'particle-swarm',
    duration: 10,
    mode: 'text',
    recipe: DEFAULT_MG_MOTION_RECIPE,
  });

  assert.match(prompt, /Duration: 10s/);
  assert.match(prompt, /0\.0-2\.0s HOOK/);
  assert.match(prompt, /2\.0-7\.0s DEVELOPMENT/);
  assert.match(prompt, /7\.0-10\.0s PAYOFF/);
  assert.match(prompt, /5-9 active visual elements/);
  assert.match(prompt, /ACCENT STYLE/);
  assert.match(prompt, /开始创作/);
  assert.doesNotMatch(prompt, /4\/6\/10s/);
});

test('MG prompt polish follows Seedance Mini duration instead of forcing ten seconds', () => {
  const prompt = buildOmniMgPolishSystemPrompt(6);

  assert.match(prompt, /6 秒视频生成提示词/);
  assert.match(prompt, /0-1\.2 秒钩子/);
  assert.match(prompt, /1\.2-4\.2 秒多元素展开/);
  assert.match(prompt, /4\.2-6 秒聚合收束/);
  assert.doesNotMatch(prompt, /10 秒视频生成提示词/);
});

test('Seedance Mini prompt compiler uses the selected style recipe at its chosen duration', () => {
  const prompt = buildOmniMgPrompt({
    userPrompt: '让三个功能图标依次出现并聚合',
    styleId: 'app-premium-3d',
    duration: 6,
    mode: 'text',
    recipe: {
      ...DEFAULT_MG_MOTION_RECIPE,
      density: 'rich',
      spatial: '3d',
      rhythm: 'punchy',
    },
  });

  assert.match(prompt, /Duration: 6s/);
  assert.match(prompt, /0\.0-1\.2s HOOK/);
  assert.match(prompt, /1\.2-4\.2s DEVELOPMENT/);
  assert.match(prompt, /4\.2-6\.0s PAYOFF/);
  assert.match(prompt, /5-9 active visual elements/);
  assert.match(prompt, /true 3D staging/);
  assert.doesNotMatch(prompt, /complete 10-second/);
});

test('MiniMax H3 MG prompt declares the real 2K output contract', () => {
  const prompt = buildOmniMgPrompt({
    userPrompt: '展示一套应用工作流',
    styleId: 'app-premium-3d',
    duration: 10,
    resolution: '2K',
  });
  assert.match(prompt, /Resolution: 2K/);
  assert.doesNotMatch(prompt, /720p MG animation/);
});
