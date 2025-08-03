export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  FATAL = 4
}

export interface LogContext {
  [key: string]: any;
}

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, error?: Error, context?: LogContext): void;
  fatal(message: string, error?: Error, context?: LogContext): void;
  
  child(context: LogContext): Logger;
  setLevel(level: LogLevel): void;
  getLevel(): LogLevel;
  
  // For structured logging
  log(level: LogLevel, message: string, context?: LogContext, error?: Error): void;
}

export interface LoggerConfig {
  level: LogLevel;
  format: 'json' | 'text';
  destination: 'console' | 'file' | 'remote';
  enableColors?: boolean;
  timestampFormat?: string;
}

export interface LoggerFactory {
  create(name: string, config?: Partial<LoggerConfig>): Logger;
  setDefault(logger: Logger): void;
  getDefault(): Logger | null;
}