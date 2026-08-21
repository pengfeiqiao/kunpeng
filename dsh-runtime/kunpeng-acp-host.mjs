import { join } from 'node:path';
import z from '@deepseek-ai/schemastery';
import * as acp from '@deepseek-ai/dsh-acp';
import * as agentCore from '@deepseek-ai/dsh-agent-spine-demo';
import * as mcpClient from '@deepseek-ai/dsh-mcp-client';
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection';
import TokenMeter from '@deepseek-ai/dsh-token-meter';
import BasicCompactionEngine from '@deepseek-ai/dsh-compaction-basic';
import ToolResultPruner from '@deepseek-ai/dsh-compaction-tool-result-pruner';
import JsonlSessionPersistence, {
  JsonlCompressionSchema,
} from '@deepseek-ai/dsh-session-persistence-jsonl';
import * as sessionCheckpointPolicy from '@deepseek-ai/dsh-session-checkpoint-policy';
import SqliteSessionQueryEngine from '@deepseek-ai/dsh-session-query-sqlite';

export const name = 'kunpeng-acp-host';

export const Config = z.intersect([
  agentCore.Config,
  z.object({
    provider: z.string().required(),
    model: z.string().required(),
    mcp: mcpClient.Config.required(),
    persistenceRoot: z.string().required(),
    contextWindow: z.number().default(1_000_000),
    packChunks: z.boolean().default(true),
    persistenceCompression: JsonlCompressionSchema,
  }),
]);

export async function apply(ctx, config) {
  // Official ACP rc.6 intentionally forwards assistant text only. Expose the
  // remaining official session signals over a private stderr side channel so
  // Kunpeng can render reasoning, tool phases and context pressure without
  // taking ownership of the DSH loop or patching DSH source.
  const emitObserver = (update) => {
    try {
      process.stderr.write(`__KUNPENG_DSH_EVENT__${JSON.stringify(update)}\n`);
    } catch {
      // Observability must never interrupt the agent turn.
    }
  };
  const emitUsage = (session, providerUsage) => {
    try {
      const measurement = ctx.tokenMeter.measure(session);
      emitObserver({
        sessionUpdate: 'usage_update',
        used: measurement.totalTokens,
        size: config.contextWindow,
      });
    } catch {
      // The first live usage event may arrive before the meter has consumed a
      // durable assistant/message anchor. Use the exact provider accounting as
      // an early baseline; later events switch back to the official meter.
      if (providerUsage) {
        emitObserver({
          sessionUpdate: 'usage_update',
          used: providerUsage.inputTokens
            + (providerUsage.cacheReadTokens ?? 0)
            + (providerUsage.cacheWriteTokens ?? 0)
            + providerUsage.outputTokens,
          size: config.contextWindow,
        });
      }
    }
  };
  ctx.on('session/event', (session, event) => {
    if (event.type === 'assistant/chunk') {
      const chunk = event.data.chunk;
      if (chunk.type === 'reasoning-delta' && chunk.text) {
        emitObserver({
          sessionUpdate: 'agent_thought_chunk',
          content: { type: 'text', text: chunk.text },
        });
      } else if (chunk.type === 'usage') {
        emitUsage(session, chunk.usage);
      }
      return;
    }
    if (event.type === 'tool/call') {
      emitObserver({ sessionUpdate: 'tool_call' });
      return;
    }
    if (event.type === 'assistant/message') {
      emitUsage(session);
      return;
    }
    if (event.type === 'compaction/start'
      || event.type === 'compaction/summary'
      || event.type === 'compaction/end') {
      emitObserver({
        sessionUpdate: 'kunpeng_compaction',
        phase: event.type.slice('compaction/'.length),
        failed: event.type === 'compaction/end' && event.data.error !== undefined,
      });
      emitUsage(session);
    }
  });

  // Follow dsh-acp-demo's ownership model exactly: the spine and every
  // consumer live in one ordered effect. Mounting the spine outside this
  // effect can let Cordis settle its fiber before ACP creates a session,
  // leaving a valid-looking transport whose bridge is already disposed.
  await ctx.effect(async function* () {
    const spine = ctx.plugin(agentCore, agentCore.pickSpineConfig(config));
    await spine;
    yield spine.dispose;

    const projection = ctx.plugin(SessionProjectionRegistry);
    await projection;
    yield projection.dispose;

    const meter = ctx.plugin(TokenMeter);
    await meter;
    yield meter.dispose;

    const pruner = ctx.plugin(ToolResultPruner, {
      thresholdChars: 8192,
      headChars: 4096,
      tailChars: 1024,
    });
    await pruner;
    yield pruner.dispose;

    const compaction = ctx.plugin(BasicCompactionEngine);
    await compaction;
    yield compaction.dispose;

    // MCP is a sibling of the spine, so it resolves the same ToolRuntime
    // service that the official agent loop uses without mutating DSH source.
    const mcp = ctx.plugin(mcpClient, config.mcp);
    await mcp;
    yield mcp.dispose;

    const persistence = ctx.plugin(JsonlSessionPersistence, {
      root: config.persistenceRoot,
      packChunks: config.packChunks,
      ...(config.persistenceCompression === undefined
        ? {}
        : { compression: config.persistenceCompression }),
    });
    await persistence;
    yield persistence.dispose;

    const checkpoint = ctx.plugin(sessionCheckpointPolicy);
    await checkpoint;
    yield checkpoint.dispose;

    const query = ctx.plugin(SqliteSessionQueryEngine, {
      path: join(config.persistenceRoot, 'session-query.db'),
    });
    await query;
    yield query.dispose;

    const transport = ctx.plugin(acp, {
      provider: config.provider,
      model: config.model,
    });
    await transport;
    yield transport.dispose;
  }, 'kunpeng-acp-host.composition');
}
