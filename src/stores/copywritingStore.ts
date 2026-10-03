import { create } from 'zustand';
import { nanoid } from 'nanoid';
import type { CopyComment, CopyDoc, WritingExperience, StyleProfile } from '@/lib/copywriting/types';
import {
  readDocsIndex,
  writeDocsIndex,
  writeDoc,
  readStyleProfile,
  readExperienceLog,
  appendExperienceLog,
  replaceExperienceLog,
} from '@/lib/copywriting/persist';
import { rebuildStyleProfile } from '@/lib/copywriting/experienceEngine';
import { reanchorCopyComments } from '@/lib/copywriting/commentAnchors';

interface CopywritingState {
  docs: CopyDoc[];
  activeDocId: string | null;
  styleProfile: StyleProfile | null;
  experiences: WritingExperience[];
  loaded: boolean;
  learningStatus: 'idle' | 'learning' | 'saved' | 'error';
  learningMessage: string;
  resetExperiences: () => Promise<void>;
  setExperienceEnabled: (id: string, enabled: boolean) => Promise<void>;

  loadAll: () => Promise<void>;
  createDoc: () => CopyDoc;
  updateDoc: (id: string, patch: Partial<CopyDoc>) => void;
  addComment: (docId: string, comment: CopyComment) => void;
  updateComment: (docId: string, commentId: string, patch: Partial<CopyComment>) => void;
  deleteComment: (docId: string, commentId: string) => void;
  deleteDoc: (id: string) => void;
  setActiveDoc: (id: string | null) => void;
  appendExperience: (exp: WritingExperience) => Promise<void>;
  rebuildProfile: () => Promise<void>;
}

let learningWrites: Promise<unknown> = Promise.resolve();
function serializeLearning<T>(job: () => Promise<T>): Promise<T> {
  const next = learningWrites.catch(() => {}).then(job); learningWrites = next; return next;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleSave(get: () => CopywritingState) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const { docs, activeDocId } = get();
    await writeDocsIndex(docs);
    if (activeDocId) {
      const doc = docs.find(d => d.id === activeDocId);
      if (doc) await writeDoc(doc);
    }
  }, 800);
}

export const useCopywritingStore = create<CopywritingState>((set, get) => ({
  docs: [],
  activeDocId: null,
  styleProfile: null,
  experiences: [],
  loaded: false,
  learningStatus: 'idle',
  learningMessage: '',

  loadAll: async () => {
    if (get().loaded) return;
    try {
      const docs = await readDocsIndex();
      const persisted = await readExperienceLog();
      const experiences = [...new Map([...persisted, ...get().experiences].map(e => [e.id, e])).values()];
      let styleProfile = await readStyleProfile();
      if (!styleProfile || styleProfile.version < 3 || styleProfile.totalSessions !== experiences.filter(e => !e.disabled && !e.lessons?.length).length) {
        styleProfile = await rebuildStyleProfile(experiences);
      }
      set({ docs: get().docs.length ? get().docs : docs, styleProfile, experiences, loaded: true });
    } catch (error) {
      set({ learningStatus: 'error', learningMessage: `经验读取失败，未覆盖原记录：${String(error)}` });
    }
  },

  createDoc: () => {
    const doc: CopyDoc = {
      id: nanoid(10),
      title: '未命名文案',
      content: '',
      contentRevision: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    set(s => ({ docs: [doc, ...s.docs], activeDocId: doc.id }));
    scheduleSave(get);
    return doc;
  },

  updateDoc: (id, patch) => {
    set(s => ({
      docs: s.docs.map(d => {
        if (d.id !== id) return d;
        const contentChanged = typeof patch.content === 'string' && patch.content !== d.content;
        const comments = contentChanged
          ? reanchorCopyComments(patch.content as string, d.comments ?? [])
          : d.comments;
        return {
          ...d,
          ...patch,
          comments,
          contentRevision: contentChanged ? (d.contentRevision ?? 0) + 1 : d.contentRevision,
          updatedAt: Date.now(),
        };
      }),
    }));
    scheduleSave(get);
  },

  addComment: (docId, comment) => {
    set(s => ({
      docs: s.docs.map(d => d.id === docId
        ? {
            ...d,
            comments: [...(d.comments ?? []), { ...comment, sourceRevision: d.contentRevision ?? 0 }],
            updatedAt: Date.now(),
          }
        : d),
    }));
    scheduleSave(get);
  },

  updateComment: (docId, commentId, patch) => {
    set(s => ({
      docs: s.docs.map(d => d.id === docId
        ? {
            ...d,
            comments: (d.comments ?? []).map(comment => comment.id === commentId
              ? {
                  ...comment,
                  ...patch,
                  sourceRevision: typeof patch.body === 'string' && patch.body !== comment.body
                    ? d.contentRevision ?? 0
                    : comment.sourceRevision,
                  updatedAt: Date.now(),
                }
              : comment),
            updatedAt: Date.now(),
          }
        : d),
    }));
    scheduleSave(get);
  },

  deleteComment: (docId, commentId) => {
    set(s => ({
      docs: s.docs.map(d => d.id === docId
        ? { ...d, comments: (d.comments ?? []).filter(comment => comment.id !== commentId), updatedAt: Date.now() }
        : d),
    }));
    scheduleSave(get);
  },

  deleteDoc: (id) => {
    set(s => ({
      docs: s.docs.filter(d => d.id !== id),
      activeDocId: s.activeDocId === id ? null : s.activeDocId,
    }));
    scheduleSave(get);
  },

  setActiveDoc: (id) => set({ activeDocId: id }),

  appendExperience: (exp) => serializeLearning(async () => {
    try {
      if (get().experiences.some(e => e.id === exp.id || (exp.sourceRunId && e.sourceRunId === exp.sourceRunId))) return;
      await appendExperienceLog(exp);
      const experiences = [...get().experiences, exp];
      set({ experiences });
      const profile = await rebuildStyleProfile(experiences);
      set({ styleProfile: profile, learningStatus: 'saved', learningMessage: `已沉淀 ${exp.lessons?.length ?? 1} 条写作经验` });
    } catch (error) {
      set({ learningStatus: 'error', learningMessage: `经验保存失败：${String(error)}` });
      throw error;
    }
  }),
  resetExperiences: () => serializeLearning(async () => {
    try {
      await replaceExperienceLog([]);
      set({ experiences: [] });
      const profile = await rebuildStyleProfile([]);
      set({ styleProfile: profile, learningStatus: 'idle', learningMessage: '经验已重置，旧记录已备份' });
    } catch (error) { set({ learningStatus: 'error', learningMessage: `重置失败：${String(error)}` }); throw error; }
  }),
  setExperienceEnabled: (id, enabled) => serializeLearning(async () => {
    try {
      const experiences = get().experiences.map(e => e.id === id ? { ...e, disabled: !enabled } : e);
      await replaceExperienceLog(experiences);
      set({ experiences });
      const profile = await rebuildStyleProfile(experiences);
      set({ styleProfile: profile });
    } catch (error) { set({ learningStatus: 'error', learningMessage: `更新失败：${String(error)}` }); throw error; }
  }),
  rebuildProfile: () => serializeLearning(async () => {
    const profile = await rebuildStyleProfile(get().experiences);
    set({ styleProfile: profile });
  }),
}));
