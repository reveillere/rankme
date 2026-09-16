const API_TOKEN_KEY = 'rankme:api-token';

export const getApiToken = () => localStorage.getItem(API_TOKEN_KEY) || '';

export const setApiToken = (token) => {
  const value = token.trim();
  if (value) localStorage.setItem(API_TOKEN_KEY, value);
  else localStorage.removeItem(API_TOKEN_KEY);
};

export const apiTokenHeaders = (headers = {}) => {
  const token = getApiToken();
  return token ? { ...headers, 'X-API-Token': token } : headers;
};
