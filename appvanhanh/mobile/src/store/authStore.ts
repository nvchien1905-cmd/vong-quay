import { create } from 'zustand';
import { authApi } from '../api/client';
import { saveTokens, saveUser, clearAll, getUser } from '../utils/storage';

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  storeId?: string;
  zoneId?: string;
  avatar?: string;
  store?: { id: string; name: string };
  zone?: { id: string; name: string };
}

interface AuthState {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  loadUser: () => Promise<void>;
  changePassword: (oldPw: string, newPw: string) => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoading: false,
  isAuthenticated: false,

  loadUser: async () => {
    const user = await getUser();
    if (user) set({ user, isAuthenticated: true });
  },

  login: async (email, password) => {
    set({ isLoading: true });
    try {
      const { data } = await authApi.login(email, password);
      const { accessToken, refreshToken, user } = data.data;
      await saveTokens(accessToken, refreshToken);
      await saveUser(user);
      set({ user, isAuthenticated: true });
    } finally {
      set({ isLoading: false });
    }
  },

  logout: async () => {
    try {
      await authApi.logout();
    } catch {}
    await clearAll();
    set({ user: null, isAuthenticated: false });
  },

  changePassword: async (oldPw, newPw) => {
    await authApi.changePassword(oldPw, newPw);
  },
}));
