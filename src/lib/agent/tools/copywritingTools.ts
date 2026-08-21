import type { Tool, ToolResult } from '../types';
import { useCopywritingStore } from '@/stores/copywritingStore';
import type { CopyDoc } from '@/lib/copywriting/types';
import {
  applyCopyPatches,
  buildCopyDocMap,
  formatCopyDocHtml,
  formatCopyDocMap,
  type CopyPatch,
} from '@/lib/copywriting/documentMap';
import { backupDoc, writeDoc, writeDocsIndex } from '@/lib/copywriting/persist';
import { auditCopywriting, formatWritingAuditForAgent } from '@/lib/copywriting/qualityAudit';

function getDoc(docId?: unknown): CopyDoc | null {
  const store = useCopywritingStore.getState();
  const id = typeof docId === 'string' && docId.trim() ? docId.trim() : store.activeDocId;
  return id ? store.docs.find((doc) => doc.id === id) ?? null : null;
}

function summarizeDoc(doc: CopyDoc) {
  const blocks = buildCopyDocMap(doc.content);
  const comments = doc.comments ?? [];
  return {
    id: doc.id,
    title: doc.title,
    contentLength: doc.content.length,
    contentRevision: doc.contentRevision ?? 0,
    blockCount: blocks.length,
    empty: blocks.length === 0,
    commentCount: comments.length,
    openCommentCount: comments.filter(comment => comment.status === 'open').length,
    updatedAt: doc.updatedAt,
  };
}

function summarizeComments(doc: CopyDoc, status: 'open' | 'resolved' | 'all' = 'open') {
  return (doc.comments ?? [])
    .filter(comment => status === 'all' || comment.status === status)
    .map(comment => ({
      id: comment.id,
      status: comment.status,
      body: comment.body,
      quote: comment.quote,
      start: comment.start,
      end: comment.end,
      prefix: comment.prefix,
      suffix: comment.suffix,
      orphaned: comment.orphaned === true,
      resolutionNote: comment.resolutionNote,
      sourceRevision: comment.sourceRevision,
      createdAt: comment.createdAt,
    }));
}

function summarizeAudit(content: string) {
  const audit = auditCopywriting(content);
  return {
    score: audit.score,
    grade: audit.grade,
    blockerCount: audit.blockerCount,
    warningCount: audit.warningCount,
    report: formatWritingAuditForAgent(audit),
  };
}

async function persistDoc(docId: string) {
  const store = useCopywritingStore.getState();
  const doc = store.docs.find((item) => item.id === docId);
  if (doc) await writeDoc(doc);
  await writeDocsIndex(store.docs);
}

function patchTextForEmptyDoc(patches: CopyPatch[]): string | null {
  const parts = patches
    .map((patch) => {
      const text = String(patch.text ?? patch.replace ?? '').trim();
      if (!text) return '';
      if (patch.op === 'replace_text' && patch.find) return '';
      if (patch.op === 'insert_before' || patch.op === 'insert_after') return '';
      const selector = (patch.selector ?? '').trim();
      if (!patch.blockId && !patch.find) return text;
      if (selector === '.doc-content' || selector === '[data-doc-empty="true"]' || selector === 'article') return text;
      return '';
    })
    .filter(Boolean);
  return parts.length > 0 ? parts.join('\n\n').trim() : null;
}

function parsePatches(input: unknown): CopyPatch[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const raw = item as Record<string, unknown>;
      const patch: CopyPatch = {};
      if (typeof raw.op === 'string') patch.op = raw.op as CopyPatch['op'];
      if (typeof raw.blockId === 'string') patch.blockId = raw.blockId;
      if (typeof raw.id === 'string' && !patch.blockId) patch.blockId = raw.id;
      if (typeof raw.selector === 'string') patch.selector = raw.selector;
      if (typeof raw.hash === 'string') patch.hash = raw.hash;
      if (typeof raw.find === 'string') patch.find = raw.find;
      if (typeof raw.replace === 'string') patch.replace = raw.replace;
      if (typeof raw.text === 'string') patch.text = raw.text;
      return patch;
    })
    .filter((patch): patch is CopyPatch => !!patch && !!(patch.blockId || patch.selector || patch.find || patch.text || patch.replace));
}

