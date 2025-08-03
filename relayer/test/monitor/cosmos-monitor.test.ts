import { StargateClient } from '@cosmjs/stargate';
import pino from 'pino';
import { CosmosMonitor } from '../../src/monitor/cosmos-monitor';
import { CosmosConfig } from '../../src/config';

// Mock StargateClient
jest.mock('@cosmjs/stargate');

describe('CosmosMonitor', () => {
  let monitor: CosmosMonitor;
  let mockClient: jest.Mocked<StargateClient>;
  let mockLogger: pino.Logger;
  let config: CosmosConfig;

  beforeEach(() => {
    // Setup mock client
    mockClient = {
      getHeight: jest.fn(),
      searchTx: jest.fn(),
      disconnect: jest.fn(),
    } as any;

    // Mock StargateClient.connect
    (StargateClient.connect as jest.Mock).mockResolvedValue(mockClient);

    // Setup logger
    mockLogger = pino({ level: 'silent' });

    // Setup config
    config = {
      chainId: 'cosmoshub-4',
      rpcUrl: 'http://localhost:26657',
      restUrl: 'http://localhost:1317',
      mnemonic: 'test mnemonic',
      htlcContractAddress: 'cosmos1htlc',
      addressPrefix: 'cosmos',
      gasPrice: '0.025uatom',
      gasLimit: 200000,
      denom: 'uatom',
    };

    monitor = new CosmosMonitor(config, mockLogger);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with correct configuration', () => {
      expect(monitor).toBeDefined();
      expect(monitor.getStatus()).toEqual({
        running: false,
        lastHeight: 0,
      });
    });
  });

  describe('start', () => {
    it('should connect to Cosmos chain and start monitoring', async () => {
      const currentHeight = 100;
      mockClient.getHeight.mockResolvedValue(currentHeight);

      await monitor.start();

      expect(StargateClient.connect).toHaveBeenCalledWith(config.rpcUrl);
      expect(mockClient.getHeight).toHaveBeenCalled();
      expect(monitor.getStatus()).toEqual({
        running: true,
        lastHeight: currentHeight,
      });
    });

    it('should not start if already running', async () => {
      mockClient.getHeight.mockResolvedValue(100);

      await monitor.start();
      await monitor.start(); // Try to start again

      expect(StargateClient.connect).toHaveBeenCalledTimes(1);
    });
  });

  describe('stop', () => {
    it('should stop monitoring and disconnect client', async () => {
      mockClient.getHeight.mockResolvedValue(100);

      await monitor.start();
      await monitor.stop();

      expect(mockClient.disconnect).toHaveBeenCalled();
      expect(monitor.getStatus().running).toBe(false);
    });
  });

  describe('event monitoring', () => {
    it('should process HTLC created events', async () => {
      const mockTx = {
        hash: '0xTXHASH',
        code: 0, // Success
        events: [
          {
            type: 'wasm',
            attributes: [
              {
                key: Buffer.from('_contract_address').toString('base64'),
                value: Buffer.from(config.htlcContractAddress).toString('base64'),
              },
              {
                key: Buffer.from('action').toString('base64'),
                value: Buffer.from('create_htlc').toString('base64'),
              },
              {
                key: Buffer.from('htlc_id').toString('base64'),
                value: Buffer.from('htlc123').toString('base64'),
              },
              {
                key: Buffer.from('sender').toString('base64'),
                value: Buffer.from('cosmos1sender').toString('base64'),
              },
              {
                key: Buffer.from('receiver').toString('base64'),
                value: Buffer.from('cosmos1receiver').toString('base64'),
              },
              {
                key: Buffer.from('amount').toString('base64'),
                value: Buffer.from('[{"denom":"uosmo","amount":"1000000"}]').toString('base64'),
              },
              {
                key: Buffer.from('hashlock').toString('base64'),
                value: Buffer.from('0xhashlock').toString('base64'),
              },
              {
                key: Buffer.from('timelock').toString('base64'),
                value: Buffer.from('1234567890').toString('base64'),
              },
              {
                key: Buffer.from('target_chain').toString('base64'),
                value: Buffer.from('ethereum').toString('base64'),
              },
              {
                key: Buffer.from('target_address').toString('base64'),
                value: Buffer.from('0xethereum').toString('base64'),
              },
            ],
          },
        ],
      };

      mockClient.getHeight
        .mockResolvedValueOnce(100) // Initial height
        .mockResolvedValueOnce(101); // New height

      mockClient.searchTx.mockResolvedValue([mockTx as any]);

      const handler = jest.fn();
      monitor.onHTLCEvent(handler);

      await monitor.start();

      // Wait for the monitor to process events
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockClient.searchTx).toHaveBeenCalledWith('tx.height=101');
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          htlcId: 'htlc123',
          sender: 'cosmos1sender',
          receiver: 'cosmos1receiver',
          amount: [{ denom: 'uosmo', amount: '1000000' }],
          hashlock: '0xhashlock',
          timelock: 1234567890,
          targetChain: 'ethereum',
          targetAddress: '0xethereum',
          height: 101,
          txHash: '0xTXHASH',
          type: 'created',
        })
      );

      await monitor.stop();
    });

    it('should process withdraw events', async () => {
      const mockTx = {
        hash: '0xTXHASH',
        code: 0,
        events: [
          {
            type: 'execute',
            attributes: [
              {
                key: Buffer.from('contract_address').toString('base64'),
                value: Buffer.from(config.htlcContractAddress).toString('base64'),
              },
              {
                key: Buffer.from('method').toString('base64'),
                value: Buffer.from('withdraw').toString('base64'),
              },
              {
                key: Buffer.from('htlc_id').toString('base64'),
                value: Buffer.from('htlc123').toString('base64'),
              },
            ],
          },
        ],
      };

      mockClient.getHeight
        .mockResolvedValueOnce(100)
        .mockResolvedValueOnce(101);

      mockClient.searchTx.mockResolvedValue([mockTx as any]);

      const handler = jest.fn();
      monitor.onHTLCEvent(handler);

      await monitor.start();

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          htlcId: 'htlc123',
          type: 'withdrawn',
        })
      );

      await monitor.stop();
    });

    it('should skip failed transactions', async () => {
      const mockTx = {
        hash: '0xTXHASH',
        code: 1, // Failed
        events: [],
      };

      mockClient.getHeight
        .mockResolvedValueOnce(100)
        .mockResolvedValueOnce(101);

      mockClient.searchTx.mockResolvedValue([mockTx as any]);

      const handler = jest.fn();
      monitor.onHTLCEvent(handler);

      await monitor.start();

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(handler).not.toHaveBeenCalled();

      await monitor.stop();
    });

    it('should handle errors during block processing', async () => {
      mockClient.getHeight
        .mockResolvedValueOnce(100)
        .mockResolvedValueOnce(101);

      mockClient.searchTx.mockRejectedValue(new Error('Network error'));

      await monitor.start();

      // Wait for error to be handled
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Monitor should still be running
      expect(monitor.getStatus().running).toBe(true);

      await monitor.stop();
    });

    it('should parse amount strings correctly', async () => {
      const mockTx = {
        hash: '0xTXHASH',
        code: 0,
        events: [
          {
            type: 'wasm',
            attributes: [
              {
                key: Buffer.from('_contract_address').toString('base64'),
                value: Buffer.from(config.htlcContractAddress).toString('base64'),
              },
              {
                key: Buffer.from('action').toString('base64'),
                value: Buffer.from('create_htlc').toString('base64'),
              },
              {
                key: Buffer.from('amount').toString('base64'),
                value: Buffer.from('1000uosmo,2000uatom').toString('base64'),
              },
            ],
          },
        ],
      };

      mockClient.getHeight
        .mockResolvedValueOnce(100)
        .mockResolvedValueOnce(101);

      mockClient.searchTx.mockResolvedValue([mockTx as any]);

      const handler = jest.fn();
      monitor.onHTLCEvent(handler);

      await monitor.start();

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: [
            { amount: '1000', denom: 'uosmo' },
            { amount: '2000', denom: 'uatom' },
          ],
        })
      );

      await monitor.stop();
    });
  });

  describe('getStatus', () => {
    it('should return current status', async () => {
      expect(monitor.getStatus()).toEqual({
        running: false,
        lastHeight: 0,
      });

      mockClient.getHeight.mockResolvedValue(100);
      await monitor.start();

      expect(monitor.getStatus()).toEqual({
        running: true,
        lastHeight: 100,
      });
    });
  });
});