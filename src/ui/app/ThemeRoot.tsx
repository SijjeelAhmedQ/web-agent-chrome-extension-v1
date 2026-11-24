import { App as AntApp, ConfigProvider } from 'antd';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAppSelector } from '@/store';
import { buildAntdTheme } from '../theme/antdTheme';
import type { Mode } from '../theme/tokens';

function useSystemDark(): boolean {
  const [dark, setDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setDark(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return dark;
}

export function useResolvedMode(): Mode {
  const theme = useAppSelector((s) => s.config.config.settings.theme);
  const systemDark = useSystemDark();
  return theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;
}

/** Applies theme, text size and motion preferences to both antd and the CSS variables. */
export function ThemeRoot({ children }: { children: ReactNode }) {
  const mode = useResolvedMode();
  const textSize = useAppSelector((s) => s.config.config.settings.textSize);
  const reduceMotion = useAppSelector((s) => s.config.config.settings.reduceMotion);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = mode;
    root.dataset.text = textSize;
    root.dataset.motion = reduceMotion ? 'reduce' : 'auto';
  }, [mode, textSize, reduceMotion]);

  const theme = useMemo(() => buildAntdTheme(mode, textSize === 'large'), [mode, textSize]);

  return (
    <ConfigProvider theme={theme} wave={{ disabled: true }}>
      <AntApp component={false}>{children}</AntApp>
    </ConfigProvider>
  );
}
