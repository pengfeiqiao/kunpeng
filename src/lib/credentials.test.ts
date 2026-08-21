import test from 'node:test';
import assert from 'node:assert/strict';
import {
  credentialIdFor,
  listCredentialUsages,
  migrateLegacyCredentials,
  normalizeBaseUrl,
  resolveApiKey,
  resolveCosSecrets,
  resolveSlotApiKey,
  type CredentialHostState,
} from './credentials.ts';

// 测试一律使用假 key，绝不使用/打印真实密钥。
const K = (name: string) => `fake-key-${name}`;

// 测试 state 带旧平铺字段（CredentialHostState 之外），统一用 st() 窄化。
const st = (o: Record<string, unknown>): CredentialHostState => o as unknown as CredentialHostState;

test('normalizeBaseUrl 去尾斜杠并小写 scheme+host', () => {
  assert.equal(normalizeBaseUrl('  HTTPS://WWW.DMXAPI.CN/ '), 'https://www.dmxapi.cn');
  assert.equal(normalizeBaseUrl('https://api.apimart.ai/v1/'), 'https://api.apimart.ai/v1');
  assert.equal(normalizeBaseUrl(''), '');
});

test('credentialIdFor 稳定且不含 key 本体', () => {
  const a = credentialIdFor('https://www.dmxapi.cn/', K('a'));
  const b = credentialIdFor('https://www.dmxapi.cn', K('a'));
  assert.equal(a, b);
  assert.match(a, /^cred-[0-9a-f]{16}$/);
  assert.ok(!a.includes(K('a')));
  assert.notEqual(a, credentialIdFor('https://www.dmxapi.cn', K('b')));
});

test('空状态迁移：无 key 则不产生任何凭证', () => {
  const result = migrateLegacyCredentials({});
  assert.deepEqual(result.credentials, []);
  assert.deepEqual(result.credentialRefs, {});
  assert.equal(result.imageApiSlots, undefined);
});

test('迁移归并：同 baseUrl 同 key 合并为一条凭证', () => {
  const state = st({
    dmxApiKey: K('dmx'),
    // providerApiKeys 里另一个 provider 用同一 baseUrl + 同一 key → 应合并
    providerApiKeys: { dmxclone: K('dmx') },
    providerBaseUrls: { dmxclone: 'https://www.dmxapi.cn/' },
    glmApiKey: K('glm'),
    geminiApiKey: K('gemini'),
  })
  const result = migrateLegacyCredentials(state);
  assert.equal(result.credentials.length, 3);
  // dmx 与 provider:dmxclone 指向同一条凭证
  assert.equal(result.credentialRefs.dmx, result.credentialRefs['provider:dmxclone']);
  assert.ok(result.credentialRefs.glm);
  assert.ok(result.credentialRefs.gemini);
});

test('迁移幂等：迁两次不重复、引用不变', () => {
  const state = st({
    arkApiKey: K('ark'),
    doubaoSpeechApiKey: K('speech'),
    cosSecretId: 'fake-cos-id',
    cosSecretKey: K('cos'),
    cosBucket: 'bucket-125000000',
    cosRegion: 'ap-guangzhou',
    imageApiSlots: [
      { id: 'slot-1', label: 'DMXAPI', provider: 'dmxapi', baseUrl: 'https://www.dmxapi.cn', apiKey: K('slot'), enabled: true, priority: 0 },
    ],
  })
  const first = migrateLegacyCredentials(state);
  const second = migrateLegacyCredentials({
    ...state,
    credentials: first.credentials,
    credentialRefs: first.credentialRefs,
    imageApiSlots: first.imageApiSlots,
  });
  assert.equal(second.credentials.length, first.credentials.length);
  assert.deepEqual(second.credentialRefs, first.credentialRefs);
  assert.deepEqual(second.imageApiSlots, first.imageApiSlots);
  // 槽位挂上 credentialId，且 apiKey 原值保留（迁移不清空旧字段）
  assert.ok(first.imageApiSlots![0].credentialId);
  assert.equal(first.imageApiSlots![0].apiKey, K('slot'));
});

test('迁移不清空、不修改任何旧字段（纯函数）', () => {
  const state = st({
    dmxApiKey: K('dmx'),
    glmApiKey: K('glm'),
    providerApiKeys: { deepseek: K('ds') },
    cosSecretId: 'fake-cos-id',
    cosSecretKey: K('cos'),
  })
  const snapshot = JSON.parse(JSON.stringify(state));
  migrateLegacyCredentials(state);
  assert.deepEqual(state, snapshot);
});

