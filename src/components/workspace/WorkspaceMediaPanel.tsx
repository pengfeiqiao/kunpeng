import { useEffect, useRef, useState, type ReactNode } from 'react';
import { FolderOpen, Image as ImageIcon, Library, Mic, Package, SlidersHorizontal, Sparkles, Video, X } from 'lucide-react';
import { open as openDialog } from '@tauri-apps/api/dialog';
import type { WorkshopData } from '@/lib/workshop/types';
import type { WorkspaceDraft, WorkspaceReference } from '@/lib/workspace/types';
import type { WorkspaceGenerationOutcome } from '@/lib/workspace/generationCommand';
import { changeWorkspaceReferences, cloneWorkspaceDraft, initialWorkspaceDraft } from '@/lib/workspace/drafts';
import { workspaceMediaToolDraft, workspaceMediaTools } from '@/lib/workspace/mediaTools';
import { pendingWorkspaceSubmission } from '@/lib/workspace/submissions';
import { selectWorkspaceObject, workspaceSelection } from '@/lib/workspace/contentModel';
import GenerationComposer, { type WorkspaceEngineChoice } from './GenerationComposer';
import MediaInspector from './MediaInspector';
import { listArtifacts, type ArtifactEntry } from '@/lib/artifacts';
import { workspacePriceKey, type WorkspacePrice } from '@/lib/workspace/services';
import type { MediaFileRecord } from '@/lib/projectObjects/types';
import type { StylePreset } from '@/lib/styleLibrary';

const LOCAL_MEDIA_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'mp4', 'mov', 'webm', 'mkv', 'mp3', 'wav', 'm4a', 'aac', 'flac'];

function mediaTypeFromPath(path: string): WorkspaceReference['type'] {
  const ext = (path.split('.').pop() ?? '').toLowerCase();
  if (['mp4', 'mov', 'webm', 'mkv'].includes(ext)) return 'video';
  if (['mp3', 'wav', 'm4a', 'aac', 'flac'].includes(ext)) return 'audio';
  return 'image';
}

interface Props {
  data: WorkshopData;
  engines: WorkspaceEngineChoice[];
  mediaSrc: (path: string) => string;
  onSaveDraft: (draft: WorkspaceDraft) => WorkspaceDraft | null;
  onGenerate: (draft: WorkspaceDraft) => Promise<WorkspaceGenerationOutcome>;
  onOptimize: (draft: WorkspaceDraft, template: 'legacy' | 'universal', signal: AbortSignal) => Promise<string>;
  onApplyStyle?: (draft: WorkspaceDraft, style: StylePreset, signal: AbortSignal) => Promise<string>;
  onViewState: (patch: Partial<NonNullable<WorkshopData['projectViewState']>>) => void;
  onAdopt: (versionId: string) => void;
  onAddToChat: (objectId: string, mediaId?: string) => void;
  onEditToChat?: (objectId: string, mediaId?: string) => void;
  estimatedCost?: string;
  renderConstraint?: (draft: WorkspaceDraft) => ReactNode;
  onEstimate?: (draft: WorkspaceDraft) => Promise<WorkspacePrice>;
  onConfigure?: () => void;
  onClassify?: (media: MediaFileRecord) => void;
  onProductionTools?: (objectId: string) => void;
  /** 分镜提示词的 agent 通道（读剧本/分镜/调度写回）：optimize=按剧本优化，write=按剧本从零编写。 */
  onAgentPrompt?: (draft: WorkspaceDraft, mode: 'write' | 'optimize', template?: 'legacy' | 'universal') => void;
  /** 单素材传入画布（待整理区） */
  onSendToCanvas?: (objectId: string, mediaId: string) => void;
  /** Resolve an uncertain submission after the user checked the original task, unblocking regeneration. */
  onResolveSubmission?: (submissionId: string) => void;
}

