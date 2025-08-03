import { ethers } from 'ethers';
import { SigningCosmWasmClient } from '@cosmjs/cosmwasm-stargate';
import { CrossChainTestHelpers } from './cross-chain-helpers';

export interface HTLCTestContext {
  sourceChain: string;
  targetChain: string;
  htlcAddresses: {
    source: string;
    target: string;
  };
  accounts: {
    alice: any; // Sender
    bob: any;   // Recipient
  };
  providers: {
    source: any;
    target: any;
  };
}

export class HTLCTestHelpers {
  static async createHTLCPair(
    context: HTLCTestContext,
    amount: string,
    asset: string,
    timelock?: number
  ): Promise<{
    sourceSwapId: string;
    targetSwapId: string;
    secret: string;
    secretHash: string;
    timelock: number;
  }> {
    const { secret, secretHash } = CrossChainTestHelpers.generateSecret();
    
    // Calculate appropriate timelocks
    const currentTime = await this.getCurrentTime(context.sourceChain, context.providers.source);
    const sourceTimelock = timelock || CrossChainTestHelpers.calculateTimelock(currentTime, context.sourceChain);
    const targetTimelock = sourceTimelock - 3600; // Target timelock is 1 hour less
    
    // Create HTLC on source chain
    const sourceSwapId = await this.createHTLC(
      context.sourceChain,
      context.htlcAddresses.source,
      {
        secretHash,
        amount,
        recipient: context.accounts.bob.address,
        timelock: sourceTimelock,
        token: asset,
      },
      context.providers.source,
      context.accounts.alice
    );
    
    // Simulate relayer creating corresponding HTLC on target chain
    const targetSwapId = await this.createHTLC(
      context.targetChain,
      context.htlcAddresses.target,
      {
        secretHash,
        amount: this.adjustAmountForChain(amount, context.targetChain),
        recipient: context.accounts.bob.address,
        timelock: targetTimelock,
        token: this.translateAsset(asset, context.targetChain),
      },
      context.providers.target,
      context.accounts.alice
    );
    
    return {
      sourceSwapId,
      targetSwapId,
      secret,
      secretHash,
      timelock: sourceTimelock,
    };
  }
  
  static async createHTLC(
    chain: string,
    htlcAddress: string,
    params: any,
    provider: any,
    sender: any
  ): Promise<string> {
    if (chain === 'ethereum') {
      // Ethereum HTLC creation
      const htlc = new ethers.Contract(
        htlcAddress,
        [
          'function createSwap(bytes32 _secretHash, address _recipient, string memory _cosmosRecipient, uint256 _timelock) external payable returns (bytes32)',
        ],
        sender
      );
      
      const tx = await htlc.createSwap(
        params.secretHash,
        params.recipient,
        params.cosmosRecipient || '',
        params.timelock,
        { value: ethers.utils.parseEther(params.amount) }
      );
      
      const receipt = await tx.wait();
      
      // Extract swap ID from events
      const event = receipt.events?.find(e => e.event === 'SwapCreated');
      return event?.args?.swapId || ethers.utils.keccak256(ethers.utils.toUtf8Bytes('test'));
    } else {
      // Cosmos HTLC creation
      const client = provider as SigningCosmWasmClient;
      const senderAddress = await sender.getAddress();
      
      const msg = {
        create_swap: {
          secret_hash: params.secretHash,
          recipient: params.recipient,
          eth_recipient: params.ethRecipient || '',
          timelock: params.timelock,
        },
      };
      
      const funds = [{
        denom: params.token || 'uosmo',
        amount: params.amount,
      }];
      
      const result = await client.execute(
        senderAddress,
        htlcAddress,
        msg,
        'auto',
        '',
        funds
      );
      
      // Extract swap ID from events
      const event = result.events.find(e => 
        e.type === 'wasm' && 
        e.attributes.some(a => a.key === 'action' && a.value === 'create_swap')
      );
      
      const swapIdAttr = event?.attributes.find(a => a.key === 'swap_id');
      return swapIdAttr?.value || `swap_${Date.now()}`;
    }
  }
  
  static async withdrawHTLC(
    chain: string,
    htlcAddress: string,
    swapId: string,
    secret: string,
    provider: any,
    withdrawer: any
  ): Promise<any> {
    if (chain === 'ethereum') {
      const htlc = new ethers.Contract(
        htlcAddress,
        ['function withdraw(bytes32 _swapId, bytes32 _secret) external'],
        withdrawer
      );
      
      const tx = await htlc.withdraw(swapId, secret);
      return await tx.wait();
    } else {
      const client = provider as SigningCosmWasmClient;
      const withdrawerAddress = await withdrawer.getAddress();
      
      const msg = {
        withdraw: {
          id: swapId,
          secret: secret,
        },
      };
      
      return await client.execute(
        withdrawerAddress,
        htlcAddress,
        msg,
        'auto'
      );
    }
  }
  
