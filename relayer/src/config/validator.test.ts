import { ConfigValidator, ValidationError } from './validator';
import { AppConfig } from './index';

describe('ConfigValidator', () => {
  let validator: ConfigValidator;
  let validConfig: AppConfig;

  beforeEach(() => {
    validator = new ConfigValidator();
    validConfig = {
      general: {
        logLevel: 'info',
        port: 3000,
        enableMetrics: true,
        shutdownTimeout: 30000,
      },
      ethereum: {
        rpcUrl: 'http://localhost:8545',
        htlcContractAddress: '0x1234567890123456789012345678901234567890',
        resolverContractAddress: '0x0987654321098765432109876543210987654321',
        privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
        chainId: 1337,
        confirmations: 1,
        gasLimit: 500000,
        gasPrice: '20',
      },
      cosmos: {
        rpcUrl: 'http://localhost:26657',
        restUrl: 'http://localhost:1317',
        chainId: 'testing',
        htlcContractAddress: 'cosmos1htlc123456789012345678901234567890abcd',
        mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
        gasPrice: '0.025uosmo',
        gasLimit: 200000,
        denom: 'uosmo',
        addressPrefix: 'osmo',
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
        timeoutBuffer: 3600,
      },
      recovery: {
        enabled: true,
        checkInterval: 60000,
        refundBuffer: 1800,
      },
    };
  });

  describe('valid configuration', () => {
    it('should validate a correct configuration', async () => {
      const result = await validator.validate(validConfig);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });
  });

  describe('general configuration validation', () => {
    it('should error on invalid log level', async () => {
      validConfig.general.logLevel = 'invalid';
      const result = await validator.validate(validConfig);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual({
        field: 'general.logLevel',
        message: 'Invalid log level. Must be one of: debug, info, warn, error',
        severity: 'error',
      });
    });

    it('should error on invalid port', async () => {
      validConfig.general.port = 70000;
      const result = await validator.validate(validConfig);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual({
        field: 'general.port',
        message: 'Port must be between 1 and 65535',
        severity: 'error',
      });
    });

    it('should error on negative shutdown timeout', async () => {
      validConfig.general.shutdownTimeout = -1;
      const result = await validator.validate(validConfig);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual({
        field: 'general.shutdownTimeout',
        message: 'Shutdown timeout must be non-negative',
        severity: 'error',
      });
    });

    it('should warn on short shutdown timeout', async () => {
      validConfig.general.shutdownTimeout = 5000;
      const result = await validator.validate(validConfig);
      expect(result.valid).toBe(true);
      expect(result.warnings).toContainEqual({
        field: 'general.shutdownTimeout',
        message: 'Shutdown timeout less than 10 seconds may not allow graceful shutdown',
        severity: 'warning',
      });
    });
  });

  describe('ethereum configuration validation', () => {
    it('should error on invalid RPC URL', async () => {
      validConfig.ethereum.rpcUrl = 'not-a-url';
      const result = await validator.validate(validConfig);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual({
        field: 'ethereum.rpcUrl',
        message: 'Invalid RPC URL format',
        severity: 'error',
      });
    });

    it('should error on invalid contract address', async () => {
      validConfig.ethereum.htlcContractAddress = 'invalid-address';
      const result = await validator.validate(validConfig);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual({
        field: 'ethereum.htlcContractAddress',
        message: 'Invalid Ethereum contract address',
        severity: 'error',
      });
    });

    it('should error on invalid private key', async () => {
      validConfig.ethereum.privateKey = 'invalid-key';
      const result = await validator.validate(validConfig);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual({
        field: 'ethereum.privateKey',
        message: 'Invalid private key format',
        severity: 'error',
      });
    });

    it('should error on zero or negative chain ID', async () => {
      validConfig.ethereum.chainId = 0;
      const result = await validator.validate(validConfig);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual({
        field: 'ethereum.chainId',
        message: 'Chain ID must be positive',
        severity: 'error',
      });
    });

    it('should warn on zero confirmations', async () => {
      validConfig.ethereum.confirmations = 0;
      const result = await validator.validate(validConfig);
      expect(result.valid).toBe(true);
      expect(result.warnings).toContainEqual({
        field: 'ethereum.confirmations',
        message: 'Zero confirmations may lead to reorg issues',
        severity: 'warning',
      });
    });

    it('should error on gas limit too low', async () => {
      validConfig.ethereum.gasLimit = 20000;
      const result = await validator.validate(validConfig);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual({
        field: 'ethereum.gasLimit',
        message: 'Gas limit must be at least 21000',
        severity: 'error',
      });
    });

    it('should warn on unusually high gas limit', async () => {
      validConfig.ethereum.gasLimit = 15000000;
      const result = await validator.validate(validConfig);
      expect(result.valid).toBe(true);
      expect(result.warnings).toContainEqual({
        field: 'ethereum.gasLimit',
        message: 'Gas limit seems unusually high',
        severity: 'warning',
      });
    });

    it('should error on invalid gas price format', async () => {
      validConfig.ethereum.gasPrice = 'invalid';
      const result = await validator.validate(validConfig);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual({
        field: 'ethereum.gasPrice',
        message: 'Invalid gas price format',
        severity: 'error',
      });
    });
  });

  describe('cosmos configuration validation', () => {
    it('should error on invalid RPC URL', async () => {
      validConfig.cosmos.rpcUrl = 'not-a-url';
      const result = await validator.validate(validConfig);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual({
        field: 'cosmos.rpcUrl',
        message: 'Invalid RPC URL format',
        severity: 'error',
      });
    });

    it('should error on invalid contract address', async () => {
      validConfig.cosmos.htlcContractAddress = 'invalid-address';
      const result = await validator.validate(validConfig);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual({
        field: 'cosmos.htlcContractAddress',
        message: 'Invalid Cosmos contract address',
        severity: 'error',
      });
    });

    it('should error on invalid mnemonic length', async () => {
      validConfig.cosmos.mnemonic = 'word1 word2 word3';
      const result = await validator.validate(validConfig);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual({
        field: 'cosmos.mnemonic',
        message: 'Mnemonic must be 12 or 24 words',
        severity: 'error',
      });
    });

    it('should error on invalid gas price format', async () => {
      validConfig.cosmos.gasPrice = '0.025';
      const result = await validator.validate(validConfig);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual({
        field: 'cosmos.gasPrice',
        message: 'Invalid gas price format. Expected format: <amount><denom>',
        severity: 'error',
      });
    });

    it('should warn on low gas limit', async () => {
      validConfig.cosmos.gasLimit = 50000;
      const result = await validator.validate(validConfig);
      expect(result.valid).toBe(true);
      expect(result.warnings).toContainEqual({
        field: 'cosmos.gasLimit',
        message: 'Gas limit seems low for Cosmos transactions',
        severity: 'warning',
      });
    });

    it('should error on invalid denom format', async () => {
      validConfig.cosmos.denom = 'UOSMO';
      const result = await validator.validate(validConfig);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual({
        field: 'cosmos.denom',
        message: 'Invalid denom format',
        severity: 'error',
      });
    });

    it('should validate additional cosmos chains', async () => {
      validConfig.cosmos.chains = [
        {
          rpcUrl: 'http://cosmos2:26657',
          restUrl: 'http://cosmos2:1317',
          chainId: 'cosmos-2',
          htlcContractAddress: 'cosmos1htlc999999999999999999999999999999999',
          mnemonic: 'test mnemonic',
          gasPrice: '0.025uatom',
          gasLimit: 200000,
          denom: 'uatom',
          addressPrefix: 'cosmos',
        },
      ];
      const result = await validator.validate(validConfig);
      expect(result.valid).toBe(true);
    });
  });

  describe('chain registry configuration validation', () => {
    it('should error on invalid base URL', async () => {
      validConfig.chainRegistry.baseUrl = 'not-a-url';
      const result = await validator.validate(validConfig);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual({
        field: 'chainRegistry.baseUrl',
        message: 'Invalid base URL format',
        severity: 'error',
      });
    });

    it('should warn on short cache timeout', async () => {
      validConfig.chainRegistry.cacheTimeout = 30;
      const result = await validator.validate(validConfig);
      expect(result.valid).toBe(true);
      expect(result.warnings).toContainEqual({
        field: 'chainRegistry.cacheTimeout',
        message: 'Cache timeout less than 60 seconds may cause excessive API calls',
        severity: 'warning',
      });
    });

    it('should warn on long cache timeout', async () => {
      validConfig.chainRegistry.cacheTimeout = 100000;
      const result = await validator.validate(validConfig);
      expect(result.valid).toBe(true);
      expect(result.warnings).toContainEqual({
        field: 'chainRegistry.cacheTimeout',
        message: 'Cache timeout greater than 24 hours may lead to stale data',
        severity: 'warning',
      });
    });

    it('should error on too short refresh interval', async () => {
      validConfig.chainRegistry.refreshInterval = 30;
      const result = await validator.validate(validConfig);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual({
        field: 'chainRegistry.refreshInterval',
        message: 'Refresh interval must be at least 60 seconds',
        severity: 'error',
      });
    });

    it('should warn when refresh interval is less than cache timeout', async () => {
      validConfig.chainRegistry.refreshInterval = 3000;
      validConfig.chainRegistry.cacheTimeout = 3600;
      const result = await validator.validate(validConfig);
      expect(result.valid).toBe(true);
      expect(result.warnings).toContainEqual({
        field: 'chainRegistry.refreshInterval',
        message: 'Refresh interval less than cache timeout is inefficient',
        severity: 'warning',
      });
    });
  });

  describe('relay configuration validation', () => {
    it('should error on negative max retries', async () => {
      validConfig.relay.maxRetries = -1;
      const result = await validator.validate(validConfig);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual({
        field: 'relay.maxRetries',
        message: 'Max retries must be non-negative',
        severity: 'error',
      });
    });

    it('should warn on high retry count', async () => {
      validConfig.relay.maxRetries = 15;
      const result = await validator.validate(validConfig);
      expect(result.valid).toBe(true);
      expect(result.warnings).toContainEqual({
        field: 'relay.maxRetries',
        message: 'High retry count may delay failure detection',
        severity: 'warning',
      });
    });

    it('should warn on short retry delay', async () => {
      validConfig.relay.retryDelay = 500;
      const result = await validator.validate(validConfig);
      expect(result.valid).toBe(true);
      expect(result.warnings).toContainEqual({
        field: 'relay.retryDelay',
        message: 'Retry delay less than 1 second may overload the system',
        severity: 'warning',
      });
    });

    it('should error on zero batch size', async () => {
      validConfig.relay.batchSize = 0;
      const result = await validator.validate(validConfig);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual({
        field: 'relay.batchSize',
        message: 'Batch size must be at least 1',
        severity: 'error',
      });
    });

    it('should warn on large batch size', async () => {
      validConfig.relay.batchSize = 150;
      const result = await validator.validate(validConfig);
      expect(result.valid).toBe(true);
      expect(result.warnings).toContainEqual({
        field: 'relay.batchSize',
        message: 'Large batch sizes may cause timeout issues',
        severity: 'warning',
      });
    });

    it('should error on too small timeout buffer', async () => {
      validConfig.relay.timeoutBuffer = 200;
      const result = await validator.validate(validConfig);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual({
        field: 'relay.timeoutBuffer',
        message: 'Timeout buffer must be at least 300 seconds (5 minutes)',
        severity: 'error',
      });
    });
  });

  describe('recovery configuration validation', () => {
    it('should warn on short check interval', async () => {
      validConfig.recovery.checkInterval = 5000;
      const result = await validator.validate(validConfig);
      expect(result.valid).toBe(true);
      expect(result.warnings).toContainEqual({
        field: 'recovery.checkInterval',
        message: 'Check interval less than 10 seconds may overload the system',
        severity: 'warning',
      });
    });

    it('should error on too small refund buffer', async () => {
      validConfig.recovery.refundBuffer = 500;
      const result = await validator.validate(validConfig);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual({
        field: 'recovery.refundBuffer',
        message: 'Refund buffer must be at least 600 seconds (10 minutes)',
        severity: 'error',
      });
    });
  });

  describe('cross-configuration consistency', () => {
    it('should error when recovery refund buffer is greater than relay timeout buffer', async () => {
      validConfig.recovery.refundBuffer = 4000;
      validConfig.relay.timeoutBuffer = 3600;
      const result = await validator.validate(validConfig);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual({
        field: 'recovery.refundBuffer',
        message: 'Recovery refund buffer must be less than relay timeout buffer',
        severity: 'error',
      });
    });

    it('should warn when processing interval is too short for batch size', async () => {
      validConfig.relay.batchSize = 50;
      validConfig.relay.processingInterval = 1000;
      const result = await validator.validate(validConfig);
      expect(result.valid).toBe(true);
      expect(result.warnings).toContainEqual({
        field: 'relay.processingInterval',
        message: 'Processing interval may be too short for batch size of 50',
        severity: 'warning',
      });
    });

    it('should warn on mixed mainnet/testnet configuration', async () => {
      validConfig.ethereum.chainId = 1; // Mainnet
      validConfig.cosmos.chainId = 'testing'; // Testnet
      const result = await validator.validate(validConfig);
      expect(result.valid).toBe(true);
      expect(result.warnings).toContainEqual({
        field: 'config',
        message: 'Ethereum and Cosmos appear to be on different network types (mainnet/testnet)',
        severity: 'warning',
      });
    });
  });

  describe('formatResults', () => {
    it('should format valid results correctly', () => {
      const result = {
        valid: true,
        errors: [],
        warnings: [],
      };
      const formatted = ConfigValidator.formatResults(result);
      expect(formatted).toBe('✅ Configuration is valid');
    });

    it('should format errors correctly', () => {
      const result = {
        valid: false,
        errors: [
          { field: 'test.field', message: 'Test error', severity: 'error' as const },
        ],
        warnings: [],
      };
      const formatted = ConfigValidator.formatResults(result);
      expect(formatted).toContain('❌ Configuration validation failed');
      expect(formatted).toContain('❌ test.field: Test error');
    });

    it('should format warnings correctly', () => {
      const result = {
        valid: true,
        errors: [],
        warnings: [
          { field: 'test.field', message: 'Test warning', severity: 'warning' as const },
        ],
      };
      const formatted = ConfigValidator.formatResults(result);
      expect(formatted).toContain('✅ Configuration is valid');
      expect(formatted).toContain('⚠️  test.field: Test warning');
    });

    it('should format both errors and warnings', () => {
      const result = {
        valid: false,
        errors: [
          { field: 'error.field', message: 'Error message', severity: 'error' as const },
        ],
        warnings: [
          { field: 'warning.field', message: 'Warning message', severity: 'warning' as const },
        ],
      };
      const formatted = ConfigValidator.formatResults(result);
      expect(formatted).toContain('❌ Configuration validation failed');
      expect(formatted).toContain('❌ error.field: Error message');
      expect(formatted).toContain('⚠️  warning.field: Warning message');
    });
  });
});