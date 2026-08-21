import { memo, useEffect, useRef, useState } from 'react';
import { nanoid } from 'nanoid';
import { BookMarked } from 'lucide-react';
import { useChatStore } from '@/stores';
import { useCopywritingStore } from '@/stores/copywritingStore';
import { buildExperienceContext } from '@/lib/copywriting/experienceEngine';
import {
  applyCopyPatches,
  buildCopyDocMap,
  formatCopyDocHtml,
  formatCopyDocMap,
  findBlockBySelection,
  formatSelectedCopyContext,
  type CopyPatch,
} from '@/lib/copywriting/documentMap';
import { backupDoc } from '@/lib/copywriting/persist';
import { buildCopywritingTaskHarness } from '@/lib/copywriting/antiAiStyle';
import AgentDrawer from '../chat/AgentDrawer';
import type { WritingExperience } from '@/lib/copywriting/types';

const STRIP_RE = /^\[用户正在鲲鹏文案工作室[\s\S]*?\]\n\n/;
const EXP_RE = /```json:experience\n([\s\S]*?)```/;
const DOC_RE = /```markdown:doc\n([\s\S]*?)```/;
const PATCH_RE = /```markdown:patch\n([\s\S]*?)```/g;
const COPY_REPLACE_RE = /```copy:replace\n([\s\S]*?)```/g;
const JSON_COPY_PATCH_RE = /```json:copy_patch\n([\s\S]*?)```/g;

type Range = {
  start: number;
  end: number;
};

function parseCopyReplaceBlocks(content: string): CopyPatch[] {
  const replacements: CopyPatch[] = [];
  COPY_REPLACE_RE.lastIndex = 0;
  let m;
  while ((m = COPY_REPLACE_RE.exec(content)) !== null) {
    const raw = m[1].replace(/^\n+|\n+$/g, '');
    const lines = raw.split('\n');
    const firstContentLine = lines.findIndex(line => line.trim().length > 0);
    if (firstContentLine < 0) continue;
    const blockId = lines[firstContentLine].trim();
    const replace = lines.slice(firstContentLine + 1).join('\n').replace(/^\n+|\n+$/g, '');
    if (blockId && replace) replacements.push({ op: 'replace_block', blockId, text: replace });
  }
  return replacements;
}

function parseJsonCopyPatches(content: string): CopyPatch[] {
  const replacements: CopyPatch[] = [];
  JSON_COPY_PATCH_RE.lastIndex = 0;
  let m;
  while ((m = JSON_COPY_PATCH_RE.exec(content)) !== null) {
    try {
      const raw = JSON.parse(m[1]);
      const items = Array.isArray(raw) ? raw : [raw];
      for (const item of items) {
        const blockId = String(item.blockId ?? item.id ?? '').trim();
        const selector = typeof item.selector === 'string' ? item.selector.trim() : undefined;
        const text = typeof item.text === 'string'
          ? item.text
          : typeof item.replace === 'string'
            ? item.replace
            : '';
        const find = typeof item.find === 'string' ? item.find : undefined;
        const op = typeof item.op === 'string' ? item.op : undefined;
        const hash = typeof item.hash === 'string' ? item.hash : undefined;
        if ((blockId || selector || find) && (text || find)) {
          replacements.push({
            op: op === 'replace_text' || op === 'insert_before' || op === 'insert_after' || op === 'replace_block'
              ? op
              : undefined,
            blockId,
            selector,
            hash,
            find,
            text,
          });
        }
      }
    } catch {
      // Invalid agent JSON should not break normal chat rendering.
    }
  }
  return replacements;
}

function contentFromEmptyDocPatch(patches: CopyPatch[]): string | null {
  const usable = patches
    .map((patch) => {
      const selector = (patch.selector ?? '').trim();
      const isWholeDocTarget = selector === '.doc-content' || selector === '[data-doc-empty="true"]' || selector === 'article';
      const text = (patch.text ?? patch.replace ?? '').trim();
      if (!text) return '';
      if (patch.op === 'replace_text' && patch.find) return '';
      if (patch.op === 'insert_before' || patch.op === 'insert_after') return '';
      if (!patch.blockId && !patch.find && (isWholeDocTarget || selector || patch.op === 'replace_block' || !patch.op)) return text;
      if (!patch.blockId && !patch.find && text) return text;
      return '';
    })
    .filter(Boolean);
  if (usable.length === 0) return null;
  return usable.join('\n\n').trim();
}