test('COS 迁移：SecretId:SecretKey 合并为一条凭证', () => {
  const state = st({
    cosSecretId: 'fake-cos-id',
    cosSecretKey: K('cos'),
    cosBucket: 'bucket-125000000',
    cosRegion: 'ap-guangzhou',
  })
  const result = migrateLegacyCredentials(state);
  assert.equal(result.credentials.length, 1);
  const cred = result.credentials[0];
  assert.equal(cred.baseUrl, 'https://bucket-125000000.cos.ap-guangzhou.myqcloud.com');
  assert.equal(cred.apiKey, `fake-cos-id:${K('cos')}`);
  assert.equal(result.credentialRefs.cos, cred.id);
});

test('resolveApiKey 优先凭证，凭证缺失/空 key 回退旧字段', () => {
  const migrated = migrateLegacyCredentials(st({ dmxApiKey: K('dmx') }));
  const state = st({
    credentials: migrated.credentials,
    credentialRefs: migrated.credentialRefs,
    dmxApiKey: K('dmx'),
  })
  // 命中凭证
  assert.equal(resolveApiKey(state, 'dmx', K('dmx')), K('dmx'));
  // 引用悬空 → 回退
  assert.equal(resolveApiKey({ ...state, credentialRefs: { dmx: 'cred-gone' } }, 'dmx', K('dmx')), K('dmx'));
  // 无引用 → 回退
  assert.equal(resolveApiKey({ credentials: [] }, 'dmx', K('dmx')), K('dmx'));
  // 凭证 key 为空 → 回退旧字段
  const emptyCred = { ...migrated.credentials[0], apiKey: '  ' };
  assert.equal(
    resolveApiKey({ credentials: [emptyCred], credentialRefs: { dmx: emptyCred.id } }, 'dmx', K('dmx')),
    K('dmx'),
  );
});

test('resolveApiKey 凭证被编辑后处处生效（单一事实源）', () => {
  const migrated = migrateLegacyCredentials(st({ dmxApiKey: K('old') }));
  const edited = {
    credentials: [{ ...migrated.credentials[0], apiKey: K('new') }],
    credentialRefs: migrated.credentialRefs,
  };
  assert.equal(resolveApiKey(edited, 'dmx', K('old')), K('new'));
});

test('resolveSlotApiKey 优先槽位凭证，回退槽位内联 key', () => {
  const migrated = migrateLegacyCredentials(st({
    imageApiSlots: [
      { id: 's1', label: 'DMXAPI', baseUrl: 'https://www.dmxapi.cn', apiKey: K('slot'), enabled: true, priority: 0 },
    ],
  }));
  const slot = migrated.imageApiSlots![0];
  const state: CredentialHostState = { credentials: migrated.credentials };
  assert.equal(resolveSlotApiKey(state, slot), K('slot'));
  // 凭证被删 → 回退槽位内联 key
  assert.equal(resolveSlotApiKey({ credentials: [] }, slot), K('slot'));
  // 空槽位
  assert.equal(resolveSlotApiKey(state, { apiKey: '' }), '');
});

test('resolveCosSecrets 优先 cos 凭证，回退旧字段对', () => {
  const migrated = migrateLegacyCredentials(st({
    cosSecretId: 'fake-cos-id',
    cosSecretKey: K('cos'),
  }));
  const state = st({
    credentials: migrated.credentials,
    credentialRefs: migrated.credentialRefs,
  })
  assert.deepEqual(resolveCosSecrets(state, 'x', 'y'), { secretId: 'fake-cos-id', secretKey: K('cos') });
  assert.deepEqual(resolveCosSecrets({}, 'x', 'y'), { secretId: 'x', secretKey: 'y' });
});

test('listCredentialUsages 汇总平铺能力 + provider + 槽位引用', () => {
  const migrated = migrateLegacyCredentials(st({
    dmxApiKey: K('dmx'),
    providerApiKeys: { deepseek: K('ds') },
    imageApiSlots: [
      { id: 's1', label: 'AiHubMix', baseUrl: 'https://api.inferera.com', apiKey: K('slot'), enabled: true, priority: 0 },
    ],
  }));
  const usages = listCredentialUsages({
    credentials: migrated.credentials,
    credentialRefs: migrated.credentialRefs,
    imageApiSlots: migrated.imageApiSlots,
  });
  const dmxCredId = migrated.credentialRefs.dmx;
  assert.deepEqual(usages[dmxCredId], ['DMXAPI']);
  assert.deepEqual(usages[migrated.credentialRefs['provider:deepseek']], ['聊天模型 · deepseek']);
  const slotCredId = migrated.imageApiSlots![0].credentialId!;
  assert.deepEqual(usages[slotCredId], ['生图槽位 · AiHubMix']);
});
