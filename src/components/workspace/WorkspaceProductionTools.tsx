import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ArrowLeft, Check, FolderOpen, Loader2 } from 'lucide-react';
import { convertFileSrc } from '@tauri-apps/api/tauri';
import { BaseDirectory, copyFile, createDir, exists, readBinaryFile, readDir, readTextFile, writeBinaryFile, writeTextFile } from '@tauri-apps/api/fs';
import { homeDir } from '@tauri-apps/api/path';
import { open as openDialog } from '@tauri-apps/api/dialog';
import { open as openPath } from '@tauri-apps/api/shell';
import { useWorkshopStore } from '@/stores/workshopStore';
import { useUnifiedProjectStore } from '@/stores/unifiedProjectStore';
import { useToolConfirmStore } from '@/stores/toolConfirmStore';
import { useChatStore } from '@/stores';
import { projectAssistantQueue } from '@/stores/projectAssistantQueueStore';
import { AssetCard } from '@/components/workshop/steps/StepAssets';
import { AudioPromptsSection, PaletteMenu } from '@/components/workshop/steps/StepPrompts';
import { buildAudioPromptsPrompt, buildVoiceDescPrompt } from '@/lib/workshop/workshopPrompts';
import type { WorkshopData, WsShot } from '@/lib/workshop/types';
import { captureProductionAssistantTarget, captureProductionLease, claimProduction, productionFileName, pendingProductionJobs, mergeProductionReceipt, parseProductionReceipts, runConfirmedProduction, shotSpeechJobs,
  type ProductionJob, type ProductionReceipt } from '@/lib/workspace/productionSafety';
import './workspaceProductionTools.css';
import { workspaceAsset } from '@/lib/workspace/assetDraftModel';
import { workspaceAssetCandidates } from '@/lib/workspace/assetCandidates';
import type { WsColorPalette, WsCharacter } from '@/lib/workshop/types';

export interface WorkspaceProductionToolsProps { projectId: string; objectId: string; onClose: () => void }
export const WORKSPACE_PRODUCTION_KINDS = ['character', 'shot', 'scene', 'prop', 'scene-asset'] as const;

let receipts: ProductionReceipt[] = [];
const listeners = new Set<() => void>();
function publishReceipt(receipt: ProductionReceipt) {
  const next = mergeProductionReceipt(receipts, receipt);
  if (next === receipts) return;
  receipts = next;
  listeners.forEach((listener) => listener());
}
const subscribeReceipts = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const receiptDirectory = (projectId: string, objectId: string) => `.kunpeng/aigc-memory/projects/${projectId}/production-receipts/${encodeURIComponent(objectId)}`;
function publicJob({ referenceData: _data, ...job }: ProductionJob) { return job; }
async function retainReceipt(receipt: ProductionReceipt) {
  // Never put reference bytes or credentials in the journal. Each phase is a separate file.
  const dir = receiptDirectory(receipt.projectId, receipt.objectId);
  await createDir(dir, { dir: BaseDirectory.Home, recursive: true });
  await writeTextFile(`${dir}/${receipt.id}.${receipt.status}.json`, JSON.stringify(receipt), { dir: BaseDirectory.Home });
  publishReceipt(receipt);
}
async function loadReceipts(projectId: string, objectId: string): Promise<number> {
  const dir = receiptDirectory(projectId, objectId);
  if (!await exists(dir, { dir: BaseDirectory.Home })) return 0;
  let invalid = 0;
  for (const entry of await readDir(dir, { dir: BaseDirectory.Home })) {
    if (!entry.name?.endsWith('.json')) continue;
    try {
      const parsed = parseProductionReceipts([await readTextFile(entry.path)], projectId, objectId);
      invalid += parsed.invalidCount;
      parsed.receipts.forEach(publishReceipt);
    } catch { invalid++; }
  }
  return invalid;
}

