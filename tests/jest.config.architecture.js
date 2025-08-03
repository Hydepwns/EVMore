/** @type {import('jest').Config} */
module.exports = {
  displayName: 'Architecture Tests',
  testEnvironment: 'node',
  testMatch: [
    '<rootDir>/integration/architecture-validation.test.ts',
    '<rootDir>/integration/performance-benchmark.test.ts',
    '<rootDir>/integration/migration-validation.test.ts'
  ],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: {
        allowJs: true,
        esModuleInterop: true,
        moduleResolution: 'node',
        resolveJsonModule: true,
        skipLibCheck: true,
        strict: false,
        paths: {
          '@evmore/errors': ['../libs/errors/dist'],
          '@evmore/interfaces': ['../libs/interfaces/dist'],
          '@evmore/types': ['../libs/types/dist'],
          '@evmore/config': ['../libs/config/dist'],
          '@evmore/utils': ['../libs/utils/dist'],
          '@evmore/connection-pool': ['../libs/connection-pool/dist'],
          '@evmore/test-utils': ['../libs/test-utils/dist']
        }
      }
    }]
  },
  moduleNameMapper: {
    '^@evmore/errors$': '<rootDir>/../libs/errors/dist',
    '^@evmore/interfaces$': '<rootDir>/../libs/interfaces/dist',
    '^@evmore/types$': '<rootDir>/../libs/types/dist',
    '^@evmore/config$': '<rootDir>/../libs/config/dist',
    '^@evmore/utils$': '<rootDir>/../libs/utils/dist',
    '^@evmore/connection-pool$': '<rootDir>/../libs/connection-pool/dist',
    '^@evmore/test-utils$': '<rootDir>/../libs/test-utils/dist'
  },
  setupFilesAfterEnv: ['<rootDir>/setup-architecture.ts'],
  testTimeout: 30000,
  collectCoverageFrom: [
    '../sdk/src/**/*.ts',
    '../relayer/src/**/*.ts',
    '../libs/*/src/**/*.ts',
    '!**/*.d.ts',
    '!**/*.test.ts',
    '!**/node_modules/**'
  ],
  coverageThreshold: {
    global: {
      branches: 75,
      functions: 75,
      lines: 75,
      statements: 75
    }
  },
  // For performance tests
  // Enable gc for memory tests
  testEnvironmentOptions: {
    customExportConditions: ['node', 'require', 'default']
  },
  // globalSetup: '<rootDir>/utils/test-environment.ts' // Not needed for architecture tests
};