  static async refundHTLC(
    chain: string,
    htlcAddress: string,
    swapId: string,
    provider: any,
    refunder: any
  ): Promise<any> {
    if (chain === 'ethereum') {
      const htlc = new ethers.Contract(
        htlcAddress,
        ['function refund(bytes32 _swapId) external'],
        refunder
      );
      
      const tx = await htlc.refund(swapId);
      return await tx.wait();
    } else {
      const client = provider as SigningCosmWasmClient;
      const refunderAddress = await refunder.getAddress();
      
      const msg = {
        refund: {
          id: swapId,
        },
      };
      
      return await client.execute(
        refunderAddress,
        htlcAddress,
        msg,
        'auto'
      );
    }
  }
  
  static async executeAtomicSwap(
    context: HTLCTestContext,
    swapIds: { source: string; target: string },
    secret: string
  ): Promise<{
    targetWithdrawTx: any;
    sourceWithdrawTx: any;
  }> {
    // Step 1: Bob withdraws on target chain revealing the secret
    const targetWithdrawTx = await this.withdrawHTLC(
      context.targetChain,
      context.htlcAddresses.target,
      swapIds.target,
      secret,
      context.providers.target,
      context.accounts.bob
    );
    
    // Step 2: Alice uses the revealed secret to withdraw on source chain
    const sourceWithdrawTx = await this.withdrawHTLC(
      context.sourceChain,
      context.htlcAddresses.source,
      swapIds.source,
      secret,
      context.providers.source,
      context.accounts.alice
    );
    
    return {
      targetWithdrawTx,
      sourceWithdrawTx,
    };
  }
  
  static async waitForTimelock(
    chain: string,
    htlcAddress: string,
    swapId: string,
    provider: any
  ): Promise<void> {
    const swap = await CrossChainTestHelpers.verifyHTLCState(
      htlcAddress,
      swapId,
      chain,
      provider
    );
    
    const currentTime = await this.getCurrentTime(chain, provider);
    const waitTime = swap.timelock - currentTime;
    
    if (waitTime > 0) {
      console.log(`Waiting ${waitTime} seconds for timelock to expire...`);
      await CrossChainTestHelpers.simulateDelay(waitTime + 5); // Add 5 second buffer
    }
  }
  
  private static async getCurrentTime(chain: string, provider: any): Promise<number> {
    return CrossChainTestHelpers.getBlockTime(chain, provider);
  }
  
  private static adjustAmountForChain(amount: string, chain: string): string {
    // Adjust decimals based on chain
    const decimals = {
      ethereum: 18,
      osmosis: 6,
      cosmoshub: 6,
      juno: 6,
      secret: 6,
    };
    
    // This is simplified - real implementation would handle decimal conversion
    return amount;
  }
  
  private static translateAsset(asset: string, chain: string): string {
    // Translate asset names between chains
    const assetMap = {
      'ETH': {
        osmosis: 'ibc/...',  // IBC denom for ETH on Osmosis
        cosmoshub: 'ibc/...', // IBC denom for ETH on Cosmos Hub
      },
      'USDC': {
        osmosis: 'ibc/...',
        juno: 'ibc/...',
      },
    };
    
    return assetMap[asset]?.[chain] || asset;
  }
  
  static generateTestScenarios(): Array<{
    name: string;
    source: string;
    target: string;
    amount: string;
    asset: string;
    shouldSucceed: boolean;
  }> {
    return [
      {
        name: 'Simple ETH to OSMO',
        source: 'ethereum',
        target: 'osmosis',
        amount: '1.0',
        asset: 'ETH',
        shouldSucceed: true,
      },
      {
        name: 'Large USDC transfer',
        source: 'ethereum',
        target: 'juno',
        amount: '10000',
        asset: 'USDC',
        shouldSucceed: true,
      },
      {
        name: 'Small amount test',
        source: 'osmosis',
        target: 'ethereum',
        amount: '0.001',
        asset: 'OSMO',
        shouldSucceed: true,
      },
      {
        name: 'Cross-chain arbitrage',
        source: 'ethereum',
        target: 'secret',
        amount: '500',
        asset: 'USDC',
        shouldSucceed: true,
      },
    ];
  }
}