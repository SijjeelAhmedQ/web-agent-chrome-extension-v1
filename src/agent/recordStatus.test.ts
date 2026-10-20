import { describe, expect, it } from 'vitest';
import { judge, statusRows, statusSummary } from './tools/recordStatus';

const rules = { label: 'Status', normal: ['Normal'], emptyIsNormal: true };

describe('a record’s results by their Status column', () => {
  it('reads rows on one line, with an empty Status as an empty flag', () => {
    const text = 'Fields — Subject: Testing; Result Date: 21/10/2026\nFile Status: Not Filed\nHbA1c Status Abnormal\nBicarbonate blood Status\nBlood Culture Status Abnormal alert\nBlood Test Status High';
    expect(statusRows(text, 'Status')).toEqual([
      { test: 'HbA1c', status: 'Abnormal' },
      { test: 'Bicarbonate blood', status: '' },
      { test: 'Blood Culture', status: 'Abnormal alert' },
      { test: 'Blood Test', status: 'High' },
    ]);
  });

  it('reads rows split over lines — test, Status, flag — and an empty flag before the next test', () => {
    const text = 'HbA1c\nStatus\nAbnormal\nBicarbonate blood\nStatus\nBlood Culture\nStatus\nbetter\nCO2 blood ( total)\nStatus\nOrdering Provider:';
    expect(statusRows(text, 'Status')).toEqual([
      { test: 'HbA1c', status: 'Abnormal' },
      { test: 'Bicarbonate blood', status: '' },
      { test: 'Blood Culture', status: 'better' },
      { test: 'CO2 blood ( total)', status: '' },
    ]);
  });

  it('does not take prose for a row', () => {
    expect(statusRows('Please check the status of this patient.\nStatus: Active', 'Status')).toEqual([]);
  });

  it('judges by the flag: anything but Normal (or empty, when that means normal) is abnormal', () => {
    const rows = statusRows('A Status Normal\nB Status\nC Status decreased', 'Status');
    expect(judge(rows, rules).verdict).toBe('abnormal');
    expect(judge(rows.slice(0, 2), rules).verdict).toBe('normal');
    expect(judge(rows.slice(0, 2), { ...rules, emptyIsNormal: false }).verdict).toBe('unclear');
  });

  it('counts the records', () => {
    const out = statusSummary(
      [
        'Fields — Subject: Testing; Result Date: 21/10/2026\nHbA1c Status Abnormal\nBicarbonate blood Status Normal',
        'Fields — Subject: LFT; Result Date: 20/10/2026\nALT Status Normal\nAST Status',
        'Fields — Subject: Discharge summary\nPatient was discharged home.',
      ],
      rules,
    );
    expect(out).toContain('Record 1 (Testing · 21/10/2026): ABNORMAL — HbA1c: Abnormal · 1 normal (Bicarbonate blood)');
    expect(out).toContain('Record 2 (LFT · 20/10/2026): NORMAL');
    expect(out).toContain('Record 3 (Discharge summary): no “Status” rows');
    expect(out).toContain('Totals: 3 records — 1 abnormal, 1 normal, 1 to decide from the text');
  });
});
