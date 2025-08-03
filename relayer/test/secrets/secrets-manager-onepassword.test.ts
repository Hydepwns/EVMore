/**
 * Integration tests for SecretsManager with 1Password provider
 * 
 * Tests the integration between SecretsManager and OnePasswordSecretsProvider
 */

import { SecretsManager } from '../../src/secrets/secrets-manager';
import { SecretsProvider, SecretsConfig } from '../../src/secrets/types';
import { createSecretsManager, getSecretsConfigFromEnv } from '../../src/secrets/utils';
import { Logger } from 'pino';

// Mock logger for testing
const mockLogger = {
  child: jest.fn().mockReturnThis(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
} as unknown as Logger;

describe('SecretsManager with 1Password', () => {
  let secretsManager: SecretsManager;

  const testConfig: SecretsConfig = {
    provider: SecretsProvider.ONEPASSWORD,
    onePassword: {
      vault: 'Test Vault',
      cliPath: 'op',
      useConnect: false,
      timeout: 30000
    },
    cacheTimeout: 300000
  };

  beforeEach(() => {
    secretsManager = new SecretsManager(testConfig, mockLogger);
  });

  test('should create SecretsManager with 1Password provider', () => {
    expect(secretsManager).toBeDefined();
  });

  test('should include 1Password in provider factory', () => {
    // Access private method for testing
    const provider = (secretsManager as any).createProvider(testConfig);
    expect(provider).toBeDefined();
    expect(provider.constructor.name).toBe('OnePasswordSecretsProvider');
  });

  test('should support 1Password in environment configuration', () => {
    // Mock environment variables
    const originalEnv = process.env;
    process.env = {
      ...originalEnv,
      SECRETS_PROVIDER: '1password',
      ONEPASSWORD_VAULT: 'Production',
      ONEPASSWORD_CLI_PATH: '/usr/local/bin/op',
      ONEPASSWORD_ACCOUNT: 'company'
    };

    const config = getSecretsConfigFromEnv();
    
    expect(config.provider).toBe(SecretsProvider.ONEPASSWORD);
    expect((config as any).onePassword.vault).toBe('Production');
    expect((config as any).onePassword.cliPath).toBe('/usr/local/bin/op');
    expect((config as any).onePassword.account).toBe('company');

    // Restore environment
    process.env = originalEnv;
  });

  test('should create SecretsManager from environment with 1Password', () => {
    // Mock environment variables
    const originalEnv = process.env;
    process.env = {
      ...originalEnv,
      SECRETS_PROVIDER: '1password',
      ONEPASSWORD_VAULT: 'Test'
    };

    const manager = createSecretsManager(mockLogger);
    expect(manager).toBeDefined();

    // Restore environment
    process.env = originalEnv;
  });

  test('should support Connect API configuration from environment', () => {
    const originalEnv = process.env;
    process.env = {
      ...originalEnv,
      SECRETS_PROVIDER: '1password',
      ONEPASSWORD_USE_CONNECT: 'true',
      ONEPASSWORD_CONNECT_HOST: 'http://localhost:8080',
      ONEPASSWORD_CONNECT_TOKEN: 'fake-token',
      ONEPASSWORD_VAULT: 'Production'
    };

    const config = getSecretsConfigFromEnv();
    
    expect(config.provider).toBe(SecretsProvider.ONEPASSWORD);
    expect((config as any).onePassword.useConnect).toBe(true);
    expect((config as any).onePassword.endpoint).toBe('http://localhost:8080');
    expect((config as any).onePassword.token).toBe('fake-token');

    process.env = originalEnv;
  });

  describe('Multi-provider configuration', () => {
    test('should support 1Password as primary with fallback', () => {
      const multiConfig = {
        providers: [
          {
            provider: SecretsProvider.ONEPASSWORD,
            config: {
              provider: SecretsProvider.ONEPASSWORD,
              onePassword: {
                vault: 'Production',
                useConnect: true,
                endpoint: 'http://localhost:8080',
                token: 'fake-token'
              }
            },
            priority: 1,
            fallback: false
          },
          {
            provider: SecretsProvider.ENVIRONMENT,
            config: {
              provider: SecretsProvider.ENVIRONMENT,
              env: { prefix: 'BACKUP_' }
            },
            priority: 2,
            fallback: true
          }
        ],
        strategy: 'priority' as const
      };

      const manager = new SecretsManager(multiConfig, mockLogger);
      expect(manager).toBeDefined();
    });

    test('should support 1Password as fallback provider', () => {
      const multiConfig = {
        providers: [
          {
            provider: SecretsProvider.ENVIRONMENT,
            config: {
              provider: SecretsProvider.ENVIRONMENT,
              env: { prefix: 'PRIMARY_' }
            },
            priority: 1,
            fallback: false
          },
          {
            provider: SecretsProvider.ONEPASSWORD,
            config: {
              provider: SecretsProvider.ONEPASSWORD,
              onePassword: {
                vault: 'Fallback',
                cliPath: 'op'
              }
            },
            priority: 2,
            fallback: true
          }
        ],
        strategy: 'priority' as const
      };

      const manager = new SecretsManager(multiConfig, mockLogger);
      expect(manager).toBeDefined();
    });
  });

  describe('Configuration validation', () => {
    test('should validate 1Password configuration', () => {
      const { validateSecretsConfig } = require('../../src/secrets/utils');
      
      // Valid configuration
      const validConfig: SecretsConfig = {
        provider: SecretsProvider.ONEPASSWORD,
        onePassword: {
          vault: 'Test Vault',
          useConnect: false
        }
      };
      
      const validErrors = validateSecretsConfig(validConfig);
      expect(validErrors).toHaveLength(0);

      // Invalid configuration - missing onePassword
      const invalidConfig: SecretsConfig = {
        provider: SecretsProvider.ONEPASSWORD
      };
      
      const invalidErrors = validateSecretsConfig(invalidConfig);
      expect(invalidErrors).toContain('1Password configuration is required for 1Password provider');

      // Invalid Connect configuration
      const invalidConnectConfig: SecretsConfig = {
        provider: SecretsProvider.ONEPASSWORD,
        onePassword: {
          useConnect: true,
          vault: 'Test'
          // Missing endpoint and token
        }
      };
      
      const connectErrors = validateSecretsConfig(invalidConnectConfig);
      expect(connectErrors).toContain('1Password Connect endpoint is required when using Connect API');
      expect(connectErrors).toContain('1Password Connect token is required when using Connect API');
    });
  });
});