function canonicalChar(char: string): string {
  const map: Record<string, string> = {
    '，': ',',
    '。': '.',
    '！': '!',
    '？': '?',
    '：': ':',
    '；': ';',
    '“': '"',
    '”': '"',
    '‘': "'",
    '’': "'",
    '（': '(',
    '）': ')',
    '【': '[',
    '】': ']',
    '《': '<',
    '》': '>',
    '、': ',',
    '—': '-',
    '–': '-',
  };
  return map[char] ?? char.toLowerCase();
}

function buildNormalizedIndex(input: string): { value: string; map: number[] } {
  let value = '';
  const map: number[] = [];
  let lastWasSpace = false;
  for (let i = 0; i < input.length; i += 1) {
    const raw = input[i];
    if (/\s/.test(raw)) {
      if (!lastWasSpace) {
        value += ' ';
        map.push(i);
        lastWasSpace = true;
      }
      continue;
    }
    value += canonicalChar(raw);
    map.push(i);
    lastWasSpace = false;
  }
  const first = value.search(/\S/);
  if (first < 0) return { value: '', map: [] };
  let last = value.length - 1;
  while (last > first && /\s/.test(value[last])) last -= 1;
  return { value: value.slice(first, last + 1), map: map.slice(first, last + 1) };
}

function findNormalizedRange(source: string, target: string): Range | null {
  const normalizedSource = buildNormalizedIndex(source);
  const normalizedTarget = buildNormalizedIndex(target);
  if (!normalizedTarget.value) return null;
  const startInNormalized = normalizedSource.value.indexOf(normalizedTarget.value);
  if (startInNormalized < 0) return null;
  const sourceStart = normalizedSource.map[startInNormalized] ?? 0;
  const lastNormalizedIndex = startInNormalized + normalizedTarget.value.length - 1;
  const sourceEnd = (normalizedSource.map[lastNormalizedIndex] ?? source.length - 1) + 1;
  return { start: sourceStart, end: sourceEnd };
}

function diceSimilarity(a: string, b: string): number {
  const left = buildNormalizedIndex(a).value.replace(/\s+/g, '');
  const right = buildNormalizedIndex(b).value.replace(/\s+/g, '');
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.length < 2 || right.length < 2) return left === right ? 1 : 0;
  const counts = new Map<string, number>();
  for (let i = 0; i < left.length - 1; i += 1) {
    const gram = left.slice(i, i + 2);
    counts.set(gram, (counts.get(gram) ?? 0) + 1);
  }
  let hits = 0;
  for (let i = 0; i < right.length - 1; i += 1) {
    const gram = right.slice(i, i + 2);
    const count = counts.get(gram) ?? 0;
    if (count > 0) {
      hits += 1;
      counts.set(gram, count - 1);
    }
  }
  return (2 * hits) / (left.length + right.length - 2);
}

function buildFallbackRanges(content: string): Range[] {
  const ranges: Range[] = [];
  let start = 0;
  for (const line of content.split('\n')) {
    const end = start + line.length;
    if (line.trim()) ranges.push({ start, end });
    start = end + 1;
  }

  const paragraphRe = /[^\n](?:[\s\S]*?[^\n])?(?=\n{2,}|$)/g;
  let m;
  while ((m = paragraphRe.exec(content)) !== null) {
    const value = m[0];
    if (value.includes('\n') && value.trim()) {
      ranges.push({ start: m.index, end: m.index + value.length });
    }
  }
  return ranges;
}

function findFuzzyRange(content: string, target: string): Range | null {
  const targetNorm = buildNormalizedIndex(target).value;
  if (targetNorm.length < 6) return null;
  const candidates = buildFallbackRanges(content);
  let best: { range: Range; score: number } | null = null;
  let secondBest = 0;
  for (const range of candidates) {
    const candidate = content.slice(range.start, range.end);
    const score = diceSimilarity(candidate, target);
    if (!best || score > best.score) {
      secondBest = best?.score ?? 0;
      best = { range, score };
    } else if (score > secondBest) {
      secondBest = score;
    }
  }
  if (!best || best.score < 0.82 || best.score - secondBest < 0.04) return null;
  return best.range;
}

