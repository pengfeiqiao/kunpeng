/**
 * Incremental SSE `data:` parser.
 *
 * Transport chunks may end in the middle of a line. Only complete lines are
 * consumed, otherwise the same partial `data:` line can be appended twice
 * when the next chunk arrives and corrupt a JSON/tool-call payload.
 */
export class AnthropicSseDataParser {
  private lineBuffer = '';
  private eventData: string[] = [];

  push(chunk: string): string[] {
    this.lineBuffer += chunk;
    const events: string[] = [];
    let newline = this.lineBuffer.indexOf('\n');
    while (newline >= 0) {
      let line = this.lineBuffer.slice(0, newline);
      this.lineBuffer = this.lineBuffer.slice(newline + 1);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      this.consumeLine(line, events);
      newline = this.lineBuffer.indexOf('\n');
    }
    return events;
  }

  finish(): string[] {
    const events: string[] = [];
    if (this.lineBuffer.length > 0) {
      let line = this.lineBuffer;
      this.lineBuffer = '';
      if (line.endsWith('\r')) line = line.slice(0, -1);
      this.consumeLine(line, events);
    }
    this.flush(events);
    return events;
  }

  private consumeLine(line: string, events: string[]): void {
    if (line === '') {
      this.flush(events);
      return;
    }
    if (line.startsWith(':')) return;
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    if (field !== 'data') return;
    let value = colon < 0 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    this.eventData.push(value);
  }

  private flush(events: string[]): void {
    if (this.eventData.length === 0) return;
    events.push(this.eventData.join('\n'));
    this.eventData = [];
  }
}
