import { describe, expect, it } from 'vitest';
import { reportHtml, reportMarkdown, SCREEN_SIZES, summary, type SizeResult } from './responsive/report';

const phone: SizeResult = {
  size: SCREEN_SIZES[0],
  shot: 'AAAA',
  report: {
    width: 375,
    height: 667,
    pageWidth: 900,
    issues: [
      { kind: 'page-scroll', what: 'The page is 900px wide on a 375px screen: it scrolls sideways.' },
      { kind: 'off-screen', what: 'button “Export” is partly off the screen (x 300–420 on a 375px screen).', rect: { x: 300, y: 10, w: 120, h: 40 } },
    ],
    totals: { 'page-scroll': 1, 'off-screen': 14 },
  },
};
const desktop: SizeResult = { size: SCREEN_SIZES[3], shot: '', report: { width: 1920, height: 1080, pageWidth: 1920, issues: [], totals: {} } };

describe('the responsiveness report', () => {
  it('has the four sizes of the plan', () => {
    expect(SCREEN_SIZES.map((s) => `${s.width}×${s.height}`)).toEqual(['375×667', '768×1024', '1366×768', '1920×1080']);
  });

  it('tells the agent where it breaks, with the faults named', () => {
    const s = summary([phone, desktop]);
    expect(s).toMatch(/^Problems at Phone\./);
    expect(s).toContain('Phone 375×667: 15 problems — 1 scrolls sideways, 14 off the screen.');
    expect(s).toContain('Desktop 1920×1080: no problems found.');
    expect(summary([desktop])).toMatch(/^The page looks right at every size checked/);
  });

  it('as Markdown: a table of sizes, then each size’s faults by kind — saying when only some are listed', () => {
    const md = reportMarkdown([phone, desktop], { url: 'https://app.test/patients', title: 'Practice members' });
    expect(md).toContain('| Phone | 375×667 | 1 scrolls sideways, 14 off the screen |');
    expect(md).toContain('| Desktop | 1920×1080 | none |');
    expect(md).toContain('### Off the screen (1 of 14)');
  });

  it('as HTML: each screenshot with its faults outlined where they are, and nothing from the page unescaped', () => {
    const html = reportHtml([phone, desktop], { url: 'https://app.test/?q=<b>', title: 'A <script>' });
    expect(html).toContain('src="data:image/jpeg;base64,AAAA"');
    expect(html).toContain('left:80.00%;top:1.50%;width:32.00%;height:6.00%');
    expect(html).not.toContain('<script>');
    expect(html).toContain('No screenshot.');
    expect(html).toContain('prefers-color-scheme:dark');
  });
});
