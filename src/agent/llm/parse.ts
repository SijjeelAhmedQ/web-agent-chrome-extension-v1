import type { ToolCall } from './types';

/** Removes reasoning blocks some local models (Qwen 3, DeepSeek R1) put in their content. */
export function stripThinking(content: string): string {
  return content
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^[\s\S]*?<\/think>/i, '')
    .trim();
}

/** Parses tool arguments, tolerating the small JSON mistakes small models make. */
export function parseArguments(raw: unknown): { value: Record<string, unknown>; error?: string } {
  if (raw && typeof raw === 'object') return { value: raw as Record<string, unknown> };
  if (typeof raw !== 'string' || !raw.trim()) return { value: {} };
  const attempts = [
    raw,
    raw.replace(/```(?:json)?|```/g, ''),
    raw.replace(/,\s*([}\]])/g, '$1'),
    raw.replace(/'/g, '"'),
  ];
  for (const text of attempts) {
    try {
      const value = JSON.parse(text.trim());
      if (value && typeof value === 'object' && !Array.isArray(value)) return { value };
      if (typeof value === 'string') return parseArguments(value);
    } catch {
      /* try the next repair */
    }
  }
  return { value: {}, error: `Arguments were not valid JSON: ${raw.slice(0, 200)}` };
}

let fallbackCounter = 0;

/**
 * Some local servers return tool calls as text (`<tool_call>{…}</tool_call>`, Hermes/Qwen
 * format) when their chat template isn't tool-aware. Recover them so the agent still works.
 */
export function extractTextToolCalls(content: string, knownTools: Set<string>): { calls: ToolCall[]; rest: string } {
  const calls: ToolCall[] = [];
  let rest = content;
  const tagged = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi;
  for (const match of content.matchAll(tagged)) {
    const parsed = parseArguments(match[1]).value as { name?: string; arguments?: unknown; parameters?: unknown };
    if (parsed.name && knownTools.has(parsed.name)) {
      calls.push({ id: `text_${++fallbackCounter}`, name: parsed.name, arguments: parseArguments(parsed.arguments ?? parsed.parameters ?? {}).value });
      rest = rest.replace(match[0], '');
    }
  }
  if (!calls.length) {
    // A bare JSON object that is clearly a tool call.
    const bare = content.trim().replace(/^```(?:json)?|```$/g, '').trim();
    if (bare.startsWith('{') && bare.endsWith('}')) {
      const parsed = parseArguments(bare).value as { name?: string; arguments?: unknown };
      if (parsed.name && knownTools.has(parsed.name) && parsed.arguments !== undefined) {
        calls.push({ id: `text_${++fallbackCounter}`, name: parsed.name, arguments: parseArguments(parsed.arguments).value });
        rest = '';
      }
    }
  }
  return { calls, rest: rest.trim() };
}
