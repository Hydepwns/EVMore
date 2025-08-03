/**
 * Test Configuration Overrides
 * 
 * This module provides test-specific configuration values to replace
 * hardcoded values in test files. It uses the centralized fusion config
 * but with test-appropriate values.
 */

// Note: Shared config import removed - using local defaults

// Export commonly used test values
export const TEST_VALUES = {
  // Timelock values
  timelock: getTestConfig().testTimelockDuration,
  minTimelock: getTestConfig().testTimelockDuration,
  maxTimelock: getTestConfig().testTimelockDuration * 2,
  
  // Test amounts
  tokenAmount: getTestConfig().testTokenAmount,
  
  // Test addresses
  ethereumAddress: getTestConfig().testEthereumAddress,
  cosmosAddress: getTestConfig().testCosmosAddress,
  
  // Test crypto values
  hashlock: getTestConfig().testHashlock,
  secret: getTestConfig().testSecret,
  
  // Test channels and pools
  channels: getTestConfig().testChannels,
  poolIds: getTestConfig().testPoolIds,
  
  // Router addresses for testing
  testRouterAddresses: {
    osmosis: 'osmo1router123',
    juno: 'juno1router456',
    cosmos: 'cosmos1router789'
  }
};

/**
 * Apply test configuration overrides
 * This should be called in test setup
 */
export function applyTestConfig() {
  updateConfig({
    timelock: {
      maxTimelockDuration: 7200,    // 2 hours for tests
      minTimelockDuration: 300,     // 5 minutes for tests
      defaultTimelockDuration: 3600, // 1 hour for tests
      timelockCascadeCosmos1: 1800, // 30 minutes
      timelockCascadeCosmos2: 1200, // 20 minutes
      timelockCascadeFinal: 600,    // 10 minutes
      recoveryBuffer: 300,          // 5 minutes
      timeoutBuffer: 300,           // 5 minutes
      timelockReductionPerHop: 300, // 5 minutes
      cacheTimeout: 60,             // 1 minute
      securityCacheTimeout: 60000,  // 1 minute
    },
    routing: {
      maxRouteHops: 3,              // Fewer hops for testing
      maxRoutesToExplore: 10,       // Fewer routes for testing
      minPoolId: 1,
      maxPoolId: 10,                // Smaller pool range
      ibcTransferTimeout: 60,       // 1 minute
      defaultIbcChannel: 'channel-0',
      channelDiscoveryEnabled: false, // Disable for tests
    },
    security: {
      rateLimitWindow: 60000,       // 1 minute
      maxRequestsPerWindow: 100,
      ddosShieldDuration: 60000,    // 1 minute
      maxConnectionsPerIp: 10,
      ipReputationCacheTime: 60000, // 1 minute
      ipReputationThreshold: 0.5,
    }
  });
}

/**
 * Reset configuration after tests
 */
export function resetTestConfig() {
  resetConfig();
}

/**
 * Get a test timelock value with optional offset
 */
export function getTestTimelock(offsetSeconds: number = 0): number {
  return Math.floor(Date.now() / 1000) + getTestConfig().testTimelockDuration + offsetSeconds;
}

/**
 * Generate test HTLC parameters
 */
export function getTestHTLCParams(overrides: any = {}) {
  return {
    htlcId: `test-htlc-${Date.now()}`,
    amount: TEST_VALUES.tokenAmount,
    hashlock: TEST_VALUES.hashlock,
    timelock: getTestTimelock(),
    sender: TEST_VALUES.ethereumAddress,
    receiver: TEST_VALUES.cosmosAddress,
    targetChain: 'osmosis-1',
    ...overrides
  };
}

/**
 * Generate test route
 */
export function getTestRoute(hops: number = 2) {
  const chains = ['osmosis-1', 'juno-1', 'cosmoshub-4'];
  const route = {
    path: chains.slice(0, hops + 1),
    channels: TEST_VALUES.channels.slice(0, hops),
    estimatedFees: '1000',
    estimatedDuration: 60 * hops
  };
  return route;
}