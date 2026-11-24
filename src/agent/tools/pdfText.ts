import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = workerUrl;

/**
 * The text of a PDF (Firefox's pdf.js, in the extension — nothing leaves the browser). Pages that
 * are pictures — a scanned document — have no text: `text` comes back empty for them.
 */
export async function pdfText(data: Uint8Array, maxPages = 15, maxChars = 12_000): Promise<{ pages: number; read: number; text: string }> {
  const task = getDocument({ data, useSystemFonts: true });
  const doc = await task.promise;
  try {
    const parts: string[] = [];
    let length = 0;
    const read = Math.min(doc.numPages, maxPages);
    for (let n = 1; n <= read && length < maxChars; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      // Items on one line join with spaces; a jump to a new line starts a new line.
      let line = '';
      const lines: string[] = [];
      let lastY: number | null = null;
      for (const item of content.items) {
        if (!('str' in item)) continue;
        const y = item.transform[5];
        if (lastY !== null && Math.abs(y - lastY) > 2 && line.trim()) {
          lines.push(line.trim());
          line = '';
        }
        line += `${item.str}${item.hasEOL ? '\n' : ' '}`;
        lastY = y;
      }
      if (line.trim()) lines.push(line.trim());
      const pageText = lines.join('\n').replace(/[ \t]+/g, ' ').trim();
      if (pageText) {
        parts.push(doc.numPages > 1 ? `[page ${n}]\n${pageText}` : pageText);
        length += pageText.length;
      }
    }
    return { pages: doc.numPages, read, text: parts.join('\n').slice(0, maxChars) };
  } finally {
    void task.destroy();
  }
}
