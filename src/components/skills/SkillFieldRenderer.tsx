import { X, Paperclip, FolderOpen } from 'lucide-react';
import { open } from '@tauri-apps/api/dialog';
import type { PanelField } from '@/types/skill';

interface SkillFieldRendererProps {
  field: PanelField;
  value: unknown;
  onChange: (value: unknown) => void;
  accentColor?: string;
}

function activeClass(_accentColor: string = 'neutral'): string {
  return 'bg-[rgb(var(--c-text))] text-[rgb(var(--c-bg))]';
}

export default function SkillFieldRenderer({ field, value, onChange, accentColor }: SkillFieldRendererProps) {
  const activeCls = activeClass(accentColor);
  const inactiveCls = 'bg-[rgb(var(--c-border))] text-[rgb(var(--c-text-muted))] hover:text-[rgb(var(--c-text))]';

  switch (field.type) {
    case 'select':
    case 'radio':
      return (
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-[rgb(var(--c-text-muted))] w-[4.5rem] flex-shrink-0 leading-none">
            {field.label}
          </span>
          <div className="flex flex-wrap gap-1.5">
            {field.options?.map((opt) => {
              const active = value === opt.value;
              return (
                <button
                  key={opt.value}
                  onClick={() => onChange(opt.value)}
                  className={`px-2.5 py-1 rounded-md text-[12px] font-medium transition-colors ${active ? activeCls : inactiveCls}`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>
      );

    case 'input':
      return (
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-[rgb(var(--c-text-muted))] w-[4.5rem] flex-shrink-0 leading-none">
            {field.label}
          </span>
          <input
            type="text"
            value={(value as string) || ''}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.placeholder}
            className="flex-1 px-2.5 py-1 rounded-md text-[12px] bg-[rgb(var(--c-bg))] border border-[rgb(var(--c-border))] text-[rgb(var(--c-text))] outline-none focus:border-[rgb(var(--c-text-muted))] placeholder:text-[rgb(var(--c-text-muted))] placeholder:opacity-60"
          />
        </div>
      );

    case 'textarea':
      return (
        <div className="flex items-start gap-3">
          <span className="text-[11px] text-[rgb(var(--c-text-muted))] w-[4.5rem] flex-shrink-0 leading-none pt-2">
            {field.label}
          </span>
          <textarea
            rows={2}
            value={(value as string) || ''}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.placeholder}
            className="flex-1 px-2.5 py-1.5 rounded-md text-[12px] bg-[rgb(var(--c-bg))] border border-[rgb(var(--c-border))] text-[rgb(var(--c-text))] outline-none focus:border-[rgb(var(--c-text-muted))] resize-none placeholder:text-[rgb(var(--c-text-muted))] placeholder:opacity-60 leading-relaxed"
          />
        </div>
      );

    case 'number':
      return <NumberField field={field} value={value} onChange={onChange} accentColor={accentColor} />;

    case 'toggle':
      return (
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-[rgb(var(--c-text-muted))] w-[4.5rem] flex-shrink-0 leading-none">
            {field.label}
          </span>
          <button
            onClick={() => onChange(!(value as boolean))}
            className={`px-2.5 py-1 rounded-md text-[12px] font-medium transition-colors ${
              value ? activeCls : inactiveCls
            }`}
          >
            {value ? '已开启' : '开启'}
          </button>
        </div>
      );

    case 'directory':
      return <DirectoryField field={field} value={value} onChange={onChange} />;

    case 'file':
      return <FileField field={field} value={value} onChange={onChange} multiple={false} />;

    case 'file-multi':
      return <FileMultiField field={field} value={value} onChange={onChange} />;

    default:
      return null;
  }
}

function NumberField({ field, value, onChange, accentColor }: SkillFieldRendererProps) {
  const activeCls = activeClass(accentColor);
  const inactiveCls = 'bg-[rgb(var(--c-border))] text-[rgb(var(--c-text-muted))] hover:text-[rgb(var(--c-text))]';
  const lo = field.min ?? 1;
  const hi = field.max ?? 200;
  const presets = (field.presets ?? [10, 20, 25, 30, 50]).filter((n: number) => n >= lo && n <= hi);

  return (
    <div className="flex items-center gap-3">
      <span className="text-[11px] text-[rgb(var(--c-text-muted))] w-[4.5rem] flex-shrink-0 leading-none">
        {field.label}
      </span>
      <div className="flex items-center gap-1.5">
        {presets.map((n) => (
          <button
            key={n}
            onClick={() => onChange(n)}
            className={`px-2.5 py-1 rounded-md text-[12px] font-medium transition-colors ${
              value === n ? activeCls : inactiveCls
            }`}
          >
            {n}
          </button>
        ))}
        <input
          type="number"
          min={field.min ?? 1}
          max={field.max ?? 200}
          value={(value as number) || 0}
          onChange={(e) => {
            const v = Math.max(field.min ?? 1, Math.min(field.max ?? 200, parseInt(e.target.value) || 1));
            onChange(v);
          }}
          className="w-14 px-2 py-1 rounded-md text-[12px] bg-[rgb(var(--c-bg))] border border-[rgb(var(--c-border))] text-[rgb(var(--c-text))] outline-none focus:border-[rgb(var(--c-text-muted))] text-center"
        />
      </div>
    </div>
  );
}

function DirectoryField({ field, value, onChange }: Omit<SkillFieldRendererProps, 'accentColor'>) {
  const handleSelect = async () => {
    const selected = await open({ multiple: false, directory: true }).catch(() => null);
    if (selected && typeof selected === 'string') onChange(selected);
  };

  const strValue = (value as string) || '';

  return (
    <div className="flex items-center gap-3">
      <span className="text-[11px] text-[rgb(var(--c-text-muted))] w-[4.5rem] flex-shrink-0 leading-none">
        {field.label}
      </span>
      <div className="flex items-center gap-1.5">
        {strValue ? (
          <div className="flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-md border border-[rgb(var(--c-border))] bg-[rgb(var(--c-bg))] text-[11px] text-[rgb(var(--c-text-muted))] max-w-[200px]">
            <span className="truncate">{strValue.split('/').pop() || strValue}</span>
            <button
              onClick={() => onChange('')}
              className="p-0.5 rounded hover:text-[rgb(var(--c-text))] transition-colors flex-shrink-0"
            >
              <X size={10} />
            </button>
          </div>
        ) : (
          <button
            onClick={handleSelect}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] font-medium bg-[rgb(var(--c-border))] text-[rgb(var(--c-text-muted))] hover:text-[rgb(var(--c-text))] transition-colors"
          >
            <FolderOpen size={11} />
            选择目录
          </button>
        )}
      </div>
    </div>
  );
}

function FileField({ field, value, onChange, multiple }: Omit<SkillFieldRendererProps, 'accentColor'> & { multiple: boolean }) {
  const handleSelect = async () => {
    const selected = await open({
      multiple,
      directory: false,
      filters: field.extensions ? [{ name: 'Files', extensions: field.extensions }] : undefined,
    }).catch(() => null);
    if (selected && typeof selected === 'string') onChange(selected);
  };

  const strValue = (value as string) || '';

  return (
    <div className="flex items-center gap-3">
      <span className="text-[11px] text-[rgb(var(--c-text-muted))] w-[4.5rem] flex-shrink-0 leading-none">
        {field.label}
      </span>
      <div className="flex items-center gap-1.5">
        {strValue ? (
          <div className="flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-md border border-[rgb(var(--c-border))] bg-[rgb(var(--c-bg))] text-[11px] text-[rgb(var(--c-text-muted))] max-w-[200px]">
            <span className="truncate">{strValue.split('/').pop() || strValue}</span>
            <button
              onClick={() => onChange('')}
              className="p-0.5 rounded hover:text-[rgb(var(--c-text))] transition-colors flex-shrink-0"
            >
              <X size={10} />
            </button>
          </div>
        ) : (
          <button
            onClick={handleSelect}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] font-medium bg-[rgb(var(--c-border))] text-[rgb(var(--c-text-muted))] hover:text-[rgb(var(--c-text))] transition-colors"
          >
            <Paperclip size={11} />
            选择文件
          </button>
        )}
      </div>
    </div>
  );
}

function FileMultiField({ field, value, onChange }: Omit<SkillFieldRendererProps, 'accentColor'>) {
  const files = (value as string[]) || [];

  const handleAdd = async () => {
    const selected = await open({
      multiple: true,
      directory: false,
      filters: field.extensions ? [{ name: 'Files', extensions: field.extensions }] : undefined,
    }).catch(() => null);
    if (selected) {
      const paths = Array.isArray(selected) ? selected : [selected];
      onChange([...files, ...paths.filter((p) => !files.includes(p))]);
    }
  };

  return (
    <div className="flex items-start gap-3">
      <span className="text-[11px] text-[rgb(var(--c-text-muted))] w-[4.5rem] flex-shrink-0 leading-none pt-1">
        {field.label}
      </span>
      <div className="flex flex-wrap gap-1.5">
        {files.map((p, i) => (
          <div
            key={i}
            className="flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-md border border-[rgb(var(--c-border))] bg-[rgb(var(--c-bg))] text-[11px] text-[rgb(var(--c-text-muted))] max-w-[200px]"
          >
            <span className="truncate">{p.split('/').pop()}</span>
            <button
              onClick={() => onChange(files.filter((_, j) => j !== i))}
              className="p-0.5 rounded hover:text-[rgb(var(--c-text))] transition-colors flex-shrink-0"
            >
              <X size={10} />
            </button>
          </div>
        ))}
        <button
          onClick={handleAdd}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] font-medium bg-[rgb(var(--c-border))] text-[rgb(var(--c-text-muted))] hover:text-[rgb(var(--c-text))] transition-colors"
        >
          <Paperclip size={11} />
          添加参考图
        </button>
      </div>
    </div>
  );
}
