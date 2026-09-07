import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Check, Edit3, ExternalLink, FileText, RefreshCw, Save, X } from 'lucide-react';
import type { AigcProjectSource } from '../../lib/aigc/projectStore';
import { WORKSPACE_ENGINES } from '../../lib/workspace/engineCatalog';
import {
  documentKey, projectSpecProjection, specFields, workspaceDocumentDrafts,
  type DocumentTarget, type SpecProjection, type WorkspaceDocumentDrafts, type WorkspaceDocumentPort,
} from '../../lib/workspace/documents';
import './workspaceDocuments.css';

export interface WorkspaceDocumentsProps {
  projectId: string;
  sources: AigcProjectSource[];
  /** Project working documents (docs/ 目录下的 md/txt：剧本讨论、分镜说明等)。 */
  documents: string[];
  port: WorkspaceDocumentPort;
  /** Increment when authoritative spec/source/document data changes. Dirty drafts are never replaced. */
  revision?: string | number;
  drafts?: WorkspaceDocumentDrafts;
}

const errorText = (error: unknown) => error instanceof Error ? error.message : '操作失败';

export default function WorkspaceDocuments({ projectId, sources, documents, port, revision,
  drafts = workspaceDocumentDrafts }: WorkspaceDocumentsProps) {
  const [selection, setSelection] = useState<Record<string, DocumentTarget>>({});
  const [notices, setNotices] = useState<Record<string, string>>({});
  const [loadingKey, setLoadingKey] = useState('');
  const [busyProject, setBusyProject] = useState<string | null>(null);
  const activeProject = useRef(projectId);
  activeProject.current = projectId;
  useSyncExternalStore(drafts.subscribe, drafts.getRevision, drafts.getRevision);
  const selected = selection[projectId] ?? (sources.length ? { kind: 'script', sourceName: sources[0].name } : { kind: 'spec' }) as DocumentTarget;
  const key = documentKey(projectId, selected);
  const draft = drafts.get(projectId, selected);
  const dirty = Boolean(draft && draft.body !== draft.source.body);
  const notice = notices[projectId];
  const notify = (pid: string, message: string) => setNotices((old) => ({ ...old, [pid]: message }));
  const select = (target: DocumentTarget) => setSelection((old) => ({ ...old, [projectId]: target }));

  useEffect(() => {
    let cancelled = false;
    setLoadingKey(key);
    void port.read(projectId, selected).then((source) => {
      if (!cancelled && documentKey(source.projectId, source.target) === key) drafts.accept(source);
    }).catch((error) => { if (!cancelled) notify(projectId, errorText(error)); })
      .finally(() => { if (!cancelled) setLoadingKey(''); });
    return () => { cancelled = true; };
    // Target is represented by its stable key, so ordinary parent renders do not trigger filesystem reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, port, drafts, revision]);

  const refresh = async (discard: boolean) => {
    const pid = projectId;
    const target = selected;
    if (discard && !window.confirm('丢弃此文档的未保存修改并读取原文？')) return;
    try {
      const source = await port.read(pid, target);
      if (discard) drafts.discard(source); else drafts.accept(source);
      notify(pid, '');
    } catch (error) { notify(pid, errorText(error)); }
  };
  const action = async (run: () => Promise<unknown>) => {
    const pid = projectId;
    if (busyProject) return;
    setBusyProject(pid);
    try { await run(); notify(pid, ''); }
    catch (error) { notify(pid, errorText(error)); }
    finally { setBusyProject(null); }
  };

  return <section className="workspace-documents" aria-label="文档工作面" data-project-id={projectId}>
    <nav className="workspace-documents-nav" aria-label="项目文档">
      <div className="workspace-documents-group"><FileText size={15} />原剧本</div>
      {sources.length === 0 && <p className="workspace-documents-muted">未登记原剧本</p>}
      {sources.map((source) => <button key={source.name} aria-current={selected.kind === 'script' && selected.sourceName === source.name ? 'page' : undefined}
        onClick={() => select({ kind: 'script', sourceName: source.name })}>{source.name}</button>)}
      <button aria-current={selected.kind === 'spec' ? 'page' : undefined} onClick={() => select({ kind: 'spec' })}>规格与创作规则</button>
      <div className="workspace-documents-group"><FileText size={15} />项目文档</div>
      {documents.length === 0 && <p className="workspace-documents-muted">暂无项目文档；与助手讨论定稿的剧本、分镜说明会出现在这里。</p>}
      {documents.map((name) => <button key={name} aria-current={selected.kind === 'doc' && selected.name === name ? 'page' : undefined}
        onClick={() => select({ kind: 'doc', name })}>{name}</button>)}
    </nav>
    <main className="workspace-document-content">
      <header className="workspace-document-toolbar">
        <h2>{draft?.source.title ?? '文档'}</h2>
        {dirty && <span className="workspace-document-dirty">未保存</span>}
        {draft?.saving && <span role="status">正在保存</span>}
        <div className="workspace-document-actions">
          {selected.kind === 'script' && port.openOriginal && <button className="workspace-document-icon" title="打开原件" aria-label="打开原件" disabled={Boolean(busyProject)} onClick={() => void action(() => port.openOriginal!(projectId, selected))}><ExternalLink size={15} /></button>}
          <button className="workspace-document-icon" title="核对原文" aria-label="核对原文" disabled={draft?.saving} onClick={() => void refresh(false)}><RefreshCw size={15} /></button>
          {draft?.source.editable && <>
            <button className="workspace-document-icon" title={draft.editing ? '返回阅读（保留草稿）' : '编辑'} aria-label={draft.editing ? '返回阅读（保留草稿）' : '编辑'} onClick={() => drafts.setEditing(projectId, selected, !draft.editing)}>{draft.editing ? <Check size={15} /> : <Edit3 size={15} />}</button>
            {dirty && <button className="workspace-document-icon" title="丢弃未保存修改" aria-label="丢弃未保存修改" disabled={draft.saving} onClick={() => void refresh(true)}><X size={15} /></button>}
            <button className="workspace-document-icon" title="保存原文" aria-label="保存原文" disabled={!dirty || draft.saving} onClick={() => void drafts.save(projectId, selected, port)}><Save size={15} /></button>
          </>}
        </div>
      </header>
      {(draft?.error || notice) && <p className="workspace-document-error" role="alert">{draft?.error || notice}</p>}
      {draft?.incoming && <details className="workspace-document-conflict"><summary>查看最新原文</summary>
        <pre className="workspace-document-reader">{draft.incoming.body}</pre>
        <button disabled={draft.saving} onClick={() => {
          if (window.confirm('已核对最新原文？保留当前草稿并使用最新版本作为保存基线，下一次保存将覆盖对应文档内容。')) drafts.rebase(projectId, selected);
        }}>基于最新版本保留草稿</button>
      </details>}
      {loadingKey === key && !draft && <p role="status">正在读取原文</p>}
      {draft && <>
        {draft.source.location && <p className="workspace-document-location">{draft.source.location}</p>}
        {draft.source.unavailable ? <div className="workspace-document-unavailable">
          <p>{draft.source.unavailable}</p>
          {selected.kind === 'script' && draft.source.location?.startsWith('http') && <button className="workspace-doc-fetch" onClick={() => {
            const url = draft.source.location!;
            const name = selected.kind === 'script' ? selected.sourceName.replace(/\.[^.]+$/, '') : '在线原稿';
            window.dispatchEvent(new CustomEvent('kunpeng-workshop-prompt', { detail: { projectId, prompt:
              `请读取这个飞书在线文档的完整内容：${url}\n用 lark-doc skill（或 npx lark-cli）读取正文并转成 Markdown，然后调用 workshop_save_document 保存为「${name}.md」。保存后告诉我即可。` } }));
          }}>让助手拉取并转存为项目文档</button>}
        </div> : selected.kind === 'spec'
          ? <SpecDocument body={draft.body} editing={draft.editing} onChange={(body) => drafts.edit(projectId, selected, body)} />
          : draft.editing && draft.source.editable
            ? <textarea className="workspace-document-editor" aria-label="文档正文" spellCheck={false} value={draft.body} onChange={(event) => drafts.edit(projectId, selected, event.target.value)} />
            : <pre className="workspace-document-reader">{draft.body || '原文为空'}</pre>}
      </>}
    </main>
  </section>;
}

function SpecDocument({ body, editing, onChange }: { body: string; editing: boolean; onChange: (body: string) => void }) {
  const values = JSON.parse(body) as SpecProjection;
  const labels: Record<string, string> = { 'always-confirm': '每次生成前确认', 'paid-only-confirm': '仅付费生成前确认', 'direct-execute': '允许直接执行' };
  const change = (key: typeof specFields[number][0], value: unknown) => {
    const next = { ...values, [key]: value };
    onChange(projectSpecProjection({ ...next, revision: 0, updatedAt: 0 }));
  };
  return <dl className="workspace-document-spec">{specFields.map(([key, label, kind]) => {
    const value = values[key];
    const text = Array.isArray(value) ? value.join('\n') : value == null ? '' : String(value);
    return <div key={key}><dt><label htmlFor={`document-spec-${key}`}>{label}</label></dt><dd>{!editing
      ? <span>{kind === 'confirmation' ? labels[text] : text || '未设置'}</span>
      : kind === 'confirmation' ? <select id={`document-spec-${key}`} value={text} onChange={(event) => change(key, event.target.value)}>
        {Object.entries(labels).map(([id, title]) => <option key={id} value={id}>{title}</option>)}</select>
      : kind === 'lines' || kind === 'multiline' ? <textarea id={`document-spec-${key}`} rows={3} value={text} onChange={(event) => change(key, kind === 'lines' ? (event.target.value ? event.target.value.split('\n') : []) : event.target.value)} />
      : kind === 'imageModel' || kind === 'videoModel' ? <select id={`document-spec-${key}`} value={text} onChange={(event) => change(key, event.target.value || undefined)}>
        <option value="">未指定</option>
        {WORKSPACE_ENGINES.filter((engine) => engine.kind === (kind === 'imageModel' ? 'image' : 'video'))
          .filter((engine, index, list) => list.findIndex((item) => item.label === engine.label) === index)
          .map((engine) => <option key={engine.id} value={engine.id}>{engine.label}</option>)}
      </select>
      : <input id={`document-spec-${key}`} type={kind === 'number' ? 'number' : 'text'} min={kind === 'number' ? 0.1 : undefined} step="any" value={text}
        onChange={(event) => change(key, kind === 'number' ? event.target.value === '' ? undefined : Number(event.target.value) : event.target.value)} />}</dd></div>;
  })}</dl>;
}
