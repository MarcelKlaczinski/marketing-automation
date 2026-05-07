import type { AxiosError } from "axios";

interface ApiErrorBody {
  error?: string;
  message?: string;
  code?: string;
  [key: string]: unknown;
}

export class HttpError extends Error {
  readonly status: number | null;
  readonly code: string | null;
  readonly body: ApiErrorBody | null;
  readonly isNetworkError: boolean;
  readonly originalCause: AxiosError | undefined;

  private constructor(args: {
    message: string;
    status: number | null;
    code: string | null;
    body: ApiErrorBody | null;
    isNetworkError: boolean;
    originalCause?: AxiosError;
  }) {
    super(args.message);
    this.name = "HttpError";
    this.status = args.status;
    this.code = args.code;
    this.body = args.body;
    this.isNetworkError = args.isNetworkError;
    this.originalCause = args.originalCause;
  }

  get isClientError(): boolean {
    return this.status !== null && this.status >= 400 && this.status < 500;
  }

  get isServerError(): boolean {
    return this.status !== null && this.status >= 500;
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  get userMessage(): string {
    if (this.body?.message) return this.body.message;
    if (this.body?.error) return this.body.error;
    if (this.isNetworkError) return "Network error — check your connection";
    if (this.isServerError) return "Server error — please try again later";
    if (this.status === 401) return "Not authenticated";
    if (this.status === 403) return "Permission denied";
    if (this.status === 404) return "Not found";
    return this.message;
  }

  static fromAxios(err: AxiosError): HttpError {
    if (!err.response) {
      return new HttpError({
        message: err.message,
        status: null,
        code: err.code ?? null,
        body: null,
        isNetworkError: true,
        originalCause: err,
      });
    }
    const body = err.response.data as ApiErrorBody | null;
    return new HttpError({
      message: body?.message ?? body?.error ?? err.message,
      status: err.response.status,
      code: body?.code ?? null,
      body,
      isNetworkError: false,
      originalCause: err,
    });
  }
}
