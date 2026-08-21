/**
 * runtime/text — CJK 安全的逐字/逐词拆分（hydrate 期一次性 DOM 改写）。
 */

export interface SplitUnit {
  el: HTMLElement;
}

/**
 * 把元素的直接文本拆成 span 单元（保留原有子元素不动）。
 * char 模式按码位拆（对 CJK 每字一单元，代理对安全）；word 模式按空白+CJK 单字拆。
 */
export function splitText(el: HTMLElement, mode: 'char' | 'word'): SplitUnit[] {
  const units: SplitUnit[] = [];
  const textNodes: Text[] = [];
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === 3 && node.textContent && node.textContent.trim()) textNodes.push(node as Text);
  }
  for (const node of textNodes) {
    const text = node.textContent ?? '';
    const frag = el.ownerDocument.createDocumentFragment();
    const pieces = mode === 'char' ? [...text] : text.split(/(\s+)/).flatMap(splitWordPiece);
    for (const piece of pieces) {
      if (!piece) continue;
      if (/^\s+$/.test(piece)) {
        frag.appendChild(el.ownerDocument.createTextNode(piece));
        continue;
      }
      const span = el.ownerDocument.createElement('span');
      span.className = 'kp-split-unit';
      span.style.display = 'inline-block';
      span.style.whiteSpace = 'pre';
      span.textContent = piece;
      frag.appendChild(span);
      units.push({ el: span });
    }
    node.replaceWith(frag);
  }
  return units;
}

/** word 模式下 CJK 连续串仍按单字拆（中文没有空格分词） */
function splitWordPiece(piece: string): string[] {
  if (/^\s+$/.test(piece) || !piece) return [piece];
  if (/[一-鿿㐀-䶿　-〿]/.test(piece)) return [...piece];
  return [piece];
}