/** Store adapters are supplied by the project container; every asynchronous operation captures its own draft identity. */
export default function WorkspaceMediaPanel(props: Props) {
  const { selected, outputType, versions, media } = workspaceSelection(props.data);
  const draft = selected ? initialWorkspaceDraft(props.data, selected.id, outputType) : null;
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Set<string>>(() => new Set());
  const [quotes, setQuotes] = useState<Record<string, WorkspacePrice>>({});
  const [quoting, setQuoting] = useState<Set<string>>(() => new Set());
  const operations = useRef(new Map<string, AbortController>());
  const mounted = useRef(true);
  const [referenceTarget, setReferenceTarget] = useState<WorkspaceDraft | null>(null);
  const [pickerSource, setPickerSource] = useState<'project' | 'assets' | 'artifacts'>('project');
  const [artifacts, setArtifacts] = useState<ArtifactEntry[]>([]);
  const [artifactsLoading, setArtifactsLoading] = useState(false);
  const [artifactCount, setArtifactCount] = useState(60);
  useEffect(() => {
    if (pickerSource !== 'artifacts' || !referenceTarget) return;
    let cancelled = false;
    setArtifactsLoading(true);
    listArtifacts()
      .then((list) => { if (!cancelled) setArtifacts(list.filter((entry) => ['image', 'video', 'audio'].includes(entry.type))); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setArtifactsLoading(false); });
    return () => { cancelled = true; };
  }, [pickerSource, referenceTarget]);
  useEffect(() => { mounted.current = true; return () => {
    mounted.current = false;
    operations.current.forEach((controller) => controller.abort()); operations.current.clear();
  }; }, []);
  const setError = (id: string, message: string) => { if (mounted.current) setErrors((old) => ({ ...old, [id]: message })); };
  // 自动估价：草稿的模型/参数/参考变化后静默刷新费用预估（失败静默，不打扰编辑）
  const quoteKey = draft ? workspacePriceKey(draft) : '';
  const quotesRef = useRef(quotes);
  quotesRef.current = quotes;
  const requestQuote = () => {
    if (!draft || !props.onEstimate || quoting.has(quoteKey)) return;
    const snapshot = cloneWorkspaceDraft(draft);
    setQuoting((old) => new Set([...old, quoteKey]));
    void props.onEstimate(snapshot).catch(() => ({ label: '暂时无法估价', detail: '查询失败不代表免费。' })).then((quote) => {
      if (mounted.current) setQuotes((old) => ({ ...old, [quoteKey]: quote }));
    }).finally(() => { if (mounted.current) setQuoting((old) => { const next = new Set(old); next.delete(quoteKey); return next; }); });
  };
  useEffect(() => {
    if (!draft || !props.onEstimate || quotesRef.current[quoteKey]) return;
    const timer = setTimeout(requestQuote, 350);
    return () => clearTimeout(timer);
  }, [quoteKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = (next: WorkspaceDraft) => {
    const saved = props.onSaveDraft(next);
    setError(next.id, saved ? '' : '内容已被修改或对象已锁定，本次改动未覆盖现有草稿。');
    return saved;
  };
  const operate = async (snapshot: WorkspaceDraft, action: (signal: AbortSignal) => Promise<void>) => {
    if (operations.current.has(snapshot.id)) return;
    const controller = new AbortController();
    operations.current.set(snapshot.id, controller);
    setBusy(new Set(operations.current.keys())); setError(snapshot.id, '');
    try { await action(controller.signal); }
    catch { if (!controller.signal.aborted) setError(snapshot.id, '操作未完成，草稿已保留。请检查任务状态后再操作。'); }
    finally { operations.current.delete(snapshot.id); if (mounted.current) setBusy(new Set(operations.current.keys())); }
  };
  /** Append one reference to the captured draft; duplicates (by id or path) are refused silently. */
  const addReference = (target: WorkspaceDraft, ref: WorkspaceReference) => {
    if (target.references.some((item) => item.id === ref.id || item.path === ref.path)) return;
    save(changeWorkspaceReferences(target, [...target.references, ref]));
    setReferenceTarget(null);
    setPickerSource('project');
  };
  const pickLocalReferences = async (target: WorkspaceDraft) => {
    const chosen = await openDialog({ multiple: true, filters: [{ name: '媒体文件', extensions: LOCAL_MEDIA_EXTENSIONS }] });
    if (!chosen) return;
    let current = target;
    for (const path of Array.isArray(chosen) ? chosen : [chosen]) {
      if (current.references.some((item) => item.path === path)) continue;
      const saved = save(changeWorkspaceReferences(current, [...current.references,
        { id: `local:${path}`, type: mediaTypeFromPath(path), path, label: path.split(/[\\/]/).pop() ?? '本地文件' }]));
      if (!saved) return;
      current = saved;
    }
    setReferenceTarget(null);
  };
  if (selected && outputType === 'audio') return <MediaInspector title={selected.label} versions={versions} selected={media}
    mediaSrc={props.mediaSrc} onSelect={(id) => props.onViewState({ workspaceMediaId: id })} onAdopt={props.onAdopt}
    canGenerate={false} onPrompt={() => {}} onEdit={() => (props.onEditToChat ?? props.onAddToChat)(selected.id, media?.media.id)}
    onAddToChat={() => props.onAddToChat(selected.id, media?.media.id)} />;
  if (!selected || !draft) return <div className="workspace-media-empty workspace-empty-project">暂无可预览的镜头或素材</div>;
  const pending = pendingWorkspaceSubmission(props.data, draft.objectId, draft.outputType);
  const priceKey = workspacePriceKey(draft);
  const pendingMessage = pending?.status === 'uncertain' ? '上次提交结果待核实，请先查询原任务，勿重复生成。'
    : pending?.status === 'awaiting-confirmation' ? '生成草稿待确认' : pending ? '生成任务处理中' : '';
  const composerOpen = props.data.projectViewState?.workspaceComposerOpen ?? true;
  const flatItems = (workspaceSelection(props.data).groups ?? []).flatMap((group) => group.items);
  const navigate = (direction: -1 | 1) => {
    const index = flatItems.findIndex((item) => item.id === selected.id);
    const next = flatItems[index + direction];
    if (!next) return;
    setReferenceTarget(null);
    const patch = selectWorkspaceObject(props.data, next.id);
    if (patch) props.onViewState({ ...patch, workspaceMediaId: undefined });
  };
  const regenerate = () => {
    const snapshot = cloneWorkspaceDraft(draft);
    void operate(snapshot, async () => {
      const stored = save(snapshot);
      if (!stored) return;
      const outcome = await props.onGenerate(cloneWorkspaceDraft(stored));
      if (outcome.error) setError(snapshot.id, outcome.error);
    });
  };
  const runTool = (toolId: string) => {
    if (!media) return;
    const tool = workspaceMediaTools(media.media.mediaType).find((item) => item.id === toolId);
    if (!tool) return;
    const toolDraft = workspaceMediaToolDraft(props.data, media.media, tool);
    if (!toolDraft) { setError(draft.id, '对象已锁定或媒体不可用，未执行工具。'); return; }
    if (tool.autoRun) {
      void operate(toolDraft, async () => {
        const stored = save(toolDraft);
        if (!stored) return;
        const outcome = await props.onGenerate(cloneWorkspaceDraft(stored));
        if (outcome.error) setError(toolDraft.id, outcome.error);
      });
      return;
    }
    // 编辑类工具：把指令和当前媒体参考预填进当前对象的图片草稿，打开编辑器由用户确认
    const base = initialWorkspaceDraft(props.data, selected.id, 'image');
    if (!base) return;
    const prefilled = save({ ...base, prompt: tool.instruction ?? '',
      references: [{ id: media.media.id, type: 'image' as const, path: media.media.path, label: media.media.label ?? '当前图片', objectId: selected.id, versionId: media.media.versionObjectId }] });
    if (prefilled) props.onViewState({ workspaceComposerOpen: true, workspaceOutputType: 'image' });
  };
  const candidates = props.data.projectObjects?.media.filter((item) => !item.archived && item.purpose !== 'historical'
    && item.source !== 'legacy-storyboard' && ['image', 'video', 'audio'].includes(item.mediaType) && item.path) ?? [];
  // 参考选择器三来源：项目素材（本项目生成/收集的媒体）、项目资产（角色/场景/道具等元素资产）、产物库（全局产物）
  const assetOwners = new Map((props.data.projectObjects?.objects ?? [])
    .filter((item) => !item.archived && ['character', 'scene', 'prop', 'scene-asset'].includes(item.kind))
    .map((item) => [item.id, item.label ?? item.id]));
  // 只显示定版（current-version）资产图，候选版本不进入参考选择
  const projectAssetItems = (props.data.projectObjects?.media ?? [])
    .filter((item) => item.ownerObjectId && assetOwners.has(item.ownerObjectId) && !item.archived
      && item.purpose === 'current-version' && ['image', 'video', 'audio'].includes(item.mediaType) && item.path)
    .map((item) => ({ id: item.id, path: item.path, mediaType: item.mediaType,
      label: `${assetOwners.get(item.ownerObjectId!) ?? '项目资产'}${item.label && item.label !== assetOwners.get(item.ownerObjectId!) ? ` · ${item.label}` : ''}` }));
  const pickerItems: Array<{ id: string; path: string; label: string; mediaType: string; ownerObjectId?: string; versionObjectId?: string }> =
    pickerSource === 'assets'
      ? projectAssetItems
      : pickerSource === 'artifacts'
        ? artifacts.slice(0, artifactCount).map((entry) => ({ id: `artifact:${entry.path}`, path: entry.path, mediaType: entry.type,
          label: entry.prompt || entry.path.split(/[\\/]/).pop() || '产物' }))
        : candidates.map((item) => ({ id: item.id, path: item.path, mediaType: item.mediaType,
          label: item.label ?? item.path.split(/[\\/]/).pop() ?? '素材', ownerObjectId: item.ownerObjectId, versionObjectId: item.versionObjectId }));
  // @ 引用选择器候选：项目素材 + 资产定版（仅图片）；label 优先资产归属名，不退化为无意义文件名
  const mentionCandidates = [...candidates, ...projectAssetItems]
    .filter((item) => item.mediaType === 'image')
    .map((item) => {
      const file = item.path.split(/[\\/]/).pop() ?? '';
      const ownerId = (item as { ownerObjectId?: string }).ownerObjectId;
      const owner = ownerId ? assetOwners.get(ownerId) : undefined;
      const base = item.label && item.label !== file ? item.label : undefined;
      return { id: item.id, path: item.path, label: owner ? (base && base !== owner ? `${owner} · ${base}` : owner) : (base ?? '项目图片') };
    });
  return <div className="workspace-media-panel">
    <div className="workspace-media-actions">
    {selected.kind === 'shot' && <div className="workspace-output-tabs" role="group" aria-label="镜头媒体类型">
      {(['video', 'image'] as const).map((type) => <button key={type} aria-pressed={outputType === type} onClick={() => {
        setReferenceTarget(null); props.onViewState({ workspaceOutputType: type, workspaceMediaId: undefined });
      }}>{type === 'image' ? <ImageIcon size={14} /> : <Video size={14} />}{type === 'image' ? '图片' : '视频'}</button>)}
    </div>}
    {selected.kind !== 'material' && props.onProductionTools && <button className="workspace-production-entry"
      onClick={() => props.onProductionTools!(selected.id)}>
      {selected.kind === 'character' || selected.kind === 'shot' ? <Mic size={14} /> : <SlidersHorizontal size={14} />}
      {selected.kind === 'character' ? '角色与音色' : selected.kind === 'shot' ? '配音与配色' : '资产设置'}
    </button>}
    {selected.kind === 'shot' && !draft.prompt.trim() && props.onAgentPrompt && <button className="workspace-production-entry"
      title="调用项目助手按剧本、拆解与调度编写本镜提示词"
      onClick={() => props.onAgentPrompt!(cloneWorkspaceDraft(draft), 'write')}>
      <Sparkles size={14} />按剧本生成提示词
    </button>}
    </div>
    <div className="workspace-media-panel-inspector">{pending?.status === 'uncertain' && props.onResolveSubmission && <div className="workspace-submission-resolve" role="alert">
      <span>上次提交结果待核实：请先在下方任务进度或任务中心核对原任务。确认原任务已失败或中断后，可标记失败再重新生成。</span>
      <button onClick={() => props.onResolveSubmission!(pending.id)}>已核对，标记失败</button>
    </div>}
    <MediaInspector title={selected.kind === 'shot' ? `${selected.displayNo ?? selected.shotNo} · ${selected.description || selected.label}` : selected.label}
      versions={versions} selected={media} mediaSrc={props.mediaSrc}
      onSelect={(id) => props.onViewState({ workspaceMediaId: id })} onAdopt={props.onAdopt}
      onPrompt={() => props.onViewState({ workspaceComposerOpen: true })}
      onEdit={() => (props.onEditToChat ?? props.onAddToChat)(selected.id, media?.media.id)} onAddToChat={() => props.onAddToChat(selected.id, media?.media.id)}
      onClassify={media && props.onClassify ? () => props.onClassify!(media.media) : undefined}
      onSendToCanvas={media && props.onSendToCanvas ? () => props.onSendToCanvas!(selected.id, media.media.id) : undefined}
      busy={busy.has(draft.id) || Boolean(pending)}
      onRegenerate={regenerate}
      tools={media ? workspaceMediaTools(media.media.mediaType) : []}
      onTool={runTool}
      onNavigate={flatItems.length > 1 ? navigate : undefined} navigateLabel={selected.kind === 'shot' ? '镜头' : '素材'}
      composer={composerOpen ? <GenerationComposer key={JSON.stringify([draft.projectId, draft.objectId, draft.outputType, draft.id])} draft={draft} engines={props.engines} mediaSrc={props.mediaSrc}
        constraintContent={selected.kind === 'shot' ? props.renderConstraint?.(draft) : undefined}
        busy={busy.has(draft.id) || Boolean(pending)} error={errors[draft.id] || pendingMessage}
        estimatedCost={quotes[priceKey]?.label ?? props.estimatedCost} priceDetail={quotes[priceKey]?.detail} onConfigure={props.onConfigure}
        estimating={quoting.has(priceKey)} onEstimate={props.onEstimate ? requestQuote : undefined}
        onChange={save} onClose={() => { setReferenceTarget(null); props.onViewState({ workspaceComposerOpen: false }); }}
        onAddReference={() => setReferenceTarget(cloneWorkspaceDraft(draft))}
        mentionCandidates={mentionCandidates}
        onOptimize={(template) => {
          // 分镜走 agent 通道：按剧本/分镜/调度写提示词（workshop_set_prompts 回写并同步草稿）；其余对象保持模板快改
          if (selected.kind === 'shot' && props.onAgentPrompt) {
            props.onAgentPrompt(cloneWorkspaceDraft(draft), 'optimize', template);
            return;
          }
          const snapshot = cloneWorkspaceDraft(draft);
          void operate(snapshot, async (signal) => {
            const prompt = await props.onOptimize(cloneWorkspaceDraft(snapshot), template, signal);
            if (signal.aborted) return;
            if (!prompt.trim()) { setError(snapshot.id, '优化没有返回提示词，原文未改变。'); return; }
            save({ ...snapshot, prompt, promptTemplate: template });
          });
        }}
        onApplyStyle={props.onApplyStyle ? (style) => {
          const snapshot = cloneWorkspaceDraft(draft);
          void operate(snapshot, async (signal) => {
            const prompt = await props.onApplyStyle!(cloneWorkspaceDraft(snapshot), style, signal);
            if (signal.aborted) return;
            if (!prompt.trim()) { setError(snapshot.id, '风格改写没有返回提示词，原文未改变。'); return; }
            save({ ...snapshot, prompt, styleId: style.id, styleName: style.name });
          });
        } : undefined}
        onGenerate={() => {
          const snapshot = cloneWorkspaceDraft(draft);
          void operate(snapshot, async () => {
            const stored = save(snapshot);
            if (!stored) return;
            const outcome = await props.onGenerate(cloneWorkspaceDraft(stored));
            if (outcome.error) setError(snapshot.id, outcome.error);
          });
        }} /> : undefined} />
    </div>
    {referenceTarget && referenceTarget.objectId === selected.id && referenceTarget.outputType === outputType && <div className="workspace-picker-backdrop" onClick={() => { setReferenceTarget(null); setPickerSource('project'); }}>
      <section className="workspace-reference-picker" role="dialog" aria-label="选择本次参考素材" aria-modal="true" onClick={(event) => event.stopPropagation()}>
      <header><h2>添加参考素材</h2><button className="workspace-icon" aria-label="关闭参考选择" onClick={() => { setReferenceTarget(null); setPickerSource('project'); }}><X size={16} /></button></header>
      <div className="workspace-reference-sources" role="group" aria-label="参考来源">
        <button aria-pressed={pickerSource === 'project'} onClick={() => setPickerSource('project')}><ImageIcon size={13} />项目素材</button>
        <button aria-pressed={pickerSource === 'assets'} onClick={() => setPickerSource('assets')}><Library size={13} />项目资产</button>
        <button aria-pressed={pickerSource === 'artifacts'} onClick={() => setPickerSource('artifacts')}><Package size={13} />产物库</button>
        <button onClick={() => void pickLocalReferences(referenceTarget)}><FolderOpen size={13} />本地文件</button>
      </div>
      <div className="workspace-picker-grid">{pickerItems.map((item) => <button key={item.id} disabled={referenceTarget.references.some((ref) => ref.id === item.id || ref.path === item.path)}
        title={item.label}
        onClick={() => {
          addReference(referenceTarget, { id: item.id, type: item.mediaType as WorkspaceReference['type'], path: item.path,
            label: item.label, objectId: item.ownerObjectId, versionId: item.versionObjectId });
        }}>
        {item.mediaType === 'image' ? <img src={props.mediaSrc(item.path)} alt="" loading="lazy" /> : <span className="workspace-picker-kind">{item.mediaType === 'video' ? '视频' : '音频'}</span>}
        <span>{item.label}</span>
      </button>)}</div>
      {pickerSource === 'artifacts' && artifactsLoading && <p className="workspace-picker-empty">正在读取产物库…</p>}
      {!artifactsLoading && !pickerItems.length && <p className="workspace-picker-empty">{
        pickerSource === 'assets' ? '项目还没有定版的角色/场景/道具资产，可先在项目元素中生成并采用定版'
          : pickerSource === 'artifacts' ? '产物库暂无产物' : '项目中暂无可用素材，可从项目资产、产物库或本地文件添加'}</p>}
      {pickerSource === 'artifacts' && artifactCount < artifacts.length && <p className="workspace-picker-empty"><button onClick={() => setArtifactCount((count) => count + 60)}>显示更多（还有 {artifacts.length - artifactCount} 项）</button></p>}
    </section></div>}
  </div>;
}
