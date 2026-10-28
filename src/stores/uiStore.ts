import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

interface UIState {
  sidebarOpen: boolean;
  inspectorOpen: boolean;
  toggleSidebar: () => void;
  toggleInspector: () => void;
}

export const useUIStore = create<UIState>()(
  immer((set) => ({
    sidebarOpen: true,
    inspectorOpen: true,
    toggleSidebar: () =>
      set((state) => {
        state.sidebarOpen = !state.sidebarOpen;
      }),
    toggleInspector: () =>
      set((state) => {
        state.inspectorOpen = !state.inspectorOpen;
      }),
  })),
);