function applyPatches(content: string, patchBlock: string): string {
  let result = content;
  const FIND_REPLACE_RE = /<<<\s*FIND\n([\s\S]*?)\n>>>\n<<<\s*REPLACE\n([\s\S]*?)\n>>>/g;
  let m;
  while ((m = FIND_REPLACE_RE.exec(patchBlock)) !== null) {
    const find = m[1];
    const replace = m[2];
    if (result.includes(find)) {
      result = result.replace(find, replace);
      continue;
    }

    const normalizedRange = findNormalizedRange(result, find);
    if (normalizedRange) {
      result = result.slice(0, normalizedRange.start) + replace + result.slice(normalizedRange.end);
      continue;
    }

    const fuzzyRange = findFuzzyRange(result, find);
    if (fuzzyRange) {
      result = result.slice(0, fuzzyRange.start) + replace + result.slice(fuzzyRange.end);
    }
  }
  return result;
}

function buildCopywritingHarness(expCtx: string, docCtx: string, taskSignal: string): string {
  return `[用户正在鲲鹏文案工作室]

你是文案工作室里的写作 agent。请严格遵循以下输出协议：
1. 最稳写入方式：优先调用 copywriting_set_doc / copywriting_patch_doc 工具。不能调用工具时，才输出下面的写回代码块。
2. 如果当前没有打开文档，或 HTML 操作视图是 \`<article data-doc-empty="true"></article>\`，说明编辑器为空。此时任何写入都必须使用 \`\`\`markdown:doc\`\`\` 整篇写入，禁止使用 copy_patch、禁止定位 .doc-content。
3. 只有当前文档存在可见的 \`data-block-id\` 块时，才使用 \`\`\`json:copy_patch\`\`\` 做局部修改。copy_patch 必须命中具体块编号或 \`[data-block-id='B0007']\` selector，不要使用 .doc-content 这类不存在的容器。
4. 用户要求“新写一篇、写入编辑器、从空白开始、替换全文、生成完整文案”时，使用 \`\`\`markdown:doc\`\`\`。
5. 当前文档会以“Markdown 生成的 HTML 操作视图”提供。HTML 里的 section 是可修改节点，data-block-id 是稳定锚点，正文最终仍会回写为 Markdown。
   - data-content="preview" 表示只提供摘要，用于定位。
   - data-content="full" 表示提供完整块内容，可以直接精修。
6. json:copy_patch 支持数组。常用格式：
   - 替换整块：{"op":"replace_block","blockId":"B0007","hash":"abc123","text":"新的完整块内容"}
   - 用 selector 替换整块：{"op":"replace_block","selector":"[data-block-id='B0007']","hash":"abc123","text":"新的 Markdown 块内容"}
   - 替换块内文字：{"op":"replace_text","blockId":"B0007","hash":"abc123","find":"原文片段","text":"替换后的片段"}
   - 插入内容：{"op":"insert_after","blockId":"B0007","text":"新增内容"}
7. text 字段必须写 Markdown 内容，不要写包裹用的 section 标签。
8. 文档地图里的 B 编号是段落/表格/标题锚点，不是行号。修改时必须优先选择最小影响范围的块。
9. 不要要求用户重新粘贴全文；如果文档地图不足以定位，先说明需要哪个关键词或哪一段。
10. 兼容旧协议：也可以使用 \`\`\`copy:replace\`\`\`，第一行是块编号，后面是替换内容。
11. 如果只是分析、建议、提纲或问用户问题，不要输出写回代码块。
12. 输出经验沉淀时可追加 \`\`\`json:experience\`\`\`，但不要把它混入文档正文。
13. 新写、改写或扩写完成后，调用 copywriting_review_doc 做一次机械审校。工具返回 blocker 或分数低于 80 时，只修命中的问题段，再复查一次；最多两轮，禁止为了刷分改坏事实和用户声线。
14. copywriting_set_doc / copywriting_patch_doc 的返回值自带文风审校。不要忽略审校结果，也不要把审校清单原样塞进正文。
15. 不展示内部提纲、自检过程或思维链。需要向用户解释时，只说做了哪些可核验的修改。
16. 用户要求“按批注修改、处理批注”或指定批注 id 时，先调用 copywriting_get_comments。逐条根据 body 修改 quote 对应原文，只做最小必要改动。
17. 只有 copywriting_patch_doc / copywriting_replace_text 明确写入成功并完成必要审校后，才能调用 copywriting_resolve_comment。意图不清、涉及事实变化或锚点失效时先询问用户，不能把未处理的批注直接标记完成。

${buildCopywritingTaskHarness(taskSignal)}

${expCtx}${docCtx}

用户请求：
`;
}

