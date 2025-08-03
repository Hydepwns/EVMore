import { Logger } from 'pino';
import { EventEmitter } from 'events';
import { FusionConfigService } from '../config/fusion-config-service';

export interface IPInfo {
  ip: string;
  country?: string;
  region?: string;
  city?: string;
  isp?: string;
  asn?: number;
  isVPN: boolean;
  isProxy: boolean;
  isTor: boolean;
  isHosting: boolean;
  threatScore: number; // 0-100
  lastSeen: number;
  requestCount: number;
  reputation: 'good' | 'neutral' | 'suspicious' | 'malicious';
}

export interface GeoBlockConfig {
  allowedCountries?: string[];
  blockedCountries?: string[];
  blockVPN: boolean;
  blockProxy: boolean;
  blockTor: boolean;
  blockHosting: boolean;
  maxThreatScore: number;
}

export interface ReputationSource {
  name: string;
  checkIP: (ip: string) => Promise<Partial<IPInfo>>;
  enabled: boolean;
  weight: number; // How much to trust this source (0-1)
}

export class IPReputationSystem extends EventEmitter {
  private logger: Logger;
  private config: GeoBlockConfig;
  private ipCache: Map<string, IPInfo> = new Map();
  private reputationSources: Map<string, ReputationSource> = new Map();
  private cacheTimeout: number = 3600000; // 1 hour default
  private cleanupInterval: NodeJS.Timeout;

  // Built-in threat intelligence
  private knownThreatIPs: Set<string> = new Set();
  private knownGoodIPs: Set<string> = new Set();
  private torExitNodes: Set<string> = new Set();
  private vpnProviders: Set<string> = new Set();

  constructor(config: GeoBlockConfig, logger: Logger) {
    super();
    this.config = config;
    this.logger = logger.child({ component: 'IPReputation' });
    
    this.initializeBuiltInSources();
    this.loadThreatIntelligence();
    
    // Clean cache every hour
    this.cleanupInterval = setInterval(() => {
      this.cleanupCache();
    }, 3600000);
    
    this.logger.info({ config }, 'IP reputation system initialized');
  }

  /**
   * Check if IP should be blocked
   */
  async checkIP(ip: string): Promise<{
    allowed: boolean;
    reason?: string;
    info?: IPInfo;
    confidence: number;
  }> {
    try {
      // Get IP information (cached or fresh)
      const ipInfo = await this.getIPInfo(ip);
      
      // Apply geoblocking rules
      const geoCheck = this.checkGeoBlocking(ipInfo);
      if (!geoCheck.allowed) {
        return { ...geoCheck, info: ipInfo, confidence: 0.9 };
      }
      
      // Apply reputation-based blocking
      const repCheck = this.checkReputation(ipInfo);
      if (!repCheck.allowed) {
        return { ...repCheck, info: ipInfo, confidence: 0.8 };
      }
      
      // Apply threat intelligence
      const threatCheck = this.checkThreatIntelligence(ipInfo);
      if (!threatCheck.allowed) {
        return { ...threatCheck, info: ipInfo, confidence: 0.95 };
      }
      
      return { allowed: true, info: ipInfo, confidence: 1.0 };
    } catch (error) {
      this.logger.error({ error, ip }, 'Error checking IP reputation');
      // Fail open - allow request but log the error
      return { allowed: true, confidence: 0.5 };
    }
  }

