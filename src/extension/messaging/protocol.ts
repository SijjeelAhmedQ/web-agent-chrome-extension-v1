import type { ElementInfo, ElementRisk, PageSnapshot, ReadMode } from '@/shared/types/page';

/**
 * Typed request/response protocol between the agent (side panel) and the content script.
 * Every request carries `channel` so unrelated extension messages are ignored.
 */
export const CHANNEL = 'web-agent/v1';
export const CONTENT_VERSION = 1;

export type ScrollDirection = 'up' | 'down' | 'top' | 'bottom';

export type ContentRequest =
  | { kind: 'ping' }
  | { kind: 'snapshot'; mode: ReadMode; maxElements: number; maxTextChars: number }
  | { kind: 'find'; query: string; limit: number }
  | { kind: 'describe'; id: number }
  | { kind: 'click'; id: number; highlight: boolean }
  | { kind: 'type'; id: number; text: string; clear: boolean; highlight: boolean }
  | { kind: 'clear'; id: number; highlight: boolean }
  | { kind: 'select'; id: number; option: string; highlight: boolean }
  | { kind: 'scroll'; direction?: ScrollDirection; id?: number }
  | { kind: 'key'; key: string; id?: number }
  | { kind: 'settle'; quietMs: number; timeoutMs: number }
  | { kind: 'waitForText'; text: string; timeoutMs: number }
  | { kind: 'presence'; active: boolean };

export type ContentErrorCode =
  | 'stale_element'
  | 'not_visible'
  | 'disabled'
  | 'not_editable'
  | 'not_native_select'
  | 'option_not_found'
  | 'timeout'
  | 'unsupported';

export interface ContentError {
  code: ContentErrorCode;
  message: string;
  /** Extra facts for the model, e.g. the available options. */
  detail?: string;
}

export type ContentResponse<T = unknown> = { ok: true; data: T } | { ok: false; error: ContentError };

export interface ClickResult {
  element: Pick<ElementInfo, 'name' | 'role'>;
  /** A link that opens in a new tab — the agent opens it itself (pop-ups from scripts are blocked). */
  opensNewTab?: string;
  covered?: boolean;
  /** Submit blocked by the browser's form validation: “field: message”. */
  invalidFields?: string[];
}

export interface TypeResult {
  element: Pick<ElementInfo, 'name' | 'role'>;
  value: string;
}

export interface SelectResult {
  element: Pick<ElementInfo, 'name' | 'role'>;
  selected: string;
}

export interface ScrollResult {
  percent: number;
  atTop: boolean;
  atBottom: boolean;
  moved: boolean;
}

export interface KeyResult {
  submittedForm: boolean;
  invalidFields?: string[];
}

export interface FindResult {
  matches: ElementInfo[];
  textMatches: string[];
}

export interface ResponseMap {
  ping: { version: number; url: string };
  snapshot: PageSnapshot;
  find: FindResult;
  describe: ElementRisk;
  click: ClickResult;
  type: TypeResult;
  clear: TypeResult;
  select: SelectResult;
  scroll: ScrollResult;
  key: KeyResult;
  settle: { mutations: number; url: string; title: string; alerts: string[] };
  waitForText: { found: boolean };
  presence: null;
}

export interface Envelope {
  channel: typeof CHANNEL;
  request: ContentRequest;
}
