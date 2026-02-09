export enum LogLevel {
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
  DEBUG = 'DEBUG'
}

export const logger = {
  info: (message: string, ...args: unknown[]): void => {
    console.log(`[${LogLevel.INFO}] ${message}`, ...args);
  },

  warn: (message: string, ...args: unknown[]): void => {
    console.warn(`[${LogLevel.WARN}] ${message}`, ...args);
  },

  error: (message: string, ...args: unknown[]): void => {
    console.error(`[${LogLevel.ERROR}] ${message}`, ...args);
  },

  debug: (message: string, ...args: unknown[]): void => {
    // Only log debug messages in development or if explicitly enabled
    if (process.env.NODE_ENV === 'development' || process.env.LOG_LEVEL === 'debug') {
      console.debug(`[${LogLevel.DEBUG}] ${message}`, ...args);
    }
  }
};

