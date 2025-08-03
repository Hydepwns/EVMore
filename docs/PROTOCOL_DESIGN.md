# Protocol Design

## Cross-Chain Architecture

### Overview

EVMore implements atomic cross-chain swaps between Ethereum and Cosmos chains using Hash Time Lock Contracts (HTLCs), Inter-Blockchain Communication (IBC), and multi-hop routing for optimal liquidity access.

### Core Components

```
┌─ Ethereum HTLC ─┐    ┌─ IBC Relayer ─┐    ┌─ Cosmos Chains ─┐
│  Lock Funds     │◄──►│  Monitor      │◄──►│  Execute Swap   │
│  Time Lock      │    │  Relay        │    │  Route Forward  │
│  Secret Hash    │    │  Route Disco  │    │  DEX Trading    │
└─────────────────┘     └───────────────┘    └─────────────────┘
```

## Multi-Hop IBC Routing

### Route Discovery

```typescript
interface SwapRoute {
  hops: Array<{
    chainId: string;
    channelId: string;
    portId: string;
    timelock: number;
  }>;
  totalFee: string;
  estimatedDuration: number;
}

class RouteDiscovery {
  async findOptimalRoute(
    from: string,
    to: string,
    amount: string
  ): Promise<SwapRoute> {
    // 1. Query Chain Registry for available paths
    const paths = await this.chainRegistry.getPaths(from, to);
    
    // 2. Calculate fees and liquidity for each path
    const routesWithCosts = await Promise.all(
      paths.map(path => this.calculateRouteCost(path, amount))
    );
    
    // 3. Select optimal route based on cost and reliability
    return this.selectOptimalRoute(routesWithCosts);
  }
}
```

### Packet Forward Middleware

```typescript
interface PacketForwardMetadata {
  receiver: string;
  port: string;
  channel: string;
  timeout: number;
  retries: number;
  next?: PacketForwardMetadata;
}

// Multi-hop packet forwarding
const forwardMemo = {
  forward: {
    receiver: "osmo1...",
    port: "transfer",
    channel: "channel-0",
    timeout: 1800, // 30 minutes
    next: {
      receiver: "juno1...",
      port: "wasm.juno1contractaddr",
      channel: "channel-47",
      timeout: 1200 // 20 minutes
    }
  }
};
```

### Timelock Cascade

```typescript
class TimelockManager {
  calculateTimelocks(hops: number): number[] {
    const baseTimelock = 48 * 3600; // 48 hours for Ethereum
    const timelocks = [];
    
    for (let i = 0; i < hops; i++) {
      // Each hop gets progressively shorter timelock
      const timelock = baseTimelock - (i * 12 * 3600); // 12 hour reduction
      timelocks.push(Math.max(timelock, 6 * 3600)); // Minimum 6 hours
    }
    
    return timelocks;
  }
}

// Example: Ethereum → Cosmos Hub → Osmosis → Juno
// Timelocks: [48h, 36h, 24h, 12h]
```

## IBC Packet Handling

### Packet Structure

```typescript
interface IBCPacket {
  sequence: number;
  source_port: string;
  source_channel: string;
  destination_port: string;
  destination_channel: string;
  data: Uint8Array;
  timeout_height: Height;
  timeout_timestamp: number;
}

interface SwapPacketData {
  sender: string;
  receiver: string;
  amount: string;
  denom: string;
  memo: string; // Contains swap instructions
  swapId: string;
  secretHash: string;
  timelock: number;
}
```

### Acknowledgment Handling

```typescript
class AcknowledgmentHandler {
  async handleAcknowledgment(
    packet: IBCPacket,
    ack: Acknowledgment
  ): Promise<void> {
    const swapData = this.parseSwapData(packet.data);
    
    if (ack.success) {
      // Secret revealed, propagate to previous hop
      await this.propagateSecret(swapData.swapId, ack.result.secret);
    } else {
      // Failure, initiate refund process
      await this.initiateRefund(swapData.swapId, ack.error);
    }
  }
  
  private async propagateSecret(swapId: string, secret: string): Promise<void> {
    // Validate secret against hash
    if (!this.crypto.verifySecret(secret, swapData.secretHash)) {
      throw new Error('Invalid secret provided');
    }
    
    // Update local state
    await this.persistence.updateSwapStatus(swapId, 'revealed', { secret });
    
    // Forward to previous hop if this is not the origin
    if (this.isPreviousHop(swapId)) {
      await this.forwardSecret(swapId, secret);
    }
  }
}
```

### Timeout Recovery

```typescript
class TimeoutRecovery {
  async handleTimeout(packet: IBCPacket): Promise<void> {
    const swapData = this.parseSwapData(packet.data);
    
    // Check if timelock has expired
    const currentTime = Math.floor(Date.now() / 1000);
    if (currentTime > swapData.timelock) {
      // Initiate refund on this chain
      await this.executeRefund(swapData);
    } else {
      // Retry packet relay
      await this.retryPacket(packet);
    }
  }
}
```

## DEX Integration

### Osmosis Integration

