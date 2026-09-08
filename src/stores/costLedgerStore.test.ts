/**
 * costLedgerStore 账本测试：聚合、taskId 幂等去重、项目隔离、倒序、条数上限。
 * store 走 @/ 别名 + zustand persist（localStorage），node --test 直接 import 不了，
 * 沿用仓库既有模式：esbuild 打包（@/ → src 别名插件）+ data: URL 动态加载，
 * 加载前先把内存版 localStorage 挂到 globalThis。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

interface CostRecordLike {
  id: string; projectId: string; taskId?: string; kind: string; engineId: string;
  provider: string; costType: 'actual' | 'estimate'; amountCny: number; createdAt: number;
}

interface LedgerApi {
  getState(): {
    records: CostRecordLike[];
    addRecord(record: Record<string, unknown>): boolean;
    hasRecordForTask(taskId: string): boolean;
    totalForProject(projectId: string): { actual: number; estimate: number };
    recordsForProject(projectId: string): CostRecordLike[];
  };
}

async function loadLedger(): Promise<LedgerApi['getState']> {
  const memory = new Map<string, string>();
  (globalThis as Record<string, unknown>).localStorage = {
    get length() { return memory.size; },
    key: (index: number) => [...memory.keys()][index] ?? null,
    getItem: (key: string) => (memory.has(key) ? memory.get(key)! : null),
    setItem: (key: string, value: string) => { memory.set(key, String(value)); },
    removeItem: (key: string) => { memory.delete(key); },
    clear: () => memory.clear(),
  };
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const bundle = await build({
    absWorkingDir: root, entryPoints: ['src/stores/costLedgerStore.ts'],
    bundle: true, platform: 'node', format: 'esm', write: false,
    plugins: [{
      name: 'at-alias', setup(b) {
        b.onResolve({ filter: /^@\// }, ({ path }) => {
          const rel = path.slice(2);
          for (const ext of ['.ts', '.tsx', '/index.ts']) {
            const candidate = join(root, 'src', rel + ext);
            if (existsSync(candidate)) return { path: candidate };
          }
          return { path: join(root, 'src', rel) };
        });
      },
    }],
  });
  // data: URL 加随机 fragment 破坏 node 模块缓存——每个用例拿到全新 store 实例
  const specifier = `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0]!.text).toString('base64')}#${Math.random()}`;
  const module = await import(specifier);
  return (module as { useCostLedgerStore: LedgerApi }).useCostLedgerStore.getState;
}

function record(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    projectId: 'p1', taskId: 't1', kind: 'video', engineId: 'seedance-2.0', engineLabel: 'Seedance 2.0',
    provider: 'kuaizi', costType: 'actual', amountCny: 7.55, displayText: '实账 ¥7.55', ...overrides,
  };
}

test('addRecord/totalForProject: 实账与预估分列聚合，项目间隔离', async () => {
  const getState = await loadLedger();
  assert.equal(getState().addRecord(record({ taskId: 't1', amountCny: 7.55 })), true);
  assert.equal(getState().addRecord(record({ taskId: 't2', costType: 'estimate', provider: 'dmxapi', amountCny: 0.3 })), true);
  assert.equal(getState().addRecord(record({ taskId: 't3', projectId: 'p2', amountCny: 100 })), true);
  assert.deepEqual(getState().totalForProject('p1'), { actual: 7.55, estimate: 0.3 });
  assert.deepEqual(getState().totalForProject('p2'), { actual: 100, estimate: 0 });
  assert.deepEqual(getState().totalForProject('p-none'), { actual: 0, estimate: 0 });
  assert.equal(getState().recordsForProject('p1').length, 2);
});

test('幂等：同一 taskId 只记一次；缺 projectId 不入账', async () => {
  const getState = await loadLedger();
  assert.equal(getState().addRecord(record({ taskId: 'dup' })), true);
  assert.equal(getState().addRecord(record({ taskId: 'dup', amountCny: 999 })), false);
  assert.equal(getState().hasRecordForTask('dup'), true);
  assert.equal(getState().totalForProject('p1').actual, 7.55);
  assert.equal(getState().addRecord(record({ projectId: '', taskId: 'orphan' })), false);
  assert.equal(getState().hasRecordForTask('orphan'), false);
  // 无 taskId 的记录（手工账）不去重，可重复入
  assert.equal(getState().addRecord(record({ taskId: undefined })), true);
  assert.equal(getState().addRecord(record({ taskId: undefined })), true);
});

test('recordsForProject 倒序（最新在前），id/createdAt 自动补齐', async () => {
  const getState = await loadLedger();
  getState().addRecord(record({ taskId: 'first' }));
  await new Promise((resolve) => setTimeout(resolve, 2));
  getState().addRecord(record({ taskId: 'second' }));
  const records = getState().recordsForProject('p1');
  assert.equal(records[0]!.taskId, 'second');
  assert.equal(records[1]!.taskId, 'first');
  assert.ok(records[0]!.id.startsWith('cost-'));
  assert.ok(records[0]!.createdAt >= records[1]!.createdAt);
});

test('账本只进不出但有 500 条上限，防爆 localStorage 配额', async () => {
  const getState = await loadLedger();
  for (let index = 0; index < 510; index += 1) {
    getState().addRecord(record({ taskId: `bulk-${index}` }));
  }
  assert.equal(getState().records.length, 500);
  // 最旧的 10 条被裁掉，最新的还在
  assert.equal(getState().hasRecordForTask('bulk-0'), false);
  assert.equal(getState().hasRecordForTask('bulk-509'), true);
});
