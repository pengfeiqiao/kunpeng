import { join } from 'node:path';
import z from '@deepseek-ai/schemastery';
// Official ACP handles native attachments and tool-result images.
import * as acp from '@deepseek-ai/dsh-acp';
import AttachmentLocal from '@deepseek-ai/dsh-attachment-local';

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
  z.object({ persona: z.string().default(''), maxParallelToolCalls: z.number().default(1) }),
  z.object({
    provider: z.string().required(),
    model: z.string().required(),
    mcp: mcpClient.Config,
    persistenceRoot: z.string().required(),
    contextWindow: z.number().default(1_000_000),
    packChunks: z.boolean().default(true),
    persistenceCompression: JsonlCompressionSchema,
  }),
]);

export async function apply(ctx, config) {
  // ACP now publishes reasoning, tools and usage itself. Only compaction
  // remains on the private observer channel; never duplicate native chunks.
  ctx.on('session/event', (_session, event) => {
    if (['compaction/start', 'compaction/summary', 'compaction/end'].includes(event.type)) {
      process.stderr.write(`__KUNPENG_DSH_EVENT__${JSON.stringify({
        sessionUpdate: 'kunpeng_compaction', phase: event.type.slice('compaction/'.length),
        failed: event.type === 'compaction/end' && event.data.error !== undefined,
      })}\n`);
    }
  });

  // The core and every
  // consumer live in one ordered effect. Mounting the spine outside this
  // effect can let Cordis settle its fiber before ACP creates a session,
  // leaving a valid-looking transport whose bridge is already disposed.
  await ctx.effect(async function* () {
    // Explicit service composition replaces the retired upstream spine-demo.
    // These are unmodified official plugins; Kunpeng owns only the tool/UI bridge.
    const core = [
      ['@deepseek-ai/cordis-plugin-timer', {}],
      ['@deepseek-ai/dsh-llm', {}],
      ['@deepseek-ai/dsh-session', {}],
      ['@deepseek-ai/dsh-session-title', { fallbackMaxWords: 5, fallbackMaxBytes: 40, maxTitleBytes: 80 }],
      ['@deepseek-ai/dsh-system-prompt', { includeRuntimeContext: false, personaPrefix: '{{kunpeng_persona}}' }],
      ['@deepseek-ai/dsh-tools', {}],
      ['@deepseek-ai/dsh-agent', {}],
      ['@deepseek-ai/dsh-llm-retry', {}],
      ['@deepseek-ai/dsh-jobs-local', {}],
      ['@deepseek-ai/dsh-invariants', {}],
      ['@deepseek-ai/dsh-session/invariant', {}],
      ['@deepseek-ai/dsh-agent/invariant', {}],
      ['@deepseek-ai/dsh-scope/invariant', {}],
      ['@deepseek-ai/dsh-agent-loop/invariant', {}],
      ['@deepseek-ai/dsh-agent-loop', { agents: [], maxParallelToolCalls: config.maxParallelToolCalls }],
    ];
    for (const [name, options] of core) {
      const module = await import(name);
      const plugin = ctx.plugin(module.default ?? module, options);
      yield plugin.dispose;
      if (name === '@deepseek-ai/dsh-system-prompt') {
        await plugin;
        const persona = ctx.inject(['systemPrompt'], (child) => {
          child.systemPrompt.variable('kunpeng_persona', () => config.persona);
        });
        await persona;
        yield persona.dispose;
      }
    }

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
    if (config.mcp) {
      const mcp = ctx.plugin(mcpClient, config.mcp);
      await mcp;
      yield mcp.dispose;
    }

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

    // Durable attachment storage for official ACP and MCP image evidence.
    // （图片字节落盘为内容寻址引用，线上请求时再 base64 内联）。
    // 单图上限对齐 DeepSeek 官方视觉限制（32MiB）。
    const attachments = ctx.plugin(AttachmentLocal, {
      dshHome: process.env.DSH_HOME || join(process.env.HOME || '', '.dsh'),
      maxImageBytes: 32 * 1024 * 1024,
      maxMessageImageBytes: 64 * 1024 * 1024,
    });
    await attachments;
    yield attachments.dispose;

    const transport = ctx.plugin(acp, {
      provider: config.provider,
      model: config.model,
    });
    await transport;
    yield transport.dispose;
  }, 'kunpeng-acp-host.composition');
}
