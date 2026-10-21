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
  /** A form field's visible label, when its name came from elsewhere (its placeholder): “Patient Name”. */
  label?: string;
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
  /** Nothing covers it: it is the one the user sees in front. */
  onTop?: boolean;
  /** For the pop-up in front: all its text, frames inside it included (a formulary's table, a form's wording). */
  fullText?: string;
  /** Hosts of frames inside it from another site, whose text the page itself can't read. */
  frames?: string[];
  /** PDFs shown inside it (Chrome's PDF viewer has no text in the page): their addresses, to read the file. */
  pdfs?: string[];
  /** For the pop-up in front: its lines as shown — cells side by side, left to right (a result row: test, label, flag). */
  rows?: VisualRow[];
  /** For the pop-up in front, when it is a form: each field as “- Name* — kind: value”. */
  form?: string[];
}

export interface VisualRow {
  cells: string[];
  /** Per cell: shown in red. */
  red: boolean[];
}

export interface TableResult {
  found: boolean;
  headers: string[];
  /** colour: the row's text colour (“red”, “grey”…), '' for the usual. */
  rows: { cells: string[]; colour: string }[];
  total: number;
}

export interface PageSnapshot {
  /** This document (a new page, or the same address loaded again, is another one) — for “only what changed”. */
  docId?: string;
  url: string;
  title: string;
  scroll: { percent: number; screens: number; atTop: boolean; atBottom: boolean };
  elements: ElementInfo[];
  /** Elements that exist but were left out to stay within the limit. */
  omitted: number;
  /** The ids of those left out — still on the page, not gone. */
  unlisted?: number[];
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
