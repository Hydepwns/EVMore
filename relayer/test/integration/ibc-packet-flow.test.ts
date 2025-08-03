/**
 * Integration tests for IBC packet flows and multi-hop transfers
 * Tests complex IBC routing, packet acknowledgments, and failure handling
 */

import { MultiHopManager } from '../../src/ibc/multi-hop-manager';
import { PacketHandler } from '../../src/ibc/packet-handler';
import { AcknowledgmentHandler } from '../../src/ibc/acknowledgment-handler';
import { PacketForwardMiddleware } from '../../src/ibc/packet-forward-middleware';
import {
  MockCosmosClient,
  MockChainRegistry,
  createTestLogger,
  createTestConfig,
  waitForEvent,
  sleep,
} from './setup';

describe('IBC Packet Flow Integration Tests', () => {
  let multiHopManager: MultiHopManager;
  let packetHandler: PacketHandler;
  let ackHandler: AcknowledgmentHandler;
  let pfmMiddleware: PacketForwardMiddleware;
  let cosmosClient: MockCosmosClient;
  let chainRegistry: MockChainRegistry;
  const logger = createTestLogger();
  const config = createTestConfig();

  beforeEach(async () => {
    cosmosClient = new MockCosmosClient();
    chainRegistry = new MockChainRegistry();

    multiHopManager = new MultiHopManager(config.cosmos, logger);
    packetHandler = new PacketHandler(config.cosmos, logger);
    ackHandler = new AcknowledgmentHandler(config.cosmos, logger);
    pfmMiddleware = new PacketForwardMiddleware(config.cosmos, logger);

    await multiHopManager.initialize();
  });

  afterEach(async () => {
    // Cleanup
  });

  describe('Multi-Hop Transfer Management', () => {
    it('should create and track multi-hop transfer', async () => {
      const transferParams = {
        htlcId: 'eth_123456789',
        sender: '0xsender',
        receiver: 'osmo1receiver',
        amount: { denom: 'uusdc', amount: '1000000' },
        route: [
          {
            chainId: 'cosmoshub-4',
            channelId: 'channel-0',
            portId: 'transfer',
            timelock: Math.floor(Date.now() / 1000) + 7200,
          },
          {
            chainId: 'osmosis-1',
            channelId: 'channel-141',
            portId: 'transfer',
            timelock: Math.floor(Date.now() / 1000) + 3600,
          },
        ],
        secret: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        hashlock: '0xa665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3',
        timeout: 1800, // 30 minutes
      };

      const transferId = await multiHopManager.createTransfer(transferParams);
      expect(transferId).toBeTruthy();

      const transfer = await multiHopManager.getTransfer(transferId);
      expect(transfer).toBeTruthy();
      expect(transfer?.status).toBe('pending');
      expect(transfer?.route).toHaveLength(2);
    });

    it('should execute multi-hop transfer with packet forwarding', async () => {
      const transferParams = {
        htlcId: 'eth_123456789',
        sender: '0xsender',
        receiver: 'osmo1receiver',
        amount: { denom: 'uusdc', amount: '1000000' },
        route: [
          {
            chainId: 'cosmoshub-4',
            channelId: 'channel-0',
            portId: 'transfer',
            timelock: Math.floor(Date.now() / 1000) + 7200,
          },
          {
            chainId: 'osmosis-1',
            channelId: 'channel-141',
            portId: 'transfer',
            timelock: Math.floor(Date.now() / 1000) + 3600,
          },
        ],
        secret: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        hashlock: '0xa665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3',
        timeout: 1800,
      };

      const transferId = await multiHopManager.createTransfer(transferParams);
      
      // Execute the first hop
      await multiHopManager.executeTransfer(transferId);

      await sleep(200);

      let transfer = await multiHopManager.getTransfer(transferId);
      expect(transfer?.status).toBe('routing');

      // Simulate IBC transfer completion for first hop
      const firstHopTx = await cosmosClient.sendIBCTransfer({
        sourceChannel: 'channel-0',
        destChain: 'cosmoshub-4',
        amount: transferParams.amount,
        receiver: 'cosmos1intermediate',
        memo: JSON.stringify({
          forward: {
            receiver: transferParams.receiver,
            port: 'transfer',
            channel: 'channel-141',
            timeout: transferParams.timeout,
            retries: 3,
          },
          htlcId: transferParams.htlcId,
          hashlock: transferParams.hashlock,
        }),
      });

      const ibcEvent = await waitForEvent(cosmosClient, 'IBCTransferComplete');
      expect(ibcEvent.memo).toContain('forward');

      // Verify transfer progressed
      transfer = await multiHopManager.getTransfer(transferId);
      expect(transfer?.currentHop).toBe(1);
    });

    it('should handle packet acknowledgments correctly', async () => {
      const transferParams = {
        htlcId: 'eth_123456789',
        sender: '0xsender',
        receiver: 'osmo1receiver',
        amount: { denom: 'uusdc', amount: '1000000' },
        route: [
          {
            chainId: 'osmoshub-4',
            channelId: 'channel-0',
            portId: 'transfer',
            timelock: Math.floor(Date.now() / 1000) + 3600,
          },
        ],
        secret: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        hashlock: '0xa665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3',
        timeout: 1800,
      };

      const transferId = await multiHopManager.createTransfer(transferParams);
      await multiHopManager.executeTransfer(transferId);

      // Simulate successful acknowledgment
      const ackData = {
        sequence: 1,
        sourcePort: 'transfer',
        sourceChannel: 'channel-0',
        destPort: 'transfer',
        destChannel: 'channel-141',
        data: Buffer.from(JSON.stringify({ result: 'success' })).toString('base64'),
        acknowledgment: Buffer.from(JSON.stringify({ result: 'AQ==' })).toString('base64'),
      };

      await ackHandler.handleAcknowledgment(ackData);

      const transfer = await multiHopManager.getTransfer(transferId);
      expect(transfer?.status).toBe('completed');
    });

    it('should handle packet timeouts and retry logic', async () => {
      const transferParams = {
        htlcId: 'eth_123456789',
        sender: '0xsender',
        receiver: 'osmo1receiver',
        amount: { denom: 'uusdc', amount: '1000000' },
        route: [
          {
            chainId: 'cosmoshub-4',
            channelId: 'channel-0',
            portId: 'transfer',
            timelock: Math.floor(Date.now() / 1000) + 3600,
          },
        ],
        secret: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        hashlock: '0xa665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3',
        timeout: 60, // Very short timeout to force timeout
      };

      const transferId = await multiHopManager.createTransfer(transferParams);
      await multiHopManager.executeTransfer(transferId);

      // Wait for timeout
      await sleep(100);

      // Simulate timeout acknowledgment
      const timeoutAck = {
        sequence: 1,
        sourcePort: 'transfer',
        sourceChannel: 'channel-0',
        destPort: 'transfer',
        destChannel: 'channel-141',
        acknowledgment: Buffer.from(JSON.stringify({ error: 'timeout' })).toString('base64'),
      };

      await ackHandler.handleAcknowledgment(timeoutAck);

      const transfer = await multiHopManager.getTransfer(transferId);
      expect(transfer?.retryCount).toBeGreaterThan(0);
    });
  });

  describe('Packet Forward Middleware', () => {
    it('should generate correct forwarding memo', () => {
      const forwardInfo = {
        receiver: 'osmo1receiver',
        port: 'transfer',
        channel: 'channel-141',
        timeout: 1800,
        retries: 3,
      };

      const memo = pfmMiddleware.generateForwardMemo(forwardInfo, {
        htlcId: 'eth_123',
        hashlock: '0xabc123',
      });

      const parsedMemo = JSON.parse(memo);
      expect(parsedMemo.forward).toBeDefined();
      expect(parsedMemo.forward.receiver).toBe('osmo1receiver');
      expect(parsedMemo.forward.channel).toBe('channel-141');
      expect(parsedMemo.htlcId).toBe('eth_123');
    });

    it('should parse incoming forwarded packets', () => {
      const packetData = {
        amount: '1000000',
        denom: 'transfer/channel-0/uusdc',
        receiver: 'cosmos1intermediate',
        sender: 'ethereum_bridge',
        memo: JSON.stringify({
          forward: {
            receiver: 'osmo1receiver',
            port: 'transfer',
            channel: 'channel-141',
            timeout: 1800,
            retries: 3,
          },
          htlcId: 'eth_123',
          hashlock: '0xabc123',
        }),
      };

      const parsed = pfmMiddleware.parseForwardPacket(packetData);
      expect(parsed.shouldForward).toBe(true);
      expect(parsed.forwardInfo?.receiver).toBe('osmo1receiver');
      expect(parsed.metadata?.htlcId).toBe('eth_123');
    });

    it('should handle nested forwarding correctly', () => {
      const nestedForwardMemo = {
        forward: {
          receiver: 'final1receiver',
          port: 'transfer',
          channel: 'channel-999',
          timeout: 1800,
          retries: 2,
          next: {
            forward: {
              receiver: 'osmo1receiver',
              port: 'transfer',
              channel: 'channel-141',
              timeout: 900,
              retries: 1,
            },
          },
        },
        htlcId: 'eth_nested_123',
        hashlock: '0xnested',
      };

      const memo = pfmMiddleware.generateForwardMemo(
        nestedForwardMemo.forward,
        { htlcId: nestedForwardMemo.htlcId, hashlock: nestedForwardMemo.hashlock }
      );

      const parsed = pfmMiddleware.parseForwardPacket({
        amount: '1000000',
        denom: 'utoken',
        receiver: 'intermediate1receiver',
        sender: 'source1sender',
        memo,
      });

      expect(parsed.shouldForward).toBe(true);
      expect(parsed.forwardInfo?.receiver).toBe('final1receiver');
      expect(parsed.forwardInfo?.next).toBeDefined();
    });
  });

  describe('Error Handling and Recovery', () => {
    it('should handle malformed packet data', async () => {
      const malformedPacket = {
        sequence: 1,
        sourcePort: 'transfer',
        sourceChannel: 'channel-0',
        destPort: 'transfer',
        destChannel: 'channel-141',
        data: 'invalid-base64-data',
        timeoutHeight: { revisionNumber: 1, revisionHeight: 1000 },
        timeoutTimestamp: '0',
      };

      // Should not throw, but handle gracefully
      await expect(packetHandler.handlePacket(malformedPacket)).resolves.not.toThrow();
    });

    it('should recover from partial multi-hop failures', async () => {
      const transferParams = {
        htlcId: 'eth_recovery_test',
        sender: '0xsender',
        receiver: 'osmo1receiver',
        amount: { denom: 'uusdc', amount: '1000000' },
        route: [
          {
            chainId: 'cosmoshub-4',
            channelId: 'channel-0',
            portId: 'transfer',
            timelock: Math.floor(Date.now() / 1000) + 7200,
          },
          {
            chainId: 'osmosis-1',
            channelId: 'channel-141',
            portId: 'transfer',
            timelock: Math.floor(Date.now() / 1000) + 3600,
          },
        ],
        secret: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        hashlock: '0xa665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3',
        timeout: 1800,
      };

      const transferId = await multiHopManager.createTransfer(transferParams);
      await multiHopManager.executeTransfer(transferId);

      // Simulate first hop success
      await sleep(200);
      let transfer = await multiHopManager.getTransfer(transferId);
      expect(transfer?.currentHop).toBe(1);

      // Simulate second hop failure
      const failureAck = {
        sequence: 2,
        sourcePort: 'transfer',
        sourceChannel: 'channel-141',
        destPort: 'transfer',
        destChannel: 'channel-42',
        acknowledgment: Buffer.from(JSON.stringify({ error: 'insufficient_funds' })).toString('base64'),
      };

      await ackHandler.handleAcknowledgment(failureAck);

      // Check recovery was initiated
      transfer = await multiHopManager.getTransfer(transferId);
      expect(transfer?.status).toBe('failed');
      expect(transfer?.failureReason).toContain('insufficient_funds');

      // Verify recovery mechanisms
      const recoveryStatus = await multiHopManager.initiateRecovery(transferId);
      expect(recoveryStatus.initiated).toBe(true);
    });

    it('should validate timelock cascade in multi-hop transfers', async () => {
      const invalidTimelocks = {
        htlcId: 'eth_invalid_timelock',
        sender: '0xsender',
        receiver: 'osmo1receiver',
        amount: { denom: 'uusdc', amount: '1000000' },
        route: [
          {
            chainId: 'cosmoshub-4',
            channelId: 'channel-0',
            portId: 'transfer',
            timelock: Math.floor(Date.now() / 1000) + 3600, // 1 hour
          },
          {
            chainId: 'osmosis-1',
            channelId: 'channel-141',
            portId: 'transfer',
            timelock: Math.floor(Date.now() / 1000) + 7200, // 2 hours - INVALID (should be less)
          },
        ],
        secret: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        hashlock: '0xa665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3',
        timeout: 1800,
      };

      await expect(multiHopManager.createTransfer(invalidTimelocks))
        .rejects.toThrow('Invalid timelock cascade');
    });
  });

  describe('Performance and Scalability', () => {
    it('should handle concurrent multi-hop transfers', async () => {
      const numTransfers = 5;
      const transferPromises: Promise<string>[] = [];

      for (let i = 0; i < numTransfers; i++) {
        const transferParams = {
          htlcId: `eth_concurrent_${i}`,
          sender: '0xsender',
          receiver: `osmo1receiver${i}`,
          amount: { denom: 'uusdc', amount: '1000000' },
          route: [
            {
              chainId: 'cosmoshub-4',
              channelId: 'channel-0',
              portId: 'transfer',
              timelock: Math.floor(Date.now() / 1000) + 3600,
            },
          ],
          secret: `1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde${i}`,
          hashlock: `0xa665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae${i}`,
          timeout: 1800,
        };

        transferPromises.push(multiHopManager.createTransfer(transferParams));
      }

      const transferIds = await Promise.all(transferPromises);
      expect(transferIds).toHaveLength(numTransfers);

      // Execute all transfers concurrently
      const executePromises = transferIds.map(id => multiHopManager.executeTransfer(id));
      await Promise.all(executePromises);

      // Verify all transfers are in progress
      for (const transferId of transferIds) {
        const transfer = await multiHopManager.getTransfer(transferId);
        expect(transfer?.status).toMatch(/routing|transferring/);
      }
    });

    it('should manage memory efficiently with large number of transfers', async () => {
      const initialMemory = process.memoryUsage();
      const numTransfers = 100;

      // Create many transfers
      for (let i = 0; i < numTransfers; i++) {
        const transferParams = {
          htlcId: `eth_memory_test_${i}`,
          sender: '0xsender',
          receiver: `osmo1receiver${i}`,
          amount: { denom: 'uusdc', amount: '1000000' },
          route: [
            {
              chainId: 'cosmoshub-4',
              channelId: 'channel-0',
              portId: 'transfer',
              timelock: Math.floor(Date.now() / 1000) + 3600,
            },
          ],
          secret: `secret_${i}`.padEnd(64, '0'),
          hashlock: `0x${'a'.repeat(62)}${i.toString().padStart(2, '0')}`,
          timeout: 1800,
        };

        await multiHopManager.createTransfer(transferParams);
      }

      const afterCreationMemory = process.memoryUsage();
      const memoryIncrease = afterCreationMemory.heapUsed - initialMemory.heapUsed;
      
      // Memory increase should be reasonable (less than 100MB for 100 transfers)
      expect(memoryIncrease).toBeLessThan(100 * 1024 * 1024);

      // Cleanup old transfers
      await multiHopManager.cleanupCompletedTransfers();

      const afterCleanupMemory = process.memoryUsage();
      
      // Memory should decrease after cleanup
      expect(afterCleanupMemory.heapUsed).toBeLessThan(afterCreationMemory.heapUsed);
    });
  });
});