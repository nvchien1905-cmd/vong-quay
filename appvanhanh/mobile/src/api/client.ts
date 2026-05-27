import axios from 'axios';
import { getAccessToken, getRefreshToken, saveTokens, clearAll } from '../utils/storage';

const BASE_URL = 'http://localhost:3000/api';

export const api = axios.create({
  baseURL: BASE_URL,
  timeout: 15000,
});

api.interceptors.request.use(async (config) => {
  const token = await getAccessToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

let isRefreshing = false;
let queue: Array<{ resolve: (v: string) => void; reject: (e: Error) => void }> = [];

api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const original = err.config;
    if (err.response?.status !== 401 || original._retry) {
      return Promise.reject(err);
    }

    if (isRefreshing) {
      return new Promise((resolve, reject) => {
        queue.push({ resolve, reject });
      }).then((token) => {
        original.headers.Authorization = `Bearer ${token}`;
        return api(original);
      });
    }

    original._retry = true;
    isRefreshing = true;

    try {
      const refreshToken = await getRefreshToken();
      const { data } = await axios.post(`${BASE_URL}/auth/refresh`, { refreshToken });
      const { accessToken, refreshToken: newRefresh } = data.data;

      await saveTokens(accessToken, newRefresh);
      queue.forEach((p) => p.resolve(accessToken));
      queue = [];

      original.headers.Authorization = `Bearer ${accessToken}`;
      return api(original);
    } catch {
      queue.forEach((p) => p.reject(new Error('Session expired')));
      queue = [];
      await clearAll();
      return Promise.reject(err);
    } finally {
      isRefreshing = false;
    }
  }
);

export const authApi = {
  login: (email: string, password: string) =>
    api.post('/auth/login', { email, password }),
  logout: () => api.post('/auth/logout'),
  changePassword: (oldPassword: string, newPassword: string) =>
    api.put('/auth/change-password', { oldPassword, newPassword }),
  getMe: () => api.get('/auth/me'),
};

export const taskApi = {
  list: (params?: object) => api.get('/tasks', { params }),
  getOne: (id: string) => api.get(`/tasks/${id}`),
  create: (data: object) => api.post('/tasks', data),
  update: (id: string, data: object) => api.put(`/tasks/${id}`, data),
  updateStatus: (id: string, status: string, rejectedReason?: string) =>
    api.patch(`/tasks/${id}/status`, { status, rejectedReason }),
  uploadAttachment: (id: string, formData: FormData) =>
    api.post(`/tasks/${id}/attachments`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
  addComment: (id: string, content: string, mentions?: string[]) =>
    api.post(`/tasks/${id}/comments`, { content, mentions }),
};

export const checklistApi = {
  listTemplates: (params?: object) => api.get('/checklists/templates', { params }),
  createTemplate: (data: object) => api.post('/checklists/templates', data),
  listSessions: (params?: object) => api.get('/checklists/sessions', { params }),
  startSession: (templateId: string, storeId?: string) =>
    api.post('/checklists/sessions', { templateId, storeId }),
  completeSession: (sessionId: string) =>
    api.patch(`/checklists/sessions/${sessionId}/complete`),
  updateItem: (itemId: string, data: FormData) =>
    api.patch(`/checklists/items/${itemId}`, data, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
};

export const kpiApi = {
  myKpi: (params?: object) => api.get('/kpi/me', { params }),
  employeeRanking: (params?: object) => api.get('/kpi/employees', { params }),
  storeRanking: (params?: object) => api.get('/kpi/stores', { params }),
};

export const dashboardApi = {
  overview: () => api.get('/dashboard/overview'),
  incompleteEmployees: (storeId?: string) =>
    api.get('/dashboard/incomplete-employees', { params: { storeId } }),
};

export const reportApi = {
  taskStats: (params?: object) => api.get('/reports/tasks', { params }),
  kpiReport: (params?: object) => api.get('/reports/kpi', { params }),
};

export const sopApi = {
  listDocuments: (params?: object) => api.get('/sop/documents', { params }),
  getDocument: (id: string) => api.get(`/sop/documents/${id}`),
  uploadDocument: (formData: FormData) =>
    api.post('/sop/documents', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
  markProgress: (id: string) => api.post(`/sop/documents/${id}/progress`),
  myProgress: () => api.get('/sop/documents/my-progress'),
  getQuiz: (quizId: string) => api.get(`/sop/quizzes/${quizId}`),
  submitQuiz: (quizId: string, answers: number[]) =>
    api.post(`/sop/quizzes/${quizId}/submit`, { answers }),
};
