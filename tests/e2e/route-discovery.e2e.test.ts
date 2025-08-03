import { TestEnvironment } from '../utils/test-environment';
import { MockRouteDiscovery } from '../mocks/relayer-mocks';

describe('E2E Route Discovery and Optimization', () => {
  let env: TestEnvironment;
  let routeDiscovery: MockRouteDiscovery;
  
  beforeAll(async () => {
    env = TestEnvironment.getInstance();
    await env.initialize();
    
    routeDiscovery = new MockRouteDiscovery();
  });
  
  afterAll(async () => {
    await env.cleanup();
  });
  
  describe('Route Discovery', () => {
    test('should find direct routes when available', async () => {
      const routes = await routeDiscovery.findRoutes('ethereum', 'osmosis');
      
      expect(routes).toHaveLength(1);
      expect(routes[0]).toEqual(['ethereum', 'osmosis']);
    });
    
    test('should find multiple routes for complex paths', async () => {
      const routes = await routeDiscovery.findRoutes('ethereum', 'juno');
      
      expect(routes.length).toBeGreaterThan(1);
      expect(routes[0]).toContain('osmosis'); // Most likely through Osmosis
    });
    
    test('should respect max hop constraints', async () => {
      const routes = await routeDiscovery.findRoutes('ethereum', 'secret', {
        maxHops: 3,
      });
      
      for (const route of routes) {
        expect(route.length).toBeLessThanOrEqual(3);
      }
    });
    
    test('should exclude specified chains', async () => {
      const routes = await routeDiscovery.findRoutes('ethereum', 'juno', {
        excludeChains: ['osmosis'],
      });
      
      for (const route of routes) {
        expect(route).not.toContain('osmosis');
      }
    });
  });
  
  describe('Route Cost Estimation', () => {
    test('should calculate fees correctly', async () => {
      const testCases = [
        {
          route: ['ethereum', 'osmosis'],
          amount: '1000',
          expectedFees: 1, // 0.1% of 1000
        },
        {
          route: ['ethereum', 'osmosis', 'juno'],
          amount: '1000',
          expectedFees: 2, // 0.2% of 1000
        },
        {
          route: ['ethereum', 'osmosis', 'cosmoshub', 'juno'],
          amount: '1000',
          expectedFees: 3, // 0.3% of 1000
        },
      ];
      
      for (const testCase of testCases) {
        const cost = await routeDiscovery.estimateRouteCost(
          testCase.route,
          testCase.amount
        );
        
        expect(parseFloat(cost.fees)).toBeCloseTo(testCase.expectedFees, 1);
      }
    });
    
    test('should estimate time based on hop count', async () => {
      const route = ['ethereum', 'osmosis', 'juno', 'secret'];
      const cost = await routeDiscovery.estimateRouteCost(route, '1000');
      
      // 3 hops * 30 seconds per hop
      expect(cost.estimatedTime).toBe(90);
    });
  });
  
  describe('Dynamic Route Updates', () => {
    test('should adapt to channel closures', async () => {
      // Add alternative route
      routeDiscovery.addRoute('ethereum', 'juno', ['ethereum', 'cosmoshub', 'juno']);
      
      // Find routes excluding osmosis (simulating channel closure)
      const routes = await routeDiscovery.findRoutes('ethereum', 'juno', {
        excludeChains: ['osmosis'],
      });
      
      expect(routes.length).toBeGreaterThan(0);
      expect(routes[0]).toContain('cosmoshub');
    });
    
    test('should prefer chains with better liquidity', async () => {
      const routes = await routeDiscovery.findRoutes('ethereum', 'secret', {
        preferredChains: ['osmosis'], // Osmosis has best liquidity
      });
      
      // First route should include Osmosis
      expect(routes[0]).toContain('osmosis');
    });
  });
  
  describe('Performance Benchmarks', () => {
    test('should find routes quickly for common pairs', async () => {
      const start = Date.now();
      
      const commonPairs = [
        ['ethereum', 'osmosis'],
        ['ethereum', 'cosmoshub'],
        ['osmosis', 'juno'],
        ['juno', 'secret'],
      ];
      
      for (const [source, target] of commonPairs) {
        await routeDiscovery.findRoutes(source, target);
      }
      
      const duration = Date.now() - start;
      
      // Should complete all lookups in under 100ms
      expect(duration).toBeLessThan(100);
    });
    
    test('should handle complex route calculations efficiently', async () => {
      const start = Date.now();
      
      // Find routes with multiple constraints
      const routes = await routeDiscovery.findRoutes('ethereum', 'secret', {
        maxHops: 4,
        excludeChains: ['terra'],
        preferredChains: ['osmosis', 'juno'],
      });
      
      const duration = Date.now() - start;
      
      expect(routes.length).toBeGreaterThan(0);
      expect(duration).toBeLessThan(50); // Should be very fast
    });
  });
});