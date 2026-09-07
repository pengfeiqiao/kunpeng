import { useState } from 'react';
import { X } from 'lucide-react';
import type { WorkshopData } from '@/lib/workshop/types';
import type { MediaFileRecord } from '@/lib/projectObjects/types';
import { inboxAssignmentTargets } from '@/lib/workspace/inbox';

interface Props {
  data: WorkshopData;
  media: MediaFileRecord;
  onClose: () => void;
  onAssign: (ownerId: string, expectedOwnerVersion: number) => boolean;
}

export default function WorkspaceClassifyDialog(props: Props) {
  const targets = inboxAssignmentTargets(props.data, props.media);
  const [target, setTarget] = useState<{ id: string; version: number } | null>(null);
  const [error, setError] = useState('');
  return <div className="workspace-dialog-backdrop"><section className="workspace-classify-dialog" role="dialog" aria-modal="true" aria-label="归类素材">
    <header><h2>归类素材</h2><button className="workspace-icon" aria-label="关闭归类" onClick={props.onClose}><X size={18} /></button></header>
    <p>{props.media.label ?? '未命名素材'}</p>
    <label>所属对象<select aria-label="素材所属对象" value={target?.id ?? ''} onChange={(event) => {
      const selected = targets.find((item) => item.id === event.target.value);
      setTarget(selected ? { id: selected.id, version: selected.version } : null); setError('');
    }}><option value="">选择镜头或素材对象</option>{targets.map((item) => <option value={item.id} key={item.id}>{item.label ?? item.id}</option>)}</select></label>
    {error && <p className="workspace-error" role="alert">{error}</p>}
    <footer><button onClick={props.onClose}>取消</button><button className="workspace-primary" disabled={!target} onClick={() => {
      if (target && !props.onAssign(target.id, target.version)) setError('素材或对象已更新、锁定或被删除，请重新选择后再试。');
    }}>归入候选组</button></footer>
  </section></div>;
}
