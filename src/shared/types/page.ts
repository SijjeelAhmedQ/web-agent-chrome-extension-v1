/** What the content script reports about a page — compact, semantic, never raw HTML. */

export interface ElementInfo {
  /** Stable for the life of the document. */
  id: number;
  role: string;
  name: string;
  tag: string;
  type?: string;
  value?: string;
  placeholder?: string;
  checked?: boolean;
  selected?: boolean;
  expanded?: boolean;
  disabled?: boolean;
  required?: boolean;
  href?: string;
  options?: string[];
  /** Dialog, form or table-row the element belongs to. */
  context?: string;
  inViewport: boolean;
}

export interface PageSnapshot {
  url: string;
  title: string;
  scroll: { percent: number; screens: number; atTop: boolean; atBottom: boolean };
  elements: ElementInfo[];
  /** Elements that exist but were left out to stay within the limit. */
  omitted: number;
  headings: string[];
  text: string;
  textTruncated: boolean;
  frames: string[];
  dialogOpen: boolean;
}

export type ReadMode = 'overview' | 'content';

export interface ElementRisk {
  name: string;
  role: string;
  tag: string;
  type?: string;
  formHasPassword: boolean;
  formHasPayment: boolean;
  formIsSearch: boolean;
  formSubmitLabels: string[];
  /** What the surrounding form or dialog holds right now — shown in the approval. */
  formValues?: { label: string; value: string }[];
  href?: string;
  target?: string;
}
