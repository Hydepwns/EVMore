import { LoggerFactory } from './logger-factory';
import { LogLevel, Logger } from '@evmore/interfaces';

describe('LoggerFactory', () => {
  let factory: LoggerFactory;
  let originalConsoleLog: typeof console.log;
  let originalConsoleWarn: typeof console.warn;
  let originalConsoleError: typeof console.error;
  let consoleOutput: string[] = [];

  beforeEach(() => {
    // Reset singleton instance
    (LoggerFactory as any).instance = undefined;
    factory = LoggerFactory.getInstance();
    
    // Mock console methods to capture output
    consoleOutput = [];
    originalConsoleLog = console.log;
    originalConsoleWarn = console.warn;
    originalConsoleError = console.error;
    
    console.log = jest.fn((...args) => {
      consoleOutput.push(args.join(' '));
      originalConsoleLog(...args);
    });
    
    console.warn = jest.fn((...args) => {
      consoleOutput.push(args.join(' '));
      originalConsoleWarn(...args);
    });
    
    console.error = jest.fn((...args) => {
      consoleOutput.push(args.join(' '));
      originalConsoleError(...args);
    });
  });

  afterEach(() => {
    // Restore original console methods
    console.log = originalConsoleLog;
    console.warn = originalConsoleWarn;
    console.error = originalConsoleError;
  });

  describe('getInstance', () => {
    it('should return the same instance (singleton)', () => {
      const instance1 = LoggerFactory.getInstance();
      const instance2 = LoggerFactory.getInstance();
      
      expect(instance1).toBe(instance2);
    });

    it('should create new instance if none exists', () => {
      // Reset singleton
      (LoggerFactory as any).instance = undefined;
      
      const instance = LoggerFactory.getInstance();
      expect(instance).toBeInstanceOf(LoggerFactory);
    });
  });

  describe('create', () => {
    it('should create a logger with default name', () => {
      const logger = factory.create('test-logger');
      
      expect(logger).toBeDefined();
      expect(typeof logger.info).toBe('function');
      expect(typeof logger.error).toBe('function');
    });

    it('should create a logger with custom config', () => {
      const logger = factory.create('test-logger', { level: LogLevel.DEBUG });
      
      expect(logger).toBeDefined();
      expect(logger.getLevel()).toBe(LogLevel.DEBUG);
    });

    it('should use INFO level by default', () => {
      const logger = factory.create('test-logger');
      
      expect(logger.getLevel()).toBe(LogLevel.INFO);
    });
  });

  describe('setDefault and getDefault', () => {
    it('should set and get default logger', () => {
      const logger = factory.create('default-logger');
      
      factory.setDefault(logger);
      const defaultLogger = factory.getDefault();
      
      expect(defaultLogger).toBe(logger);
    });

    it('should return null when no default logger is set', () => {
      const defaultLogger = factory.getDefault();
      
      expect(defaultLogger).toBeNull();
    });

    it('should allow setting default logger to null', () => {
      const logger = factory.create('test-logger');
      factory.setDefault(logger);
      
      factory.setDefault(null as unknown as Logger);
      expect(factory.getDefault()).toBeNull();
    });
  });
});

