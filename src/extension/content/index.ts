import { CHANNEL, CONTENT_VERSION, type ContentRequest, type ContentResponse, type Envelope } from '../messaging/protocol';
import { ActionError, clear, click, currentEffect, fieldText, pointAt, pressKey, resolve, scroll, select, settle, type, visibleDialogs, waitForText } from './actions';
import { formAround } from './form';
import { hover, openMenu } from './hover';
import { setPresence } from './overlay';
import { areaText, readTable } from './rows';
import { fetchPdf, popupControl, describeRisk, find, findText, snapshot } from './snapshot';

/**
 * Content script entry. Injected on demand (never on every page by default) by the agent
 * when it needs to read or act on a tab. It does nothing until asked.
 */

declare global {
  interface Window {
    __webAgentContent?: number;
  }
}

async function handle(request: ContentRequest): Promise<unknown> {
  switch (request.kind) {
    case 'ping':
      return { version: CONTENT_VERSION, url: location.href };
    case 'snapshot':
      return snapshot(request.mode, request.maxElements, request.maxTextChars);
    case 'find':
      return find(request.query, request.limit);
    case 'findText':
      return findText(request.text, request.near, request.limit);
    case 'describe':
      return describeRisk(resolve(request.id));
    case 'click':
      return click(request.id, request.highlight, request.double);
    case 'pointAt':
      return pointAt(request.id);
    case 'effect':
      return currentEffect() ?? null;
    case 'type':
      return type(request.id, request.text, request.clear, request.highlight, request.trusted);
    case 'fieldText':
      return fieldText(request.id);
    case 'clear':
      return clear(request.id, request.highlight);
    case 'select':
      return select(request.id, request.option, request.highlight);
    case 'scroll':
      return scroll(request.direction, request.id);
    case 'key':
      return pressKey(request.key, request.id);
    case 'settle':
      return settle(request.quietMs, request.timeoutMs);
    case 'waitForText':
      return waitForText(request.text, request.timeoutMs);
    case 'dialogs':
      return visibleDialogs(request.waitMs, request.settle !== false);
    case 'popupControl':
      return popupControl(request.name);
    case 'fetchPdf':
      return fetchPdf(request.url);
    case 'table':
      return readTable(request.near, request.max);
    case 'areaText':
      return areaText(request.anchor, request.next);
    case 'formAround':
      return formAround(resolve(request.id));
    case 'hover':
      return hover(resolve(request.id), request.highlight);
    case 'menuPath':
      return openMenu(request.path, request.highlight);
    case 'presence':
      setPresence(request.active);
      return null;
  }
}

if (window.__webAgentContent !== CONTENT_VERSION) {
  window.__webAgentContent = CONTENT_VERSION;

  chrome.runtime.onMessage.addListener((message: Envelope, _sender, sendResponse: (r: ContentResponse) => void) => {
    if (message?.channel !== CHANNEL) return false;
    handle(message.request)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err: unknown) => {
        if (err instanceof ActionError) sendResponse({ ok: false, error: err.error });
        else sendResponse({ ok: false, error: { code: 'unsupported', message: err instanceof Error ? err.message : String(err) } });
      });
    return true; // async response
  });
}
