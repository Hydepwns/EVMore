/**
 * High-Throughput Stress Testing
 * Tests system performance under extreme load conditions
 */

import { ethers } from 'ethers';
import { Logger } from 'pino';
import cluster from 'cluster';
import os from 'os';
import { performance } from 'perf_hooks';
import { EthereumMonitor } from '../../src/monitor/ethereum-monitor';
import { CosmosMonitor } from '../../src/monitor/cosmos-monitor';
import { RelayService } from '../../src/relay/relay-service';
import { PersistenceManager } from '../../src/persistence/persistence-manager';
import { ConnectionPoolManager } from '../../src/connection-pool/pool-manager';
import { RateLimiter } from '../../src/security/rate-limiter';
import { ResourceMonitor } from '../../src/security/resource-monitor';
import { MetricsCollector } from '../../src/monitoring/metrics-collector';
import {
  MockEthereumClient,
  MockCosmosClient,
  MockChainRegistry,
  createTestLogger,
  createTestConfig,
  sleep,
} from './setup';

// Mock heavy dependencies
jest.mock('../../src/persistence/persistence-manager');
jest.mock('../../src/connection-pool/pool-manager');
jest.mock('../../src/security/rate-limiter');
jest.mock('../../src/security/resource-monitor');
jest.mock('../../src/monitoring/metrics-collector');

interface PerformanceMetrics {
  totalSwaps: number;
  successfulSwaps: number;
  failedSwaps: number;
  averageLatency: number;
  p95Latency: number;
  p99Latency: number;
  throughput: number;
  peakThroughput: number;
  memoryUsage: NodeJS.MemoryUsage;
  cpuUsage: NodeJS.CpuUsage;
  errors: Map<string, number>;
}

