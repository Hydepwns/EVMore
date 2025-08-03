import { Logger, LoggerFactory as ILoggerFactory, LoggerConfig, LogLevel } from '@evmore/interfaces';

export class LoggerFactory implements ILoggerFactory {
  private static instance: LoggerFactory;
  private defaultLogger: Logger | null = null;
  
  static getInstance(): LoggerFactory {
    if (!this.instance) {
      this.instance = new LoggerFactory();
    }
    return this.instance;
  }
  
  create(name: string, config?: Partial<LoggerConfig>): Logger {
    // For now, return a simple console logger
    // This can be replaced with more sophisticated implementations
    return new ConsoleLogger(name, config);
  }
  
  setDefault(logger: Logger): void {
    this.defaultLogger = logger;
  }
  
  getDefault(): Logger | null {
    return this.defaultLogger;
  }
}

class ConsoleLogger implements Logger {
  private level: LogLevel;
  private context: Record<string, any> = {};
  
  constructor(
    private name: string,
    config?: Partial<LoggerConfig>
  ) {
    this.level = config?.level ?? LogLevel.INFO;
  }
  
  debug(message: string, context?: Record<string, any>): void {
    this.log(LogLevel.DEBUG, message, context);
  }
  
  info(message: string, context?: Record<string, any>): void {
    this.log(LogLevel.INFO, message, context);
  }
  
  warn(message: string, context?: Record<string, any>): void {
    this.log(LogLevel.WARN, message, context);
  }
  
  error(message: string, error?: Error, context?: Record<string, any>): void {
    this.log(LogLevel.ERROR, message, context, error);
  }
  
  fatal(message: string, error?: Error, context?: Record<string, any>): void {
    this.log(LogLevel.FATAL, message, context, error);
  }
  
  child(context: Record<string, any>): Logger {
    const child = new ConsoleLogger(this.name, { level: this.level });
    child.context = { ...this.context, ...context };
    return child;
  }
  
  setLevel(level: LogLevel): void {
    this.level = level;
  }
  
  getLevel(): LogLevel {
    return this.level;
  }
  
  log(level: LogLevel, message: string, context?: Record<string, any>, error?: Error): void {
    if (level < this.level) {
      return;
    }
    
    const timestamp = new Date().toISOString();
    const levelName = LogLevel[level];
    const fullContext = { ...this.context, ...context };
    
    const logEntry = {
      timestamp,
      level: levelName,
      name: this.name,
      message,
      ...(Object.keys(fullContext).length > 0 && { context: fullContext }),
      ...(error && { error: { message: error.message, stack: error.stack } })
    };
    
    const output = JSON.stringify(logEntry, null, 2);
    
    switch (level) {
      case LogLevel.DEBUG:
      case LogLevel.INFO:
        console.log(output);
        break;
      case LogLevel.WARN:
        console.warn(output);
        break;
      case LogLevel.ERROR:
      case LogLevel.FATAL:
        console.error(output);
        break;
    }
  }
}