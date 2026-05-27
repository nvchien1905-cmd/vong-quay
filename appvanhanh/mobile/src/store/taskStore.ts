import { create } from 'zustand';
import { taskApi } from '../api/client';

interface Task {
  id: string;
  title: string;
  description?: string;
  status: string;
  priority: string;
  deadline?: string;
  standard?: string;
  creator: { id: string; name: string; avatar?: string };
  assignee?: { id: string; name: string; avatar?: string };
  collaborators: Array<{ id: string; name: string }>;
  store?: { id: string; name: string };
  attachments: Array<{ id: string; url: string; type: string }>;
  _count?: { comments: number };
  createdAt: string;
}

interface TaskState {
  tasks: Task[];
  currentTask: Task | null;
  total: number;
  isLoading: boolean;
  fetchTasks: (params?: object) => Promise<void>;
  fetchTask: (id: string) => Promise<void>;
  createTask: (data: object) => Promise<Task>;
  updateTask: (id: string, data: object) => Promise<void>;
  changeStatus: (id: string, status: string, reason?: string) => Promise<void>;
  addComment: (id: string, content: string, mentions?: string[]) => Promise<void>;
}

export const useTaskStore = create<TaskState>((set, get) => ({
  tasks: [],
  currentTask: null,
  total: 0,
  isLoading: false,

  fetchTasks: async (params) => {
    set({ isLoading: true });
    try {
      const { data } = await taskApi.list(params);
      set({ tasks: data.data.tasks, total: data.data.total });
    } finally {
      set({ isLoading: false });
    }
  },

  fetchTask: async (id) => {
    set({ isLoading: true });
    try {
      const { data } = await taskApi.getOne(id);
      set({ currentTask: data.data });
    } finally {
      set({ isLoading: false });
    }
  },

  createTask: async (taskData) => {
    const { data } = await taskApi.create(taskData);
    const task = data.data;
    set((s) => ({ tasks: [task, ...s.tasks] }));
    return task;
  },

  updateTask: async (id, taskData) => {
    const { data } = await taskApi.update(id, taskData);
    const updated = data.data;
    set((s) => ({
      tasks: s.tasks.map((t) => (t.id === id ? updated : t)),
      currentTask: s.currentTask?.id === id ? updated : s.currentTask,
    }));
  },

  changeStatus: async (id, status, reason) => {
    await taskApi.updateStatus(id, status, reason);
    await get().fetchTask(id);
  },

  addComment: async (id, content, mentions) => {
    await taskApi.addComment(id, content, mentions);
    await get().fetchTask(id);
  },
}));