function normalizeText(input: string): string {
  return input
    .replace(/\s+/g, ' ')
    .replace(/[，。！？：；“”‘’（）【】《》、]/g, (char) => {
      const map: Record<string, string> = {
        '，': ',', '。': '.', '！': '!', '？': '?', '：': ':', '；': ';',
        '“': '"', '”': '"', '‘': "'", '’': "'", '（': '(', '）': ')',
        '【': '[', '】': ']', '《': '<', '》': '>', '、': ',',
      };
      return map[char] ?? char;
    })
    .trim()
    .toLowerCase();
}

function replaceText(content: string, find: string, replace: string, replaceAll: boolean): { content: string; count: number } {
  if (!find) return { content, count: 0 };
  const exactCount = content.split(find).length - 1;
  if (exactCount > 0) {
    return {
      content: replaceAll ? content.split(find).join(replace) : content.replace(find, replace),
      count: replaceAll ? exactCount : 1,
    };
  }

  const normalizedFind = normalizeText(find);
  if (!normalizedFind) return { content, count: 0 };
  const blocks = buildCopyDocMap(content);
  for (const block of blocks) {
    if (normalizeText(block.text).includes(normalizedFind)) {
      return {
        content: content.slice(0, block.start) + replace + content.slice(block.end),
        count: 1,
      };
    }
  }
  return { content, count: 0 };
}

function ok(output: unknown): ToolResult {
  return { success: true, output: typeof output === 'string' ? output : JSON.stringify(output, null, 2) };
}

export const copywritingGetStateTool: Tool = {
  definition: {
    name: 'copywriting_get_state',
    description: '读取文案工作室当前编辑器状态、文档地图和 HTML 操作视图。写入前先调用它确认文档是否为空；空文档必须整篇写入，不能 patch。',
    parameters: {
      type: 'object',
      properties: {
        include_content: { type: 'boolean', description: '是否返回完整正文，默认 false。长文档慎用。' },
        doc_id: { type: 'string', description: '可选，指定文档 id；默认当前打开文档' },
      },
    },
  },
  risk: 'safe',
  async execute(params) {
    const store = useCopywritingStore.getState();
    const doc = getDoc(params.doc_id);
    if (!doc) {
      return ok({
        activeDocId: store.activeDocId,
        docs: store.docs.map(summarizeDoc),
        message: '当前没有打开文档。要写入编辑器请调用 copywriting_set_doc 创建并写入，或输出 markdown:doc。',
      });
    }
    return ok({
      activeDocId: store.activeDocId,
      doc: {
        ...summarizeDoc(doc),
        content: params.include_content === true ? doc.content : undefined,
        htmlView: formatCopyDocHtml(doc.content, { includeAllText: doc.content.length <= 2200 }),
        docMap: formatCopyDocMap(doc.content),
        openComments: summarizeComments(doc, 'open'),
      },
      docs: store.docs.map(summarizeDoc),
    });
  },
};

export const copywritingSetDocTool: Tool = {
  definition: {
    name: 'copywriting_set_doc',
    description: '整篇写入文案编辑器。适合空文档、新写一篇、替换全文、创建新文档。这个工具会自动备份旧内容并立即持久化。',
    parameters: {
      type: 'object',
      properties: {
        content: { type: 'string', description: '要写入编辑器的完整 Markdown 正文' },
        title: { type: 'string', description: '可选，文档标题' },
        doc_id: { type: 'string', description: '可选，指定文档 id；默认当前打开文档' },
        create_if_missing: { type: 'boolean', description: '没有目标文档时是否自动创建，默认 true' },
      },
      required: ['content'],
    },
  },
  risk: 'safe',
  async execute(params) {
    const content = String(params.content ?? '');
    if (!content.trim()) return { success: false, output: '', error: 'content 不能为空' };
    const store = useCopywritingStore.getState();
    let doc = getDoc(params.doc_id);
    if (!doc) {
      if (params.create_if_missing === false) return { success: false, output: '', error: '当前没有目标文档' };
      doc = store.createDoc();
    }
    if (doc.content.trim()) await backupDoc(doc);
    useCopywritingStore.getState().updateDoc(doc.id, {
      content,
      title: typeof params.title === 'string' && params.title.trim() ? params.title.trim() : doc.title,
    });
    await persistDoc(doc.id);
    const next = getDoc(doc.id);
    return ok({
      message: '已写入文案编辑器',
      doc: next ? summarizeDoc(next) : { id: doc.id },
      qualityAudit: summarizeAudit(content),
    });
  },
};

