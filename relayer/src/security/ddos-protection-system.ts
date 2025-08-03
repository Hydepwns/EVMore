import { Logger } from '@evmore/interfaces';
import { EventEmitter } from 'events';

export interface DDoSProtectionConfig {
  enabled: boolean;
  maxRequestsPerMinute: number;
  maxRequestsPerHour: number;
  blockDuration: number; // in seconds
  whitelist: string[];
  blacklist: string[];
}

export interface RequestFingerprint {
  ip: string;
  userAgent?: string;
  endpoint?: string;
  timestamp: number;
}

export class DDoSProtectionSystem extends EventEmitter {
  private config: DDoSProtectionConfig;
  private logger: Logger;
  private requestCounts: Map<string, { count: number; firstRequest: number; blockedUntil?: number }> = new Map();
  private whitelist: Set<string> = new Set();
  private blacklist: Set<string> = new Set();

  constructor(config: DDoSProtectionConfig, logger: Logger) {
    super();
    this.config = config;
    this.logger = logger.child({ component: 'DDoSProtection' });
    
    // Initialize whitelist and blacklist
    this.whitelist = new Set(config.whitelist);
    this.blacklist = new Set(config.blacklist);
  }

  // Stop method for graceful shutdown
  stop(): void {
    // Implementation would go here
    this.logger.info('DDoS protection system stopped');
  }
} 