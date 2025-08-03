import { ethers } from 'ethers';
import { SigningCosmWasmClient } from '@cosmjs/cosmwasm-stargate';
import { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing';
import pino from 'pino';
import { RecoveryService } from '../../src/recovery/recovery-service';
import { AppConfig } from '../../src/config';

// Mock dependencies
jest.mock('ethers');
jest.mock('@cosmjs/cosmwasm-stargate');
jest.mock('@cosmjs/proto-signing');

describe('RecoveryService', () => {
  let recoveryService: RecoveryService;
  let mockEthereumProvider: jest.Mocked<ethers.providers.JsonRpcProvider>;
  let mockEthereumWallet: jest.Mocked<ethers.Wallet>;
  let mockHtlcContract: jest.Mocked<ethers.Contract>;
  let mockCosmosClient: jest.Mocked<SigningCosmWasmClient>;
  let mockLogger: pino.Logger;
  let config: AppConfig;

  const mockAddress = '0x1234567890123456789012345678901234567890';
  const mockCosmosAddress = 'cosmos1abcdefghijklmnopqrstuvwxyz';

  beforeEach(() => {
    // Setup mock Ethereum provider
    mockEthereumProvider = {
      getBlock: jest.fn(),
    } as any;

    // Setup mock Ethereum wallet
    mockEthereumWallet = {
      getAddress: jest.fn().mockResolvedValue(mockAddress),
    } as any;

    // Setup mock HTLC contract
    mockHtlcContract = {
      filters: {
        HTLCCreated: jest.fn().mockReturnValue({}),
      },
      queryFilter: jest.fn(),
      htlcs: jest.fn(),
      refund: jest.fn(),
    } as any;

    // Setup mock Cosmos client
    mockCosmosClient = {
      queryContractSmart: jest.fn(),
      execute: jest.fn(),
      getAccounts: jest.fn(),
    } as any;

    // Mock constructors
    (ethers.providers.JsonRpcProvider as any) = jest.fn().mockReturnValue(mockEthereumProvider);
    (ethers.Wallet as jest.MockedClass<typeof ethers.Wallet>).mockImplementation(
      () => mockEthereumWallet
    );
    (ethers.Contract as jest.MockedClass<typeof ethers.Contract>).mockImplementation(
      () => mockHtlcContract
    );
    (SigningCosmWasmClient.connectWithSigner as jest.Mock).mockResolvedValue(mockCosmosClient);
    (DirectSecp256k1HdWallet.fromMnemonic as jest.Mock).mockResolvedValue({
      getAccounts: jest.fn().mockResolvedValue([{ address: mockCosmosAddress }]),
    });

    // Setup logger
    mockLogger = pino({ level: 'silent' });

    // Setup config
    config = {
      general: {
        logLevel: 'info',
        port: 3000,
        enableMetrics: false,
        shutdownTimeout: 30000,
      },
      ethereum: {
        rpcUrl: 'http://localhost:8545',
        privateKey: '0x1234',
        htlcContractAddress: '0xabcd',
        resolverContractAddress: '0xdef0',
        chainId: 1337,
        confirmations: 1,
        gasLimit: 300000,
      },
      cosmos: {
        chainId: 'osmosis-1',
        rpcUrl: 'http://localhost:26657',
        restUrl: 'http://localhost:1317',
        mnemonic: 'test mnemonic',
        htlcContractAddress: 'osmo1htlc',
        addressPrefix: 'osmo',
        gasPrice: '0.025uosmo',
        gasLimit: 200000,
        denom: 'uosmo',
      },
      chainRegistry: {
        baseUrl: 'https://registry.ping.pub',
        cacheTimeout: 3600,
        refreshInterval: 300,
      },
      relay: {
        maxRetries: 3,
        retryDelay: 5000,
        batchSize: 10,
        processingInterval: 10000,
        timeoutBuffer: 300,
      },
      recovery: {
        enabled: true,
        checkInterval: 60000,
        refundBuffer: 7200,
      },
    };

    recoveryService = new RecoveryService(config, mockLogger);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('start/stop', () => {
    it('should start and initialize connections', async () => {
      await recoveryService.start();

      expect(ethers.providers.JsonRpcProvider).toHaveBeenCalledWith(config.ethereum.rpcUrl);
      expect(ethers.Wallet).toHaveBeenCalledWith(config.ethereum.privateKey, mockEthereumProvider);
      expect(DirectSecp256k1HdWallet.fromMnemonic).toHaveBeenCalledWith(
        config.cosmos.mnemonic,
        { prefix: config.cosmos.addressPrefix }
      );
      expect(SigningCosmWasmClient.connectWithSigner).toHaveBeenCalled();
    });

    it('should not start if already running', async () => {
      await recoveryService.start();
      await recoveryService.start(); // Try to start again

      expect(ethers.providers.JsonRpcProvider).toHaveBeenCalledTimes(1);
    });

    it('should stop monitoring', async () => {
      await recoveryService.start();
      await recoveryService.stop();

      // Service should stop
      expect(recoveryService['isRunning']).toBe(false);
    });
  });

  describe('Ethereum HTLC monitoring', () => {
    const currentTime = Math.floor(Date.now() / 1000);

    beforeEach(async () => {
      mockEthereumProvider.getBlock.mockResolvedValue({
        timestamp: currentTime,
      } as any);

      await recoveryService.start();
      await recoveryService.stop(); // Stop automatic monitoring
    });

    it('should check and refund expired Ethereum HTLCs', async () => {
      const htlcId = '0xhtlc123';
      const expiredTimelock = currentTime - 3600; // Expired 1 hour ago

      // Mock HTLC created event
      const mockEvent = {
        args: { htlcId },
      };
      mockHtlcContract.queryFilter.mockResolvedValue([mockEvent as any]);

      // Mock HTLC details
      mockHtlcContract.htlcs.mockResolvedValue({
        sender: mockAddress, // We are the sender
        token: '0xtoken',
        amount: ethers.BigNumber.from('1000000'),
        hashlock: '0xhash',
        timelock: expiredTimelock,
        withdrawn: false,
        refunded: false,
        targetChain: 'osmosis',
        targetAddress: 'osmo1receiver',
      });

      // Mock refund transaction
      const mockTx = { wait: jest.fn().mockResolvedValue({ hash: '0xtxhash', gasUsed: ethers.BigNumber.from(100000) }) };
      mockHtlcContract.refund.mockResolvedValue(mockTx);

      // Manually call checkEthereumHTLCs
      await (recoveryService as any).checkEthereumHTLCs();

      expect(mockHtlcContract.htlcs).toHaveBeenCalledWith(htlcId);
      expect(mockHtlcContract.refund).toHaveBeenCalledWith(htlcId, {
        gasLimit: config.ethereum.gasLimit,
      });
    });

    it('should not refund if not the sender', async () => {
      const htlcId = '0xhtlc123';
      const expiredTimelock = currentTime - 3600;

      const mockEvent = { args: { htlcId } };
      mockHtlcContract.queryFilter.mockResolvedValue([mockEvent as any]);

      mockHtlcContract.htlcs.mockResolvedValue({
        sender: '0xotheraddress', // Different sender
        timelock: expiredTimelock,
        withdrawn: false,
        refunded: false,
      });

      await (recoveryService as any).checkEthereumHTLCs();

      expect(mockHtlcContract.refund).not.toHaveBeenCalled();
    });

    it('should not refund if already withdrawn', async () => {
      const htlcId = '0xhtlc123';
      const expiredTimelock = currentTime - 3600;

      const mockEvent = { args: { htlcId } };
      mockHtlcContract.queryFilter.mockResolvedValue([mockEvent as any]);

      mockHtlcContract.htlcs.mockResolvedValue({
        sender: mockAddress,
        timelock: expiredTimelock,
        withdrawn: true, // Already withdrawn
        refunded: false,
      });

      await (recoveryService as any).checkEthereumHTLCs();

      expect(mockHtlcContract.refund).not.toHaveBeenCalled();
    });

    it('should not refund if not expired', async () => {
      const htlcId = '0xhtlc123';
      const futureTimelock = currentTime + 3600; // Expires in 1 hour

      const mockEvent = { args: { htlcId } };
      mockHtlcContract.queryFilter.mockResolvedValue([mockEvent as any]);

      mockHtlcContract.htlcs.mockResolvedValue({
        sender: mockAddress,
        timelock: futureTimelock,
        withdrawn: false,
        refunded: false,
      });

      await (recoveryService as any).checkEthereumHTLCs();

      expect(mockHtlcContract.refund).not.toHaveBeenCalled();
    });

    it('should handle errors during Ethereum checking', async () => {
      mockHtlcContract.queryFilter.mockRejectedValue(new Error('Network error'));

      await expect((recoveryService as any).checkEthereumHTLCs()).resolves.not.toThrow();
    });
  });

  describe('Cosmos HTLC monitoring', () => {
    const currentTime = Math.floor(Date.now() / 1000);

    beforeEach(async () => {
      // Mock getAccount method instead since we're dealing with a wallet separately
      
      await recoveryService.start();
      await recoveryService.stop(); // Stop automatic monitoring
    });

    it('should check and refund expired Cosmos HTLCs', async () => {
      const htlcId = 'cosmos123';
      const expiredTimelock = currentTime - 3600;

      // Mock HTLC query response
      mockCosmosClient.queryContractSmart.mockResolvedValue({
        htlcs: [
          {
            id: htlcId,
            sender: mockCosmosAddress, // We are the sender
            receiver: 'cosmos1receiver',
            amount: [{ denom: 'uosmo', amount: '1000000' }],
            hashlock: '0xhash',
            timelock: expiredTimelock,
            withdrawn: false,
            refunded: false,
          },
        ],
      });

      // Mock refund execution
      mockCosmosClient.execute.mockResolvedValue({
        transactionHash: '0xtxhash',
        gasUsed: 100000,
        gasWanted: 100000,
        height: 1000,
        logs: [],
        events: [],
      } as any);

      // Manually call checkCosmosHTLCs
      await (recoveryService as any).checkCosmosHTLCs();

      expect(mockCosmosClient.execute).toHaveBeenCalledWith(
        mockCosmosAddress,
        config.cosmos.htlcContractAddress,
        { refund: { htlc_id: htlcId } },
        'auto'
      );
    });

    it('should not refund if not the sender', async () => {
      const htlcId = 'cosmos123';
      const expiredTimelock = currentTime - 3600;

      mockCosmosClient.queryContractSmart.mockResolvedValue({
        htlcs: [
          {
            id: htlcId,
            sender: 'cosmos1otheraddress', // Different sender
            timelock: expiredTimelock,
            withdrawn: false,
            refunded: false,
          },
        ],
      });

      await (recoveryService as any).checkCosmosHTLCs();

      expect(mockCosmosClient.execute).not.toHaveBeenCalled();
    });

    it('should handle empty HTLC list', async () => {
      mockCosmosClient.queryContractSmart.mockResolvedValue({
        htlcs: [],
      });

      await (recoveryService as any).checkCosmosHTLCs();

      expect(mockCosmosClient.execute).not.toHaveBeenCalled();
    });

    it('should handle errors during Cosmos checking', async () => {
      mockCosmosClient.queryContractSmart.mockRejectedValue(new Error('Network error'));

      await expect((recoveryService as any).checkCosmosHTLCs()).resolves.not.toThrow();
    });
  });

  describe('continuous monitoring', () => {
    it('should continuously monitor for expired HTLCs', async () => {
      jest.useFakeTimers();

      const currentTime = Math.floor(Date.now() / 1000);
      mockEthereumProvider.getBlock.mockResolvedValue({ timestamp: currentTime } as any);
      mockHtlcContract.queryFilter.mockResolvedValue([]);
      mockCosmosClient.queryContractSmart.mockResolvedValue({ htlcs: [] });

      await recoveryService.start();

      // Advance time to trigger checks
      jest.advanceTimersByTime(60000); // 1 minute
      await Promise.resolve();

      expect(mockHtlcContract.queryFilter).toHaveBeenCalled();
      expect(mockCosmosClient.queryContractSmart).toHaveBeenCalled();

      await recoveryService.stop();
      jest.useRealTimers();
    });

    it('should handle errors and continue monitoring', async () => {
      jest.useFakeTimers();

      mockHtlcContract.queryFilter.mockRejectedValue(new Error('Network error'));
      mockCosmosClient.queryContractSmart.mockRejectedValue(new Error('Network error'));

      await recoveryService.start();

      // Advance time to trigger checks
      jest.advanceTimersByTime(60000);
      await Promise.resolve();

      // Should continue running despite errors
      expect(recoveryService['isRunning']).toBe(true);

      await recoveryService.stop();
      jest.useRealTimers();
    });
  });
});