  /**
   * Get comprehensive IP information
   */
  private async getIPInfo(ip: string): Promise<IPInfo> {
    // Check cache first
    const cached = this.ipCache.get(ip);
    if (cached && Date.now() - cached.lastSeen < this.cacheTimeout) {
      cached.requestCount++;
      return cached;
    }
    
    // Gather information from all sources
    const info: Partial<IPInfo> = {
      ip,
      lastSeen: Date.now(),
      requestCount: cached ? cached.requestCount + 1 : 1
    };
    
    // Query all enabled reputation sources
    const promises = Array.from(this.reputationSources.values())
      .filter(source => source.enabled)
      .map(async source => {
        try {
          const result = await source.checkIP(ip);
          return { source: source.name, weight: source.weight, data: result };
        } catch (error) {
          this.logger.warn({ error, source: source.name, ip }, 'Reputation source failed');
          return null;
        }
      });
    
    const results = (await Promise.all(promises)).filter(Boolean);
    
    // Merge results with weighted scoring
    let totalWeight = 0;
    let weightedThreatScore = 0;
    
    for (const result of results) {
      if (!result) continue;
      
      // Merge basic info (first non-null wins)
      if (!info.country && result.data.country) info.country = result.data.country;
      if (!info.region && result.data.region) info.region = result.data.region;
      if (!info.city && result.data.city) info.city = result.data.city;
      if (!info.isp && result.data.isp) info.isp = result.data.isp;
      if (!info.asn && result.data.asn) info.asn = result.data.asn;
      
      // Boolean flags (any source reporting true makes it true)
      if (result.data.isVPN) info.isVPN = true;
      if (result.data.isProxy) info.isProxy = true;
      if (result.data.isTor) info.isTor = true;
      if (result.data.isHosting) info.isHosting = true;
      
      // Weighted threat score
      if (typeof result.data.threatScore === 'number') {
        weightedThreatScore += result.data.threatScore * result.weight;
        totalWeight += result.weight;
      }
    }
    
    // Calculate final threat score
    info.threatScore = totalWeight > 0 ? weightedThreatScore / totalWeight : 0;
    
    // Determine reputation based on threat score and flags
    info.reputation = this.calculateReputation(info as IPInfo);
    
    // Set defaults for missing values
    const completeInfo: IPInfo = {
      isVPN: false,
      isProxy: false,
      isTor: false,
      isHosting: false,
      threatScore: 0,
      reputation: 'neutral',
      ...info
    } as IPInfo;
    
    // Cache the result
    this.ipCache.set(ip, completeInfo);
    
    this.emit('ipAnalyzed', completeInfo);
    return completeInfo;
  }

  /**
   * Check geoblocking rules
   */
  private checkGeoBlocking(ipInfo: IPInfo): { allowed: boolean; reason?: string } {
    // Country-based blocking
    if (this.config.blockedCountries && ipInfo.country) {
      if (this.config.blockedCountries.includes(ipInfo.country)) {
        return { allowed: false, reason: `Country ${ipInfo.country} is blocked` };
      }
    }
    
    if (this.config.allowedCountries && ipInfo.country) {
      if (!this.config.allowedCountries.includes(ipInfo.country)) {
        return { allowed: false, reason: `Country ${ipInfo.country} is not in allowlist` };
      }
    }
    
    // Service type blocking
    if (this.config.blockVPN && ipInfo.isVPN) {
      return { allowed: false, reason: 'VPN traffic is blocked' };
    }
    
    if (this.config.blockProxy && ipInfo.isProxy) {
      return { allowed: false, reason: 'Proxy traffic is blocked' };
    }
    
    if (this.config.blockTor && ipInfo.isTor) {
      return { allowed: false, reason: 'Tor traffic is blocked' };
    }
    
    if (this.config.blockHosting && ipInfo.isHosting) {
      return { allowed: false, reason: 'Hosting provider traffic is blocked' };
    }
    
    return { allowed: true };
  }

  /**
   * Check reputation-based blocking
   */
  private checkReputation(ipInfo: IPInfo): { allowed: boolean; reason?: string } {
    if (ipInfo.threatScore > this.config.maxThreatScore) {
      return { 
        allowed: false, 
        reason: `Threat score ${ipInfo.threatScore} exceeds limit ${this.config.maxThreatScore}` 
      };
    }
    
    if (ipInfo.reputation === 'malicious') {
      return { allowed: false, reason: 'IP has malicious reputation' };
    }
    
    return { allowed: true };
  }

