import { configureStore } from '@reduxjs/toolkit';
import { useDispatch, useSelector } from 'react-redux';
import { loadConfig, saveConfig, watchConfig } from '@/shared/storage/configStore';
import { loadHistory, watchHistory } from '@/shared/storage/historyStore';
import { chatSlice } from './chatSlice';
import { configActions, configSlice } from './configSlice';
import { historyActions, historySlice } from './historySlice';

export function createStore() {
  return configureStore({
    reducer: {
      config: configSlice.reducer,
      history: historySlice.reducer,
      chat: chatSlice.reducer,
    },
    middleware: (getDefault) => getDefault({ serializableCheck: false, immutableCheck: false }),
  });
}

export type AppStore = ReturnType<typeof createStore>;
export type RootState = ReturnType<AppStore['getState']>;
export type AppDispatch = AppStore['dispatch'];

export const useAppDispatch = useDispatch.withTypes<AppDispatch>();
export const useAppSelector = useSelector.withTypes<RootState>();

/**
 * Keeps the store and chrome.storage in sync both ways: user edits are saved (debounced),
 * and changes made in another extension page (side panel ↔ configuration) flow back in.
 */
export async function connectStorage(store: AppStore): Promise<() => void> {
  const config = await loadConfig();
  store.dispatch(configActions.hydrate(config));
  store.dispatch(historyActions.setTasks(await loadHistory()));

  let lastJson = JSON.stringify(config);
  let savedRevision = store.getState().config.revision;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const unsubscribeStore = store.subscribe(() => {
    const { revision } = store.getState().config;
    if (revision === savedRevision) return;
    savedRevision = revision;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      const latest = store.getState().config.config;
      lastJson = JSON.stringify(latest);
      void saveConfig(latest);
    }, 200);
  });

  const unwatchConfig = watchConfig((next) => {
    const json = JSON.stringify(next);
    if (json === lastJson) return;
    lastJson = json;
    store.dispatch(configActions.hydrate(next));
  });
  const unwatchHistory = watchHistory((tasks) => store.dispatch(historyActions.setTasks(tasks)));

  return () => {
    unsubscribeStore();
    unwatchConfig();
    unwatchHistory();
  };
}
