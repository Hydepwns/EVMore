export * from './client';
export * from './types';
export * from './utils';

// Re-export key classes for convenience
export { FusionCosmosClient } from './client/fusion-cosmos-client';
export { EthereumHTLCClient } from './client/ethereum-htlc-client';
export { CosmosHTLCClient } from './client/cosmos-htlc-client';

// Re-export key types
export type {
  HTLCOrder,
  CrossChainSwapParams,
  SwapQuote,
  SwapStatus,
  HTLCDetails
} from './types';

// Re-export utilities
export {
  generateSecret,
  hashSecret,
  convertAddress,
  cosmosAddressToEthereum,
  calculateTimelock
} from './utils';