interface Props {
  onSendMessage: (content: string, filePaths?: string[]) => void;
  onAbort: () => void;
}

export function dispatchCopywritingPrompt(prompt: string, selectedText?: string) {
  window.dispatchEvent(new CustomEvent('kunpeng-copywriting-prompt', { detail: { prompt, selectedText } }));
}

function CopywritingChatPanel({ onSendMessage, onAbort }: Props) {
  const [open, setOpen] = useState(true);
  const [queued, setQueued] = useState<{ prompt: string; selectedText?: string } | null>(null);
  const isStreaming = useChatStore(s => s.streamingPhase) !== 'idle';
  const lastExtractedRef = useRef<string | null>(null);
  const streamDocIdRef = useRef<string | null>(null);
  const backedUpRef = useRef(false);

  const chat = useChatStore(s => s.messages);

  // 流结束后：提取 markdown:doc → 备份旧版 → 写入编辑器；提取 experience
  useEffect(() => {
    if (isStreaming) return;
    const last = chat[chat.length - 1];
    if (!last || last.role !== 'assistant') return;
    if (lastExtractedRef.current === last.content) return;
    lastExtractedRef.current = last.content;

    const store = useCopywritingStore.getState();

    // 提取 AI 标记的文案内容（全量替换 或 增量补丁）
    const docMatch = DOC_RE.exec(last.content);
    if (docMatch) {
      const newContent = docMatch[1].trim();
      let docId = store.activeDocId;
      if (!docId) {
        const doc = store.createDoc();
        docId = doc.id;
      }
      const oldDoc = store.docs.find(d => d.id === docId);
      if (oldDoc && oldDoc.content.trim()) {
        void backupDoc(oldDoc);
      }
      store.updateDoc(docId, { content: newContent });
    } else {
      const docId = store.activeDocId;
      const oldDoc = docId ? store.docs.find(d => d.id === docId) : null;
      if (docId && oldDoc) {
        let nextContent = oldDoc.content;
        const copyPatches = [
          ...parseCopyReplaceBlocks(last.content),
          ...parseJsonCopyPatches(last.content),
        ];
        if (copyPatches.length > 0) {
          if (!nextContent.trim()) {
            const wholeDoc = contentFromEmptyDocPatch(copyPatches);
            if (wholeDoc) {
              nextContent = wholeDoc;
            } else {
              nextContent = applyCopyPatches(nextContent, copyPatches);
            }
          } else {
            nextContent = applyCopyPatches(nextContent, copyPatches);
          }
        }

        PATCH_RE.lastIndex = 0;
        let patchMatch;
        while ((patchMatch = PATCH_RE.exec(last.content)) !== null) {
          nextContent = applyPatches(nextContent, patchMatch[1]);
        }

        if (nextContent !== oldDoc.content) {
          void backupDoc(oldDoc);
          store.updateDoc(docId, { content: nextContent });
        }
      }
    }

    // 提取经验
    const expMatch = EXP_RE.exec(last.content);
    if (!expMatch) return;
    try {
      const raw = JSON.parse(expMatch[1]);
      const { activeDocId, docs } = store;
      const activeDoc = docs.find(d => d.id === activeDocId);
      const exp: WritingExperience = {
        id: nanoid(10),
        timestamp: Date.now(),
        docId: activeDocId ?? '',
        docTitle: activeDoc?.title ?? '未命名',
        styleNotes: Array.isArray(raw.styleNotes) ? raw.styleNotes : raw.styleNotes ? [raw.styleNotes] : [],
        vocabularyHits: Array.isArray(raw.vocabularyHits) ? raw.vocabularyHits : raw.vocabularyHits ? [raw.vocabularyHits] : [],
        tonePreference: raw.tonePreference ?? '',
        structurePattern: raw.structurePattern ?? '',
        whatWorked: raw.whatWorked ?? '',
        whatToImprove: raw.whatToImprove ?? '',
      };
      void store.appendExperience(exp);
    } catch { /* ignore parse errors */ }
  }, [chat, isStreaming]);

  // Stream text is a high-frequency external signal. Subscribe imperatively so
  // every token does not re-render this wrapper and the whole Agent drawer.
  // Keep the preview live without rewriting the whole document for every token.
  // The final idle transition always performs one exact sync.
  useEffect(() => {
    let latestContent = '';
    let lastSyncedContent = '';
    let syncTimer: ReturnType<typeof setTimeout> | null = null;
    const marker = '```markdown:doc\n';
    const previewCadenceMs = 900;
    const minimumPreviewDelta = 192;

    const resetStreamTarget = () => {
      streamDocIdRef.current = null;
      backedUpRef.current = false;
      latestContent = '';
      lastSyncedContent = '';
    };

    const syncPartialDocument = (force = false) => {
      syncTimer = null;
      const fenceStart = latestContent.indexOf(marker);
      if (fenceStart < 0) return;

      const store = useCopywritingStore.getState();
      let docId = streamDocIdRef.current ?? store.activeDocId;
      if (!docId) {
        const created = store.createDoc();
        docId = created.id;
      }
      streamDocIdRef.current = docId;

      if (!backedUpRef.current) {
        backedUpRef.current = true;
        const oldDoc = store.docs.find(d => d.id === docId);
        if (oldDoc?.content.trim()) void backupDoc(oldDoc);
      }

      const bodyStart = fenceStart + marker.length;
      const fenceEnd = latestContent.indexOf('\n```', bodyStart);
      const partial = fenceEnd >= 0
        ? latestContent.slice(bodyStart, fenceEnd)
        : latestContent.slice(bodyStart);
      if (!force && fenceEnd < 0 && Math.abs(partial.length - lastSyncedContent.length) < minimumPreviewDelta) {
        return;
      }
      const current = useCopywritingStore.getState().docs.find(d => d.id === docId);
      if (partial && current?.content !== partial) {
        store.updateDoc(docId, { content: partial });
        lastSyncedContent = partial;
      }
    };

    const unsubscribe = useChatStore.subscribe((state, previous) => {
      if (state.streamingPhase === 'idle') {
        if (syncTimer) clearTimeout(syncTimer);
        syncTimer = null;
        syncPartialDocument(true);
        resetStreamTarget();
        return;
      }
      if (state.streamingContent === previous.streamingContent) return;
      latestContent = state.streamingContent;
      if (!latestContent.includes(marker) || syncTimer) return;
      syncTimer = setTimeout(() => syncPartialDocument(false), previewCadenceMs);
    });

    return () => {
      unsubscribe();
      if (syncTimer) clearTimeout(syncTimer);
    };
  }, []);

  const sendWithContext = (text: string, files?: string[], selectedText?: string) => {
    const { styleProfile, activeDocId, docs } = useCopywritingStore.getState();
    const expCtx = buildExperienceContext(styleProfile);
    const activeDoc = activeDocId ? docs.find(d => d.id === activeDocId) : null;
    let docCtx = '\n\n当前编辑器中没有打开的文档。\n';
    if (activeDoc) {
      const blocks = buildCopyDocMap(activeDoc.content);
      const openComments = (activeDoc.comments ?? []).filter(comment => comment.status === 'open');
      const smallDoc = activeDoc.content.length <= 2200;
      const selectedBlock = selectedText ? findBlockBySelection(activeDoc.content, selectedText) : null;
      const emptyDocHint = blocks.length === 0
        ? '\n\n写入规则提醒：当前文档为空，HTML 为 data-doc-empty=true。若要写入编辑器，必须使用 markdown:doc 整篇写入；禁止使用 json:copy_patch 或 .doc-content selector。\n'
        : '';
      docCtx = `\n\n当前编辑器中的文档标题：「${activeDoc.title}」\n` +
        `当前文档 HTML 操作视图（由 Markdown 生成，修改时优先使用 data-block-id / selector；长文档默认只发摘要）：\n${formatCopyDocHtml(activeDoc.content, {
          includeAllText: smallDoc,
          fullBlockIds: selectedBlock ? [selectedBlock.id] : [],
        })}\n\n` +
        `当前文档地图（辅助阅读，局部修改优先使用这些块编号和 hash）：\n${formatCopyDocMap(activeDoc.content)}\n` +
        formatSelectedCopyContext(activeDoc.content, selectedText) +
        (openComments.length > 0
          ? `\n\n当前有 ${openComments.length} 条待处理批注：\n${openComments.map(comment => JSON.stringify({
              id: comment.id,
              body: comment.body,
              quote: comment.quote,
              start: comment.start,
              end: comment.end,
              orphaned: comment.orphaned === true,
            })).join('\n')}\n`
          : '\n\n当前没有待处理批注。\n') +
        emptyDocHint +
        (smallDoc
          ? '\n\n当前短文档已在 HTML 操作视图中提供完整内容。\n'
          : `\n\n当前文档共 ${blocks.length} 个可修改块，全文较长，本轮只提供文档地图和选中块上下文。\n`);
    } else {
      docCtx += '写入规则提醒：当前没有文档。若用户要求写入编辑器，必须使用 markdown:doc 整篇写入，或调用 copywriting_set_doc 创建并写入。\n';
    }

    const taskSignal = `${text}\n${activeDoc?.title ?? ''}\n${activeDoc?.content.slice(0, 600) ?? ''}`;
    const prefix = buildCopywritingHarness(expCtx, docCtx, taskSignal);
    onSendMessage(prefix + text, files);
  };

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ prompt: string; selectedText?: string }>).detail;
      const prompt = detail?.prompt;
      const selectedText = detail?.selectedText;
      if (!prompt) return;
      setOpen(true);
      if (useChatStore.getState().streamingPhase === 'idle') {
        setTimeout(() => sendWithContext(prompt, undefined, selectedText), 250);
      } else {
        setQueued({ prompt, selectedText });
      }
    };
    window.addEventListener('kunpeng-copywriting-prompt', handler);
    return () => window.removeEventListener('kunpeng-copywriting-prompt', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!queued || isStreaming) return;
    const p = queued;
    setQueued(null);
    setTimeout(() => sendWithContext(p.prompt, undefined, p.selectedText), 250);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queued, isStreaming]);

  return (
    <AgentDrawer
      open={open}
      onOpenChange={setOpen}
      title="文案大师"
      variant="light"
      stripPrefixRe={STRIP_RE}
      greeting={{ hello: 'Hi，文案工作室就绪！', title: '告诉我你要写什么' }}
      suggestions={[
        '帮品牌 XX 策划一条抖音短视频广告',
        '分析诊断我这个剧本的结构和角色',
        '帮我写一个丽江旅行 VLOG 脚本',
        '把这段文案改成更有感染力的风格',
      ]}
      onSend={(text, files) => sendWithContext(text, files)}
      onAbort={onAbort}
      placeholder="描述你的写作需求，或直接粘贴文字让我润色"
      extraActions={
        <button
          onClick={() => sendWithContext('请总结本次对话的写作经验，输出 json:experience 块。')}
          disabled={isStreaming}
          className="h-7 px-2 rounded-full flex items-center gap-1 text-[11px] transition-colors disabled:opacity-40"
          style={{ color: '#6B7280' }}
          onMouseEnter={e => { e.currentTarget.style.color = '#1A1A1A'; e.currentTarget.style.background = '#F3F4F6'; }}
          onMouseLeave={e => { e.currentTarget.style.color = '#6B7280'; e.currentTarget.style.background = 'transparent'; }}
          title="让 AI 总结本次写作经验"
        >
          <BookMarked size={13} />
          总结经验
        </button>
      }
    />
  );
}

export default memo(CopywritingChatPanel);
