// The only values shipped to the browser. DATABASE_URL must never appear here.
export const config = {
  dataApiUrl: import.meta.env.VITE_DATA_API_URL ?? '',
  authUrl: import.meta.env.VITE_AUTH_URL ?? '',
};