export const copywritingPatchDocTool: Tool = {
  definition: {
    name: 'copywriting_patch_doc',
    description: '按文档块局部修改文案编辑器。只用于已有 data-block-id 的文档；空文档会把可识别的 replace_block text 当整篇内容写入，避免静默失败。',
    parameters: {
      type: 'object',
      properties: {
        patches: {
          type: 'array',
          description: 'CopyPatch 数组：{op, blockId, selector, hash, find, text}',
          items: { type: 'object' },
        },
        doc_id: { type: 'string', description: '可选，指定文档 id；默认当前打开文档' },
      },
      required: ['patches'],
    },
  },
  risk: 'safe',
  async execute(params) {
    const doc = getDoc(params.doc_id);
    if (!doc) return { success: false, output: '', error: '当前没有打开文档，请先用 copywriting_set_doc 创建并写入' };
    const patches = parsePatches(params.patches);
    if (patches.length === 0) return { success: false, output: '', error: 'patches 为空或格式不正确' };

    let nextContent = doc.content;
    if (!doc.content.trim()) {
      const wholeDoc = patchTextForEmptyDoc(patches);
      if (!wholeDoc) return { success: false, output: '', error: '当前文档为空，patch 没有可整篇写入的 text；请改用 copywriting_set_doc' };
      nextContent = wholeDoc;
    } else {
      nextContent = applyCopyPatches(doc.content, patches);
    }
    if (nextContent === doc.content) {
      return { success: false, output: '', error: '没有任何 patch 命中文档。请先调用 copywriting_get_state 获取最新块编号。' };
    }
    if (doc.content.trim()) await backupDoc(doc);
    useCopywritingStore.getState().updateDoc(doc.id, { content: nextContent });
    await persistDoc(doc.id);
    const next = getDoc(doc.id);
    return ok({
      message: '已修改文案编辑器',
      doc: next ? summarizeDoc(next) : { id: doc.id },
      qualityAudit: summarizeAudit(nextContent),
    });
  },
};

export const copywritingReplaceTextTool: Tool = {
  definition: {
    name: 'copywriting_replace_text',
    description: '在文案编辑器里做文本替换。优先精确替换；精确失败时会按段落做轻量容错定位。适合用户说“把某句话改成...”的场景。',
    parameters: {
      type: 'object',
      properties: {
        find: { type: 'string', description: '要查找的原文片段' },
        replace: { type: 'string', description: '替换后的文字' },
        replace_all: { type: 'boolean', description: '是否全局替换，默认 false' },
        doc_id: { type: 'string', description: '可选，指定文档 id；默认当前打开文档' },
      },
      required: ['find', 'replace'],
    },
  },
  risk: 'safe',
  async execute(params) {
    const doc = getDoc(params.doc_id);
    if (!doc) return { success: false, output: '', error: '当前没有打开文档' };
    const find = String(params.find ?? '');
    const replacement = String(params.replace ?? '');
    const result = replaceText(doc.content, find, replacement, params.replace_all === true);
    if (result.count <= 0 || result.content === doc.content) {
      return { success: false, output: '', error: '没有找到可替换的文字。请先调用 copywriting_get_state 查看文档内容或块编号。' };
    }
    await backupDoc(doc);
    useCopywritingStore.getState().updateDoc(doc.id, { content: result.content });
    await persistDoc(doc.id);
    return ok({
      message: `已替换 ${result.count} 处`,
      doc: summarizeDoc(getDoc(doc.id) ?? doc),
      qualityAudit: summarizeAudit(result.content),
    });
  },
};

