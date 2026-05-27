import AsyncStorage from '@react-native-async-storage/async-storage';

const KEYS = {
  ACCESS_TOKEN: '@retail_access_token',
  REFRESH_TOKEN: '@retail_refresh_token',
  USER: '@retail_user',
};

export const saveTokens = async (accessToken: string, refreshToken: string) => {
  await AsyncStorage.multiSet([
    [KEYS.ACCESS_TOKEN, accessToken],
    [KEYS.REFRESH_TOKEN, refreshToken],
  ]);
};

export const getAccessToken = () => AsyncStorage.getItem(KEYS.ACCESS_TOKEN);
export const getRefreshToken = () => AsyncStorage.getItem(KEYS.REFRESH_TOKEN);

export const saveUser = async (user: object) => {
  await AsyncStorage.setItem(KEYS.USER, JSON.stringify(user));
};

export const getUser = async () => {
  const raw = await AsyncStorage.getItem(KEYS.USER);
  return raw ? JSON.parse(raw) : null;
};

export const clearAll = async () => {
  await AsyncStorage.multiRemove(Object.values(KEYS));
};
