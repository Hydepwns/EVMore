/**
 * Service tokens for dependency injection in the relayer
 * Uses @evmore/interfaces for standardized DI
 */

import { ServiceToken, createServiceToken } from '@evmore/interfaces';
// import { FusionConfig } from '@evmore/config';
// import { Logger } from 'pino';
import { RelayServiceFusion } from '../relay/relay-service-fusion';
import { EthereumMonitor } from '../monitor/ethereum-monitor';
import { CosmosMonitor } from '../monitor/cosmos-monitor';
import { RecoveryService } from '../recovery/recovery-service';
import { ChainRegistryClient } from '../registry/chain-registry-client';
import { RouterResolutionService } from '../registry/router-resolution-service';
import { DexIntegrationService } from '../dex/dex-integration';
import { MultiHopManager } from '../ibc/multi-hop-manager';
// import { Database } from 'pg';

// Type definitions for infrastructure services
interface DatabaseService {
  query: (text: string, params?: unknown[]) => Promise<unknown>;
  connect: () => Promise<void>;
  end: () => Promise<void>;
}

interface MetricsServerService {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  getMetrics: () => Promise<string>;
}

interface TracingProviderService {
  startSpan: (name: string) => unknown;
  endSpan: (span: unknown) => void;
  addEvent: (span: unknown, name: string, attributes?: Record<string, unknown>) => void;
}

/**
 * Relayer-specific service tokens
 */
export const RELAYER_TOKENS = {
  // Core services
  RelayService: createServiceToken<RelayServiceFusion>('RelayService'),
  RecoveryService: createServiceToken<RecoveryService>('RecoveryService'),
  
  // Monitors
  EthereumMonitor: createServiceToken<EthereumMonitor>('EthereumMonitor'),
  CosmosMonitor: createServiceToken<CosmosMonitor>('CosmosMonitor'),
  
  // Registry services
  ChainRegistry: createServiceToken<ChainRegistryClient>('ChainRegistry'),
  RouterResolver: createServiceToken<RouterResolutionService>('RouterResolver'),
  
  // IBC and DEX
  MultiHopManager: createServiceToken<MultiHopManager>('MultiHopManager'),
  DexIntegration: createServiceToken<DexIntegrationService>('DexIntegration'),
  
  // Infrastructure
  Database: createServiceToken<DatabaseService>('Database'), // Database type from pg
  MetricsServer: createServiceToken<MetricsServerService>('MetricsServer'),
  TracingProvider: createServiceToken<TracingProviderService>('TracingProvider'),
} as const;

/**
 * Service registration metadata
 */
export interface ServiceMetadata {
  name: string;
  version: string;
  description: string;
  dependencies: ServiceToken<unknown>[];
  optional?: ServiceToken<unknown>[];
  lifecycle?: 'singleton' | 'transient' | 'scoped';
}

/**
 * Service metadata registry
 */
export const SERVICE_METADATA = new Map<ServiceToken<unknown>, ServiceMetadata>([
  [RELAYER_TOKENS.RelayService, {
    name: 'RelayService',
    version: '1.0.0',
    description: 'Core relay service for cross-chain HTLC operations',
    dependencies: [] as ServiceToken<any>[],
    lifecycle: 'singleton'
  }],
  
  [RELAYER_TOKENS.EthereumMonitor, {
    name: 'EthereumMonitor',
    version: '1.0.0',
    description: 'Monitors Ethereum blockchain for HTLC events',
    dependencies: [] as ServiceToken<any>[],
    lifecycle: 'singleton'
  }],
  
  [RELAYER_TOKENS.CosmosMonitor, {
    name: 'CosmosMonitor',
    version: '1.0.0',
    description: 'Monitors Cosmos chains for HTLC events',
    dependencies: [] as ServiceToken<any>[],
    lifecycle: 'singleton'
  }],
  
  [RELAYER_TOKENS.RecoveryService, {
    name: 'RecoveryService',
    version: '1.0.0',
    description: 'Handles failed swaps and refunds',
    dependencies: [] as ServiceToken<any>[],
    lifecycle: 'singleton'
  }],
  
  [RELAYER_TOKENS.ChainRegistry, {
    name: 'ChainRegistry',
    version: '1.0.0',
    description: 'Manages chain metadata and IBC paths',
    dependencies: [] as ServiceToken<any>[],
    lifecycle: 'singleton'
  }],
  
  [RELAYER_TOKENS.RouterResolver, {
    name: 'RouterResolver',
    version: '1.0.0',
    description: 'Resolves router addresses for chains',
    dependencies: [RELAYER_TOKENS.ChainRegistry],
    lifecycle: 'singleton'
  }],
  
  [RELAYER_TOKENS.MultiHopManager, {
    name: 'MultiHopManager',
    version: '1.0.0',
    description: 'Manages multi-hop IBC transfers',
    dependencies: [] as ServiceToken<any>[],
    lifecycle: 'singleton'
  }],
  
  [RELAYER_TOKENS.DexIntegration, {
    name: 'DexIntegration',
    version: '1.0.0',
    description: 'Integrates with DEX protocols for swaps',
    dependencies: [] as ServiceToken<any>[],
    lifecycle: 'singleton'
  }]
]);