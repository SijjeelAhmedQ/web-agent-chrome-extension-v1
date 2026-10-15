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
  /** Opens a sub-menu that is hidden now (hover or click it to see the items). */
  hasMenu?: boolean;
  disabled?: boolean;
  required?: boolean;
  /** A field that shows a value but can’t be typed into. */
  readonly?: boolean;
  /** A text field inside a pop-up that has no ×, Close or Cancel: that pop-up's title. */
  inBlockingPopup?: string;
  href?: string;
  options?: string[];
  /** Dialog, form or table-row the element belongs to. */
  context?: string;
  inViewport: boolean;
}

/** A pop-up showing on top of the page, and the control that closes it (×, Close, Cancel), if any. */
export interface DialogInfo {
  title: string;
  text: string;
  close: ElementInfo | null;
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
  /** The pop-ups showing now (outermost first). */
  dialogs?: DialogInfo[];
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
