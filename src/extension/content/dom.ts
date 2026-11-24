/**
 * Element checks that work for elements in same-origin iframes too. Those come from another
 * window, where `el instanceof HTMLInputElement` (this window's class) is false — so fields and
 * buttons inside a frame (a modal that loads a page) could not be named, typed into or clicked.
 */

const tagIs = (el: unknown, tag: string) => !!el && (el as Element).tagName === tag;

export const isInput = (el: unknown): el is HTMLInputElement => tagIs(el, 'INPUT');
export const isTextArea = (el: unknown): el is HTMLTextAreaElement => tagIs(el, 'TEXTAREA');
export const isSelect = (el: unknown): el is HTMLSelectElement => tagIs(el, 'SELECT');
export const isButton = (el: unknown): el is HTMLButtonElement => tagIs(el, 'BUTTON');
export const isAnchor = (el: unknown): el is HTMLAnchorElement => tagIs(el, 'A');
export const isLabel = (el: unknown): el is HTMLLabelElement => tagIs(el, 'LABEL');

/** Any HTML element (not SVG or MathML), from any window. */
export const isHTML = (el: unknown): el is HTMLElement => !!el && typeof (el as Element).tagName === 'string' && 'offsetParent' in (el as object);
