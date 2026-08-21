/**
 * splitStreamingParts — split streaming text into a memoized markdown prefix
 * and a plain-text tail.
 *
 * Re-parsing the whole buffer as markdown on every flush is O(n²) over a
 * stream and is a real source of UI jank on long answers. Exponential
 * checkpoints (300 → 700 → 1500 → …) keep total parse work at ≈2× the final
 * length: the checkpointed prefix re-parses only when it doubles, and the
 * not-yet-checkpointed tail renders as plain text. When streaming ends the
 * finalized message renders full markdown, so nothing stays unstyled.
 *
 * The prefix is byte-stable between checkpoints (it only ever grows), which
 * is what lets a React.memo'd markdown renderer skip re-parsing.
 */
export function splitStreamingParts(content: string): { stable: string; tail: string } {
  if (!content) return { stable: '', tail: '' };
  let checkpoint = 300;
  while (checkpoint * 2 + 100 <= content.length) checkpoint = checkpoint * 2 + 100;
  // Strictly-greater: at content.length === checkpoint the prefix is still
  // meaningful; returning '' here would unmount the whole markdown prefix
  // for one frame at every checkpoint boundary.
  if (checkpoint > content.length) return { stable: '', tail: content };
  const nl = content.lastIndexOf('\n', checkpoint);
  const cut = nl > 0 ? nl : checkpoint;
  return { stable: content.slice(0, cut), tail: content.slice(cut) };
}
