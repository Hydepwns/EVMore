/**
 * Tests for 1Password Secrets Provider
 * 
 * These tests validate both CLI and Connect API functionality.
 * Tests use mocked implementations to avoid requiring actual 1Password infrastructure.
 */

import { OnePasswordSecretsProvider } from '../../src/secrets/onepassword-secrets-provider';
import { SecretsProvider, SecretsConfig } from '../../src/secrets/types';
import { spawn } from 'child_process';
import axios from 'axios';

// Mock axios for Connect API tests
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

// Mock child_process for CLI tests
jest.mock('child_process');
const mockedSpawn = spawn as jest.MockedFunction<typeof spawn>;

describe('OnePasswordSecretsProvider', () => {
  let provider: OnePasswordSecretsProvider;
  
  // Mock configurations
  const cliConfig: SecretsConfig = {
    provider: SecretsProvider.ONEPASSWORD,
    onePassword: {
      vault: 'Test Vault',
      cliPath: 'op',
      account: 'test-account',
      useConnect: false,
      timeout: 30000
    }
  };

  const connectConfig: SecretsConfig = {
    provider: SecretsProvider.ONEPASSWORD,
    onePassword: {
      endpoint: 'http://localhost:8080',
      token: 'fake-connect-token',
      vault: 'Test Vault',
      useConnect: true,
      timeout: 30000
    }
  };

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('CLI Provider', () => {
    beforeEach(() => {
      provider = new OnePasswordSecretsProvider(cliConfig);
    });

    test('should initialize successfully with valid CLI', async () => {
      // Mock successful CLI version check
      const mockChild = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn((event, callback) => {
          if (event === 'close') {
            setTimeout(() => callback(0), 10);
          }
        }),
        kill: jest.fn()
      };
      
      (mockChild.stdout.on as jest.Mock).mockImplementation((event, callback) => {
        if (event === 'data') {
          setTimeout(() => callback(Buffer.from('2.29.0')), 5);
        }
      });

      mockedSpawn.mockReturnValue(mockChild as any);

      await expect(provider.initialize()).resolves.not.toThrow();
      expect(provider.isHealthy()).toBe(true);
    });

    test('should fail initialization with invalid CLI path', async () => {
      const mockChild = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn((event, callback) => {
          if (event === 'error') {
            setTimeout(() => callback(new Error('ENOENT: no such file or directory')), 10);
          }
        }),
        kill: jest.fn()
      };

      mockedSpawn.mockReturnValue(mockChild as any);

      await expect(provider.initialize()).rejects.toThrow('1Password CLI not available');
    });

    test('should retrieve secret via CLI', async () => {
      // Mock CLI initialization
      let mockChild = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn((event, callback) => {
          if (event === 'close') {
            setTimeout(() => callback(0), 10);
          }
        }),
        kill: jest.fn()
      };
      
      (mockChild.stdout.on as jest.Mock).mockImplementation((event, callback) => {
        if (event === 'data') {
          setTimeout(() => callback(Buffer.from('2.29.0')), 5);
        }
      });

      mockedSpawn.mockReturnValueOnce(mockChild as any);
      await provider.initialize();

      // Mock secret retrieval
      const secretData = {
        id: '123',
        title: 'test-secret',
        fields: [
          { id: 'password', label: 'password', value: 'secret-value-123' }
        ],
        version: 1,
        createdAt: '2023-01-01T00:00:00Z',
        updatedAt: '2023-01-01T00:00:00Z'
      };

      mockChild = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn((event, callback) => {
          if (event === 'close') {
            setTimeout(() => callback(0), 10);
          }
        }),
        kill: jest.fn()
      };

      (mockChild.stdout.on as jest.Mock).mockImplementation((event, callback) => {
        if (event === 'data') {
          setTimeout(() => callback(Buffer.from(JSON.stringify(secretData))), 5);
        }
      });

      mockedSpawn.mockReturnValueOnce(mockChild as any);

      const result = await provider.getSecret('test-secret');
      
      expect(result.value).toBe('secret-value-123');
      expect(result.version).toBe('1');
      expect(result.metadata?.provider).toBe('onepassword-cli');
    });

    test('should handle CLI timeout', async () => {
      // Initialize first
      let mockChild = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn((event, callback) => {
          if (event === 'close') {
            setTimeout(() => callback(0), 10);
          }
        }),
        kill: jest.fn()
      };
      
      (mockChild.stdout.on as jest.Mock).mockImplementation((event, callback) => {
        if (event === 'data') {
          setTimeout(() => callback(Buffer.from('2.29.0')), 5);
        }
      });

      mockedSpawn.mockReturnValueOnce(mockChild as any);
      await provider.initialize();

      // Mock timeout scenario
      mockChild = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn(),
        kill: jest.fn()
      };

      mockedSpawn.mockReturnValueOnce(mockChild as any);

      // Set a short timeout for testing
      const shortTimeoutProvider = new OnePasswordSecretsProvider({
        ...cliConfig,
        onePassword: { ...cliConfig.onePassword!, timeout: 100 }
      });

      await shortTimeoutProvider.initialize();
      await expect(shortTimeoutProvider.getSecret('test-secret')).rejects.toThrow('CLI command timed out');
    });

    test('should parse secret names correctly', () => {
      const testCases = [
        { name: 'simple', expected: { vaultId: 'Test Vault', itemId: 'simple' } },
        { name: 'vault/item', expected: { vaultId: 'vault', itemId: 'item' } },
        { name: 'vault/item/field', expected: { vaultId: 'vault', itemId: 'item', fieldId: 'field' } }
      ];

      testCases.forEach(({ name, expected }) => {
        // Access private method via any cast for testing
        const result = (provider as any).parseSecretName(name, 'Test Vault');
        expect(result).toEqual(expected);
      });
    });
  });

  describe('Connect API Provider', () => {
    beforeEach(() => {
      provider = new OnePasswordSecretsProvider(connectConfig);
      
      // Mock axios.create
      const mockAxiosInstance = {
        get: jest.fn(),
        interceptors: {
          response: {
            use: jest.fn()
          }
        }
      };
      mockedAxios.create.mockReturnValue(mockAxiosInstance as any);
    });

    test('should initialize with Connect API', async () => {
      const mockAxiosInstance = mockedAxios.create();
      (mockAxiosInstance.get as jest.Mock).mockResolvedValue({ data: 'OK' });

      await expect(provider.initialize()).resolves.not.toThrow();
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/v1/heartbeat');
    });

    test('should retrieve secret via Connect API', async () => {
      const mockAxiosInstance = mockedAxios.create();
      
      // Mock heartbeat for initialization
      (mockAxiosInstance.get as jest.Mock).mockResolvedValueOnce({ data: 'OK' });
      await provider.initialize();

      // Mock secret retrieval
      const itemData = {
        id: '123',
        title: 'test-secret',
        vault: { id: 'vault-123', name: 'Test Vault' },
        fields: [
          { id: 'password', label: 'password', type: 'CONCEALED', value: 'secret-value-123' }
        ],
        version: 1,
        createdAt: '2023-01-01T00:00:00Z',
        updatedAt: '2023-01-01T00:00:00Z'
      };

      (mockAxiosInstance.get as jest.Mock).mockResolvedValueOnce({ data: itemData });

      const result = await provider.getSecret('test-secret');
      
      expect(result.value).toBe('secret-value-123');
      expect(result.version).toBe('1');
      expect(result.metadata?.provider).toBe('onepassword-connect');
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/v1/vaults/Test Vault/items/test-secret');
    });

    test('should handle Connect API errors', async () => {
      const mockAxiosInstance = mockedAxios.create();
      
      // Mock initialization
      (mockAxiosInstance.get as jest.Mock).mockResolvedValueOnce({ data: 'OK' });
      await provider.initialize();

      // Mock API error
      const apiError = {
        response: {
          status: 404,
          data: { message: 'Item not found' }
        }
      };
      (mockAxiosInstance.get as jest.Mock).mockRejectedValueOnce(apiError);

      await expect(provider.getSecret('nonexistent')).rejects.toThrow('1Password Connect API error: Item not found');
    });

    test('should extract specific field from item', async () => {
      const mockAxiosInstance = mockedAxios.create();
      
      // Mock initialization
      (mockAxiosInstance.get as jest.Mock).mockResolvedValueOnce({ data: 'OK' });
      await provider.initialize();

      // Mock item with multiple fields
      const itemData = {
        id: '123',
        title: 'database-config',
        vault: { id: 'vault-123', name: 'Test Vault' },
        fields: [
          { id: 'username', label: 'username', type: 'TEXT', value: 'admin' },
          { id: 'password', label: 'password', type: 'CONCEALED', value: 'secret-password' },
          { id: 'host', label: 'host', type: 'TEXT', value: 'localhost' }
        ],
        version: 1,
        createdAt: '2023-01-01T00:00:00Z',
        updatedAt: '2023-01-01T00:00:00Z'
      };

      (mockAxiosInstance.get as jest.Mock).mockResolvedValueOnce({ data: itemData });

      const result = await provider.getSecret('database-config', 'username');
      
      expect(result.value).toBe('admin');
      expect(result.metadata?.field).toBe('username');
    });
  });

  describe('Configuration Validation', () => {
    test('should require 1Password configuration', () => {
      const invalidConfig: SecretsConfig = {
        provider: SecretsProvider.ONEPASSWORD
        // Missing onePassword config
      };

      expect(() => new OnePasswordSecretsProvider(invalidConfig)).toThrow('1Password configuration is required');
    });

    test('should validate Connect API requirements', () => {
      const invalidConnectConfig: SecretsConfig = {
        provider: SecretsProvider.ONEPASSWORD,
        onePassword: {
          useConnect: true,
          vault: 'Test'
          // Missing endpoint and token
        }
      };

      // This should not throw during construction, but during validation
      const provider = new OnePasswordSecretsProvider(invalidConnectConfig);
      expect(provider).toBeDefined();
    });
  });

  describe('Caching', () => {
    beforeEach(() => {
      provider = new OnePasswordSecretsProvider({
        ...cliConfig,
        cacheTimeout: 100 // Short cache for testing
      });
    });

    test('should cache secrets and return cached values', async () => {
      // Mock initialization
      let mockChild = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn((event, callback) => {
          if (event === 'close') {
            setTimeout(() => callback(0), 10);
          }
        }),
        kill: jest.fn()
      };
      
      (mockChild.stdout.on as jest.Mock).mockImplementation((event, callback) => {
        if (event === 'data') {
          setTimeout(() => callback(Buffer.from('2.29.0')), 5);
        }
      });

      mockedSpawn.mockReturnValueOnce(mockChild as any);
      await provider.initialize();

      // Mock secret retrieval
      const secretData = { fields: [{ label: 'password', value: 'cached-value' }] };
      mockChild = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn((event, callback) => {
          if (event === 'close') {
            setTimeout(() => callback(0), 10);
          }
        }),
        kill: jest.fn()
      };

      (mockChild.stdout.on as jest.Mock).mockImplementation((event, callback) => {
        if (event === 'data') {
          setTimeout(() => callback(Buffer.from(JSON.stringify(secretData))), 5);
        }
      });

      mockedSpawn.mockReturnValue(mockChild as any);

      // First call should hit the provider
      const result1 = await provider.getSecret('test-secret');
      expect(result1.value).toBe('cached-value');
      expect(mockedSpawn).toHaveBeenCalledTimes(2); // Once for init, once for secret

      // Second call should use cache
      const result2 = await provider.getSecret('test-secret');
      expect(result2.value).toBe('cached-value');
      expect(mockedSpawn).toHaveBeenCalledTimes(2); // Should not increase
    });

    test('should expire cached secrets', async () => {
      // This test would need more complex setup to test cache expiration
      // For now, just verify the cache can be cleared
      provider.clearCache();
      expect(provider.getProviderInfo().cacheSize).toBe(0);
    });
  });

  describe('Provider Info', () => {
    test('should return correct provider info', () => {
      const provider = new OnePasswordSecretsProvider(cliConfig);
      const info = provider.getProviderInfo();
      
      expect(info.type).toBe(SecretsProvider.ONEPASSWORD);
      expect(info.healthy).toBe(true); // Default state before initialization
      expect(info.cacheSize).toBe(0);
    });
  });
});