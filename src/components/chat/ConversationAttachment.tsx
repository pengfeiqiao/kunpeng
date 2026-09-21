import { useState } from 'react';
import { FileText, FileVideo, FileAudio, FileCode2, FolderOpen, Archive, X } from 'lucide-react';
import { toCanvasDisplayUrl, assetUrlToLocalPath } from '@/lib/canvas/imageSource';

/** References remain inputs; this preview never registers a generated asset. */
export default function ConversationAttachment({ path, onRemove }: { path: string; onRemove?: () => void }) {
  const [failed, setFailed] = useState(false);
  const name = (assetUrlToLocalPath(path) ?? path.split(/[?#]/)[0]).replace(/[\\/]+$/, '').split(/[\\/]/).pop() || '附件';
  const image = /\.(png|jpe?g|webp|gif|avif)$/i.test(name);
  const Icon = /[\\/]$/.test(path) ? FolderOpen
    : /\.(mp4|mov|m4v|webm|avi|mkv)$/i.test(name) ? FileVideo
    : /\.(mp3|wav|m4a|aac|flac|ogg|opus)$/i.test(name) ? FileAudio
    : /\.(ts|tsx|js|jsx|py|rs|go|swift|html|css|json)$/i.test(name) ? FileCode2
    : /\.(zip|rar|7z|tar|gz|dmg)$/i.test(name) ? Archive : FileText;
  return <span className="conversation-attachment" title={name}>
    <span className="conversation-attachment-preview">{image && !failed
      ? <img src={toCanvasDisplayUrl(path)} alt="" onError={() => setFailed(true)} /> : <Icon size={16} />}</span>
    <span className="conversation-attachment-name">{name}</span>
    {onRemove && <button type="button" onClick={onRemove} title="移除附件" aria-label={`移除附件 ${name}`}><X size={12} /></button>}
  </span>;
}
