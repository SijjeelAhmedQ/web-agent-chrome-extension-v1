import { App, Button } from 'antd';
import { RotateCcw, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { FRESH_INSTALL_KEY, mergeConfig } from '@/shared/storage/configStore';
import { restoreLedger } from '@/shared/storage/costLedger';
import { getItem, removeItem } from '@/shared/storage/storage';
import type { AppConfig } from '@/shared/types/config';
import { useAppDispatch, useAppSelector } from '@/store';
import { configActions } from '@/store/configSlice';

/**
 * Right after the extension is installed — often again, after it was removed, which deletes
 * everything it stored — offers to bring the setup back from the automatic backup file.
 */
export function RestoreBanner() {
  const [show, setShow] = useState(false);
  const config = useAppSelector((s) => s.config.config);
  const dispatch = useAppDispatch();
  const { message } = App.useApp();
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void getItem<boolean>(FRESH_INSTALL_KEY).then((fresh) => setShow(!!fresh));
  }, []);

  const done = () => {
    setShow(false);
    void removeItem(FRESH_INSTALL_KEY);
  };

  const restore = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as Partial<AppConfig>;
      if (!parsed || typeof parsed !== 'object' || (!parsed.agents && !parsed.sites)) throw new Error('not a config');
      const { config: next, added } = mergeConfig(config, parsed);
      dispatch(configActions.replaceConfig(next));
      const days = await restoreLedger(parsed).catch(() => 0);
      message.success(`Restored ${added.agents} agents, ${added.sites} sites, ${added.skills} skills and ${added.customTools} tools${days ? `, and ${days} days of cost` : ''}`);
      done();
    } catch {
      message.error("That file isn't a Web Agent backup.");
    }
  };

  if (!show) return null;
  return (
    <div className="restore-banner" role="region" aria-label="Restore from backup">
      <RotateCcw size={18} aria-hidden />
      <div className="restore-banner-text">
        <strong>Had Web Agent before?</strong> Bring back your agents, sites, knowledge, skills, tools and cost record from the backup in{' '}
        <code>Downloads\WebAgent\web-agent-backup.json</code>.
      </div>
      <input
        ref={input}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void restore(f);
          e.target.value = '';
        }}
      />
      <Button type="primary" onClick={() => input.current?.click()}>
        Restore from backup
      </Button>
      <button type="button" className="icon-btn small" aria-label="Dismiss" onClick={done}>
        <X size={14} />
      </button>
    </div>
  );
}
