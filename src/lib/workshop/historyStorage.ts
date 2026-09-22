import type { WorkshopData } from './types';

type Entry = NonNullable<WorkshopData['projectSnapshots']>[number] | NonNullable<WorkshopData['projectBranches']>[number];
interface Port {
  read(projectId: string, path: string): Promise<string | null>;
  write(projectId: string, path: string, content: string): Promise<void>;
}
const historyPath = /^history\/[a-f0-9]{64}\.json$/;

/** Immutable payloads are written before their index, never pruned during migration. */
export class WorkshopHistoryStorage {
  private port: Port;
  private files = new WeakMap<Entry, { projectId: string; path: string; workshopPayload: string; canvasPayload: string; mediaPaths: string }>();
  private pending = new Map<string, Promise<void>>();
  constructor(port: Port) { this.port = port; }
  save(projectId: string, data: WorkshopData): Promise<void> {
    const previous = this.pending.get(projectId) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(() => this.write(projectId, data));
    this.pending.set(projectId, next);
    void next.finally(() => { if (this.pending.get(projectId) === next) this.pending.delete(projectId); }).catch(() => {});
    return next;
  }
  private async write(projectId: string, data: WorkshopData) {
    if (data.projectId !== projectId) throw new Error('项目已变化，未保存');
    const pack = async (entry: Entry) => {
      let stored = this.files.get(entry);
      if (!stored || stored.projectId !== projectId || stored.workshopPayload !== entry.workshopPayload || stored.canvasPayload !== entry.canvasPayload || stored.mediaPaths !== JSON.stringify(entry.mediaPaths)) {
        const body = JSON.stringify({ workshopPayload: entry.workshopPayload, canvasPayload: entry.canvasPayload, mediaPaths: entry.mediaPaths });
        const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
        const path = `history/${Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('')}.json`;
        await this.port.write(projectId, path, body);
        stored = { projectId, path, workshopPayload: entry.workshopPayload, canvasPayload: entry.canvasPayload, mediaPaths: JSON.stringify(entry.mediaPaths) }; this.files.set(entry, stored);
      }
      const { workshopPayload: _w, canvasPayload: _c, mediaPaths: _m, ...meta } = entry;
      return { ...meta, historyPayloadFile: stored.path };
    };
    const snapshots = [];
    for (const entry of data.projectSnapshots ?? []) snapshots.push(await pack(entry));
    const branches = [];
    for (const entry of data.projectBranches ?? []) branches.push(await pack(entry));
    await this.port.write(projectId, 'workshop.json', JSON.stringify({ ...data,
      projectSnapshots: data.projectSnapshots ? snapshots : undefined,
      projectBranches: data.projectBranches ? branches : undefined,
    }));
  }
  async hydrate(projectId: string, data: WorkshopData): Promise<WorkshopData> {
    const unpack = async (entry: Entry) => {
      const path = (entry as Entry & { historyPayloadFile?: string }).historyPayloadFile;
      if (!path) return entry; // Legacy inline snapshots are preserved, not discarded.
      if (!historyPath.test(path)) throw new Error('项目历史索引无效，未加载或覆盖项目');
      const raw = await this.port.read(projectId, path);
      if (!raw) throw new Error('项目历史文件缺失，未加载或覆盖项目');
      const payload = JSON.parse(raw);
      if (typeof payload.workshopPayload !== 'string' || typeof payload.canvasPayload !== 'string' || !Array.isArray(payload.mediaPaths)) {
        throw new Error('项目历史文件损坏，未加载或覆盖项目');
      }
      const { historyPayloadFile: _file, ...metadata } = entry as Entry & { historyPayloadFile: string };
      const restored = { ...metadata, workshopPayload: payload.workshopPayload, canvasPayload: payload.canvasPayload, mediaPaths: payload.mediaPaths } as Entry;
      this.files.set(restored, { projectId, path, workshopPayload: restored.workshopPayload, canvasPayload: restored.canvasPayload, mediaPaths: JSON.stringify(restored.mediaPaths) });
      return restored;
    };
    const snapshots = [];
    for (const entry of data.projectSnapshots ?? []) snapshots.push(await unpack(entry));
    const branches = [];
    for (const entry of data.projectBranches ?? []) branches.push(await unpack(entry));
    return { ...data, projectSnapshots: data.projectSnapshots ? snapshots as WorkshopData['projectSnapshots'] : undefined,
      projectBranches: data.projectBranches ? branches as WorkshopData['projectBranches'] : undefined };
  }
}
