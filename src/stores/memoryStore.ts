import { create } from 'zustand';
import { scanMemoryDir, readMemoryFile, listGenerationLogs } from '@/lib/aigcMemory';

export interface DirectorDNA {
  id: string;
  name: string;
  description: string;
  tags: string[];
  score: number;
  usageCount: number;
  visualDNA: string;
  cameraLanguage: string;
  commonParams: string;
  body: string;
}

export interface ShotPattern {
  id: string;
  name: string;
  type: string;
  tags: string[];
  purpose: string;
  body: string;
}

export interface GenerationLogEntry {
  path: string;
  name: string;
  timestamp: string;
  director?: string;
  engine?: string;
  prompt?: string;
  resultPath?: string;
  body: string;
}

interface MemoryStore {
  isPanelOpen: boolean;
  activeTab: 'projects' | 'assets' | 'directors' | 'shots' | 'history';
  directors: DirectorDNA[];
  shotPatterns: ShotPattern[];
  generationLogs: GenerationLogEntry[];
  loaded: boolean;
  loading: boolean;
  selectedDirectorId: string | null;
  expandedDirectorId: string | null;

  togglePanel: () => void;
  setActiveTab: (tab: 'projects' | 'assets' | 'directors' | 'shots' | 'history') => void;
  loadAll: () => Promise<void>;
  applyDirector: (id: string) => void;
  applyShotPattern: (id: string) => void;
  setExpandedDirector: (id: string | null) => void;
}

function extractSection(body: string, heading: string): string {
  const regex = new RegExp(`##\\s+${heading}\\n([\\s\\S]*?)(?:\\n##\\s|$)`);
  const match = body.match(regex);
  return match ? match[1].trim() : '';
}

export const useMemoryStore = create<MemoryStore>((set, get) => ({
  isPanelOpen: false,
  activeTab: 'projects',
  directors: [],
  shotPatterns: [],
  generationLogs: [],
  loaded: false,
  loading: false,
  selectedDirectorId: null,
  expandedDirectorId: null,

  togglePanel: () => set((s) => ({ isPanelOpen: !s.isPanelOpen })),
  setActiveTab: (tab) => set({ activeTab: tab }),
  setExpandedDirector: (id) =>
    set((s) => ({ expandedDirectorId: s.expandedDirectorId === id ? null : id })),

  loadAll: async () => {
    set({ loading: true });

    const dirPaths = await scanMemoryDir('director-dna');
    const directors: DirectorDNA[] = [];
    for (const path of dirPaths) {
      const parsed = await readMemoryFile(path);
      if (!parsed) continue;
      const fm = parsed.frontmatter;
      directors.push({
        id: (fm.id as string) || '',
        name: (fm.name as string) || '',
        description: (fm.description as string) || '',
        tags: (fm.tags as string[]) || [],
        score: (fm.score as number) || 0,
        usageCount: (fm.usage_count as number) || 0,
        visualDNA: extractSection(parsed.body, '视觉基因'),
        cameraLanguage: extractSection(parsed.body, '镜头语言'),
        commonParams: extractSection(parsed.body, '常用参数'),
        body: parsed.body,
      });
    }

    const shotPaths = await scanMemoryDir('shot-patterns');
    const shotPatterns: ShotPattern[] = [];
    for (const path of shotPaths) {
      const parsed = await readMemoryFile(path);
      if (!parsed) continue;
      const fm = parsed.frontmatter;
      const name = path.split('/').pop()?.replace('.md', '') || '';
      const nameMatch = parsed.body.match(/^##\s+(.+)/m);
      const purposeMatch = parsed.body.match(/目的[：:]\s*(.+)/);
      shotPatterns.push({
        id: name,
        name: nameMatch?.[1] || name,
        type: (fm.type as string) || '',
        tags: (fm.tags as string[]) || [],
        purpose: purposeMatch?.[1] || '',
        body: parsed.body,
      });
    }

    const logEntries = await listGenerationLogs();
    const generationLogs: GenerationLogEntry[] = [];
    for (const entry of logEntries) {
      const parsed = await readMemoryFile(entry.path);
      let director: string | undefined;
      let engine: string | undefined;
      let prompt: string | undefined;
      let resultPath: string | undefined;
      if (parsed) {
        director = parsed.frontmatter.director as string;
        engine = parsed.frontmatter.engine as string;
        prompt = parsed.frontmatter.prompt as string;
        resultPath = parsed.frontmatter.result_path as string;
      }
      generationLogs.push({
        path: entry.path,
        name: entry.name,
        timestamp: entry.timestamp,
        director,
        engine,
        prompt,
        resultPath,
        body: parsed?.body || '',
      });
    }

    set({
      directors,
      shotPatterns,
      generationLogs,
      loaded: true,
      loading: false,
    });
  },

  applyDirector: (id) => {
    const { directors } = get();
    const dir = directors.find((d) => d.id === id);
    if (dir) {
      set({ selectedDirectorId: id });
    }
  },

  applyShotPattern: (_id) => {
    // Future: inject shot pattern into current session
  },
}));
