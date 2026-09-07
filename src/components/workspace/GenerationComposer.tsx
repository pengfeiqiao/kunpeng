import { useId, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Check, Layers, Plus, Wand2, X, RefreshCw, Palette, Maximize2, SlidersHorizontal } from 'lucide-react';
import StyleLibraryPicker from '../canvas/StyleLibraryPicker';
import WorkspaceEngineMenu from './WorkspaceEngineMenu';
import type { StylePreset } from '@/lib/styleLibrary';
import type { RhtvCanvasEngine } from '@/lib/rhtv/types';
import type { WorkspaceDraft } from '@/lib/workspace/types';
import { calibrateWorkspaceDraft, changeWorkspaceReferences, referenceMention, workspaceDraftErrors } from '@/lib/workspace/drafts';
import './workspace.css';
import './promptExperience.css';

export interface WorkspaceEngineChoice { engine: RhtvCanvasEngine; unavailableReason?: string }
interface Props {
  draft: WorkspaceDraft;
  engines: WorkspaceEngineChoice[];
  saving?: boolean;
  busy?: boolean;
  error?: string;
  estimatedCost?: string;
  priceDetail?: string;
  estimating?: boolean;
  onEstimate?: () => void;
  onConfigure?: () => void;
  constraint?: { label: string; onOpen: () => void };
  constraintContent?: ReactNode;
  mediaSrc: (path: string) => string;
  onChange: (draft: WorkspaceDraft) => void;
  onGenerate: () => void;
  onClose: () => void;
  onAddReference: () => void;
  onOptimize: (template: 'legacy' | 'universal') => void;
  onApplyStyle?: (style: StylePreset) => void;
}

