import axios, { type AxiosInstance, type AxiosError } from 'axios';
import { Notify } from 'quasar';
import { HttpError } from './http-error';

export const api: AxiosInstance = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/api',
  withCredentials: true,
  timeout: 30_000,
});

api.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    const httpError = HttpError.fromAxios(error);

    if (httpError.isServerError || httpError.isNetworkError) {
      Notify.create({
        type: 'negative',
        message: httpError.userMessage,
        timeout: 6000,
      });
    }

    return Promise.reject(httpError);
  },
);
