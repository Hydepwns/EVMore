import { ethers } from 'ethers';
import { CrossChainTestHelpers } from '../utils/cross-chain-helpers';

export interface HTLCTestCase {
  name: string;
  description: string;
  params: {
    sourceChain: string;
    targetChain: string;
    amount: string;
    asset: string;
    route?: string[];
  };
  expectedOutcome: 'success' | 'timeout' | 'refund' | 'error';
  errorMessage?: string;
}

export const HTLC_TEST_CASES: HTLCTestCase[] = [
  {
    name: 'simple_eth_to_osmosis',
    description: 'Simple ETH to Osmosis swap',
    params: {
      sourceChain: 'ethereum',
      targetChain: 'osmosis',
      amount: '1.0',
      asset: 'ETH',
    },
    expectedOutcome: 'success',
  },
  {
    name: 'multi_hop_eth_to_juno',
    description: 'Multi-hop swap from ETH to Juno via Osmosis',
    params: {
      sourceChain: 'ethereum',
      targetChain: 'juno',
      amount: '100',
      asset: 'USDC',
      route: ['ethereum', 'osmosis', 'juno'],
    },
    expectedOutcome: 'success',
  },
  {
    name: 'timeout_scenario',
    description: 'Swap that times out due to no secret reveal',
    params: {
      sourceChain: 'ethereum',
      targetChain: 'osmosis',
      amount: '0.5',
      asset: 'ETH',
    },
    expectedOutcome: 'timeout',
  },
  {
    name: 'invalid_secret',
    description: 'Attempt to withdraw with wrong secret',
    params: {
      sourceChain: 'osmosis',
      targetChain: 'ethereum',
      amount: '1000',
      asset: 'OSMO',
    },
    expectedOutcome: 'error',
    errorMessage: 'Invalid secret',
  },
  {
    name: 'insufficient_timelock',
    description: 'Multi-hop with insufficient timelock',
    params: {
      sourceChain: 'ethereum',
      targetChain: 'secret',
      amount: '50',
      asset: 'USDC',
      route: ['ethereum', 'osmosis', 'juno', 'secret'],
    },
    expectedOutcome: 'error',
    errorMessage: 'Insufficient timelock for route',
  },
];

export const SWAP_FIXTURES = {
  valid: {
    secret: '0x' + '42'.repeat(32),
    secretHash: ethers.utils.keccak256('0x' + '42'.repeat(32)),
    amount: ethers.utils.parseEther('1.0'),
    timelock: Math.floor(Date.now() / 1000) + 86400, // 24 hours
  },
  expired: {
    secret: '0x' + '43'.repeat(32),
    secretHash: ethers.utils.keccak256('0x' + '43'.repeat(32)),
    amount: ethers.utils.parseEther('0.5'),
    timelock: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
  },
  largeAmount: {
    secret: '0x' + '44'.repeat(32),
    secretHash: ethers.utils.keccak256('0x' + '44'.repeat(32)),
    amount: ethers.utils.parseEther('1000'),
    timelock: Math.floor(Date.now() / 1000) + 172800, // 48 hours
  },
};

export const ROUTE_FIXTURES = {
  direct: {
    ethereum_to_osmosis: ['ethereum', 'osmosis'],
    osmosis_to_ethereum: ['osmosis', 'ethereum'],
  },
  twoHop: {
    ethereum_to_juno: ['ethereum', 'osmosis', 'juno'],
    juno_to_ethereum: ['juno', 'osmosis', 'ethereum'],
  },
  threeHop: {
    ethereum_to_secret: ['ethereum', 'osmosis', 'juno', 'secret'],
    secret_to_ethereum: ['secret', 'juno', 'osmosis', 'ethereum'],
  },
  complex: {
    circular: ['ethereum', 'osmosis', 'cosmoshub', 'juno', 'osmosis', 'ethereum'],
    max_hops: ['ethereum', 'osmosis', 'cosmoshub', 'juno', 'secret'],
  },
};

export const IBC_CHANNEL_FIXTURES = {
  osmosis_cosmoshub: {
    source: 'channel-0',
    destination: 'channel-141',
  },
  osmosis_juno: {
    source: 'channel-42',
    destination: 'channel-0',
  },
  juno_secret: {
    source: 'channel-8',
    destination: 'channel-48',
  },
};

export function generateTestSwapId(): string {
  return ethers.utils.keccak256(
    ethers.utils.toUtf8Bytes(`test-swap-${Date.now()}-${Math.random()}`)
  );
}

export function createMockHTLCEvent(
  eventType: 'Created' | 'Withdrawn' | 'Refunded',
  swapId: string,
  params: any
) {
  return {
    event: eventType,
    args: {
      swapId,
      ...params,
    },
    blockNumber: 12345,
    transactionHash: '0x' + '99'.repeat(32),
    logIndex: 0,
  };
}