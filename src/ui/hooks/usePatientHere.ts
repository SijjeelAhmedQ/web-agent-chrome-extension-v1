import { useEffect, useState } from 'react';
import { patientFrom } from '@/agent/runtime/directTask';
import { BrowserController } from '@/extension/browser/controller';
import type { SiteProfile } from '@/shared/types/config';
import type { ActiveTab } from './useActiveTab';

const TRIES = 6;
const PAUSE_MS = 1_500;

/**
 * The patient whose consult is open in the tab, read from the page by code — no model, nothing spent. A consult takes
 * a few seconds to fill in, so it looks a few times. Not while the agent works: the agent is the one reading the page then.
 */
export function usePatientHere(tab: ActiveTab, sites: SiteProfile[], busy: boolean): { name: string; nhi?: string } | null {
  const [patient, setPatient] = useState<{ name: string; nhi?: string } | null>(null);
  const page = sites.find((s) => s.patientPage && tab.url.includes(s.patientPage.at))?.patientPage;
  useEffect(() => setPatient(null), [tab.id, tab.url]);
  useEffect(() => {
    if (!page || busy || tab.windowId === null || tab.id === null || tab.loading) return;
    const browser = new BrowserController(tab.windowId, tab.id);
    let stopped = false;
    void (async () => {
      for (let n = 0; n < TRIES && !stopped; n++) {
        const read = await browser.send({ kind: 'snapshot', mode: 'overview', maxElements: 250, maxTextChars: 0 }).catch(() => null);
        const found = read ? patientFrom(page, read.elements) : null;
        if (stopped) return;
        if (found) {
          setPatient(found);
          return;
        }
        await new Promise((done) => setTimeout(done, PAUSE_MS));
      }
    })();
    return () => {
      stopped = true;
    };
  }, [tab.id, tab.url, tab.loading, tab.windowId, page?.at, busy]);
  return patient;
}
