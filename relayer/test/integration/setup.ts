/**
 * Integration test setup - creates test infrastructure for full E2E testing
 */

import { EventEmitter } from 'events';
import { Logger } from 'pino';
import pino from 'pino';

// Mock blockchain clients for integration testing
export class MockEthereumClient {
  private events = new EventEmitter();
  private htlcs = new Map<string, any>();
  private blockNumber = 12345;

  async getBlockNumber(): Promise<number> {
    return this.blockNumber;
  }

  async queryFilter(filter: any, fromBlock: number, toBlock: number): Promise<any[]> {
    return [];
  }

  async getHTLC(htlcId: string): Promise<any | null> {
    return this.htlcs.get(htlcId) || null;
  }

  createHTLC(params: any): string {
    const htlcId = `eth_${Date.now()}`;
    this.htlcs.set(htlcId, {
      htlcId,
      sender: params.sender,
      token: params.token,
      amount: params.amount,
      hashlock: params.hashlock,
      timelock: params.timelock,
      withdrawn: false,
      refunded: false,
      targetChain: params.targetChain,
      targetAddress: params.targetAddress,
    });

    // Emit event after a short delay to simulate blockchain confirmation
    setTimeout(() => {
      this.events.emit('HTLCCreated', {
        htlcId,
        sender: params.sender,
        token: params.token,
        amount: params.amount,
        hashlock: params.hashlock,
        timelock: params.timelock,
        targetChain: params.targetChain,
        targetAddress: params.targetAddress,
        blockNumber: this.blockNumber++,
        transactionHash: `0x${htlcId}`,
      });
    }, 100);

    return htlcId;
  }

  withdraw(htlcId: string, secret: string): void {
    const htlc = this.htlcs.get(htlcId);
    if (htlc) {
      htlc.withdrawn = true;
      this.events.emit('HTLCWithdrawn', {
        htlcId,
        secret,
        blockNumber: this.blockNumber++,
        transactionHash: `0x${htlcId}_withdraw`,
      });
    }
  }

  on(event: string, listener: (...args: any[]) => void): void {
    this.events.on(event, listener);
  }

  off(event: string, listener: (...args: any[]) => void): void {
    this.events.off(event, listener);
  }
}

export class MockCosmosClient {
  private events = new EventEmitter();
  private htlcs = new Map<string, any>();
  private height = 1000;

  async getHeight(): Promise<number> {
    return this.height;
  }

  async searchTxs(query: any): Promise<any[]> {
    return [];
  }

  async queryContractSmart(contract: string, query: any): Promise<any> {
    if (query.get_htlc) {
      return this.htlcs.get(query.get_htlc.htlc_id) || null;
    }
    return null;
  }

  createHTLC(params: any): string {
    const htlcId = `cosmos_${Date.now()}`;
    this.htlcs.set(htlcId, {
      htlcId,
      sender: params.sender,
      receiver: params.receiver,
      amount: params.amount,
      denom: params.denom,
      hashlock: params.hashlock,
      timelock: params.timelock,
      withdrawn: false,
      refunded: false,
    });

    // Emit event after a short delay
    setTimeout(() => {
      this.events.emit('HTLCCreated', {
        htlcId,
        sender: params.sender,
        receiver: params.receiver,
        amount: params.amount,
        denom: params.denom,
        hashlock: params.hashlock,
        timelock: params.timelock,
        height: this.height++,
        txHash: `${htlcId}_tx`,
      });
    }, 100);

    return htlcId;
  }

  async sendIBCTransfer(params: any): Promise<string> {
    const txHash = `ibc_${Date.now()}`;
    
    // Simulate IBC transfer completion after delay
    setTimeout(() => {
      this.events.emit('IBCTransferComplete', {
        txHash,
        sourceChannel: params.sourceChannel,
        destChain: params.destChain,
        amount: params.amount,
        receiver: params.receiver,
        memo: params.memo,
        height: this.height++,
      });
    }, 200);

    return txHash;
  }

  on(event: string, listener: (...args: any[]) => void): void {
    this.events.on(event, listener);
  }

  off(event: string, listener: (...args: any[]) => void): void {
    this.events.off(event, listener);
  }
}

export class MockChainRegistry {
  private chains = new Map([
    ['osmosis-1', {
      chainId: 'osmosis-1',
      chainName: 'osmosis',
      rpcUrl: 'https://rpc.osmosis.zone',
      restUrl: 'https://lcd.osmosis.zone',
      channels: [
        { chainId: 'cosmoshub-4', channelId: 'channel-0', portId: 'transfer' },
        { chainId: 'ethereum', channelId: 'channel-1', portId: 'transfer' },
      ],
    }],
    ['cosmoshub-4', {
      chainId: 'cosmoshub-4',
      chainName: 'cosmos',
      rpcUrl: 'https://rpc.cosmos.network',
      restUrl: 'https://lcd.cosmos.network',
      channels: [
        { chainId: 'osmosis-1', channelId: 'channel-141', portId: 'transfer' },
      ],
    }],
  ]);

  async getChain(chainId: string): Promise<any> {
    return this.chains.get(chainId);
  }

  async getIBCPath(from: string, to: string): Promise<any[]> {
    if (from === 'ethereum' && to === 'osmosis-1') {
      return [
        { chainId: 'cosmoshub-4', channelId: 'channel-0' },
        { chainId: 'osmosis-1', channelId: 'channel-141' },
      ];
    }
    return [];
  }
}

export function createTestLogger(): Logger {
  return pino({
    level: 'silent', // Suppress logs during tests
  });
}

export function createTestConfig() {
  return {
    general: {
      logLevel: 'silent',
      metricsPort: 0,
    },
    ethereum: {
      rpcUrl: 'http://localhost:8545',
      htlcContract: '0xHTLC',
      privateKey: '0xtest',
      confirmations: 1,
      blockTime: 15,
    },
    cosmos: {
      rpcUrl: 'http://localhost:26657',
      restUrl: 'http://localhost:1317',
      chainId: 'cosmoshub-4',
      htlcContract: 'cosmos1htlc',
      mnemonic: 'test mnemonic',
      addressPrefix: 'cosmos',
      gasPrice: '0.025uatom',
    },
    chainRegistry: {
      updateInterval: 300000,
      cacheTimeout: 3600000,
    },
    relay: {
      maxRetries: 3,
      retryDelay: 1000,
      batchSize: 10,
      processingTimeout: 30000,
    },
    recovery: {
      checkInterval: 60000,
      timeBuffer: 3600,
    },
  };
}

// Helper to wait for events
export function waitForEvent(emitter: EventEmitter, event: string, timeout = 5000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for event: ${event}`));
    }, timeout);

    emitter.once(event, (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

// Helper to simulate time passage
export async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}