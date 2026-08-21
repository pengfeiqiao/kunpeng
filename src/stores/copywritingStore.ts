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
} from '@/lib/copywriting/persist';
import { rebuildStyleProfile } from '@/lib/copywriting/experienceEngine';
import { reanchorCopyComments } from '@/lib/copywriting/commentAnchors';

interface CopywritingState {
  docs: CopyDoc[];
  activeDocId: string | null;
  styleProfile: StyleProfile | null;
  experiences: WritingExperience[];
  loaded: boolean;

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

  loadAll: async () => {
    const docs = await readDocsIndex();
    const experiences = await readExperienceLog();
    let styleProfile = await readStyleProfile();
    if (experiences.length > 0 && (!styleProfile || styleProfile.version < 2 || styleProfile.totalSessions !== experiences.length)) {
      styleProfile = await rebuildStyleProfile(experiences);
    }
    set({ docs, styleProfile, experiences, loaded: true });
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

  appendExperience: async (exp) => {
    await appendExperienceLog(exp);
    const experiences = [...get().experiences, exp];
    set({ experiences });
    await get().rebuildProfile();
  },

  rebuildProfile: async () => {
    const profile = await rebuildStyleProfile(get().experiences);
    set({ styleProfile: profile });
  },
}));
