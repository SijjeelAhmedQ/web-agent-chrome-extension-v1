import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { pruneHistory } from '@/shared/storage/historyStore';
import { connectStorage, createStore } from '@/store';
import { ThemeRoot } from './ThemeRoot';

/** Shared bootstrap for both extension pages: store, storage sync, theme. */
export function mount(children: ReactNode) {
  const store = createStore();
  void connectStorage(store).then(() => {
    const { historyRetentionDays } = store.getState().config.config.settings;
    // Tasks idle for 10+ minutes while “running” belonged to a panel that was closed.
    void pruneHistory(historyRetentionDays, Date.now() - 10 * 60_000);
  });

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <Provider store={store}>
        <ThemeRoot>
          {children}
        </ThemeRoot>
      </Provider>
    </StrictMode>,
  );
}
