import { afterEach, describe, expect, it, vi } from 'vitest';
import { chooseInCustom } from '@/extension/content/actions';

// The Smart Inbox's filter bar, as Ant Design builds it: a dropdown's list is made the first time it opens.
function bar() {
  document.body.innerHTML = `
    <div class="ant-select" id="status"><div class="ant-select-selector"><input aria-controls="status_list" readonly><span class="ant-select-selection-item" title="Normal">Normal</span></div></div>
    <div class="ant-select" id="file"><div class="ant-select-selector"><input aria-controls="file_list" readonly><span class="ant-select-selection-placeholder">File (All)</span></div></div>
    <div class="ant-select-dropdown"><div id="status_list"></div>
      <div class="ant-select-item-option" title="Status (All)">Status (All)</div><div class="ant-select-item-option" title="Normal">Normal</div><div class="ant-select-item-option" title="Abnormal">Abnormal</div></div>`;
  const file = document.getElementById('file')!;
  file.querySelector('.ant-select-selector')!.addEventListener('mousedown', () => {
    if (document.getElementById('file_list')) return;
    const list = document.createElement('div');
    list.className = 'ant-select-dropdown';
    list.innerHTML = `<div id="file_list"></div>${['File (All)', 'Filed', 'Unfiled'].map((o) => `<div class="ant-select-item-option" title="${o}">${o}</div>`).join('')}`;
    list.addEventListener('click', (e) => {
      const o = (e.target as Element).closest('.ant-select-item-option');
      if (o) file.querySelector('.ant-select-selector span')!.outerHTML = `<span class="ant-select-selection-item" title="${o.getAttribute('title')}">${o.textContent}</span>`;
    });
    document.body.append(list);
  });
  return file;
}

describe('an Ant dropdown opened for the first time, with another one’s list still showing', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('chooses in its own list, not in the other one (“Unfiled” in File, Status’s list still open)', async () => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, width: 100, height: 20, top: 0, left: 0, right: 100, bottom: 20, toJSON: () => ({}) } as DOMRect);
    Object.assign(HTMLElement.prototype, { checkVisibility: () => true });
    Object.assign(Range.prototype, { getBoundingClientRect: () => ({ x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 }), getClientRects: () => [] });
    // jsdom has no PointerEvent, and its MouseEvent refuses the page's view: plain events, as the listeners need.
    vi.stubGlobal('PointerEvent', class extends Event {});
    vi.stubGlobal('MouseEvent', class extends Event {});
    const file = bar();
    const result = await chooseInCustom(file, 'Unfiled', false);
    expect(result?.selected).toBe('Unfiled');
  });
});
