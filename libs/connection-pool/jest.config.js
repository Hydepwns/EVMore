module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
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
  moduleFileExtensions: ['ts', 'js', 'json', 'node'],
};