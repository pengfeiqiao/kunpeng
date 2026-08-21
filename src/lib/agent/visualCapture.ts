import html2canvas from 'html2canvas';
import { createDir, writeBinaryFile } from '@tauri-apps/api/fs';
import { dirname } from '@tauri-apps/api/path';
import { saveCanvasImage } from '@/lib/canvas/assetPersist';

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const encoded = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function nextPaint(): Promise<void> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

export async function waitForElement(selector: string, timeoutMs = 5000): Promise<HTMLElement> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const element = document.querySelector<HTMLElement>(selector);
    if (element && element.getBoundingClientRect().width > 1 && element.getBoundingClientRect().height > 1) {
      await nextPaint();
      return element;
    }
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw new Error(`等待可视区域超时：${selector}`);
}

export async function captureElementToPng(
  element: HTMLElement,
  options: {
    outPath?: string;
    namePrefix: string;
    backgroundColor?: string | null;
    cropAspectRatio?: number;
    outputSize?: { width: number; height: number };
  },
): Promise<string> {
  await nextPaint();
  const canvas = await html2canvas(element, {
    backgroundColor: options.backgroundColor ?? null,
    logging: false,
    useCORS: true,
    allowTaint: false,
    scale: Math.min(2, Math.max(1, window.devicePixelRatio || 1)),
  });
  let outputCanvas = canvas;
  const targetRatio = options.cropAspectRatio;
  if ((targetRatio && targetRatio > 0) || options.outputSize) {
    let sx = 0;
    let sy = 0;
    let sw = canvas.width;
    let sh = canvas.height;
    if (targetRatio && targetRatio > 0) {
      const sourceRatio = sw / sh;
      if (sourceRatio > targetRatio) {
        sw = Math.max(1, Math.round(sh * targetRatio));
        sx = Math.round((canvas.width - sw) / 2);
      } else if (sourceRatio < targetRatio) {
        sh = Math.max(1, Math.round(sw / targetRatio));
        sy = Math.round((canvas.height - sh) / 2);
      }
    }
    const width = options.outputSize?.width ?? sw;
    const height = options.outputSize?.height ?? sh;
    outputCanvas = document.createElement('canvas');
    outputCanvas.width = width;
    outputCanvas.height = height;
    const context = outputCanvas.getContext('2d');
    if (!context) throw new Error('无法创建截图画布');
    context.drawImage(canvas, sx, sy, sw, sh, 0, 0, width, height);
  }
  const dataUrl = outputCanvas.toDataURL('image/png');
  if (!options.outPath?.trim()) return saveCanvasImage(dataUrl, options.namePrefix);

  const outPath = options.outPath.trim();
  await createDir(await dirname(outPath), { recursive: true }).catch(() => undefined);
  await writeBinaryFile(outPath, dataUrlToBytes(dataUrl));
  return outPath;
}