describe('ConsoleLogger', () => {
  let logger: Logger;
  let consoleOutput: string[] = [];
  let originalConsoleLog: typeof console.log;
  let originalConsoleWarn: typeof console.warn;
  let originalConsoleError: typeof console.error;

  beforeEach(() => {
    // Mock console methods to capture output
    consoleOutput = [];
    originalConsoleLog = console.log;
    originalConsoleWarn = console.warn;
    originalConsoleError = console.error;
    
    console.log = jest.fn((...args) => {
      consoleOutput.push(args.join(' '));
      originalConsoleLog(...args);
    });
    
    console.warn = jest.fn((...args) => {
      consoleOutput.push(args.join(' '));
      originalConsoleWarn(...args);
    });
    
    console.error = jest.fn((...args) => {
      consoleOutput.push(args.join(' '));
      originalConsoleError(...args);
    });

    const factory = LoggerFactory.getInstance();
    logger = factory.create('test-logger');
  });

  afterEach(() => {
    // Restore original console methods
    console.log = originalConsoleLog;
    console.warn = originalConsoleWarn;
    console.error = originalConsoleError;
  });

  describe('log levels', () => {
    it('should log debug messages when level is DEBUG', () => {
      logger.setLevel(LogLevel.DEBUG);
      logger.debug('Debug message');
      
      expect(console.log).toHaveBeenCalled();
      expect(consoleOutput[0]).toContain('Debug message');
      const logEntry = JSON.parse(consoleOutput[0]);
      expect(logEntry.level).toBe('DEBUG');
    });

    it('should not log debug messages when level is INFO', () => {
      logger.setLevel(LogLevel.INFO);
      logger.debug('Debug message');
      
      expect(console.log).not.toHaveBeenCalled();
    });

    it('should log info messages when level is INFO', () => {
      logger.setLevel(LogLevel.INFO);
      logger.info('Info message');
      
      expect(console.log).toHaveBeenCalled();
      expect(consoleOutput[0]).toContain('Info message');
      const logEntry = JSON.parse(consoleOutput[0]);
      expect(logEntry.level).toBe('INFO');
    });

    it('should log warn messages when level is WARN', () => {
      logger.setLevel(LogLevel.WARN);
      logger.warn('Warning message');
      
      expect(console.warn).toHaveBeenCalled();
      expect(consoleOutput[0]).toContain('Warning message');
      const logEntry = JSON.parse(consoleOutput[0]);
      expect(logEntry.level).toBe('WARN');
    });

    it('should log error messages when level is ERROR', () => {
      logger.setLevel(LogLevel.ERROR);
      const error = new Error('Test error');
      logger.error('Error message', error);
      
      expect(console.error).toHaveBeenCalled();
      expect(consoleOutput[0]).toContain('Error message');
      const logEntry = JSON.parse(consoleOutput[0]);
      expect(logEntry.level).toBe('ERROR');
      expect(consoleOutput[0]).toContain('Test error');
    });

    it('should log fatal messages when level is FATAL', () => {
      logger.setLevel(LogLevel.FATAL);
      const error = new Error('Fatal error');
      logger.fatal('Fatal message', error);
      
      expect(console.error).toHaveBeenCalled();
      expect(consoleOutput[0]).toContain('Fatal message');
      const logEntry = JSON.parse(consoleOutput[0]);
      expect(logEntry.level).toBe('FATAL');
      expect(consoleOutput[0]).toContain('Fatal error');
    });
  });

  describe('context handling', () => {
    it('should include context in log messages', () => {
      logger.setLevel(LogLevel.INFO);
      logger.info('Test message', { userId: 123, action: 'login' });
      
      const logEntry = JSON.parse(consoleOutput[0]);
      expect(logEntry.context).toEqual({ userId: 123, action: 'login' });
    });

    it('should merge context from child logger', () => {
      logger.setLevel(LogLevel.INFO);
      const childLogger = logger.child({ userId: 123 });
      
      childLogger.info('Child message', { action: 'login' });
      
      const logEntry = JSON.parse(consoleOutput[0]);
      expect(logEntry.context).toEqual({ userId: 123, action: 'login' });
    });

    it('should override parent context with child context', () => {
      logger.setLevel(LogLevel.INFO);
      const childLogger = logger.child({ userId: 123 });
      
      childLogger.info('Child message', { userId: 456, action: 'login' });
      
      const logEntry = JSON.parse(consoleOutput[0]);
      expect(logEntry.context).toEqual({ userId: 456, action: 'login' });
    });
  });

  describe('error handling', () => {
    it('should include error details in log messages', () => {
      logger.setLevel(LogLevel.ERROR);
      const error = new Error('Test error message');
      error.stack = 'Error stack trace';
      
      logger.error('Error occurred', error);
      
      const logEntry = JSON.parse(consoleOutput[0]);
      expect(logEntry.error).toEqual({
        message: 'Test error message',
        stack: 'Error stack trace'
      });
    });

    it('should handle error without stack trace', () => {
      logger.setLevel(LogLevel.ERROR);
      const error = new Error('Test error');
      delete (error as any).stack;
      
      logger.error('Error occurred', error);
      
      const logEntry = JSON.parse(consoleOutput[0]);
      expect(logEntry.error).toEqual({ message: 'Test error' });
    });

    it('should handle error without error object', () => {
      logger.setLevel(LogLevel.ERROR);
      logger.error('Error occurred');
      
      expect(consoleOutput[0]).toContain('Error occurred');
      expect(consoleOutput[0]).not.toContain('"error"');
    });
  });

  describe('child logger', () => {
    it('should create child logger with inherited level', () => {
      logger.setLevel(LogLevel.DEBUG);
      const childLogger = logger.child({ userId: 123 });
      
      expect(childLogger.getLevel()).toBe(LogLevel.DEBUG);
    });

    it('should create child logger with merged context', () => {
      const childLogger = logger.child({ userId: 123 });
      
      expect(childLogger).toBeDefined();
      expect(typeof childLogger.info).toBe('function');
    });

    it('should not affect parent logger context', () => {
      const childLogger = logger.child({ userId: 123 });
      
      logger.setLevel(LogLevel.INFO);
      logger.info('Parent message');
      
      expect(consoleOutput[0]).not.toContain('"userId":123');
    });
  });

  describe('log format', () => {
    it('should include timestamp in log messages', () => {
      logger.setLevel(LogLevel.INFO);
      logger.info('Test message');
      
      expect(consoleOutput[0]).toContain('"timestamp"');
      expect(consoleOutput[0]).toMatch(/"timestamp": "\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z"/);
    });

    it('should include logger name in log messages', () => {
      logger.setLevel(LogLevel.INFO);
      logger.info('Test message');
      
      const logEntry = JSON.parse(consoleOutput[0]);
      expect(logEntry.name).toBe('test-logger');
    });

    it('should format log messages as JSON', () => {
      logger.setLevel(LogLevel.INFO);
      logger.info('Test message', { key: 'value' });
      
      const logEntry = JSON.parse(consoleOutput[0]);
      expect(logEntry).toHaveProperty('timestamp');
      expect(logEntry).toHaveProperty('level', 'INFO');
      expect(logEntry).toHaveProperty('name', 'test-logger');
      expect(logEntry).toHaveProperty('message', 'Test message');
      expect(logEntry).toHaveProperty('context', { key: 'value' });
    });
  });

  describe('level management', () => {
    it('should allow setting and getting log level', () => {
      logger.setLevel(LogLevel.DEBUG);
      expect(logger.getLevel()).toBe(LogLevel.DEBUG);
      
      logger.setLevel(LogLevel.ERROR);
      expect(logger.getLevel()).toBe(LogLevel.ERROR);
    });

    it('should respect log level filtering', () => {
      logger.setLevel(LogLevel.WARN);
      
      logger.debug('Debug message');
      logger.info('Info message');
      logger.warn('Warning message');
      logger.error('Error message');
      
      expect(console.log).not.toHaveBeenCalled();
      expect(console.warn).toHaveBeenCalledTimes(1);
      expect(console.error).toHaveBeenCalledTimes(1);
    });
  });
}); 