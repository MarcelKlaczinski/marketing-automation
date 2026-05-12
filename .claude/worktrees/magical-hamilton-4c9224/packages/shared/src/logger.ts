import pino from "pino";
import pretty from "pino-pretty";
import { getEnv } from "./config.js";

export function createLogger(name: string) {
  const env = getEnv();
  const base = {
    name,
    level: env.LOG_LEVEL,
    formatters: {
      level: (label: string) => ({ level: label }),
    },
  };

  if (env.NODE_ENV === "development") {
    return pino(base, pretty({ colorize: true }));
  }
  return pino(base);
}

export type Logger = ReturnType<typeof createLogger>;
