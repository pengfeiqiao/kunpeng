import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { isAbsolute } from "node:path";
import { Readable, Writable } from "node:stream";
import Schema from "@deepseek-ai/schemastery";
import "@deepseek-ai/cordis";
import { AgentSideConnection, PROTOCOL_VERSION, RequestError, ndJsonStream } from "@agentclientprotocol/sdk";
import { SessionId } from "@deepseek-ai/dsh-session";
//#region ../../llm/llm/src/brand.ts
/**
* Brand a message identifier.
* @param id - the opaque message identifier.
* @returns the same string, branded; no validation is performed.
*/
function MessageId(id) {
	return id;
}
//#endregion
//#region ../../llm/llm/src/call-config.ts
/**
* Deep-freeze a value in place with an iterative traversal, guarding cycles,
* so later mutation throws without imposing a JavaScript call-stack depth cap.
* {@link AbortSignal} objects are deliberately skipped because they are the
* request's live cancellation channel and freezing them breaks abort.
* @param value - the value to freeze in place.
* @returns the same value, frozen.
*/
function deepFreeze(value) {
	const seen = /* @__PURE__ */ new WeakSet();
	const pending = [{
		kind: "visit",
		node: value
	}];
	while (pending.length > 0) {
		const task = pending.pop();
		/* v8 ignore next -- the loop condition guarantees one pending task. */
		if (task === void 0) continue;
		if (task.kind === "property") {
			pending.push({
				kind: "visit",
				node: task.source[task.key]
			});
			continue;
		}
		const node = task.node;
		if (node === null || typeof node !== "object") continue;
		if (node instanceof AbortSignal) continue;
		if (seen.has(node)) continue;
		seen.add(node);
		Object.freeze(node);
		const keys = Object.keys(node);
		for (let index = keys.length - 1; index >= 0; index--) {
			const key = keys[index];
			/* v8 ignore next -- the loop is bounded by the captured key count. */
			if (key === void 0) continue;
			pending.push({
				kind: "property",
				source: node,
				key
			});
		}
	}
	return value;
}
//#endregion
//#region ../../llm/llm/src/message.ts
/** Message value types, identity, and immutable construction helpers. */
/**
* Detach and deep-freeze a message whose identity already exists.
* @param message - complete message, including its stable identity.
* @returns an immutable snapshot that preserves the identity.
*/
function freezeMessage(message) {
	return deepFreeze(structuredClone(message));
}
/**
* Create one identified message and freeze it before publication.
* @param input - complete role, content, and source for a new message.
* @returns an immutable message with a fresh stable identity.
*/
function createMessage(input) {
	return freezeMessage({
		...input,
		id: MessageId(crypto.randomUUID())
	});
}
/**
* Create one identified user-role message and freeze it before publication.
* @param input - complete content and source for a new user message.
* @returns an immutable user message with a fresh stable identity.
*/
function createUserMessage(input) {
	return createMessage({
		...input,
		role: "user"
	});
}
//#endregion
//#region ../../util/timeout/src/index.ts
/** Largest delay Node schedules without clamping it to one millisecond. */
const MAX_TIMER_DELAY_MS = 2147483647;
//#endregion
//#region ../../llm/llm/src/error.ts
/**
* Canonical provider-neutral code for a response that completed normally but
* carried no content blocks at all. Providers occasionally emit a degenerate
* completion (a terminal stop with zero output); adapters classify it as this
* failure instead of yielding an empty assistant message, because an empty
* message silently ends the turn with nothing for the user or the loop to act
* on. The attempt produced nothing durable, so retry policy treats it as safe
* to repeat.
*/
const EMPTY_RESPONSE_CODE = "EMPTY_RESPONSE";
new RegExp(String.raw`(?:^|[^a-z0-9])context[\s_-](?:length|window)[\s_-]` + String.raw`(?:exceed(?:ed|s)?|overflow(?:ed)?|limit[\s_-]exceeded)(?:$|[^a-z0-9])`, "i");
new RegExp(String.raw`\b(?:request|prompt|input|messages?)\s+(?:is\s+|are\s+)?` + String.raw`too\s+(?:large|long)\s+for\s+(?:(?:this|the)\s+)?` + String.raw`(?:model(?:'s)?\s+)?context(?:\s+window)?\b`, "i");
new RegExp(String.raw`\b(?:input|prompt|request|messages?)\b.{0,40}` + String.raw`\b(?:exceed(?:s|ed)?|overflows?|is\s+larger\s+than)\b.{0,40}` + String.raw`\b(?:the\s+)?(?:model(?:'s)?\s+)?context(?:\s+(?:length|window))?\b`, "i");
/**
* Render a thrown value with its full `cause` chain and AggregateError
* members, so transport wrappers like undici's `TypeError: fetch failed`
* surface the underlying failure instead of masking it. Plain structured
* failures render their own data-backed `message`. Diagnostic-surface
* rendering only (messages, notices, logs) — never parse the result; route on
* {@link HarnessError.code}.
* @param value - the caught value (`unknown` in catch clauses).
* @returns the outermost message first, each cause appended with `: ` (skipped
* when it repeats the wrapper message verbatim), and AggregateError members
* bracketed and `; `-joined.
*/
function errorChain(value) {
	const path = /* @__PURE__ */ new Set();
	const render = (current) => {
		if (path.has(current)) return "<circular cause>";
		path.add(current);
		try {
			if (!(current instanceof Error)) {
				if (typeof current === "object" && current !== null) {
					const descriptor = Object.getOwnPropertyDescriptor(current, "message");
					if (descriptor !== void 0 && "value" in descriptor && typeof descriptor.value === "string") return descriptor.value;
				}
				return String(current);
			}
			const message = current.message === "" ? current.name : current.message;
			const members = current instanceof AggregateError && current.errors.length > 0 ? ` [${current.errors.map(render).join("; ")}]` : "";
			const causeText = current.cause === void 0 || current.cause === null ? "" : render(current.cause);
			return `${message}${members}${causeText === "" || causeText === message ? "" : `: ${causeText}`}`;
		} catch {
			return "<unrenderable value>";
		} finally {
			path.delete(current);
		}
	};
	return render(value);
}
//#endregion
//#region ../../llm/llm/src/retry-policy.ts
/**
* Provider-owned request-retry policy configuration and resolution.
*
* Adapters expose one resolved policy per registered provider route; the
* optional dsh-llm-retry plugin executes it on the agent's failed-step extension point.
*
* @module @deepseek-ai/dsh-llm/retry-policy
*/
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_INITIAL_DELAY_MS = 500;
const DEFAULT_MAX_DELAY_MS = 1e4;
const DEFAULT_JITTER_RATIO = .1;
const DEFAULT_RETRYABLE_CODES = Object.freeze([
	EMPTY_RESPONSE_CODE,
	"RATE_LIMIT",
	"SERVER",
	"TIMEOUT",
	"TRANSPORT"
]);
const backoffSchema = Schema.object({
	initialDelayMs: Schema.number().max(MAX_TIMER_DELAY_MS).default(DEFAULT_INITIAL_DELAY_MS),
	maxDelayMs: Schema.number().max(MAX_TIMER_DELAY_MS).default(DEFAULT_MAX_DELAY_MS),
	jitterRatio: Schema.number().min(0).max(1).default(DEFAULT_JITTER_RATIO)
});
const normalPolicySchema = Schema.object({
	mode: Schema.const("normal").required(),
	maxRetries: Schema.number().step(1).min(0).max(Number.MAX_SAFE_INTEGER).default(DEFAULT_MAX_RETRIES),
	retryableCodes: Schema.array(Schema.string()).default([...DEFAULT_RETRYABLE_CODES]),
	backoff: backoffSchema
});
const alwaysPolicySchema = Schema.object({
	mode: Schema.const("always").required(),
	backoff: backoffSchema
});
Schema.union([normalPolicySchema, alwaysPolicySchema]);
//#endregion
//#region ../../llm/llm/src/attribution.ts
/**
* Centralize the non-secret product identity every provider request sends as `User-Agent`, keeping
* adapters from drifting. See
* `.agents/notes/implemented/architecture/2026-06-21-mandatory-app-attribution-headers.md`.
*
* App-attribution vocabulary for provider requests.
* @module @deepseek-ai/dsh-llm/attribution
*/
// KUNPENG PATCH（部署布局容错）：上游 bundle 的 `../package.json` 假设文件
// 位于 node_modules/<pkg>/lib/ 内；本 fork 被 vendored 到运行时根后，开发
// 布局下 ../ 解析到仓库根 package.json，而部署布局（~/.kunpeng/dsh/<ver>/）
// 下 ../ 指向不存在的 ~/.kunpeng/dsh/package.json 直接 MODULE_NOT_FOUND。
// 依次回退：../package.json（保留上游行为）→ ./package.json（运行时根，
// 即 dsh-runtime 自身的 0.1.0-rc.6，语义上正是原 dsh-acp 包版本）→ 硬编码。
const { version } = (() => {
	const req = createRequire(import.meta.url);
	for (const candidate of ["../package.json", "./package.json"]) {
		try {
			return req(candidate);
		} catch { /* 布局回退 */ }
	}
	return { version: "0.1.0-rc.6" };
})();
//#endregion
//#region lib/types/codec.js
/**
* Pure translation between the harness lifecycle and the automation-only ACP wire.
* @module @deepseek-ai/dsh-acp/codec
*/
/**
* KUNPENG FORK of @deepseek-ai/dsh-acp (vendored 0.1.0-rc.6, 上游锁定不改)：
* 唯一行为差异 = prompt 接受 ACP image 块，经 durable attachment store
* 持久化后以 {type:"image", attachment} 发给 agent，供声明了
* input:[text,image] 的 pi-ai 视觉模型路由原生看图。其余逻辑与上游逐行一致
* （sessions/inflight/approval/quiesce），升级上游时应重新 fork 对比。
*/
/**
* Map a harness turn ending to ACP's terminal reason vocabulary.
* @param reason - harness turn outcome.
* @returns the closest legal ACP stop reason.
*/
function turnEndToStopReason(reason) {
	switch (reason.kind) {
		case "completed": return "end_turn";
		case "max-tokens": return "max_tokens";
		case "aborted": return "end_turn";
		case "interrupted": return "cancelled";
		case "blocked":
		case "error": return "end_turn";
		/* v8 ignore next 2 -- TurnEndReason is closed and every member is handled above */
		default: return "end_turn";
	}
}
/**
* Flatten an ACP prompt's baseline blocks to text. Text blocks concatenate
* verbatim; resource links become explicit textual references so a baseline
* client can point at files without the bridge silently dropping that context.
* @param prompt - supported ACP prompt blocks.
* @returns text in wire order, with resource links rendered as bracketed references.
*/
function acpPromptToText(prompt) {
	return prompt.flatMap((block) => {
		switch (block.type) {
			case "text": return [block.text];
			case "resource_link": return [`\n[resource_link name=${JSON.stringify(block.name)} uri=${JSON.stringify(block.uri)}]\n`];
			default: return [];
		}
	}).join("");
}
/**
* KUNPENG: image blocks are now supported via the attachment store; anything
* beyond text/resource_link/image is still rejected (audio/embedded resource).
*/
function promptHasUnsupportedContent(prompt) {
	return prompt.some((block) => block.type !== "text" && block.type !== "resource_link" && block.type !== "image");
}
/** KUNPENG: decode base64 while rejecting non-canonical forms (same rule as dsh-host-apiproxy). */
function decodeImageBase64(data) {
	const decoded = Buffer.from(data, "base64");
	if (data.length === 0 || decoded.toString("base64") !== data) throw invalidParams("image data is not canonical base64");
	return new Uint8Array(decoded);
}
/**
* KUNPENG: convert ACP prompt blocks into harness user-message content, saving
* image blocks through the durable attachment store (mirrors dsh-host-apiproxy's
* durablePromptContent). resource_link stays as a textual reference, matching
* upstream flattening semantics.
* @param ctx - Cordis context (needs the attachments service).
* @param prompt - ACP prompt blocks.
* @returns harness content blocks for createUserMessage.
*/
async function durablePromptContent(ctx, prompt) {
	const store = ctx.get("attachments");
	const imageParts = prompt.filter((block) => block.type === "image");
	if (imageParts.length > 0 && store === void 0) throw invalidParams("image prompt content requires the attachment service");
	const limits = store?.imageLimits;
	if (limits && imageParts.length > limits.maxImagesPerMessage) throw invalidParams("prompt exceeds the configured image-count limit");
	const prepared = prompt.map((block) => block.type === "image" ? { block, data: decodeImageBase64(block.data) } : { block });
	if (limits) {
		const total = prepared.reduce((sum, item) => sum + (item.data ? item.data.byteLength : 0), 0);
		if (total > limits.maxMessageImageBytes) throw invalidParams("prompt exceeds the configured aggregate image-byte limit");
	}
	for (const item of prepared) if (item.data) await store.validateImage({
		data: item.data,
		mediaType: item.block.mimeType,
		...item.block.name === void 0 ? {} : { name: item.block.name }
	});
	const blocks = [];
	for (const item of prepared) {
		if (item.data) {
			const attachment = await store.saveImage({
				data: item.data,
				mediaType: item.block.mimeType,
				...item.block.name === void 0 ? {} : { name: item.block.name }
			});
			blocks.push({
				type: "image",
				attachment
			});
			continue;
		}
		if (item.block.type === "text") blocks.push({
			type: "text",
			text: item.block.text
		});
		else if (item.block.type === "resource_link") blocks.push({
			type: "text",
			text: `\n[resource_link name=${JSON.stringify(item.block.name)} uri=${JSON.stringify(item.block.uri)}]\n`
		});
	}
	return blocks;
}
//#endregion
//#region lib/types/index.js
/**
* Automation-only Agent Client Protocol server over JSON-RPC stdio.
*
* The bridge exposes fresh harness sessions to trusted programmatic clients. It
* carries prompt text, committed assistant text, cancellation, and one-shot
* permission decisions; presentation and human-interaction features stay with
* the harness's UI modules.
*
* @module @deepseek-ai/dsh-acp
*/
const name = "acp";
/** The bridge creates and owns agents; every other concern is carried by the agent composition. */
const inject = ["agents"];
/** Preserve invalid-parameter detail in the SDK wire error message. */
function invalidParams(detail) {
	return RequestError.invalidParams(void 0, detail);
}
/** Preserve failed-turn detail; plain handler errors become a generic wire internal error. */
function internalError(detail) {
	return RequestError.internalError(void 0, detail);
}
const Config = Schema.object({
	provider: Schema.string(),
	model: Schema.string()
});
/**
* Mount the automation-only ACP server.
* @param ctx - Cordis context carrying the agent factory and session events.
* @param config - Initial provider/model selection and optional test transport.
*/
function apply(ctx, config) {
	const agents = ctx.agents;
	const logger = ctx.logger;
	const sessions = /* @__PURE__ */ new Map();
	let closed = false;
	let conn;
	/** Return the bridge-owned record for an agent, rejecting same-id impostors. */
	const ownedRecord = (agent) => {
		const record = sessions.get(agent.session.id);
		return record?.agent === agent ? record : void 0;
	};
	const assertOpen = () => {
		if (closed) throw internalError("the ACP bridge has been disposed");
	};
	const requireSession = (sessionId) => {
		const record = sessions.get(sessionId);
		if (record === void 0) throw invalidParams(`unknown session: ${sessionId}`);
		return record;
	};
	/** Send a protocol update without letting a disconnected client fail an agent turn. */
	const notify = (notification) => {
		/* v8 ignore next 3 -- only a transport write failure reaches this guard. */
		conn.sessionUpdate(notification).catch((error) => {
			logger.warn(`acp: session/update failed: ${String(error)}`);
		});
	};
	const settlePrompt = (record, reason) => {
		const inflight = record.inflight;
		if (inflight === void 0) return;
		record.inflight = void 0;
		inflight.resolve(reason);
	};
	const rejectFromError = (inflight, reason) => {
		inflight.reject(internalError(`turn failed: ${reason.error.message}`));
	};
	ctx.on("session/event", (session, event) => {
		const record = sessions.get(session.header.id);
		if (record === void 0 || record.agent.session !== session) return;
		try {
			if (event.type === "assistant/message") {
				for (const block of event.data.message.content) if (block.type === "text" && block.text.length > 0) notify({
					sessionId: record.agent.session.id,
					update: {
						sessionUpdate: "agent_message_chunk",
						content: {
							type: "text",
							text: block.text
						}
					}
				});
				else if (block.type === "image") notify({
					sessionId: record.agent.session.id,
					update: {
						sessionUpdate: "agent_message_chunk",
						content: {
							type: "text",
							text: `[image attachment ${block.attachment.attachmentId}]`
						}
					}
				});
			}
		} finally {
			const inflight = record.inflight;
			if (inflight !== void 0 && event.type === "turn/end" && inflight.turn === event.data.turn) if (event.data.reason.kind === "error") {
				record.inflight = void 0;
				rejectFromError(inflight, event.data.reason);
			} else inflight.endReason = event.data.reason;
		}
	});
	ctx.on("agent/inbox/claimed", ({ agent, message, turn }) => {
		const inflight = ownedRecord(agent)?.inflight;
		if (inflight !== void 0 && inflight.messageId === message.id) inflight.turn = turn;
	});
	ctx.on("agent/error", ({ agent, turn, error }) => {
		const record = ownedRecord(agent);
		const inflight = record?.inflight;
		if (record === void 0 || inflight === void 0 || inflight.turn === turn) return;
		record.inflight = void 0;
		inflight.reject(internalError(`turn failed: ${errorChain(error)}`));
	});
	ctx.on("approval/request", (request, next) => {
		const record = ownedRecord(request.agent);
		if (record === void 0 || request.callId === void 0) return next();
		return conn.requestPermission({
			sessionId: record.agent.session.id,
			toolCall: { toolCallId: request.callId },
			options: [{
				optionId: "allow-once",
				name: "Allow once",
				kind: "allow_once"
			}, {
				optionId: "reject-once",
				name: "Reject",
				kind: "reject_once"
			}]
		}).then(({ outcome }) => {
			if (outcome.outcome === "cancelled") return "cancelled";
			return outcome.optionId === "allow-once" ? "allowed-once" : "rejected";
		});
	});
	const makeAgent = (connection) => {
		conn = connection;
		return {
			initialize(_params) {
				return Promise.resolve({
					protocolVersion: PROTOCOL_VERSION,
					agentInfo: {
						name: "deepseek-harness-acp",
						version: "0.0.1"
					},
					agentCapabilities: { promptCapabilities: {
						image: true,
						audio: false,
						embeddedContext: false
					} },
					authMethods: []
				});
			},
			authenticate(_params) {
				return Promise.resolve();
			},
			async newSession(params) {
				assertOpen();
				validateSessionParams(params);
				const sessionId = SessionId(randomUUID());
				const handle = await agents.create({
					sessionId,
					meta: { cwd: params.cwd },
					agentOptions: agentOptions(config)
				});
				/* v8 ignore next 4 -- a real stdio close can race an in-flight create. */
				if (closed) {
					await handle.dispose();
					throw internalError("connection closed during session/new");
				}
				sessions.set(sessionId, {
					agent: handle.agent,
					dispose: () => handle.dispose(),
					inflight: void 0
				});
				return { sessionId };
			},
			async prompt(params) {
				assertOpen();
				const record = requireSession(SessionId(params.sessionId));
				if (record.inflight !== void 0) throw invalidParams("a prompt is already in flight for this session");
				if (promptHasUnsupportedContent(params.prompt)) throw invalidParams("only text, resource_link and image prompt content is supported");
				const content = await durablePromptContent(ctx, params.prompt);
				const hasText = content.some((block) => block.type === "text" && block.text.trim().length > 0);
				const hasImage = content.some((block) => block.type === "image");
				if (!hasText && !hasImage) throw invalidParams("empty prompt");
				if (ctx.agents.get(record.agent.id) !== record.agent) throw internalError("prompt was not queued: the agent was disposed outside the bridge");
				const message = createUserMessage({
					content,
					source: { kind: "user" }
				});
				return { stopReason: await new Promise((resolve, reject) => {
					const inflight = {
						resolve,
						reject,
						messageId: message.id,
						turn: void 0,
						endReason: void 0
					};
					record.inflight = inflight;
					try {
						record.agent.followup(message);
					} catch (error) {
						record.inflight = void 0;
						throw internalError(`prompt was not queued: ${error instanceof Error ? error.message : String(error)}`);
					}
					/* v8 ignore stop */
					record.agent.whenIdle().then(() => {
						if (record.inflight !== inflight) return;
						record.inflight = void 0;
						const end = inflight.endReason;
						if (end === void 0) inflight.resolve("cancelled");
						else inflight.resolve(end.kind === "max-tokens" ? "end_turn" : turnEndToStopReason(end));
					});
				}) };
			},
			cancel(params) {
				const record = sessions.get(SessionId(params.sessionId));
				if (record === void 0) return Promise.resolve();
				record.agent.cancel({ kind: "user" });
				settlePrompt(record, "cancelled");
				return Promise.resolve();
			}
		};
	};
	conn = new AgentSideConnection(makeAgent, config.stream ?? ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)));
	let quiescing;
	const quiesce = () => {
		if (quiescing !== void 0) return quiescing;
		closed = true;
		const records = [...sessions.values()];
		sessions.clear();
		for (const record of records) {
			record.agent.cancel({ kind: "user" });
			settlePrompt(record, "cancelled");
		}
		quiescing = (async () => {
			const subagents = ctx.get("subagents");
			if (subagents !== void 0) try {
				await subagents.drainContinuableDescendants(records.map((record) => record.agent));
			} catch (error) {
				logger.warn(`acp: continuable subagent teardown failed: ${String(error)}`);
			}
			const disposals = await Promise.allSettled(records.map((record) => record.dispose()));
			const failures = [];
			for (const result of disposals) if (result.status === "rejected") failures.push(result.reason);
			if (failures.length > 0) {
				const detail = failures.map((failure) => errorChain(failure)).join("; ");
				throw new AggregateError(failures, `ACP agent teardown failed for ${failures.length} session(s): ${detail}`);
			}
		})();
		return quiescing;
	};
	/* v8 ignore start -- production transport rejection and teardown failure. */
	conn.closed.catch((error) => {
		logger.warn(`acp: connection closed with an error: ${String(error)}`);
	}).then(quiesce).catch((error) => {
		logger.warn(`acp: connection-close teardown failed: ${String(error)}`);
	});
	/* v8 ignore stop */
	ctx.effect(() => quiesce, "acp.connection");
}
/**
* Build per-agent options from plugin config without assigning absent optional fields.
* @param config - ACP provider/model configuration.
* @returns the configured fields only.
*/
function agentOptions(config) {
	return {
		...config.provider !== void 0 ? { provider: config.provider } : {},
		...config.model !== void 0 ? { model: config.model } : {}
	};
}
/** Reject session features outside the automation contract. */
function validateSessionParams(params) {
	if (!isAbsolute(params.cwd)) throw invalidParams(`cwd must be an absolute path: ${params.cwd}`);
	if (params.additionalDirectories !== void 0 && params.additionalDirectories.length > 0) throw invalidParams("additionalDirectories is not supported");
	if (params.mcpServers.length > 0) throw invalidParams("mcpServers is not supported");
}
//#endregion
export { Config, apply, inject, name };
