import { useEffect, useRef, useState } from 'react';
import { MessageSquare, Plus } from 'lucide-react';
import type { WorkshopData } from '@/lib/workshop/types';
import type { WorkspaceDraft } from '@/lib/workspace/types';
import type { WorkspaceGenerationOutcome } from '@/lib/workspace/generationCommand';
import { constraintGenerationDraft, createWorkspaceConstraint, setDraftConstraint, staleConstraintDrafts, workspaceConstraints, type ConstraintScope } from '@/lib/workspace/constraints';
import { workspaceMediaVersions } from '@/lib/workspace/mediaView';
import { pendingWorkspaceSubmission } from '@/lib/workspace/submissions';

interface Props {
  data: WorkshopData;
  draft: WorkspaceDraft;
  mediaSrc: (path: string) => string;
  onCommand: (command: (data: WorkshopData) => WorkshopData | null) => boolean;
  onSave: (draft: WorkspaceDraft) => WorkspaceDraft | null;
  onGenerate: (draft: WorkspaceDraft) => Promise<WorkspaceGenerationOutcome>;
  onAdopt: (objectId: string, versionId: string) => boolean;
  onAddToChat: (objectId: string) => void;
}

/** The enclosing media panel keys this section by shot; operations capture the card draft, not selection. */
export default function WorkspaceConstraintSection(props: Props) {
  const { draft, data } = props;
  const context = workspaceConstraints(data, draft.objectId);
  const [scope, setScope] = useState<ConstraintScope>(context.shotCard ? 'shot' : context.sceneCard ? 'scene' : 'shot');
  const [error, setError] = useState('');
  const [running, setRunning] = useState<Set<string>>(() => new Set());
  const [generationErrors, setGenerationErrors] = useState<Record<string, string>>({});
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  if (!context.shot || draft.outputType !== 'video') return null;
  const card = scope === 'scene' ? context.sceneCard : context.shotCard;
  const cardDraft = card ? constraintGenerationDraft(data, draft.objectId, card) : null;
  const busy = Boolean(cardDraft && running.has(cardDraft.id));
  const versions = cardDraft ? workspaceMediaVersions(data, cardDraft.objectId, 'image') : [];
  const activeRef = draft.references.find((ref) => ref.role === 'director-constraint'
    || data.projectObjects?.objects.some((item) => item.id === ref.objectId && item.kind === 'director-constraint'));
  const usingScene = context.sceneCard && activeRef?.objectId === `director-constraint:${context.sceneCard.id}`;
  const summary = activeRef ? usingScene ? `继承 ${context.scene?.name ?? '场景'}` : '本镜覆盖' : '未使用';
  const enabled = Boolean(card && activeRef?.objectId === `director-constraint:${card.id}`);
  const outdated = Boolean(enabled && card && activeRef?.path !== card.imagePath);
  const staleCount = card ? staleConstraintDrafts(data, card).length : 0;
  const pending = cardDraft && pendingWorkspaceSubmission(data, cardDraft.objectId, 'image');
  const locked = context.owner?.locked || data.projectObjects?.objects.find((item) => item.id === cardDraft?.objectId)?.locked;
  const save = (next: WorkspaceDraft) => {
    const saved = props.onSave(next);
    setError(saved ? '' : '内容已改变或对象已锁定，请重新核对后操作。');
    return saved;
  };
  return <details className="workspace-constraint-section">
    <summary>空间与调度 <span>{summary}{outdated ? ' · 引用旧版' : ''}</span>
      {!card && <button className="workspace-constraint-create" disabled={Boolean(locked)} title="为此镜头新建导演约束卡" onClick={(event) => {
        event.preventDefault(); event.stopPropagation();
        const success = props.onCommand((current) => createWorkspaceConstraint(current, draft.objectId, scope, crypto.randomUUID()));
        setError(success ? '' : '无法创建约束卡，请检查对象状态。');
      }}><Plus size={13} />新建约束卡</button>}
    </summary>
    <div className="workspace-constraint-body">
      <div className="workspace-constraint-controls">
        <label>约束来源 <select aria-label="约束卡范围" value={scope} onChange={(event) => { setScope(event.target.value as ConstraintScope); setError(''); }}>
          <option value="shot">本镜约束</option><option value="scene" disabled={!context.scene}>共享场景约束</option>
        </select></label>
        {activeRef && !enabled && <button onClick={() => save(setDraftConstraint(data, draft))}>关闭当前引用</button>}
      </div>
      {!card ? <button disabled={Boolean(locked)} onClick={() => {
        const success = props.onCommand((current) => createWorkspaceConstraint(current, draft.objectId, scope, crypto.randomUUID()));
        setError(success ? '' : '无法创建约束卡，请检查对象状态。');
      }}><Plus size={14} />建立{scope === 'scene' ? '场景' : '本镜'}约束卡</button> : <>
        {card.imagePath && <img className="workspace-constraint-preview" src={props.mediaSrc(card.imagePath)} alt="导演约束卡当前版本" loading="lazy" />}
        <label className="workspace-constraint-toggle"><input type="checkbox" checked={enabled} disabled={Boolean(locked || !card.imagePath)}
          onChange={(event) => save(setDraftConstraint(data, draft, event.target.checked ? card : undefined))} />本次视频使用导演约束卡</label>
        {outdated && <button onClick={() => save(setDraftConstraint(data, draft, card))}>更新本镜草稿引用</button>}
        {staleCount > 0 && <p className="workspace-muted" role="status">{staleCount} 份草稿仍引用旧版</p>}
        {cardDraft && <>
          <label className="workspace-constraint-prompt">约束卡提示词<textarea aria-label="导演约束卡提示词" value={cardDraft.prompt} spellCheck={false}
            disabled={Boolean(locked)} onChange={(event) => save({ ...cardDraft, prompt: event.target.value })} /></label>
          <div className="workspace-references" aria-label="约束卡场景参考">
            {cardDraft.references.map((ref) => <div className="workspace-reference" key={ref.id}><img src={props.mediaSrc(ref.path)} alt={ref.label} loading="lazy" /><span>{ref.label}</span></div>)}
          </div>
          {!cardDraft.references.length && <p className="workspace-muted">当前镜头暂无场景参考图</p>}
          <div className="workspace-constraint-controls">
            <span className="workspace-muted">GPT Image 2 · 16:9 · 2K</span>
            <button title="让助手修改约束卡提示词" aria-label="让助手修改约束卡提示词" onClick={() => {
              if (save(cardDraft)) props.onAddToChat(cardDraft.objectId);
            }}><MessageSquare size={14} />修改提示词</button>
            <button disabled={Boolean(busy || pending || locked || !cardDraft.references.length || !cardDraft.prompt.trim())}
              onClick={() => {
                const stored = save(cardDraft);
                if (!stored) return;
                setRunning((old) => new Set([...old, stored.id]));
                const report = (message: string) => { if (mounted.current) setGenerationErrors((old) => ({ ...old, [stored.id]: message })); };
                report('');
                void props.onGenerate(stored).then((result) => report(result.error ?? '')).catch(() => {
                  report('生成未完成，请先检查原任务状态，不要重复提交。');
                }).finally(() => { if (mounted.current) setRunning((old) => { const next = new Set(old); next.delete(stored.id); return next; }); });
              }}>{busy || pending ? pending?.status === 'uncertain' ? '提交待核实' : '处理中' : '生成约束卡'}</button>
          </div>
          {versions.length > 0 && <div className="workspace-constraint-versions" aria-label="约束卡候选版本">{versions.map((item) => <div key={item.media.id}>
            <img src={props.mediaSrc(item.media.path)} alt={`约束卡 v${item.ordinal}`} loading="lazy" />
            <span>v{item.ordinal}</span><button disabled={Boolean(locked || item.adopted || !item.version)} onClick={() => {
              if (item.version) setError(props.onAdopt(cardDraft.objectId, item.version.id) ? '' : '版本未切换，请检查锁定状态。');
            }}>{item.adopted ? '已采用' : '采用'}</button>
          </div>)}</div>}
        </>}
      </>}
      {error && <p className="workspace-error" role="alert">{error}</p>}
      {cardDraft && generationErrors[cardDraft.id] && <p className="workspace-error" role="alert">{generationErrors[cardDraft.id]}</p>}
    </div>
  </details>;
}
