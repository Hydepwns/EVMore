module.exports = {
  ...require('../../jest.config.shared'),
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: {
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
        strict: false,
        skipLibCheck: true,
        noUnusedLocals: false,
        noUnusedParameters: false,
        allowJs: true
      }
    }]
  },
};