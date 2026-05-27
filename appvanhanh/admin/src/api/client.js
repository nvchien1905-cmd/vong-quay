import axios from 'axios';

const BASE_URL = import.meta.env.VITE_API_URL || '/api';
const client = axios.create({ baseURL: BASE_URL });

client.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

client.interceptors.response.use(
  (r) => r,
  async (err) => {
    const orig = err.config;
    if (err.response?.status === 401 && !orig._retry) {
      orig._retry = true;
      const refreshToken = localStorage.getItem('refreshToken');
      if (!refreshToken) return Promise.reject(err);
      try {
        const { data } = await axios.post('/api/auth/refresh', { refreshToken });
        localStorage.setItem('accessToken', data.data.accessToken);
        localStorage.setItem('refreshToken', data.data.refreshToken);
        orig.headers.Authorization = `Bearer ${data.data.accessToken}`;
        return client(orig);
      } catch {
        localStorage.clear();
        return Promise.reject(err);
      }
    }
    return Promise.reject(err);
  }
);

export default client;
