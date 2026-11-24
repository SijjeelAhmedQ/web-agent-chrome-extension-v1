import { z } from 'zod';
import type { CustomToolConfig } from '@/shared/types/config';
import { clip } from '@/shared/utils';
import type { AgentTool } from './types';

/**
 * User-defined HTTP tools: the model calls them like any other tool and the extension sends
 * the arguments to the configured endpoint (as JSON body for POST, query string for GET).
 */

export const TOOL_NAME_PATTERN = /^[a-z][a-z0-9_]{1,47}$/;

export function parseHeaders(text: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) {
      const key = line.slice(0, i).trim();
      const value = line.slice(i + 1).trim();
      if (key) headers[key] = value;
    }
  }
  return headers;
}

function jsonSchemaFor(tool: CustomToolConfig): Record<string, unknown> {
  return {
    type: 'object',
    properties: Object.fromEntries(tool.params.map((p) => [p.name, { type: p.type, description: p.description }])),
    required: tool.params.filter((p) => p.required).map((p) => p.name),
    additionalProperties: false,
  };
}

function zodFor(tool: CustomToolConfig) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const p of tool.params) {
    let t: z.ZodTypeAny = p.type === 'number' ? z.coerce.number() : p.type === 'boolean' ? z.preprocess((v) => (typeof v === 'string' ? v === 'true' : v), z.boolean()) : z.coerce.string();
    if (!p.required) t = t.optional();
    shape[p.name] = t;
  }
  return z.object(shape);
}

export function customTool(tool: CustomToolConfig): AgentTool<Record<string, unknown>> {
  return {
    name: tool.name,
    description: tool.description || tool.label,
    schema: zodFor(tool) as unknown as z.ZodType<Record<string, unknown>, z.ZodTypeDef, unknown>,
    jsonSchema: jsonSchemaFor(tool),
    risk: tool.needsApproval ? 'sensitive' : 'action',
    touchesPage: false,
    label: () => `Using ${tool.label || tool.name}`,
    async assess() {
      if (!tool.needsApproval) return null;
      return { title: `Use ${tool.label || tool.name}?`, detail: `This sends data to ${safeHost(tool.url)}.`, confirmLabel: 'Allow' };
    },
    async execute(args, ctx) {
      let url = tool.url;
      const init: RequestInit = { method: tool.method, headers: parseHeaders(tool.headers), signal: ctx.signal };
      if (tool.method === 'GET') {
        const u = new URL(url);
        for (const [k, v] of Object.entries(args)) if (v !== undefined) u.searchParams.set(k, String(v));
        url = u.toString();
      } else {
        init.headers = { 'Content-Type': 'application/json', ...(init.headers as Record<string, string>) };
        init.body = JSON.stringify(args);
      }
      const res = await fetch(url, init);
      const text = await res.text();
      return {
        output: `HTTP ${res.status}${res.ok ? '' : ' (error)'}\n${clip(text, 6000)}`,
        note: res.ok ? 'Done' : `Error ${res.status}`,
      };
    },
  };
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