function target(data: WorkshopData | null, objectId: string) {
  const owner = data?.projectObjects?.objects.find((item) => item.id === objectId);
  const character = owner?.kind === 'character' ? data?.characters.find((item) => item.id === owner.sourceId) : undefined;
  const shot = owner?.kind === 'shot' ? data?.shots.find((item) => (item.id ?? item.shotNo) === owner.sourceId) : undefined;
  const asset = data ? workspaceAsset(data, objectId) : undefined;
  return { owner, character, shot, asset };
}
function scopeSignature(projectId: string, objectId: string): string | null {
  const state = useWorkshopStore.getState();
  if (useUnifiedProjectStore.getState().activeId !== projectId || state.project?.id !== projectId || state.data?.projectId !== projectId) return null;
  const { owner, character, shot, asset } = target(state.data, objectId);
  if (!owner || owner.locked || owner.archived || (!asset && !shot)) return null;
  return JSON.stringify({ owner, character, shot, asset, globalColorPaletteId: state.data.globalColorPaletteId,
    executionPreference: state.data.projectSpec?.generationConfirmation ?? 'paid-only-confirm',
    ...(shot ? { characters: state.data.characters, model: state.data.videoModel, drafts: state.data.workspaceDrafts } : {}) });
}

export default function WorkspaceProductionTools(props: WorkspaceProductionToolsProps) {
  return <ProductionTools key={`${props.projectId}:${props.objectId}`} {...props} />;
}

