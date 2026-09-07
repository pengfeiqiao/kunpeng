import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGenerationDraft, isPaidGeneration, shouldConfirmGeneration, shouldOfferToolConfirmation } from './generationDraft.ts';
import type { GenerationConfirmationPreference } from './types.ts';
import type { CoordinatorCallbacks, Tool, ToolRisk } from '../agent/types.ts';
import type { ToolRegistry } from '../agent/toolRegistry.ts';
import { executeDshToolCall } from '../agent/dsh/toolRpc.ts';

const preferences: GenerationConfirmationPreference[] = ['always-confirm', 'paid-only-confirm', 'direct-execute'];
for (const paid of [false, true]) {
  for (const preference of preferences) {
    test(`${paid ? 'paid' : 'free'} generation under ${preference} reaches the real confirmation gate`, async () => {
      let confirmations = 0;
      let executions = 0;
      const risk: ToolRisk = paid ? 'ask' : 'safe';
      const tool: Tool = {
        definition: { name: 'mock_generate', description: 'offline test', parameters: { type: 'object', properties: {} } },
        risk,
        execute: async () => { executions++; return { success: true, output: 'mock only' }; },
      };
      const registry = { get: () => tool, execute: tool.execute } as unknown as ToolRegistry;
      const expectedConfirmation = preference === 'always-confirm' || (preference === 'paid-only-confirm' && paid);
      assert.equal(shouldOfferToolConfirmation('mock_generate', risk), true);
      const callbacks: CoordinatorCallbacks = {
        onTextDelta: () => {}, onThinkingDelta: () => {}, onToolStart: () => {}, onToolEnd: () => {},
        onComplete: () => {}, onError: () => {},
        onToolConfirm: async () => {
          if (!shouldConfirmGeneration(preference, isPaidGeneration(tool.risk))) return true;
          confirmations++;
          return false;
        },
      };
      const result = await executeDshToolCall({
        name: 'mock_generate', runId: 'mock', instanceId: 'mock', requestId: 'mock', arguments: {},
      }, registry, callbacks, new AbortController().signal);
      assert.equal(confirmations, expectedConfirmation ? 1 : 0);
      assert.equal(executions, expectedConfirmation ? 0 : 1);
      assert.equal(result.success, !expectedConfirmation);
      assert.equal(buildGenerationDraft('mock_generate', { paid: !paid }, risk)?.paid, paid);
    });
  }
}

test('unknown generation cost stays conservative; untrusted paid flags cannot bypass confirmation', () => {
  assert.equal(buildGenerationDraft('image_generate', { paid: false })?.paid, true);
  assert.equal(shouldOfferToolConfirmation('custom-media:test', 'ask'), true);
  assert.equal(shouldOfferToolConfirmation('read_file', 'safe'), false);
  assert.equal(shouldOfferToolConfirmation('image_generate', 'deny'), false);
});
