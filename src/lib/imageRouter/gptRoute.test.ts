import test from 'node:test';
import assert from 'node:assert/strict';
import { gptImageRouteExists } from './gptRoute.ts';
import type { ImageRouteDefinition } from './metrics.ts';

function route(partial: Partial<ImageRouteDefinition> & Pick<ImageRouteDefinition, 'id' | 'mode'>): ImageRouteDefinition {
  return {
    label: partial.id,
    provider: 'dmxapi',
    tier: 'standard',
    model: 'gpt-image-2',
    ...partial,
  };
}

test('gpt-image 引擎在存在对应模式路由时放行', () => {
  const routes = [
    route({ id: 'api:slot1:standard:text-to-image', mode: 'text-to-image' }),
    route({ id: 'api:slot1:standard:image-to-image', mode: 'image-to-image' }),
  ];
  assert.equal(gptImageRouteExists(routes, 'gpt-image-2', false), true);
  assert.equal(gptImageRouteExists(routes, 'gpt-image-2', true), true);
  assert.equal(gptImageRouteExists(routes, 'gpt-image-2-i2i', true), true);
});

test('没有对应模式路由时放行失败（文生请求不能拿图生路由充数）', () => {
  const i2iOnly = [route({ id: 'api:slot1:standard:image-to-image', mode: 'image-to-image' })];
  assert.equal(gptImageRouteExists(i2iOnly, 'gpt-image-2', false), false);
  assert.equal(gptImageRouteExists(i2iOnly, 'gpt-image-2', true), true);
});

test('空路由表 / 非 gpt-image 引擎一律不放行', () => {
  const routes = [route({ id: 'api:slot1:standard:text-to-image', mode: 'text-to-image' })];
  assert.equal(gptImageRouteExists([], 'gpt-image-2', false), false);
  assert.equal(gptImageRouteExists(routes, 'seedream-v5-pro', false), false);
  assert.equal(gptImageRouteExists(routes, 'midjourney-v82', false), false);
});

test('seedream 路由不算 gpt-image 渠道', () => {
  const seedreamOnly: ImageRouteDefinition[] = [{
    id: 'api:slot1:seedream-v5-pro:text-to-image',
    label: 'Seedream',
    provider: 'dmxapi',
    mode: 'text-to-image',
    tier: 'standard',
    model: 'seedream-v5-pro',
  }];
  assert.equal(gptImageRouteExists(seedreamOnly, 'gpt-image-2', false), false);
});
