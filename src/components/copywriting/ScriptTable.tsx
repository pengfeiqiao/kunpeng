import { useState } from 'react';
import { MarkdownRenderer } from '@/lib/markdown';

interface TableRow {
  [key: string]: string;
}

interface ParsedTable {
  headers: string[];
  rows: TableRow[];
}

export function parseMarkdownTable(md: string): ParsedTable | null {
  const lines = md.trim().split('\n').filter(l => l.trim().length > 0);
  if (lines.length < 2) return null;

  const headerLine = lines[0];
  if (!headerLine.includes('|')) return null;

  const headers = headerLine.split('|').map(h => h.trim()).filter(Boolean);
  if (headers.length < 2) return null;

  const rows: TableRow[] = [];
  for (let i = 2; i < lines.length; i++) {
    const cells = lines[i].split('|').map(c => c.trim()).filter(Boolean);
    const row: TableRow = {};
    headers.forEach((h, idx) => {
      row[h] = cells[idx] ?? '';
    });
    rows.push(row);
  }

  return { headers, rows };
}

interface Props {
  markdown: string;
  onChange?: (markdown: string) => void;
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, '<br>');
}

function serializeMarkdownTable(headers: string[], rows: TableRow[]): string {
  const header = `| ${headers.map(escapeCell).join(' | ')} |`;
  const divider = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map(row => `| ${headers.map(h => escapeCell(row[h] ?? '')).join(' | ')} |`);
  return [header, divider, ...body].join('\n');
}

export default function ScriptTable({ markdown, onChange }: Props) {
  const [editingCell, setEditingCell] = useState<{ row: number; header: string } | null>(null);
  const table = parseMarkdownTable(markdown);
  if (!table) return null;

  const { headers, rows } = table;

  const handleCellChange = (rowIndex: number, header: string, value: string) => {
    if (!onChange) return;
    setEditingCell(null);
    const nextRows = rows.map((row, i) => (
      i === rowIndex ? { ...row, [header]: value } : row
    ));
    onChange(serializeMarkdownTable(headers, nextRows));
  };

  return (
    <div className="rounded-xl border overflow-hidden my-3" style={{ borderColor: 'var(--cw-border)' }}>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]" style={{ color: 'var(--cw-text)' }}>
          <thead>
            <tr style={{ background: 'var(--cw-card)' }}>
              {headers.map((h, i) => (
                <th
                  key={i}
                  className="px-3 py-2.5 text-left font-semibold whitespace-nowrap border-b text-[12px]"
                  style={{ borderColor: 'var(--cw-border)', color: 'var(--cw-text)' }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr
                key={ri}
                style={{ background: ri % 2 === 0 ? 'var(--cw-bg)' : 'var(--cw-card)' }}
              >
                {headers.map((h, ci) => (
                  <td
                    key={ci}
                    className="px-3 py-2.5 border-b align-top"
                    style={{ borderColor: 'var(--cw-border)', color: 'var(--cw-text-2)' }}
                  >
                    {editingCell?.row === ri && editingCell.header === h ? (
                      <div
                        contentEditable
                        suppressContentEditableWarning
                        autoFocus
                        onBlur={e => handleCellChange(ri, h, e.currentTarget.innerText)}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            e.currentTarget.blur();
                          } else if (e.key === 'Escape') {
                            e.preventDefault();
                            setEditingCell(null);
                          }
                        }}
                        className="min-w-[72px] rounded bg-white px-1 py-0.5 outline-none ring-1 ring-stone-300"
                      >
                        {row[h]}
                      </div>
                    ) : (
                      <div
                        onDoubleClick={() => onChange && setEditingCell({ row: ri, header: h })}
                        className={onChange ? 'min-w-[72px] rounded px-1 py-0.5 transition-colors hover:bg-white/60' : undefined}
                        title={onChange ? '双击编辑单元格' : undefined}
                      >
                        <MarkdownRenderer content={row[h] ?? ''} />
                      </div>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

    </div>
  );
}