  /**
   * Check against threat intelligence
   */
  private checkThreatIntelligence(ipInfo: IPInfo): { allowed: boolean; reason?: string } {
    if (this.knownThreatIPs.has(ipInfo.ip)) {
      return { allowed: false, reason: 'IP is in threat intelligence database' };
    }
    
    return { allowed: true };
  }

  /**
   * Calculate reputation based on various factors
   */
  private calculateReputation(ipInfo: IPInfo): IPInfo['reputation'] {
    let score = ipInfo.threatScore || 0;
    
    // Increase score for suspicious characteristics
    if (ipInfo.isVPN) score += 10;
    if (ipInfo.isProxy) score += 15;
    if (ipInfo.isTor) score += 20;
    if (ipInfo.isHosting) score += 5;
    
    // Check against known lists
    if (this.knownThreatIPs.has(ipInfo.ip)) score = 100;
    if (this.knownGoodIPs.has(ipInfo.ip)) score = Math.min(score, 10);
    
    // Classify based on score
    if (score >= 80) return 'malicious';
    if (score >= 50) return 'suspicious';
    if (score <= 20) return 'good';
    return 'neutral';
  }

  /**
   * Initialize built-in reputation sources
   */
  private initializeBuiltInSources(): void {
    // Mock source for demonstration - in production, integrate with real services
    this.addReputationSource({
      name: 'internal',
      enabled: true,
      weight: 1.0,
      checkIP: async (ip: string) => {
        // Internal logic for IP classification
        const info: Partial<IPInfo> = {};
        
        // Simple heuristics
        if (this.isPrivateIP(ip)) {
          info.threatScore = 0;
          info.reputation = 'good';
        } else {
          // Mock scoring based on IP patterns
          const lastOctet = parseInt(ip.split('.').pop() || '0');
          info.threatScore = Math.min(lastOctet % 100, 95); // Semi-random for demo
        }
        
        return info;
      }
    });
    
    // Add more sources as needed
    // this.addReputationSource(new AbuseIPDBSource());
    // this.addReputationSource(new VirusTotalSource());
    // this.addReputationSource(new MaxMindSource());
  }

  /**
   * Add a reputation source
   */
  addReputationSource(source: ReputationSource): void {
    this.reputationSources.set(source.name, source);
    this.logger.info({ source: source.name }, 'Reputation source added');
  }

  /**
   * Remove a reputation source
   */
  removeReputationSource(name: string): void {
    this.reputationSources.delete(name);
    this.logger.info({ source: name }, 'Reputation source removed');
  }

  /**
   * Load threat intelligence feeds
   */
  private async loadThreatIntelligence(): Promise<void> {
    try {
      // In production, load from threat intelligence feeds
      // For now, add some example malicious IPs
      const threatIPs = [
        '192.168.1.100', // Example threat IP
        '10.0.0.50',     // Example threat IP
      ];
      
      threatIPs.forEach(ip => this.knownThreatIPs.add(ip));
      
      // Load known good IPs (e.g., major CDNs, legitimate services)
      const goodIPs = [
        '8.8.8.8',       // Google DNS
        '1.1.1.1',       // Cloudflare DNS
      ];
      
      goodIPs.forEach(ip => this.knownGoodIPs.add(ip));
      
      this.logger.info({ 
        threatIPs: this.knownThreatIPs.size,
        goodIPs: this.knownGoodIPs.size 
      }, 'Threat intelligence loaded');
    } catch (error) {
      this.logger.error({ error }, 'Failed to load threat intelligence');
    }
  }

  /**
   * Update threat intelligence with new IP
   */
  addThreatIP(ip: string, reason?: string): void {
    this.knownThreatIPs.add(ip);
    this.logger.warn({ ip, reason }, 'IP added to threat list');
    
    // Remove from cache to force re-evaluation
    this.ipCache.delete(ip);
    
    this.emit('threatIPAdded', { ip, reason });
  }

