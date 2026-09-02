import test from 'node:test';
import assert from 'node:assert/strict';
import {
  discoverConfiguredImageSlots,
  resolveConfiguredApimartApiKey,
  type ImageChannelSettings,
} from './configuredChannels.ts';

const key = (name: string) => `fake-${name}-key`;
const state = (value: Record<string, unknown>) => value as unknown as ImageChannelSettings;

test('discovers an enabled credential-backed image slot', () => {
  const slots = discoverConfiguredImageSlots(state({
    credentials: [{ id: 'cred-dmx', label: 'DMX', baseUrl: 'https://www.dmxapi.cn', apiKey: key('dmx'), createdAt: 1 }],
    imageApiSlots: [{ id: 'slot-dmx', label: 'DMX', provider: 'dmxapi', baseUrl: 'https://www.dmxapi.cn', apiKey: '', credentialId: 'cred-dmx', enabled: true, priority: 0 }],
  }));
  assert.equal(slots.length, 1);
  assert.equal(slots[0].id, 'slot-dmx');
  assert.equal(slots[0].apiKey, key('dmx'));
});

test('recovers a stale slot reference from a matching provider credential', () => {
  const slots = discoverConfiguredImageSlots(state({
    credentials: [{ id: 'cred-new', label: 'AiHubMix', baseUrl: 'https://api.inferera.com', apiKey: key('aihub'), createdAt: 1 }],
    imageApiSlots: [{ id: 'slot-old', label: 'AiHubMix', provider: 'aihubmix', baseUrl: 'https://api.inferera.com', apiKey: '', credentialId: 'missing', enabled: true, priority: 0 }],
  }));
  assert.equal(slots[0].credentialId, 'cred-new');
  assert.equal(slots[0].apiKey, key('aihub'));
});

test('credentials-only imports become runnable virtual image slots', () => {
  const slots = discoverConfiguredImageSlots(state({
    credentials: [{ id: 'cred-zex', label: 'ZexAPI', baseUrl: 'https://zexapi.com', apiKey: key('zex'), createdAt: 1 }],
    imageApiSlots: [],
  }));
  assert.equal(slots.length, 1);
  assert.equal(slots[0].provider, 'zexapi');
  assert.equal(slots[0].credentialId, 'cred-zex');
});

test('an explicitly disabled provider is not silently re-enabled', () => {
  const slots = discoverConfiguredImageSlots(state({
    credentials: [{ id: 'cred-zex', label: 'ZexAPI', baseUrl: 'https://zexapi.com', apiKey: key('zex'), createdAt: 1 }],
    imageApiSlots: [{ id: 'slot-zex', label: 'ZexAPI', provider: 'zexapi', baseUrl: 'https://zexapi.com', apiKey: '', credentialId: 'cred-zex', enabled: false, priority: 0 }],
  }));
  assert.deepEqual(slots, []);
});

test('legacy DMX key remains a usable GPT image channel', () => {
  const slots = discoverConfiguredImageSlots(state({ dmxApiKey: key('legacy-dmx'), imageApiSlots: [] }));
  assert.equal(slots[0].provider, 'dmxapi');
  assert.equal(slots[0].apiKey, key('legacy-dmx'));
});

test('APIMart key survives a missing capability reference after settings import', () => {
  const resolved = resolveConfiguredApimartApiKey(state({
    credentials: [{ id: 'cred-apib', label: 'APIMart', baseUrl: 'https://apib.ai', apiKey: key('apimart'), createdAt: 1 }],
    credentialRefs: {},
  }));
  assert.equal(resolved, key('apimart'));
});

test('unrelated credentials are not mistaken for image channels', () => {
  const input = state({
    credentials: [{ id: 'cred-chat', label: 'Chat', baseUrl: 'https://example.com', apiKey: key('chat'), createdAt: 1 }],
    imageApiSlots: [],
  });
  assert.deepEqual(discoverConfiguredImageSlots(input), []);
  assert.equal(resolveConfiguredApimartApiKey(input), '');
});
