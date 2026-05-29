/**
 * Mastra's agent-attached scorers receive `run.output` as the persisted
 * message-list payload — typically an array of structured message objects
 * with `content` parts, not a plain string. Coercing it directly into a
 * template literal yields "[object Object]" and breaks every regex-based
 * or LLM-prompt-based scorer.
 *
 * This helper walks the common shapes and returns the concatenated text.
 * Defensive: if the structure is something unexpected, falls back to JSON
 * serialization so at least the LLM judge gets something inspectable
 * rather than a literal "[object Object]" sentinel.
 */
export function extractReportText(output: unknown): string {
  if (output == null) return '';
  if (typeof output === 'string') return output;

  if (Array.isArray(output)) {
    return output.map(extractMessageText).filter(Boolean).join('\n\n');
  }

  if (typeof output === 'object') {
    // Single message object: { role, content, ... }
    const single = extractMessageText(output);
    if (single) return single;

    // Wrapped result: { text: '...' } or { output: '...' }
    const o = output as { text?: unknown; output?: unknown };
    if (typeof o.text === 'string') return o.text;
    if (typeof o.output === 'string') return o.output;
  }

  // Last-resort: serialize so the value is at least visible in prompts/logs.
  return JSON.stringify(output);
}

function extractMessageText(msg: unknown): string {
  if (msg == null) return '';
  if (typeof msg === 'string') return msg;
  if (typeof msg !== 'object') return '';

  const m = msg as { content?: unknown; text?: unknown };

  if (typeof m.text === 'string') return m.text;

  if (typeof m.content === 'string') return m.content;

  if (Array.isArray(m.content)) {
    return m.content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object') {
          const p = part as { type?: unknown; text?: unknown };
          if ((p.type === 'text' || p.type === undefined) && typeof p.text === 'string') {
            return p.text;
          }
        }
        return '';
      })
      .filter(Boolean)
      .join('');
  }

  return '';
}
