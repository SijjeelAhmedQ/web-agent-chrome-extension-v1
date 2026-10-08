import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { TaskRecord } from '@/shared/types/history';

interface HistoryState {
  tasks: TaskRecord[];
  loaded: boolean;
}

const initialState: HistoryState = { tasks: [], loaded: false };

export const historySlice = createSlice({
  name: 'history',
  initialState,
  reducers: {
    setTasks(state, action: PayloadAction<TaskRecord[]>) {
      state.tasks = action.payload;
      state.loaded = true;
    },
  },
});

export const historyActions = historySlice.actions;
