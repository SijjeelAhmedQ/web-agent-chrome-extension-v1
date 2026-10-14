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
  | { kind: 'findText'; text: string; near?: string; limit: number }
  | { kind: 'describe'; id: number }
  | { kind: 'click'; id: number; highlight: boolean; double?: boolean }
  | { kind: 'pointAt'; id: number }
  | { kind: 'effect' }
  | { kind: 'type'; id: number; text: string; clear: boolean; highlight: boolean }
  | { kind: 'clear'; id: number; highlight: boolean }
  | { kind: 'select'; id: number; option: string; highlight: boolean }
  | { kind: 'scroll'; direction?: ScrollDirection; id?: number }
  | { kind: 'key'; key: string; id?: number }
  | { kind: 'settle'; quietMs: number; timeoutMs: number }
  | { kind: 'waitForText'; text: string; timeoutMs: number }
  | { kind: 'hover'; id: number; highlight: boolean }
  | { kind: 'menuPath'; path: string[]; highlight: boolean }
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

export interface HoverResult {
  element: Pick<ElementInfo, 'name' | 'role'>;
  /** Controls that became visible — the menu or tooltip that opened. */
  revealed: ElementInfo[];
}

export interface MenuResult {
  /** Labels of the levels that were opened, in order. */
  opened: string[];
  /** What the last opened level shows. */
  revealed: ElementInfo[];
  /** The label that couldn't be found, and what was there instead. */
  failedAt?: string;
  options?: ElementInfo[];
  /** The last label was a final item (not a menu): it was reached but not clicked. */
  item?: ElementInfo;
}

/** What a click changed on the page (measured from just before it until the page settled). */
export interface ClickEffect {
  /** Lines of text that appeared — a sample. */
  added: string[];
  /** How many lines of text disappeared. */
  removed: number;
  /** Class/style/attribute changes — e.g. a row now looks selected. */
  styleChanges: number;
}

export interface ClickResult {
  element: Pick<ElementInfo, 'name' | 'role'>;
  /** A link that opens in a new tab — the agent opens it itself (pop-ups from scripts are blocked). */
  opensNewTab?: string;
  covered?: boolean;
  /** Submit blocked by the browser's form validation: “field: message”. */
  invalidFields?: string[];
  /** It was a menu trigger: its menu was opened (hovered) instead, showing these items. */
  menu?: ElementInfo[];
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

export interface TextResult {
  /** Elements showing the text, best first. */
  matches: ElementInfo[];
  total: number;
}

export interface ResponseMap {
  ping: { version: number; url: string };
  snapshot: PageSnapshot;
  find: FindResult;
  findText: TextResult;
  describe: ElementRisk;
  click: ClickResult;
  pointAt: { x: number; y: number };
  effect: ClickEffect | undefined;
  hover: HoverResult;
  menuPath: MenuResult;
  type: TypeResult;
  clear: TypeResult;
  select: SelectResult;
  scroll: ScrollResult;
  key: KeyResult;
  settle: { mutations: number; url: string; title: string; alerts: string[]; effect?: ClickEffect };
  waitForText: { found: boolean };
  presence: null;
}

export interface Envelope {
  channel: typeof CHANNEL;
  request: ContentRequest;
}