/** Controlled by an object-scoped draft, never by whichever object is currently selected in a global store. */
export default function GenerationComposer(props: Props) {
  const { draft, engines, busy, saving } = props;
  const [adjustments, setAdjustments] = useState<string[]>([]);
  const [styleOpen, setStyleOpen] = useState(false);
  const [paramsOpen, setParamsOpen] = useState(false);
  const [modeOpen, setModeOpen] = useState(false);
  const paramsRoot = useRef<HTMLDivElement>(null);
  const editor = useRef<HTMLDialogElement>(null);
  const editorInput = useRef<HTMLTextAreaElement>(null);
  const editorTrigger = useRef<HTMLButtonElement>(null);
  const editorTitle = useId();
  const choice = engines.find((item) => item.engine.id === draft.engineId);
  const commonKeys = ['ratio', 'aspectRatio', 'resolution', 'duration'];
  const commonParams = choice?.engine.params.filter((param) => commonKeys.includes(param.key)) ?? [];
  const advancedParams = choice?.engine.params.filter((param) => !commonKeys.includes(param.key)) ?? [];
  const allParams = [...commonParams, ...advancedParams];
  const paramsSummary = commonParams.map((param) => String(draft.params[param.key] ?? param.default ?? '')).filter(Boolean).join(' · ');
  // Seedance 2.0 族视频模式（沿用画布 NodeInfoBar 的正交语义：模型 × 模式 × 有无参考 → 引擎 id）：
  // 全能参考（默认，无参考时按画布语义落 t2v）/ 首尾帧（startend-v3.1-pro）/ 文生视频（t2v 引擎，不提交参考）
  // 视频模式（与画布一致的正交语义）：全能参考（默认）/ 首尾帧 / 文生视频。
  // 首尾帧统一走 startend-v3.1-pro（画布同款语义：H3/万相/2.5 的首尾帧也由该引擎承接）；
  // 文生视频：Seedance 2.0 族用 t2v 引擎 id，其余模型同引擎 + videoMode=t2v（提交时剥离参考）。
  const SEEDANCE2_FAMILY = ['seedance-2.0', 'seedance-2.0-t2v', 'seedance-2.0-fast', 'seedance-2.0-mini-t2v', 'seedance-2.0-mini-i2v'];
  const VIDEO_MODES = [
    { id: 'multimodal', label: '全能参考' },
    { id: 'startend', label: '首尾帧' },
    { id: 't2v', label: '文生视频' },
  ] as const;
  const modeAvailable = draft.outputType === 'video';
  const currentMode = draft.engineId === 'startend-v3.1-pro' ? VIDEO_MODES[1]
    : (draft.engineId.endsWith('-t2v') || draft.params.videoMode === 't2v') ? VIDEO_MODES[2] : VIDEO_MODES[0];
  const resolveModeEngine = (modeId: (typeof VIDEO_MODES)[number]['id']): { engineId: string; videoMode?: string } => {
    const family = draft.engineId.includes('mini') ? 'mini' : draft.engineId === 'seedance-2.0-fast' ? 'fast' : 'pro';
    if (modeId === 'startend') return { engineId: 'startend-v3.1-pro' };
    if (modeId === 't2v') {
      return SEEDANCE2_FAMILY.includes(draft.engineId)
        ? { engineId: family === 'mini' ? 'seedance-2.0-mini-t2v' : 'seedance-2.0-t2v' }
        : { engineId: draft.engineId, videoMode: 't2v' };
    }
    // 全能参考：Seedance 族按参考数解析；其他模型清掉 t2v 标记
    if (SEEDANCE2_FAMILY.includes(draft.engineId)) {
      const hasRefs = draft.references.length > 0;
      return { engineId: !hasRefs ? (family === 'mini' ? 'seedance-2.0-mini-t2v' : 'seedance-2.0-t2v')
        : family === 'mini' ? 'seedance-2.0-mini-i2v' : family === 'fast' ? 'seedance-2.0-fast' : 'seedance-2.0' };
    }
    return { engineId: draft.engineId };
  };
  const pickEngine = (engineId: string, videoMode?: string) => {
    const next = engines.find((item) => item.engine.id === engineId);
    if (!next || next.unavailableReason) return;
    const changed = calibrateWorkspaceDraft(draft, next.engine);
    const params = { ...changed.draft.params };
    if (videoMode) params.videoMode = videoMode; else delete params.videoMode;
    setAdjustments(changed.adjustments); props.onChange({ ...changed.draft, params });
  };
  const renderParameter = (param: RhtvCanvasEngine['params'][number]) => param.type === 'list' ? <label key={param.key} className="workspace-parameter">{param.label}<select aria-label={param.label} disabled={busy}
    value={String(draft.params[param.key] ?? param.default ?? '')}
    onChange={(event) => props.onChange({ ...draft, params: { ...draft.params, [param.key]: event.target.value } })}>
    {param.options?.map((option) => <option key={option} value={option}>{option}</option>)}
  </select></label> : param.type === 'boolean' ? <label key={param.key} className="workspace-parameter"><input type="checkbox" checked={Boolean(draft.params[param.key] ?? param.default)} disabled={busy}
    onChange={(event) => props.onChange({ ...draft, params: { ...draft.params, [param.key]: event.target.checked } })} />{param.label}</label>
    : <label key={param.key} className="workspace-parameter">{param.label}<input aria-label={param.label} disabled={busy} type={param.type === 'int' ? 'number' : 'text'}
      value={String(draft.params[param.key] ?? param.default ?? '')} onChange={(event) => props.onChange({ ...draft,
        params: { ...draft.params, [param.key]: param.type === 'int' ? Number(event.target.value) : event.target.value } })} /></label>;
  const errors = workspaceDraftErrors(draft);
  const disabled = Boolean(busy || saving || errors.length || !choice || choice.unavailableReason);
  const move = (index: number, direction: number) => {
    const refs = [...draft.references];
    [refs[index], refs[index + direction]] = [refs[index + direction], refs[index]];
    props.onChange(changeWorkspaceReferences(draft, refs));
  };
  return <section className="workspace-composer workspace-prompt-experience" aria-label="生成提示词编辑器">
    <header className="workspace-composer-heading">
      <h2>{draft.outputType === 'video' ? '视频提示词' : draft.outputType === 'image' ? '图片提示词' : '音频提示词'}</h2>
      {/* 经典版/新版优化只适用于视频提示词；图片由风格库点选后自动改写，不单列优化入口 */}
      {draft.outputType === 'video' && <label className="workspace-optimize"><Wand2 size={14} /><select aria-label="优化提示词" value="" disabled={busy} onChange={(event) => props.onOptimize(event.target.value as 'legacy' | 'universal')}>
        <option value="" disabled>优化提示词</option><option value="legacy">按经典版优化</option><option value="universal">按新版优化</option>
      </select></label>}
      <span className="workspace-muted" role="status">{saving ? '保存中' : '草稿'}</span>
      {props.onApplyStyle && <button className="workspace-icon" title={draft.styleName ? `风格库 · ${draft.styleName}` : '风格库'} aria-label="风格库" disabled={busy} onClick={() => setStyleOpen(true)}><Palette size={16} /></button>}
      <button ref={editorTrigger} className="workspace-icon" title="展开大编辑器" aria-label="展开大编辑器" aria-haspopup="dialog" onClick={() => {
        editor.current?.showModal(); editorInput.current?.focus();
      }}><Maximize2 size={16} /></button>
      <button className="workspace-icon" title="收起提示词" aria-label="收起提示词" onClick={props.onClose}><X size={16} /></button>
    </header>
    <dialog ref={editor} className="workspace-prompt-dialog" aria-labelledby={editorTitle}
      onCancel={(event) => { event.preventDefault(); editor.current?.close(); }}
      onClose={() => { if (editorTrigger.current?.isConnected) editorTrigger.current.focus({ preventScroll: true }); }}>
      <header><h2 id={editorTitle}>完整提示词</h2>
        <button type="button" className="workspace-icon" title="返回编辑面板" aria-label="返回编辑面板" onClick={() => editor.current?.close()}><X size={18} /></button>
      </header>
      <textarea ref={editorInput} aria-label="大编辑器提示词" value={draft.prompt}
        onChange={(event) => props.onChange({ ...draft, prompt: event.target.value })} spellCheck={false} />
      <footer><span role="status">{saving ? '保存中' : '草稿'} · {draft.prompt.length} 字</span>
        {props.error && <span className="workspace-error" role="alert">{props.error}</span>}
        <button type="button" onClick={() => editor.current?.close()}>完成</button>
      </footer>
    </dialog>
    {styleOpen && props.onApplyStyle && <StyleLibraryPicker key={draft.engineId} open presentation="dialog"
      library={draft.engineId.startsWith('midjourney') ? 'midjourney' : 'general'}
      onClose={() => setStyleOpen(false)} onApply={props.onApplyStyle}
      onClear={() => props.onChange({ ...draft, styleId: undefined, styleName: undefined })} />}
    <div className="workspace-composer-body">
      <div className="workspace-reference-label">本次参考</div>
      <div className="workspace-references" aria-label="本次生成参考素材">
        {draft.references.map((ref, index) => <div className="workspace-reference" key={ref.id} title={ref.label}>
          {ref.type === 'image' ? <img src={props.mediaSrc(ref.path)} alt={ref.label} loading="lazy" />
            : <span className="workspace-reference-kind">{ref.type === 'video' ? '视频' : '音频'}</span>}
          <span>{referenceMention(ref, draft.references)}</span>
          <div className="workspace-reference-actions">
            <button title={`前移${ref.label}`} aria-label={`前移${ref.label}`} disabled={index === 0} onClick={() => move(index, -1)}><ArrowLeft size={12} /></button>
            <button title={`移除${ref.label}`} aria-label={`移除${ref.label}`} onClick={() => props.onChange(changeWorkspaceReferences(draft, draft.references.filter((item) => item.id !== ref.id)))}><X size={12} /></button>
            <button title={`后移${ref.label}`} aria-label={`后移${ref.label}`} disabled={index === draft.references.length - 1} onClick={() => move(index, 1)}><ArrowRight size={12} /></button>
          </div>
        </div>)}
        <button className="workspace-add-reference" title="添加参考素材" aria-label="添加参考素材" onClick={props.onAddReference}><Plus size={20} /><span>添加</span></button>
      </div>
      <textarea className="workspace-prompt" aria-label="完整提示词" value={draft.prompt}
        onChange={(event) => props.onChange({ ...draft, prompt: event.target.value })} spellCheck={false} />
      {draft.outputType === 'video' && props.constraint && <button className="workspace-constraint" onClick={props.constraint.onOpen}>
        空间与调度 · {props.constraint.label}
      </button>}
      {draft.outputType === 'video' && props.constraintContent}
      <div className="workspace-composer-aux">
        <span className="workspace-muted">{draft.prompt.length} 字</span>
      </div>
      {adjustments.length > 0 && <p className="workspace-adjustments" role="status">{adjustments.join('；')}</p>}
      {(props.error || errors.length > 0 || choice?.unavailableReason || !choice) && <p className="workspace-error" role="alert">
        {props.error || choice?.unavailableReason || (!choice ? '当前模型不可用' : errors.join('；'))}
      </p>}
      {choice?.unavailableReason && props.onConfigure && <button onClick={props.onConfigure}>配置模型渠道</button>}
      {props.priceDetail && <p className="workspace-muted" role="status">{props.priceDetail}</p>}
    </div>
    <footer className="workspace-generation-bar">
      <div className="workspace-generation-options">
        {modeAvailable && <div className="workspace-params-root">
          <button type="button" className="workspace-params-trigger" aria-label="视频参考模式" aria-expanded={modeOpen} disabled={busy}
            onClick={() => setModeOpen(!modeOpen)}><Layers size={13} />{currentMode.label}</button>
          {modeOpen && <div className="workspace-params-drawer" role="group" aria-label="视频参考模式">
            {VIDEO_MODES.map((mode) => <button key={mode.id} className="workspace-engine-option" role="option" aria-selected={currentMode.id === mode.id}
              onClick={() => { const resolved = resolveModeEngine(mode.id); pickEngine(resolved.engineId, resolved.videoMode); setModeOpen(false); }}>
              <span className="workspace-engine-check">{currentMode.id === mode.id && <Check size={13} />}</span>
              <span className="workspace-engine-name">{mode.label}</span></button>)}
          </div>}
        </div>}
        <WorkspaceEngineMenu draft={draft} engines={engines} disabled={busy} adjustmentsNote={adjustments.length ? adjustments.join('；') : undefined}
          onPick={pickEngine} />
        {/* 隐藏的原生 select 与菜单保持同步：屏幕阅读器与自动化测试的语义锚点 */}
        <select className="workspace-visually-hidden" aria-label="生成模型" value={draft.engineId} disabled={busy} tabIndex={-1} onChange={(event) => {
          const next = engines.find((item) => item.engine.id === event.target.value);
          if (!next || next.unavailableReason) return;
          const changed = calibrateWorkspaceDraft(draft, next.engine);
          setAdjustments(changed.adjustments); props.onChange(changed.draft);
        }}>
          {!choice && <option value={draft.engineId} disabled>{draft.engineId} · 不可用</option>}
          {engines.filter((item) => item.engine.kind === draft.outputType).map((item) => <option key={item.engine.id} value={item.engine.id} disabled={Boolean(item.unavailableReason)}>{item.engine.label}{item.unavailableReason ? ` · ${item.unavailableReason}` : ''}</option>)}
        </select>
        {allParams.length > 0 && <div className="workspace-params-root" ref={paramsRoot}>
          <button type="button" className="workspace-params-trigger" aria-label="生成参数设置" aria-expanded={paramsOpen} disabled={busy}
            onClick={() => setParamsOpen(!paramsOpen)}><SlidersHorizontal size={13} />{paramsSummary || '参数'}</button>
          {paramsOpen && <div className="workspace-params-drawer" role="group" aria-label="生成参数">
            {allParams.map(renderParameter)}
          </div>}
        </div>}
      </div>
      <div className="workspace-generation-submit"><span className="workspace-muted" title={props.priceDetail}>{props.estimating ? '查询费用中' : props.estimatedCost ?? '费用以渠道结算为准'}</span>
        {props.onEstimate && <button className="workspace-icon" title="查询费用预估" aria-label="查询费用预估" disabled={props.estimating} onClick={props.onEstimate}><RefreshCw size={14} /></button>}
        <button className="workspace-primary" onClick={props.onGenerate} disabled={disabled}>{busy ? '处理中' : '生成'}</button></div>
    </footer>
  </section>;
}
