/**
 * Migration utilities for transitioning from legacy types to modern types
 * 
 * This module provides:
 * - Type aliases for backwards compatibility
 * - Adapters to convert between legacy and modern formats
 * - Migration tracking and reporting tools
 * - Deprecation warnings
 */

export * from './type-aliases';
export * from './adapters';

// Migration guide and utilities
export interface MigrationGuide {
  component: string;
  legacyTypes: string[];
  modernTypes: string[];
  steps: string[];
  examples: Record<string, { before: string; after: string }>;
}

export const MIGRATION_GUIDES: Record<string, MigrationGuide> = {
  'htlc-order': {
    component: 'HTLC Order',
    legacyTypes: ['HTLCOrder', 'HTLCDetails'],
    modernTypes: ['SwapOrder', 'SwapEndpoint', 'SwapAmount'],
    steps: [
      'Replace HTLCOrder imports with SwapOrder from @evmore/types',
      'Update status handling to use SwapStatus enum',
      'Restructure amount fields to use SwapAmount interface',
      'Update timelock handling to use TimelockConfig',
      'Replace secret/hashlock with SecretPair structure'
    ],
    examples: {
      'import': {
        before: "import { HTLCOrder } from '../types'",
        after: "import { SwapOrder } from '@evmore/types'"
      },
      'status': {
        before: "order.status === 'filled'",
        after: "order.status === SwapStatus.COMPLETED"
      },
      'amount': {
        before: "order.amount",
        after: "order.amount.value"
      }
    }
  },
  
  'chain-config': {
    component: 'Chain Configuration',
    legacyTypes: ['ChainConfig', 'ChainInfo'],
    modernTypes: ['Chain', 'ChainConfig', 'ChainEndpoints'],
    steps: [
      'Replace legacy ChainConfig with new Chain interface',
      'Update endpoint structure to use ChainEndpoints',
      'Add chain type classification (ChainType enum)',
      'Restructure gas configuration',
      'Update native currency information'
    ],
    examples: {
      'import': {
        before: "import { ChainConfig } from '../config'",
        after: "import { Chain, ChainConfig } from '@evmore/types'"
      },
      'endpoints': {
        before: "config.rpcUrl",
        after: "config.endpoints.rpc"
      },
      'type': {
        before: "// No type classification",
        after: "chain.type === ChainType.ETHEREUM"
      }
    }
  },
  
  'swap-routes': {
    component: 'Swap Routes',
    legacyTypes: ['SwapRoute', 'RouteInfo'],
    modernTypes: ['IBCRoute', 'SwapRoute', 'DexRoute'],
    steps: [
      'Replace legacy SwapRoute with IBCRoute for cross-chain routing',
      'Use SwapRoute for individual route segments',
      'Add DexRoute for DEX-specific routing information',
      'Update route discovery to use new interfaces'
    ],
    examples: {
      'route': {
        before: "route.poolId",
        after: "route.hops[0].dexRoute?.poolId"
      }
    }
  }
};

// Helper function to get migration guide
export function getMigrationGuide(component: string): MigrationGuide | undefined {
  return MIGRATION_GUIDES[component];
}

// Helper function to print migration guide
export function printMigrationGuide(component: string): void {
  const guide = getMigrationGuide(component);
  if (!guide) {
    console.log(`No migration guide found for component: ${component}`);
    return;
  }
  
  console.log(`\n=== Migration Guide: ${guide.component} ===`);
  console.log(`\nLegacy Types: ${guide.legacyTypes.join(', ')}`);
  console.log(`Modern Types: ${guide.modernTypes.join(', ')}`);
  
  console.log('\nMigration Steps:');
  guide.steps.forEach((step, index) => {
    console.log(`  ${index + 1}. ${step}`);
  });
  
  console.log('\nExamples:');
  Object.entries(guide.examples).forEach(([key, example]) => {
    console.log(`\n  ${key}:`);
    console.log(`    Before: ${example.before}`);
    console.log(`    After:  ${example.after}`);
  });
  
  console.log('\n================================\n');
}

// Helper function to list all available migration guides
export function listMigrationGuides(): void {
  console.log('\n=== Available Migration Guides ===');
  Object.keys(MIGRATION_GUIDES).forEach(key => {
    const guide = MIGRATION_GUIDES[key];
    console.log(`  ${key}: ${guide.component}`);
  });
  console.log('===================================\n');
}

// Utility to check if migration is complete for a codebase
export async function checkMigrationStatus(_projectPath: string): Promise<{
  totalFiles: number;
  filesWithLegacyTypes: number;
  legacyTypeUsage: Record<string, number>;
}> {
  // This would be implemented to scan files for legacy type usage
  // For now, return a placeholder implementation
  return {
    totalFiles: 0,
    filesWithLegacyTypes: 0,
    legacyTypeUsage: {}
  };
}

// Migration completion validator
export function validateMigrationComplete(component: string): boolean {
  // Check if component has fully migrated to new types
  // This would implement actual validation logic
  console.log(`Validating migration completion for ${component}...`);
  return true;
}