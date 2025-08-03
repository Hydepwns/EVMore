#!/usr/bin/env ts-node

import { config } from 'dotenv';
import { Config, ConfigValidator } from './index';
import pino from 'pino';

// Load environment variables
config();

// Initialize logger
const logger = pino({
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'HH:MM:ss Z',
      ignore: 'pid,hostname',
    },
  },
});

async function validateConfig() {
  logger.info('Starting configuration validation...');
  
  try {
    // Try to load configuration
    const appConfig = await Config.load();
    logger.info('✅ Configuration loaded successfully');
    
    // Run detailed validation
    const validator = new ConfigValidator();
    const result = await validator.validate(appConfig);
    
    // Display results
    console.log('\n' + ConfigValidator.formatResults(result));
    
    if (result.valid) {
      logger.info('Configuration is valid and ready for use');
      process.exit(0);
    } else {
      logger.error('Configuration validation failed. Please fix the errors above.');
      process.exit(1);
    }
  } catch (error) {
    logger.error({ error }, 'Failed to validate configuration');
    if (error instanceof Error) {
      console.error(`\n❌ ${error.message}`);
    }
    process.exit(1);
  }
}

// Run validation
validateConfig().catch((error) => {
  logger.fatal({ error }, 'Unexpected error during validation');
  process.exit(1);
});