export const copywritingReviewDocTool: Tool = {
  definition: {
    name: 'copywriting_review_doc',
    description: '审校当前文案的模板化表达、破折号、对立句、连接词、重复句首、重复意象和空泛词。用于生成或改写后的质量闸门；它不自动改文案。',
    parameters: {
      type: 'object',
      properties: {
        doc_id: { type: 'string', description: '可选，指定文档 id；默认当前打开文档' },
      },
    },
  },
  risk: 'safe',
  async execute(params) {
    const doc = getDoc(params.doc_id);
    if (!doc) return { success: false, output: '', error: '当前没有打开文档' };
    const audit = auditCopywriting(doc.content);
    return ok({
      doc: summarizeDoc(doc),
      qualityAudit: {
        score: audit.score,
        grade: audit.grade,
        kind: audit.kind,
        blockerCount: audit.blockerCount,
        warningCount: audit.warningCount,
        issues: audit.issues,
        report: formatWritingAuditForAgent(audit),
      },
      nextAction: audit.grade === 'clean'
        ? '通过机械审校。仍需人工确认事实、创意和情感是否成立。'
        : '只修改 issues 命中的最小段落，然后再次调用 copywriting_review_doc；最多复查两轮。',
    });
  },
};

export const copywritingGetCommentsTool: Tool = {
  definition: {
    name: 'copywriting_get_comments',
    description: '读取文案批注及其锚定原文。处理批注前必须先调用；批注正文 body 是修改要求，quote/prefix/suffix 用于确认目标位置。',
    parameters: {
      type: 'object',
      properties: {
        doc_id: { type: 'string', description: '可选，指定文档 id；默认当前打开文档' },
        status: { type: 'string', enum: ['open', 'resolved', 'all'], description: '筛选状态，默认 open' },
        comment_id: { type: 'string', description: '可选，只读取一条批注' },
      },
    },
  },
  risk: 'safe',
  async execute(params) {
    const doc = getDoc(params.doc_id);
    if (!doc) return { success: false, output: '', error: '当前没有打开文档' };
    const status = params.status === 'resolved' || params.status === 'all' ? params.status : 'open';
    const commentId = typeof params.comment_id === 'string' ? params.comment_id.trim() : '';
    const comments = summarizeComments(doc, status).filter(comment => !commentId || comment.id === commentId);
    return ok({
      doc: summarizeDoc(doc),
      comments,
      instruction: comments.length > 0
        ? '逐条确认批注意图，使用 copywriting_patch_doc 做最小修改。正文写入成功后，再调用 copywriting_resolve_comment。'
        : '没有符合条件的批注。',
    });
  },
};

export const copywritingResolveCommentTool: Tool = {
  definition: {
    name: 'copywriting_resolve_comment',
    description: '将一条文案批注标记为已解决。只能在对应正文修改已经成功写入后调用；不能用它跳过修改。',
    parameters: {
      type: 'object',
      properties: {
        comment_id: { type: 'string', description: '要解决的批注 id' },
        resolution_note: { type: 'string', description: '可选，简要说明实际做了什么修改' },
        doc_id: { type: 'string', description: '可选，指定文档 id；默认当前打开文档' },
      },
      required: ['comment_id'],
    },
  },
  risk: 'safe',
  async execute(params) {
    const doc = getDoc(params.doc_id);
    if (!doc) return { success: false, output: '', error: '当前没有打开文档' };
    const commentId = String(params.comment_id ?? '').trim();
    const comment = (doc.comments ?? []).find(item => item.id === commentId);
    if (!comment) return { success: false, output: '', error: `没有找到批注 ${commentId}` };
    if (comment.status === 'resolved') return ok({ message: '批注已经是已解决状态', commentId });
    if (comment.sourceRevision != null && (doc.contentRevision ?? 0) <= comment.sourceRevision) {
      return {
        success: false,
        output: '',
        error: '正文在这条批注创建或更新后还没有成功写入修改。请先调用 copywriting_patch_doc 或 copywriting_replace_text，确认成功后再解决批注。',
      };
    }
    useCopywritingStore.getState().updateComment(doc.id, commentId, {
      status: 'resolved',
      resolvedAt: Date.now(),
      resolutionNote: typeof params.resolution_note === 'string' ? params.resolution_note.trim() : undefined,
    });
    await persistDoc(doc.id);
    return ok({ message: '批注已标记为解决', commentId, remainingOpenComments: summarizeDoc(getDoc(doc.id) ?? doc).openCommentCount });
  },
};

export const allCopywritingTools: Tool[] = [
  copywritingGetStateTool,
  copywritingSetDocTool,
  copywritingPatchDocTool,
  copywritingReplaceTextTool,
  copywritingReviewDocTool,
  copywritingGetCommentsTool,
  copywritingResolveCommentTool,
];