function ProductionTools({ projectId, objectId, onClose }: WorkspaceProductionToolsProps) {
  const data = useWorkshopStore((state) => state.data);
  useUnifiedProjectStore((state) => state.activeId);
  const { owner, character, shot, asset } = target(data, objectId);
  const signature = scopeSignature(projectId, objectId);
  const allReceipts = useSyncExternalStore(subscribeReceipts, () => receipts);
  const history = allReceipts.filter((item) => item.projectId === projectId && item.objectId === objectId);
  const [loaded, setLoaded] = useState(false);
  const [journalHealthy, setJournalHealthy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const mounted = useRef(true);
  const leaseRef = useRef<ReturnType<typeof captureProductionLease> | null>(null);
  useEffect(() => {
    mounted.current = true;
    void loadReceipts(projectId, objectId).then((invalid) => {
      if (!mounted.current) return;
      setLoaded(true); setJournalHealthy(invalid === 0);
      if (invalid) setNotice(`${invalid} 条产物记录损坏，本对象语音生成已暂停；可继续编辑和试听。`);
    }).catch(() => { if (mounted.current) { setLoaded(true); setNotice('本对象产物记录读取失败，语音生成已暂停；可继续编辑和试听。'); } });
    return () => { mounted.current = false; leaseRef.current?.close(); };
  }, [projectId, objectId]);
  const message = (value: string) => { if (mounted.current) setNotice(value); };
  const capture = () => {
    if (!mounted.current || !signature || scopeSignature(projectId, objectId) !== signature) throw new Error('项目或对象已更新，请重新操作。');
    return captureProductionLease({ read: () => mounted.current ? scopeSignature(projectId, objectId) : null,
      subscribe: (listener) => {
        const off = useWorkshopStore.subscribe(listener);
        const offProject = useUnifiedProjectStore.subscribe(listener);
        return () => { off(); offProject(); };
      } });
  };
  const perform = async <T,>(action: (lease: ReturnType<typeof captureProductionLease>) => Promise<T>): Promise<T | undefined> => {
    if (!loaded) return;
    const release = claimProduction(`${projectId}:${objectId}`);
    if (!release) return;
    let lease: ReturnType<typeof captureProductionLease> | undefined;
    try {
      lease = capture(); leaseRef.current = lease;
      setBusy(true); message('');
      return await action(lease);
    } catch (error) { message(error instanceof Error ? error.message : '操作未完成。'); }
    finally { lease?.close(); leaseRef.current = null; release(); if (mounted.current) setBusy(false); }
  };
  const patchShot = (patch: Partial<WsShot>) => {
    try {
      const lease = capture();
      try {
        lease.assertCurrent();
        if (shot) useWorkshopStore.getState().updateShot(shot.shotNo, patch);
      } finally { lease.close(); }
    } catch (error) { message(error instanceof Error ? error.message : '镜头未更新。'); }
  };
  const mutateAsset = (action: () => void) => {
    try { const lease = capture(); try { lease.assertCurrent(); action(); } finally { lease.close(); } }
    catch (error) { message(error instanceof Error ? error.message : '资产未更新。'); }
  };
  const assistant = () => {
    try {
      const lease = capture();
      try {
        const prompt = character ? buildVoiceDescPrompt(character.id) : shot ? buildAudioPromptsPrompt(shot.shotNo) : '';
        lease.assertCurrent();
        const contextBase = `[媒体工作台上下文：${JSON.stringify({ project_id: projectId, object_id: objectId })}]\n`
          + '只为指定对象完善音色描述或配音提示词，不执行音色、配音或其他付费生成。';
        const assistantTarget = captureProductionAssistantTarget(useWorkshopStore.getState().data!, objectId,
          useChatStore.getState().currentSessionId, contextBase, character?.name ?? `镜头 ${shot?.shotNo}`);
        projectAssistantQueue.enqueue(assistantTarget, prompt);
        projectAssistantQueue.select(assistantTarget);
        useWorkshopStore.getState().updateProjectViewState({ agentDrawerState: 'expanded' });
      } finally { lease.close(); }
    } catch (error) { message(error instanceof Error ? error.message : '未加入助手队列。'); }
  };

  const generate = async (voicePrompt?: string, repeatCharacterId?: string): Promise<boolean> => Boolean(await perform(async (lease) => {
    if (!journalHealthy) { message('本对象产物记录尚未确认，语音生成已暂停。'); return false; }
    if (!data) return false;
    const frozenData = structuredClone(data);
    const executionPreference = frozenData.projectSpec?.generationConfirmation ?? 'paid-only-confirm';
    const frozenShot = shot && structuredClone(shot);
    const jobs: ProductionJob[] = character && voicePrompt
      ? [{ characterId: character.id, characterName: character.name, prompt: voicePrompt }]
      : frozenShot ? shotSpeechJobs(frozenShot, frozenData.characters) : [];
    for (const job of jobs) {
      if (!job.referencePath) continue;
      const bytes = new Uint8Array(await readBinaryFile(job.referencePath));
      lease.assertCurrent();
      let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
      job.referenceData = btoa(binary);
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      job.referenceDigest = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
      lease.assertCurrent();
    }
    // A prior submitted item is never silently replayed as part of a partial batch.
    const pending = pendingProductionJobs(jobs, receipts, projectId, objectId, repeatCharacterId);
    if (!pending.length) { message('相同内容已有提交记录。请试听已有产物；状态未明的提交不会自动重放。'); return false; }
    const runId = crypto.randomUUID();
    const kind = character ? 'voice' as const : 'dubbing' as const;
    const home = await homeDir();
    lease.assertCurrent();
    const { doubaoSpeechGenerateTool } = await import('@/lib/agent/tools/doubaoSpeechTool');
    lease.assertCurrent();
    const risk = doubaoSpeechGenerateTool.risk;
    const result = await runConfirmedProduction({ jobs: pending, lease, executionPreference, risk,
      confirm: (approved) => useToolConfirmStore.getState().requestConfirm('workspace_speech_generate', {
        prompt: approved.map((job) => `${job.characterName}：${job.prompt}`).join('\n\n'),
        audio_urls: approved.flatMap((job) => job.referencePath ? [job.referencePath] : []), count: approved.length,
        params: { project_id: projectId, object_id: objectId, shot_id: frozenShot?.id ?? frozenShot?.shotNo,
          characters: approved.map(publicJob), operation_id: runId },
        fallback_notice: '复用原语音客户端与渠道策略；逐项提交，失败不自动重试或整批重放。',
      }, undefined, { scope: `production:${projectId}:${objectId}`, signal: lease.signal, risk }),
      submit: async (job, index) => {
        const id = `${runId}-${index}`;
        const base: ProductionReceipt = { id, projectId, objectId, kind, job: publicJob(job), status: 'started' };
        const relDir = `.kunpeng/aigc-memory/projects/${projectId}/${character ? 'assets/voices' : 'dubbing'}`;
        const filename = character ? productionFileName(character.id, id)
          : productionFileName(`${frozenShot!.shotNo}-${job.characterName}`, `${id}-${job.characterId}`);
        const outputPath = `${home.replace(/\/$/, '')}/${relDir}/${filename}`;
        base.outputPath = outputPath;
        await retainReceipt(base);
        let submitted = false;
        try {
          lease.assertCurrent();
          if (character) {
            const { generateSpeech, fetchSpeechAudioBytes } = await import('@/lib/doubaoSpeech/client');
            lease.assertCurrent();
            submitted = true;
            const response = await generateSpeech({ text_prompt: job.prompt });
            const bytes = await fetchSpeechAudioBytes(response);
            await createDir(relDir, { dir: BaseDirectory.Home, recursive: true });
            await writeBinaryFile(outputPath, bytes);
            return { characterId: job.characterId, characterName: job.characterName, path: outputPath, duration: response.duration };
          }
          const { generateShotAudio } = await import('@/lib/doubaoSpeech/generate');
          lease.assertCurrent();
          const audios = await generateShotAudio({ ...frozenShot!, audioPrompts: [{ characterId: job.characterId, prompt: job.prompt }] },
            frozenData.characters, projectId, undefined, { operationId: id,
              frozenReferences: { [job.characterId]: job.referenceData }, beforeSubmit: () => { lease.assertCurrent(); submitted = true; } });
          if (!audios[0]) throw new Error('未返回配音产物。');
          return audios[0];
        } catch (error) {
          await retainReceipt({ ...base, status: submitted ? 'uncertain' : 'cancelled' });
          throw error;
        }
      },
      retain: async (audio, job, index) => retainReceipt({ id: `${runId}-${index}`, projectId, objectId, kind,
        job: publicJob(job), status: 'completed', audio, outputPath: audio.path }),
    });
    message(result.cancelled ? '已取消，未提交。' : result.failedIndex !== undefined
      ? `已保留 ${result.audios.length} 项产物；本项失败或状态未明，后续未提交，未自动重试。`
      : result.audios.length ? `已保留 ${result.audios.length} 项声音候选，尚未采用。` : '内容已变化，后续未提交。');
    return result.audios.length > 0;
  }));

  const upload = async () => { await perform(async (lease) => {
    if (!character) return;
    const selected = await openDialog({ filters: [{ name: '音频', extensions: ['mp3', 'wav', 'm4a', 'ogg'] }] });
    if (!selected || Array.isArray(selected)) return;
    lease.assertCurrent();
    const id = crypto.randomUUID();
    const relDir = `.kunpeng/aigc-memory/projects/${projectId}/assets/voices`;
    const home = await homeDir();
    lease.assertCurrent();
    await createDir(relDir, { dir: BaseDirectory.Home, recursive: true });
    const path = `${home.replace(/\/$/, '')}/${relDir}/${productionFileName(character.id, id, selected.split('.').pop() ?? 'mp3')}`;
    lease.assertCurrent();
    await copyFile(selected, path);
    const audio = { characterId: character.id, characterName: character.name, path, duration: 0 };
    await retainReceipt({ id, projectId, objectId, kind: 'upload', job: { characterId: character.id, characterName: character.name, prompt: '' }, status: 'completed', audio });
    if (lease.current()) useWorkshopStore.getState().setCharacterVoice(character.id, path, 'upload');
    else message('上传音色已保留，未覆盖当前编辑。');
  }); };

  const uploadImage = async () => { await perform(async (lease) => {
    if (!asset) return;
    const selected = await openDialog({ filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] });
    if (!selected || Array.isArray(selected)) return;
    lease.assertCurrent();
    const id = crypto.randomUUID();
    const relDir = `.kunpeng/aigc-memory/projects/${projectId}/assets`;
    const home = await homeDir();
    lease.assertCurrent();
    await createDir(relDir, { dir: BaseDirectory.Home, recursive: true });
    const path = `${home.replace(/\/$/, '')}/${relDir}/${productionFileName(asset.asset.id, id, selected.split('.').pop() ?? 'png')}`;
    lease.assertCurrent();
    await copyFile(selected, path);
    await retainReceipt({ id, projectId, objectId, kind: 'image-upload', job: { characterId: asset.asset.id, characterName: asset.asset.name, prompt: '' },
      status: 'completed', outputPath: path });
    if (lease.current()) useWorkshopStore.getState().setAssetImage(asset.kind, asset.asset.id, path);
    else message('上传图片已保留，未覆盖当前编辑。');
  }); };

  const trim = async () => { await perform(async (lease) => {
    if (!shot || !data) return;
    const frozen = structuredClone(shot.generatedAudios ?? []);
    const limit = (shot.videoModel || data.videoModel) === 'seedance-2.5' ? 30 : 15;
    const { trimAudiosToFit } = await import('@/lib/doubaoSpeech/trim');
    lease.assertCurrent();
    const id = crypto.randomUUID();
    const ratio = Math.min(1, limit / frozen.reduce((sum, audio) => sum + audio.duration, 0));
    let retained = 0;
    for (const [index, original] of frozen.entries()) {
      lease.assertCurrent();
      const [audio] = await trimAudiosToFit([original], original.duration * ratio, projectId, `${id}-${index}`);
      await retainReceipt({ id: `${id}-${index}`, projectId, objectId, kind: 'trim',
        job: { characterId: audio.characterId, characterName: audio.characterName, prompt: '' }, status: 'completed', audio });
      retained++;
    }
    message(`已保留 ${retained} 项裁剪候选，尚未采用。`);
  }); };

  const adopt = async (receipt: ProductionReceipt) => { await perform(async (lease) => {
    if (receipt.status !== 'completed' || receipt.projectId !== projectId || receipt.objectId !== objectId) return;
    if (receipt.kind === 'image-upload' && receipt.outputPath && asset) {
      if (!await exists(receipt.outputPath)) throw new Error('产物文件不存在。');
      lease.assertCurrent();
      useWorkshopStore.getState().setAssetImage(asset.kind, asset.asset.id, receipt.outputPath);
      return;
    }
    if (!receipt.audio) return;
    const audio = receipt.audio;
    if (!await exists(audio.trimmedPath || audio.path)) throw new Error('产物文件不存在。');
    lease.assertCurrent();
    if (character && character.id === audio.characterId) useWorkshopStore.getState().setCharacterVoice(character.id, audio.path, receipt.kind === 'upload' ? 'upload' : 'tts');
    else if (shot && data?.characters.some((item) => item.id === audio.characterId)) useWorkshopStore.getState().updateShot(shot.shotNo, {
      generatedAudios: [...(shot.generatedAudios ?? []).filter((item) => item.characterId !== audio.characterId), audio], audioInjected: false,
    });
  }); };

  const palette = asset?.kind === 'colorPalette' ? asset.asset as WsColorPalette : undefined;
  return <section className="workspace-production-tools canvas-dark" aria-label="资产与配音设置" aria-busy={busy}>
    <header><button title="返回素材" onClick={onClose}><ArrowLeft size={16} />返回素材</button>
      <strong>{character ? '角色与音色' : shot ? '配音与配色' : '资产设置'}</strong>{busy && <Loader2 size={15} className="animate-spin" />}</header>
    {notice && <p role="status" className="production-notice">{notice}</p>}
    {!signature && <p role="status">对象已锁定、归档或项目已切换。</p>}
    <fieldset disabled={busy || !loaded || !signature}>
      {asset && data && <AssetCard kind={asset.kind} id={asset.asset.id} name={asset.asset.name} aspect="16/9"
        candidateCount={workspaceAssetCandidates(data, asset.kind, asset.asset.id).length}
        focused="asset" imagePath={asset.asset.assetImagePath} prompt={asset.asset.assetPrompt} promptMj={(asset.asset as WsCharacter).assetPromptMj}
        engine={asset.asset.assetEngine} assetResolution={asset.asset.assetResolution} assetAspectRatio={asset.asset.assetAspectRatio}
        colors={palette?.colors} usagePrompt={palette?.usagePrompt} isGlobalPalette={palette?.id === data.globalColorPaletteId} isDefaultPalette={palette?.source === 'default'}
        assetActions={{ mutate: mutateAsset, uploadImage, isCurrent: () => Boolean(signature && scopeSignature(projectId, objectId) === signature) }}
        voicePath={character?.voicePath} voiceSource={character?.voiceSource}
        voiceActions={character ? { generate, upload, describe: assistant, remove: () => {
          try { const lease = capture(); try { lease.assertCurrent(); useWorkshopStore.getState().removeCharacterVoice(character.id); } finally { lease.close(); } }
          catch (error) { message(error instanceof Error ? error.message : '音色未移除。'); }
        } } : undefined} />}
      {shot && data && <>
        <div className="production-palette"><h3>镜头 {shot.shotNo}</h3><PaletteMenu value={shot.colorPaletteId}
          palettes={data.colorPalettes ?? []} placeholder="色卡" followLabel="跟随全片色卡" onChange={(colorPaletteId) => patchShot({ colorPaletteId })} /></div>
        <AudioPromptsSection shot={shot} characters={data.characters} onPatch={patchShot}
          actions={{ generate: async () => { await generate(); }, trim, autoFill: assistant }} />
      </>}
    </fieldset>
    {history.length > 0 && <section className="production-results" aria-label="保留产物">
      <h3>产物候选</h3>{history.map((receipt) => <div className="production-result" key={receipt.id} data-production-receipt-id={receipt.id}>
        <span>{receipt.job.characterName}</span>
        {receipt.kind === 'image-upload' && receipt.outputPath ? <><img src={convertFileSrc(receipt.outputPath)} alt={receipt.job.characterName} />
          <button disabled={busy || !signature} title="采用此图片" onClick={() => void adopt(receipt)}><Check size={14} />采用</button></>
          : receipt.status === 'completed' && receipt.audio ? <><audio controls aria-label={`试听 ${receipt.job.characterName}`} src={convertFileSrc(receipt.audio.trimmedPath || receipt.audio.path)} />
          <button disabled={busy || !signature} title="采用此产物" onClick={() => void adopt(receipt)}><Check size={14} />采用</button>
          {(receipt.kind === 'voice' || receipt.kind === 'dubbing') && <button disabled={busy || !signature} title="单独重新生成，需要确认"
            onClick={() => void generate(character ? receipt.job.prompt : undefined, receipt.job.characterId)}>重新生成此项</button>}</>
          : <span className="production-notice">{receipt.status === 'cancelled' ? '已取消，未提交' : '提交状态未确认，不自动重试'}</span>}
        <button title="打开产物目录" onClick={() => void homeDir().then((home) => openPath(`${home.replace(/\/$/, '')}/.kunpeng/aigc-memory/projects/${projectId}/${receipt.kind === 'image-upload' ? 'assets' : receipt.kind === 'voice' || receipt.kind === 'upload' ? 'assets/voices' : 'dubbing'}`)).catch(() => message('产物目录无法打开。'))}><FolderOpen size={14} /></button>
      </div>)}
    </section>}
    {!owner && <p role="status">素材对象不存在。</p>}
  </section>;
}