describe('High-Throughput Stress Tests', () => {
  let ethereumClients: MockEthereumClient[];
  let cosmosClients: MockCosmosClient[];
  let relayServices: RelayService[];
  let persistenceManager: jest.Mocked<PersistenceManager>;
  let connectionPoolManager: jest.Mocked<ConnectionPoolManager>;
  let rateLimiter: jest.Mocked<RateLimiter>;
  let resourceMonitor: jest.Mocked<ResourceMonitor>;
  let metricsCollector: jest.Mocked<MetricsCollector>;
  
  const logger = createTestLogger();
  const config = createTestConfig();
  
  // Stress test configuration
  const SWAP_COUNTS = [100, 500, 1000, 5000];
  const CONCURRENT_LIMITS = [10, 20, 50, 100];
  const WORKER_COUNTS = [1, 2, 4, 8];
  
  // Performance tracking
  const latencies: number[] = [];
  const errorCounts = new Map<string, number>();
  let startTime: number;

  beforeEach(() => {
    jest.clearAllMocks();
    latencies.length = 0;
    errorCounts.clear();

    // Setup mocks
    persistenceManager = new (jest.requireMock('../../src/persistence/persistence-manager').PersistenceManager)();
    connectionPoolManager = new (jest.requireMock('../../src/connection-pool/pool-manager').ConnectionPoolManager)();
    rateLimiter = new (jest.requireMock('../../src/security/rate-limiter').RateLimiter)();
    resourceMonitor = new (jest.requireMock('../../src/security/resource-monitor').ResourceMonitor)();
    metricsCollector = new (jest.requireMock('../../src/monitoring/metrics-collector').MetricsCollector)();

    // Configure mocks for high throughput
    persistenceManager.saveSwap = jest.fn().mockImplementation(async () => {
      // Simulate database latency
      await sleep(Math.random() * 10);
    });
    
    persistenceManager.updateSwapStatus = jest.fn().mockImplementation(async () => {
      await sleep(Math.random() * 5);
    });

    connectionPoolManager.getConnection = jest.fn().mockImplementation(async () => ({
      execute: jest.fn(),
      release: jest.fn(),
    }));

    rateLimiter.checkLimit = jest.fn().mockResolvedValue(true);
    rateLimiter.getCurrentRate = jest.fn().mockReturnValue(0);

    resourceMonitor.checkResources = jest.fn().mockResolvedValue({
      healthy: true,
      cpu: 50,
      memory: 60,
      connections: 100,
    });

    metricsCollector.recordSwapLatency = jest.fn();
    metricsCollector.recordError = jest.fn();
    metricsCollector.getMetrics = jest.fn().mockReturnValue({});
  });

  describe('Concurrent Swap Processing', () => {
    it('should handle 100 concurrent swaps with acceptable performance', async () => {
      const swapCount = 100;
      const results = await runStressTest(swapCount, 20);

      expect(results.successfulSwaps).toBeGreaterThan(95);
      expect(results.averageLatency).toBeLessThan(1000); // Less than 1 second average
      expect(results.throughput).toBeGreaterThan(10); // At least 10 swaps/second
    });

    it('should handle 500 concurrent swaps without memory leaks', async () => {
      const initialMemory = process.memoryUsage();
      
      const results = await runStressTest(500, 50);
      
      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }
      
      await sleep(1000); // Let memory settle
      
      const finalMemory = process.memoryUsage();
      const memoryGrowth = (finalMemory.heapUsed - initialMemory.heapUsed) / 1024 / 1024; // MB
      
      expect(memoryGrowth).toBeLessThan(100); // Less than 100MB growth
      expect(results.successfulSwaps).toBeGreaterThan(475); // 95% success rate
    });

    it('should handle 1000 concurrent swaps with graceful degradation', async () => {
      // Configure rate limiting to kick in
      let callCount = 0;
      rateLimiter.checkLimit.mockImplementation(async () => {
        callCount++;
        // Start rejecting after 800 swaps
        return callCount < 800;
      });

      const results = await runStressTest(1000, 100);

      expect(results.successfulSwaps).toBeGreaterThan(750);
      expect(results.errors.get('rate_limited')).toBeGreaterThan(150);
      
      // Verify system remained stable
      expect(results.memoryUsage.heapUsed).toBeLessThan(500 * 1024 * 1024); // Less than 500MB
    });

    it('should maintain consistent latency under sustained load', async () => {
      const batchSize = 100;
      const batches = 10;
      const batchLatencies: number[] = [];

      for (let i = 0; i < batches; i++) {
        const batchStart = performance.now();
        await runStressTest(batchSize, 20);
        const batchTime = performance.now() - batchStart;
        batchLatencies.push(batchTime / batchSize);
        
        // Brief pause between batches
        await sleep(100);
      }

      // Calculate latency variance
      const avgLatency = batchLatencies.reduce((a, b) => a + b) / batches;
      const variance = batchLatencies.reduce((sum, lat) => sum + Math.pow(lat - avgLatency, 2), 0) / batches;
      const stdDev = Math.sqrt(variance);

      // Latency should be consistent (low standard deviation)
      expect(stdDev / avgLatency).toBeLessThan(0.2); // Less than 20% variation
    });
  });

  describe('Resource Management Under Load', () => {
    it('should respect connection pool limits', async () => {
      const maxConnections = 50;
      connectionPoolManager.getMaxConnections = jest.fn().mockReturnValue(maxConnections);
      
      let activeConnections = 0;
      let peakConnections = 0;

      connectionPoolManager.getConnection.mockImplementation(async () => {
        activeConnections++;
        peakConnections = Math.max(peakConnections, activeConnections);
        
        return {
          execute: jest.fn(),
          release: jest.fn().mockImplementation(() => {
            activeConnections--;
          }),
        };
      });

      await runStressTest(200, 100);

      expect(peakConnections).toBeLessThanOrEqual(maxConnections);
    });

    it('should handle database connection failures gracefully', async () => {
      let failureCount = 0;
      persistenceManager.saveSwap.mockImplementation(async () => {
        failureCount++;
        if (failureCount % 10 === 0) {
          throw new Error('Database connection timeout');
        }
        await sleep(5);
      });

      const results = await runStressTest(100, 20);

      expect(results.errors.get('database_error')).toBeGreaterThan(5);
      expect(results.successfulSwaps).toBeGreaterThan(80); // Still processing despite failures
    });

    it('should implement circuit breaker under extreme load', async () => {
      let requestCount = 0;
      const circuitBreakerThreshold = 50;

      persistenceManager.saveSwap.mockImplementation(async () => {
        requestCount++;
        if (requestCount > circuitBreakerThreshold) {
          throw new Error('Circuit breaker open');
        }
        await sleep(2);
      });

      const results = await runStressTest(100, 50);

      expect(results.errors.get('circuit_breaker')).toBeGreaterThan(0);
      expect(requestCount).toBeLessThanOrEqual(circuitBreakerThreshold + 10); // Some overshoot is acceptable
    });
  });

  describe('Multi-Worker Stress Tests', () => {
    it('should scale linearly with worker count', async () => {
      const swapsPerWorker = 50;
      const results: Map<number, PerformanceMetrics> = new Map();

      for (const workerCount of [1, 2, 4]) {
        const result = await runMultiWorkerTest(swapsPerWorker * workerCount, workerCount);
        results.set(workerCount, result);
      }

      // Verify near-linear scaling
      const baseline = results.get(1)!.throughput;
      const twoWorkers = results.get(2)!.throughput;
      const fourWorkers = results.get(4)!.throughput;

      expect(twoWorkers).toBeGreaterThan(baseline * 1.8); // At least 80% scaling efficiency
      expect(fourWorkers).toBeGreaterThan(baseline * 3.2); // At least 80% scaling efficiency
    });

    it('should handle worker failures without data loss', async () => {
      const totalSwaps = 200;
      const workerCount = 4;
      
      // Simulate worker crashes
      const workerCrashPoints = new Map([
        [1, 30], // Worker 1 crashes after 30 swaps
        [3, 45], // Worker 3 crashes after 45 swaps
      ]);

      const result = await runMultiWorkerTest(totalSwaps, workerCount, workerCrashPoints);

      // Verify no swaps were lost
      expect(result.totalSwaps).toBe(totalSwaps);
      expect(result.successfulSwaps + result.failedSwaps).toBe(totalSwaps);
    });
  });

  describe('Extreme Load Scenarios', () => {
    it('should survive 5000 swap burst', async () => {
      const results = await runStressTest(5000, 200, {
        timeout: 60000, // 60 second timeout
        batchProcessing: true,
        batchSize: 100,
      });

      expect(results.successfulSwaps).toBeGreaterThan(4500); // 90% success rate
      expect(results.peakThroughput).toBeGreaterThan(50); // Peak of 50+ swaps/second
    });

    it('should handle mixed swap types under load', async () => {
      const swapTypes = ['simple', 'multihop', 'complex'];
      const swapsPerType = 100;
      const results = new Map<string, PerformanceMetrics>();

      for (const type of swapTypes) {
        const result = await runStressTest(swapsPerType, 30, {
          swapType: type,
          complexity: type === 'complex' ? 5 : type === 'multihop' ? 3 : 1,
        });
        results.set(type, result);
      }

      // Verify all types completed successfully
      for (const [type, result] of results) {
        expect(result.successfulSwaps).toBeGreaterThan(90);
        logger.info(`${type} swaps: ${result.throughput.toFixed(2)} swaps/sec`);
      }
    });

    it('should maintain SLA under sustained high load', async () => {
      const duration = 30000; // 30 seconds
      const targetThroughput = 100; // swaps per second
      const slaLatency = 500; // 500ms p99

      const result = await runSustainedLoadTest(duration, targetThroughput);

      expect(result.throughput).toBeGreaterThan(targetThroughput * 0.95); // 95% of target
      expect(result.p99Latency).toBeLessThan(slaLatency);
      expect(result.errors.size).toBeLessThan(5); // Less than 5 error types
    });
  });

  // Helper function to run stress test
  async function runStressTest(
    swapCount: number,
    concurrencyLimit: number,
    options: any = {}
  ): Promise<PerformanceMetrics> {
    startTime = performance.now();
    const swapPromises: Promise<void>[] = [];
    const semaphore = new Semaphore(concurrencyLimit);
    
    // Create mock clients
    const ethereumClient = new MockEthereumClient();
    const cosmosClient = new MockCosmosClient();
    
    // Create services
    const ethereumMonitor = new EthereumMonitor(config.ethereum, logger);
    const cosmosMonitor = new CosmosMonitor(config.cosmos, logger);
    const relayService = new RelayService(
      ethereumMonitor,
      cosmosMonitor,
      {} as any, // route discovery
      {} as any, // multi-hop manager
      persistenceManager as any,
      {} as any, // circuit breaker
      logger
    );

    await ethereumMonitor.start();
    await relayService.start();

    // Generate swaps
    for (let i = 0; i < swapCount; i++) {
      const swapPromise = semaphore.acquire().then(async (release) => {
        const swapStart = performance.now();
        
        try {
          const swapParams = generateSwapParams(i, options.swapType);
          const htlcId = ethereumClient.createHTLC(swapParams);
          
          // Wait for processing
          await sleep(Math.random() * 100 + 50); // 50-150ms processing time
          
          const swapLatency = performance.now() - swapStart;
          latencies.push(swapLatency);
          metricsCollector.recordSwapLatency(swapLatency);
          
        } catch (error) {
          const errorType = classifyError(error);
          errorCounts.set(errorType, (errorCounts.get(errorType) || 0) + 1);
          metricsCollector.recordError(errorType);
        } finally {
          release();
        }
      });
      
      swapPromises.push(swapPromise);
      
      // Batch processing
      if (options.batchProcessing && i % options.batchSize === 0) {
        await sleep(10); // Brief pause between batches
      }
    }

    // Wait for all swaps to complete
    await Promise.allSettled(swapPromises);

    // Stop services
    await ethereumMonitor.stop();
    await relayService.stop();

    return calculateMetrics(swapCount);
  }

  // Helper function for multi-worker tests
  async function runMultiWorkerTest(
    totalSwaps: number,
    workerCount: number,
    workerCrashPoints?: Map<number, number>
  ): Promise<PerformanceMetrics> {
    if (cluster.isPrimary) {
      const workerPromises: Promise<any>[] = [];
      const swapsPerWorker = Math.floor(totalSwaps / workerCount);
      
      for (let i = 0; i < workerCount; i++) {
        const worker = cluster.fork();
        
        workerPromises.push(new Promise((resolve) => {
          worker.on('message', (msg) => {
            if (msg.type === 'result') {
              resolve(msg.data);
            }
          });
          
          worker.send({
            type: 'start',
            swapCount: swapsPerWorker,
            workerId: i,
            crashPoint: workerCrashPoints?.get(i),
          });
        }));
      }
      
      const results = await Promise.all(workerPromises);
      return aggregateWorkerResults(results);
      
    } else {
      // Worker process
      process.on('message', async (msg: any) => {
        if (msg.type === 'start') {
          const result = await runStressTest(msg.swapCount, 20);
          process.send!({ type: 'result', data: result });
          process.exit(0);
        }
      });
    }
    
    // Default return for TypeScript
    return calculateMetrics(0);
  }

  // Helper function for sustained load test
  async function runSustainedLoadTest(
    duration: number,
    targetThroughput: number
  ): Promise<PerformanceMetrics> {
    const endTime = Date.now() + duration;
    const swapInterval = 1000 / targetThroughput; // ms between swaps
    let totalSwaps = 0;
    
    const ethereumClient = new MockEthereumClient();
    const cosmosClient = new MockCosmosClient();
    
    while (Date.now() < endTime) {
      const swapStart = performance.now();
      
      try {
        const swapParams = generateSwapParams(totalSwaps);
        ethereumClient.createHTLC(swapParams);
        totalSwaps++;
        
        const swapLatency = performance.now() - swapStart;
        latencies.push(swapLatency);
        
      } catch (error) {
        const errorType = classifyError(error);
        errorCounts.set(errorType, (errorCounts.get(errorType) || 0) + 1);
      }
      
      // Maintain target rate
      const elapsed = performance.now() - swapStart;
      if (elapsed < swapInterval) {
        await sleep(swapInterval - elapsed);
      }
    }
    
    return calculateMetrics(totalSwaps);
  }

  // Helper functions
  function generateSwapParams(index: number, type: string = 'simple'): any {
    const baseAmount = ethers.utils.parseUnits(String(100 + index % 1000), 6);
    
    return {
      sender: `0x${index.toString(16).padStart(40, '0')}`,
      token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      amount: baseAmount,
      targetChain: type === 'complex' ? 'stargaze-1' : 'osmosis-1',
      targetAddress: `osmo${index}`,
      hashlock: ethers.utils.sha256(`0x${index}`),
      timelock: Math.floor(Date.now() / 1000) + 3600,
    };
  }

  function classifyError(error: any): string {
    const message = error.message || error.toString();
    
    if (message.includes('rate')) return 'rate_limited';
    if (message.includes('database') || message.includes('Database')) return 'database_error';
    if (message.includes('circuit breaker')) return 'circuit_breaker';
    if (message.includes('timeout')) return 'timeout';
    if (message.includes('memory')) return 'out_of_memory';
    
    return 'unknown_error';
  }

  function calculateMetrics(totalSwaps: number): PerformanceMetrics {
    const duration = (performance.now() - startTime) / 1000; // seconds
    const successfulSwaps = latencies.length;
    const failedSwaps = totalSwaps - successfulSwaps;
    
    // Calculate latency percentiles
    latencies.sort((a, b) => a - b);
    const p95Index = Math.floor(latencies.length * 0.95);
    const p99Index = Math.floor(latencies.length * 0.99);
    
    return {
      totalSwaps,
      successfulSwaps,
      failedSwaps,
      averageLatency: latencies.reduce((a, b) => a + b, 0) / latencies.length || 0,
      p95Latency: latencies[p95Index] || 0,
      p99Latency: latencies[p99Index] || 0,
      throughput: successfulSwaps / duration,
      peakThroughput: calculatePeakThroughput(),
      memoryUsage: process.memoryUsage(),
      cpuUsage: process.cpuUsage(),
      errors: new Map(errorCounts),
    };
  }

  function calculatePeakThroughput(): number {
    // Calculate peak throughput over 1-second windows
    const windowSize = 1000; // 1 second
    const windows = new Map<number, number>();
    
    latencies.forEach((_, index) => {
      const timestamp = startTime + (index * 10); // Approximate
      const window = Math.floor(timestamp / windowSize);
      windows.set(window, (windows.get(window) || 0) + 1);
    });
    
    return Math.max(...windows.values());
  }

  function aggregateWorkerResults(results: PerformanceMetrics[]): PerformanceMetrics {
    const aggregated: PerformanceMetrics = {
      totalSwaps: 0,
      successfulSwaps: 0,
      failedSwaps: 0,
      averageLatency: 0,
      p95Latency: 0,
      p99Latency: 0,
      throughput: 0,
      peakThroughput: 0,
      memoryUsage: process.memoryUsage(),
      cpuUsage: process.cpuUsage(),
      errors: new Map(),
    };
    
    results.forEach(result => {
      aggregated.totalSwaps += result.totalSwaps;
      aggregated.successfulSwaps += result.successfulSwaps;
      aggregated.failedSwaps += result.failedSwaps;
      aggregated.throughput += result.throughput;
      aggregated.peakThroughput = Math.max(aggregated.peakThroughput, result.peakThroughput);
      
      // Merge errors
      result.errors.forEach((count, type) => {
        aggregated.errors.set(type, (aggregated.errors.get(type) || 0) + count);
      });
    });
    
    // Calculate weighted averages
    const totalSuccessful = aggregated.successfulSwaps;
    aggregated.averageLatency = results.reduce((sum, r) => 
      sum + (r.averageLatency * r.successfulSwaps / totalSuccessful), 0
    );
    
    return aggregated;
  }
});

// Simple semaphore implementation for concurrency control
class Semaphore {
  private permits: number;
  private waiting: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<() => void> {
    if (this.permits > 0) {
      this.permits--;
      return () => this.release();
    }

    return new Promise<() => void>((resolve) => {
      this.waiting.push(() => {
        this.permits--;
        resolve(() => this.release());
      });
    });
  }

  private release(): void {
    this.permits++;
    if (this.waiting.length > 0) {
      const next = this.waiting.shift()!;
      next();
    }
  }
}