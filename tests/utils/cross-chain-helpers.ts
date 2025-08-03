import { ethers } from 'ethers';
import { SigningCosmWasmClient } from '@cosmjs/cosmwasm-stargate';
import { generateSecret, hashSecret } from '@evmore/utils';

export interface CrossChainSwapParams {
  sourceChain: 'ethereum' | 'osmosis' | 'cosmoshub' | 'juno';
  targetChain: 'ethereum' | 'osmosis' | 'cosmoshub' | 'juno';
  amount: string;
  asset: string;
  sender: string;
  recipient: string;
  timelock?: number;
}

export interface HTLCParams {
  secretHash: string;
  amount: string;
  recipient: string;
  timelock: number;
  token?: string; // For ERC20 tokens
}

export class CrossChainTestHelpers {
  static generateSecret(): { secret: string; secretHash: string } {
    const secret = generateSecret();
    const secretHash = hashSecret(secret);
    
    return {
      secret,
      secretHash,
    };
  }
  
  static calculateTimelock(baseTime: number, chain: string): number {
    // Different timelocks for different chains
    const timelockDurations = {
      ethereum: 48 * 60 * 60, // 48 hours
      osmosis: 24 * 60 * 60,  // 24 hours
      cosmoshub: 24 * 60 * 60, // 24 hours
      juno: 24 * 60 * 60,     // 24 hours
    };
    
    return baseTime + (timelockDurations[chain] || 24 * 60 * 60);
  }
  
  static async waitForTransaction(
    txHash: string,
    chain: string,
    provider: ethers.providers.Provider | SigningCosmWasmClient
  ): Promise<any> {
    if (chain === 'ethereum') {
      const ethProvider = provider as ethers.providers.Provider;
      const receipt = await ethProvider.waitForTransaction(txHash);
      if (receipt.status === 0) {
        throw new Error('Ethereum transaction failed');
      }
      return receipt;
    } else {
      const cosmosClient = provider as SigningCosmWasmClient;
      // Poll for transaction
      let attempts = 0;
      while (attempts < 30) {
        try {
          const tx = await cosmosClient.getTx(txHash);
          if (tx) {
            if (tx.code !== 0) {
              throw new Error(`Cosmos transaction failed with code ${tx.code}`);
            }
            return tx;
          }
        } catch (error) {
          // Transaction not found yet
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
        attempts++;
      }
      throw new Error('Transaction not found after 30 seconds');
    }
  }
  
  static async getBlockTime(
    chain: string,
    provider: ethers.providers.Provider | SigningCosmWasmClient
  ): Promise<number> {
    if (chain === 'ethereum') {
      const ethProvider = provider as ethers.providers.Provider;
      const block = await ethProvider.getBlock('latest');
      return block.timestamp;
    } else {
      const cosmosClient = provider as SigningCosmWasmClient;
      const block = await cosmosClient.getBlock();
      return Math.floor(new Date(block.header.time).getTime() / 1000);
    }
  }
  
  static formatAmount(amount: string, decimals: number): string {
    if (decimals === 18) {
      return ethers.utils.parseEther(amount).toString();
    } else if (decimals === 6) {
      return ethers.utils.parseUnits(amount, 6).toString();
    }
    return ethers.utils.parseUnits(amount, decimals).toString();
  }
  
  static async verifyHTLCState(
    htlcAddress: string,
    swapId: string,
    chain: string,
    provider: any
  ): Promise<{
    exists: boolean;
    amount: string;
    recipient: string;
    secretHash: string;
    timelock: number;
    withdrawn: boolean;
    refunded: boolean;
  }> {
    if (chain === 'ethereum') {
      // Query Ethereum HTLC contract
      const htlc = new ethers.Contract(
        htlcAddress,
        ['function swaps(bytes32) view returns (tuple(bytes32 secretHash, uint256 amount, address token, address sender, address recipient, uint256 timelock, bool withdrawn, bool refunded))'],
        provider
      );
      
      const swap = await htlc.swaps(swapId);
      return {
        exists: swap.amount.gt(0),
        amount: swap.amount.toString(),
        recipient: swap.recipient,
        secretHash: swap.secretHash,
        timelock: swap.timelock.toNumber(),
        withdrawn: swap.withdrawn,
        refunded: swap.refunded,
      };
    } else {
      // Query CosmWasm HTLC contract
      const client = provider as SigningCosmWasmClient;
      try {
        const result = await client.queryContractSmart(htlcAddress, {
          get_swap: { id: swapId },
        });
        
        return {
          exists: true,
          amount: result.amount,
          recipient: result.recipient,
          secretHash: result.secret_hash,
          timelock: result.timelock,
          withdrawn: result.withdrawn,
          refunded: result.refunded,
        };
      } catch (error) {
        return {
          exists: false,
          amount: '0',
          recipient: '',
          secretHash: '',
          timelock: 0,
          withdrawn: false,
          refunded: false,
        };
      }
    }
  }
  
  static async simulateDelay(seconds: number): Promise<void> {
    if (process.env.FAST_FORWARD === 'true') {
      // In test environment, we might use time manipulation
      console.log(`Fast-forwarding ${seconds} seconds`);
      // Implementation depends on test environment setup
    } else {
      await new Promise(resolve => setTimeout(resolve, seconds * 1000));
    }
  }
  
  static validateRoute(route: string[]): void {
    if (route.length < 2) {
      throw new Error('Route must have at least 2 chains');
    }
    
    if (route.length > 5) {
      throw new Error('Route cannot have more than 5 hops for safety');
    }
    
    // Check for duplicates (except for round trips)
    const uniqueChains = new Set(route);
    if (uniqueChains.size < route.length - 1) {
      throw new Error('Route contains unnecessary loops');
    }
  }
  
  static calculateRouteFees(route: string[], amount: string): string {
    // Simplified fee calculation for testing
    const feePerHop = 0.001; // 0.1%
    const relayerFeePerHop = '1000000'; // Fixed relayer fee
    
    let totalAmount = ethers.BigNumber.from(amount);
    let totalFees = ethers.BigNumber.from(0);
    
    for (let i = 0; i < route.length - 1; i++) {
      const hopFee = totalAmount.mul(feePerHop * 1000).div(1000);
      const relayerFee = ethers.BigNumber.from(relayerFeePerHop);
      totalFees = totalFees.add(hopFee).add(relayerFee);
    }
    
    return totalFees.toString();
  }
}