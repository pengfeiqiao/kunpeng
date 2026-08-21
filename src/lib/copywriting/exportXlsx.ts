import { save } from '@tauri-apps/api/dialog';
import { writeBinaryFile } from '@tauri-apps/api/fs';

interface TableRow {
  [key: string]: string;
}

export async function exportXlsx(headers: string[], rows: TableRow[], defaultName = '分镜表') {
  const { utils, write } = await import('xlsx');

  const wsData = [headers, ...rows.map(r => headers.map(h => r[h] ?? ''))];
  const ws = utils.aoa_to_sheet(wsData);

  const colWidths = headers.map((h) => {
    const maxLen = Math.max(h.length, ...rows.map(r => (r[h] ?? '').length));
    return { wch: Math.min(Math.max(maxLen * 2, 8), 50) };
  });
  ws['!cols'] = colWidths;

  const wb = utils.book_new();
  utils.book_append_sheet(wb, ws, '分镜表');

  const buf = write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;

  const filePath = await save({
    defaultPath: `${defaultName}.xlsx`,
    filters: [{ name: 'Excel', extensions: ['xlsx'] }],
  });

  if (filePath) {
    await writeBinaryFile(filePath, new Uint8Array(buf));
  }
}
