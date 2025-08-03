#!/usr/bin/env node

import axios from 'axios';
import { Command } from 'commander';

const program = new Command();

// Configuration
const DEFAULT_BASE_URL = 'http://localhost:3000';

program
  .name('fusion-admin')
  .description('Admin CLI for 1inch Fusion+ Relayer')
  .version('1.0.0')
  .option('-u, --url <url>', 'Relayer API base URL', DEFAULT_BASE_URL);

// Health commands
program
  .command('health')
  .description('Show system health status')
  .action(async () => {
    try {
      const response = await axios.get(`${getBaseUrl()}/health/detailed`);
      console.log(JSON.stringify(response.data, null, 2));
    } catch (error) {
      console.error('Failed to get health status:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// Circuit breaker commands
const circuitCommand = program
  .command('circuit')
  .description('Circuit breaker management');

circuitCommand
  .command('status')
  .description('Show circuit breaker status')
  .action(async () => {
    try {
      const response = await axios.get(`${getBaseUrl()}/circuit-breakers`);
      console.log(JSON.stringify(response.data, null, 2));
    } catch (error) {
      console.error('Failed to get circuit breaker status:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

circuitCommand
  .command('trip <name>')
  .description('Trip a circuit breaker (use "all" for emergency stop)')
  .option('-r, --reason <reason>', 'Reason for tripping the circuit breaker')
  .action(async (name: string, options: { reason?: string }) => {
    try {
      const response = await axios.post(`${getBaseUrl()}/circuit-breakers/${name}/trip`, {
        reason: options.reason
      });
      console.log(`Circuit breaker "${name}" tripped successfully`);
      console.log(JSON.stringify(response.data, null, 2));
    } catch (error) {
      console.error(`Failed to trip circuit breaker "${name}":`, error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

circuitCommand
  .command('reset <name>')
  .description('Reset a circuit breaker (use "all" to reset all, "system" to resume from emergency stop)')
  .action(async (name: string) => {
    try {
      const response = await axios.post(`${getBaseUrl()}/circuit-breakers/${name}/reset`);
      console.log(`Circuit breaker "${name}" reset successfully`);
      console.log(JSON.stringify(response.data, null, 2));
    } catch (error) {
      console.error(`Failed to reset circuit breaker "${name}":`, error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// Emergency commands
const emergencyCommand = program
  .command('emergency')
  .description('Emergency controls');

emergencyCommand
  .command('stop')
  .description('Emergency stop the entire system')
  .option('-r, --reason <reason>', 'Reason for emergency stop', 'Manual emergency stop via CLI')
  .action(async (options: { reason: string }) => {
    try {
      const response = await axios.post(`${getBaseUrl()}/emergency-stop`, {
        reason: options.reason
      });
      console.log('🚨 EMERGENCY STOP ACTIVATED 🚨');
      console.log(JSON.stringify(response.data, null, 2));
    } catch (error) {
      console.error('Failed to activate emergency stop:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

emergencyCommand
  .command('resume')
  .description('Resume from emergency stop')
  .action(async () => {
    try {
      const response = await axios.post(`${getBaseUrl()}/resume`);
      console.log('✅ System resumed from emergency stop');
      console.log(JSON.stringify(response.data, null, 2));
    } catch (error) {
      console.error('Failed to resume from emergency stop:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// Metrics commands
program
  .command('metrics')
  .description('Show system metrics')
  .action(async () => {
    try {
      const response = await axios.get(`${getBaseUrl()}/metrics`);
      console.log(JSON.stringify(response.data, null, 2));
    } catch (error) {
      console.error('Failed to get metrics:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// Monitor commands
const monitorCommand = program
  .command('monitor')
  .description('Real-time monitoring');

monitorCommand
  .command('health')
  .description('Monitor system health (updates every 5 seconds)')
  .action(async () => {
    console.log('Monitoring system health (Press Ctrl+C to stop)...\n');
    
    const checkHealth = async () => {
      try {
        const response = await axios.get(`${getBaseUrl()}/health`);
        const timestamp = new Date().toISOString();
        
        console.clear();
        console.log(`🔍 System Health Monitor - ${timestamp}\n`);
        
        const health = response.data;
        console.log(`Overall Status: ${health.status === 'healthy' ? '✅ HEALTHY' : '❌ UNHEALTHY'}`);
        console.log(`System Health: ${health.systemHealth ? '✅ HEALTHY' : '❌ UNHEALTHY'}`);
        console.log(`\nMonitors:`);
        console.log(`  Ethereum: ${health.monitors.ethereum.running ? '🟢 Running' : '🔴 Stopped'} (Block: ${health.monitors.ethereum.lastBlock})`);
        console.log(`  Cosmos: ${health.monitors.cosmos.running ? '🟢 Running' : '🔴 Stopped'} (Height: ${health.monitors.cosmos.lastHeight})`);
        console.log(`\nRecovery Service: ${health.recovery.running ? '🟢 Running' : '🔴 Stopped'}`);
        
        if (health.enhanced?.errorRecovery?.hasOpenCircuits) {
          console.log(`\n⚠️  Open Circuit Breakers: ${health.enhanced.errorRecovery.openCircuits.join(', ')}`);
        }
        
        if (health.enhanced?.errorRecovery?.emergencyStop) {
          console.log('\n🚨 EMERGENCY STOP ACTIVE 🚨');
        }
        
      } catch (error) {
        console.clear();
        console.log(`❌ Failed to fetch health status: ${error instanceof Error ? error.message : error}`);
      }
    };
    
    // Initial check
    await checkHealth();
    
    // Set up interval
    const interval = setInterval(checkHealth, 5000);
    
    // Handle Ctrl+C
    process.on('SIGINT', () => {
      clearInterval(interval);
      console.log('\n\nMonitoring stopped.');
      process.exit(0);
    });
  });

function getBaseUrl(): string {
  return program.opts().url || DEFAULT_BASE_URL;
}

// Error handling
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

program.parse();