  /**
   * Remove IP from threat list
   */
  removeThreatIP(ip: string): void {
    this.knownThreatIPs.delete(ip);
    this.logger.info({ ip }, 'IP removed from threat list');
    
    // Remove from cache to force re-evaluation
    this.ipCache.delete(ip);
  }

  /**
   * Check if IP is private/internal
   */
  private isPrivateIP(ip: string): boolean {
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4) return false;
    
    // 192.168.x.x
    if (parts[0] === 192 && parts[1] === 168) return true;
    
    // 10.x.x.x
    if (parts[0] === 10) return true;
    
    // 172.16.x.x - 172.31.x.x
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    
    // 127.x.x.x (localhost)
    if (parts[0] === 127) return true;
    
    return false;
  }

  /**
   * Clean up expired cache entries
   */
  private cleanupCache(): void {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [ip, info] of this.ipCache.entries()) {
      if (now - info.lastSeen > this.cacheTimeout) {
        this.ipCache.delete(ip);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      this.logger.debug({ cleaned }, 'Cleaned up expired IP cache entries');
    }
  }

  /**
   * Get IP reputation statistics
   */
  getStats(): {
    cachedIPs: number;
    threatIPs: number;
    goodIPs: number;
    reputationSources: number;
    reputationBreakdown: Record<string, number>;
    countryBreakdown: Record<string, number>;
  } {
    const reputationBreakdown: Record<string, number> = {
      good: 0,
      neutral: 0,
      suspicious: 0,
      malicious: 0
    };
    
    const countryBreakdown: Record<string, number> = {};
    
    for (const info of this.ipCache.values()) {
      reputationBreakdown[info.reputation]++;
      
      if (info.country) {
        countryBreakdown[info.country] = (countryBreakdown[info.country] || 0) + 1;
      }
    }
    
    return {
      cachedIPs: this.ipCache.size,
      threatIPs: this.knownThreatIPs.size,
      goodIPs: this.knownGoodIPs.size,
      reputationSources: this.reputationSources.size,
      reputationBreakdown,
      countryBreakdown
    };
  }

  /**
   * Force refresh of IP information
   */
  async refreshIP(ip: string): Promise<IPInfo> {
    this.ipCache.delete(ip);
    return this.getIPInfo(ip);
  }

  /**
   * Bulk check multiple IPs
   */
  async checkIPs(ips: string[]): Promise<Map<string, { allowed: boolean; reason?: string; info?: IPInfo }>> {
    const results = new Map();
    
    // Process in batches to avoid overwhelming sources
    const batchSize = 10;
    for (let i = 0; i < ips.length; i += batchSize) {
      const batch = ips.slice(i, i + batchSize);
      const promises = batch.map(ip => this.checkIP(ip).then(result => ({ ip, result })));
      const batchResults = await Promise.all(promises);
      
      batchResults.forEach(({ ip, result }) => {
        results.set(ip, result);
      });
      
      // Small delay between batches
      if (i + batchSize < ips.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    return results;
  }

  /**
   * Export threat intelligence for sharing
   */
  exportThreatIntelligence(): {
    threats: string[];
    exportTime: number;
    version: string;
  } {
    return {
      threats: Array.from(this.knownThreatIPs),
      exportTime: Date.now(),
      version: '1.0'
    };
  }

  /**
   * Import threat intelligence from external source
   */
  importThreatIntelligence(data: { threats: string[]; source?: string }): void {
    let imported = 0;
    
    data.threats.forEach(ip => {
      if (!this.knownThreatIPs.has(ip)) {
        this.knownThreatIPs.add(ip);
        imported++;
      }
    });
    
    this.logger.info({ 
      imported, 
      total: data.threats.length,
      source: data.source 
    }, 'Threat intelligence imported');
  }

  /**
   * Destroy the IP reputation system
   */
  destroy(): void {
    clearInterval(this.cleanupInterval);
    this.ipCache.clear();
    this.reputationSources.clear();
    this.removeAllListeners();
  }
}