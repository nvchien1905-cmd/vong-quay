import { create } from 'zustand';
import client from '../api/client';

const useAuth = create((set) => ({
  user: null,
  loading: true,

  login: async (email, password) => {
    const { data } = await client.post('/auth/login', { email, password });
    localStorage.setItem('accessToken', data.data.accessToken);
    localStorage.setItem('refreshToken', data.data.refreshToken);
    set({ user: data.data.user });
  },

  logout: async () => {
    try { await client.post('/auth/logout'); } catch {}
    localStorage.clear();
    set({ user: null });
  },

  fetchMe: async () => {
    try {
      const { data } = await client.get('/auth/me');
      set({ user: data.data, loading: false });
    } catch {
      set({ user: null, loading: false });
    }
  },
}));

export default useAuth;