```typescript
class OsmosisClient {
  async executeSwap(params: SwapParams): Promise<SwapResult> {
    const { 
      tokenIn, 
      tokenOut, 
      amountIn, 
      minAmountOut,
      swapFee,
      routes 
    } = params;
    
    // Query pools for optimal route
    const optimalRoute = await this.findOptimalRoute(
      tokenIn, 
      tokenOut, 
      amountIn
    );
    
    // Execute multi-hop swap
    const msg = {
      swap_exact_amount_in: {
        sender: this.address,
        routes: optimalRoute.pools.map(pool => ({
          pool_id: pool.id,
          token_out_denom: pool.tokenOut
        })),
        token_in: {
          denom: tokenIn,
          amount: amountIn
        },
        token_out_min_amount: minAmountOut
      }
    };
    
    return await this.broadcast(msg);
  }
  
  async getQuote(
    tokenIn: string,
    tokenOut: string,
    amountIn: string
  ): Promise<SwapQuote> {
    // Query all available pools
    const pools = await this.queryPools(tokenIn, tokenOut);
    
    // Calculate optimal route through pools
    return await this.calculateOptimalRoute(pools, amountIn);
  }
}
```

### AMM Integration

```typescript
interface AMMPool {
  id: string;
  tokenA: string;
  tokenB: string;
  reserveA: string;
  reserveB: string;
  swapFee: string;
  exitFee: string;
}

class AMMCalculator {
  calculateSwapOutput(
    pool: AMMPool,
    tokenIn: string,
    amountIn: string
  ): SwapCalculation {
    const isTokenA = tokenIn === pool.tokenA;
    const reserveIn = isTokenA ? pool.reserveA : pool.reserveB;
    const reserveOut = isTokenA ? pool.reserveB : pool.reserveA;
    
    // Constant product formula: xy = k
    const amountInAfterFee = this.applySwapFee(amountIn, pool.swapFee);
    const numerator = amountInAfterFee * reserveOut;
    const denominator = reserveIn + amountInAfterFee;
    
    return {
      amountOut: numerator / denominator,
      priceImpact: this.calculatePriceImpact(amountIn, reserveIn, reserveOut),
      fee: amountIn - amountInAfterFee
    };
  }
}
```

## Chain Registry Integration

### Dynamic Discovery

```typescript
class ChainRegistryClient {
  async getChainInfo(chainId: string): Promise<ChainInfo> {
    const response = await fetch(
      `https://registry.cosmos.network/chains/${chainId}`
    );
    return await response.json();
  }
  
  async getIBCChannels(
    chainA: string,
    chainB: string
  ): Promise<IBCChannel[]> {
    const response = await fetch(
      `https://registry.cosmos.network/ibc/${chainA}/${chainB}.json`
    );
    return (await response.json()).channels;
  }
  
  async findRoutePaths(
    source: string,
    destination: string,
    maxHops: number = 3
  ): Promise<RoutePath[]> {
    // BFS algorithm to find all possible paths
    const queue = [{ chain: source, path: [source], hops: 0 }];
    const visited = new Set([source]);
    const paths: RoutePath[] = [];
    
    while (queue.length > 0) {
      const current = queue.shift()!;
      
      if (current.chain === destination) {
        paths.push({
          chains: current.path,
          hops: current.hops,
          channels: await this.getChannelsForPath(current.path)
        });
        continue;
      }
      
      if (current.hops >= maxHops) continue;
      
      const connections = await this.getConnectedChains(current.chain);
      for (const nextChain of connections) {
        if (!visited.has(nextChain)) {
          visited.add(nextChain);
          queue.push({
            chain: nextChain,
            path: [...current.path, nextChain],
            hops: current.hops + 1
          });
        }
      }
    }
    
    return paths.sort((a, b) => a.hops - b.hops); // Prefer shorter paths
  }
}
```

### Route Optimization

```typescript
class RouteOptimizer {
  async optimizeRoute(
    paths: RoutePath[],
    amount: string,
    preferences: RoutePreferences
  ): Promise<OptimalRoute> {
    const scoredPaths = await Promise.all(
      paths.map(async path => {
        const fees = await this.calculateFees(path, amount);
        const duration = await this.estimateDuration(path);
        const reliability = await this.getReliabilityScore(path);
        
        const score = this.calculateScore(
          fees,
          duration,
          reliability,
          preferences
        );
        
        return { path, score, fees, duration, reliability };
      })
    );
    
    return scoredPaths.sort((a, b) => b.score - a.score)[0];
  }
  
  private calculateScore(
    fees: string,
    duration: number,
    reliability: number,
    preferences: RoutePreferences
  ): number {
    const feeScore = (1 / parseFloat(fees)) * preferences.feeWeight;
    const speedScore = (1 / duration) * preferences.speedWeight;
    const reliabilityScore = reliability * preferences.reliabilityWeight;
    
    return feeScore + speedScore + reliabilityScore;
  }
}
```

## Security & MEV Protection

### Commit-Reveal Scheme

```typescript
class SecretManager {
  generateCommitment(): { secret: string; commitment: string } {
    const secret = crypto.randomBytes(32).toString('hex');
    const commitment = crypto
      .createHash('sha256')
      .update(Buffer.from(secret, 'hex'))
      .digest('hex');
      
    return { secret, commitment };
  }
  
  verifyReveal(secret: string, commitment: string): boolean {
    const computedCommitment = crypto
      .createHash('sha256')
      .update(Buffer.from(secret, 'hex'))
      .digest('hex');
      
    return computedCommitment === commitment;
  }
}
```

### MEV Protection

```typescript
class MEVProtection {
  async submitWithPrivateMempool(
    transaction: Transaction
  ): Promise<TransactionResponse> {
    // Use flashbots or similar private mempool
    return await this.flashbotsRelay.sendTransaction(transaction);
  }
  
  async useTimelockedSubmission(
    transaction: Transaction,
    delay: number
  ): Promise<void> {
    // Submit transaction with future execution time
    setTimeout(async () => {
      await this.submitTransaction(transaction);
    }, delay);
  }
}
