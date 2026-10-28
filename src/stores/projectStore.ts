import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { Project, PageAnalysis, ZoomSegment } from '../types/project';
import { saveProject, listProjects, getProject as dbGetProject } from '../storage/db';

interface ProjectState {
  currentProjectId: string | null;
  projects: Record<string, Project>;
  pendingAnalysis: PageAnalysis | null;

  // Actions
  setCurrent: (id: string | null) => void;
  upsertProject: (project: Project) => void;
  loadProject: (id: string) => Promise<Project | undefined>;
  loadAllProjects: () => Promise<void>;
  setPendingAnalysis: (analysis: PageAnalysis | null) => void;
  persistProject: (project: Project) => Promise<void>;
  updateProjectZooms: (id: string, zooms: ZoomSegment[]) => Promise<void>;
}

export const useProjectStore = create<ProjectState>()(
  immer((set, get) => ({
    currentProjectId: null,
    projects: {},
    pendingAnalysis: null,

    setCurrent: (id) =>
      set((state) => {
        state.currentProjectId = id;
      }),

    upsertProject: (project) =>
      set((state) => {
        state.projects[project.id] = project;
      }),

    loadProject: async (id: string) => {
      // Check memory first
      const existing = get().projects[id];
      if (existing) return existing;
      // Fall back to IndexedDB
      const project = await dbGetProject(id);
      if (project) {
        set((state) => {
          state.projects[project.id] = project;
        });
      }
      return project;
    },

    loadAllProjects: async () => {
      const all = await listProjects();
      set((state) => {
        for (const p of all) {
          state.projects[p.id] = p;
        }
      });
    },

    setPendingAnalysis: (analysis) =>
      set((state) => {
        state.pendingAnalysis = analysis;
      }),

    persistProject: async (project: Project) => {
      await saveProject(project);
      set((state) => {
        state.projects[project.id] = project;
        state.currentProjectId = project.id;
      });
    },

    updateProjectZooms: async (id: string, zooms) => {
      const proj = get().projects[id];
      if (!proj) return;
      const updated = {
        ...proj,
        edit: {
          ...proj.edit,
          zooms,
        },
      };
      await saveProject(updated);
      set((state) => {
        state.projects[id] = updated;
      });
    },
  })),
);
