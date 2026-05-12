import { Notify, type QNotifyCreateOptions } from "quasar";

interface NotifyOptions {
  message: string;
  caption?: string;
  type?: "positive" | "negative" | "warning" | "info";
  timeout?: number;
}

export function useNotify(): {
  success: (msg: string, caption?: string) => void;
  error: (msg: string, caption?: string) => void;
  warn: (msg: string, caption?: string) => void;
  info: (msg: string, caption?: string) => void;
  custom: (opts: QNotifyCreateOptions) => void;
} {
  function notify(opts: NotifyOptions): void {
    const config: QNotifyCreateOptions = {
      type: opts.type ?? "info",
      message: opts.message,
      timeout: opts.timeout ?? 4000,
    };
    if (opts.caption) {
      config.caption = opts.caption;
    }
    Notify.create(config);
  }

  return {
    success: (msg, caption) => {
      const opts: NotifyOptions = { message: msg, type: "positive" };
      if (caption) opts.caption = caption;
      notify(opts);
    },
    error: (msg, caption) => {
      const opts: NotifyOptions = { message: msg, type: "negative" };
      if (caption) opts.caption = caption;
      notify(opts);
    },
    warn: (msg, caption) => {
      const opts: NotifyOptions = { message: msg, type: "warning" };
      if (caption) opts.caption = caption;
      notify(opts);
    },
    info: (msg, caption) => {
      const opts: NotifyOptions = { message: msg, type: "info" };
      if (caption) opts.caption = caption;
      notify(opts);
    },
    custom: (opts) => Notify.create(opts),
  };
}
