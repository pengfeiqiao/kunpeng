/** Only result envelopes may supply output images. Providers can echo input/reference URLs. */
export function collectResultUrls(body: unknown): string[] {
  const found = new Set<string>();
  const outputKey = /^(?:results?|images?|outputs?|files?|urls?|output_url|image_url)$/i;
  const visit = (value: unknown, output = false) => {
    if (typeof value === 'string') {
      if (output && /^https?:\/\//i.test(value)) found.add(value);
      return;
    }
    if (Array.isArray(value)) { value.forEach((item) => visit(item, output)); return; }
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (outputKey.test(key)) visit(child, true);
      else if (key === 'data') visit(child, output);
      // Do not recurse through input, request, parameters, reference_images, etc.
    }
  };
  visit(body);
  return [...found];
}
