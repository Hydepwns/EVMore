import { ethers } from 'ethers';

export class MockHTLCContract {
  private swaps: Map<string, any> = new Map();
  private events: any[] = [];
  
  constructor(private address: string) {}
  
  async createSwap(
    secretHash: string,
    recipient: string,
    cosmosRecipient: string,
    timelock: number,
    options?: { value?: ethers.BigNumber }
  ): Promise<any> {
    const swapId = ethers.utils.keccak256(
      ethers.utils.defaultAbiCoder.encode(
        ['bytes32', 'address', 'uint256'],
        [secretHash, recipient, Date.now()]
      )
    );
    
    const swap = {
      secretHash,
      amount: options?.value || ethers.BigNumber.from(0),
      token: ethers.constants.AddressZero,
      sender: '0x' + '11'.repeat(20),
      recipient,
      cosmosRecipient,
      timelock,
      withdrawn: false,
      refunded: false,
    };
    
    this.swaps.set(swapId, swap);
    
    this.events.push({
      event: 'SwapCreated',
      args: {
        swapId,
        secretHash,
        sender: swap.sender,
        recipient,
        amount: swap.amount,
        timelock,
      },
    });
    
    return {
      hash: '0x' + '99'.repeat(32),
      wait: async () => ({
        status: 1,
        events: [this.events[this.events.length - 1]],
      }),
    };
  }
  
  async withdraw(swapId: string, secret: string): Promise<any> {
    const swap = this.swaps.get(swapId);
    if (!swap) {
      throw new Error('Swap does not exist');
    }
    
    const secretHash = ethers.utils.keccak256(secret);
    if (secretHash !== swap.secretHash) {
      throw new Error('Invalid secret');
    }
    
    if (Date.now() / 1000 > swap.timelock) {
      throw new Error('Swap expired');
    }
    
    swap.withdrawn = true;
    
    this.events.push({
      event: 'SwapWithdrawn',
      args: {
        swapId,
        secret,
        recipient: swap.recipient,
      },
    });
    
    return {
      hash: '0x' + 'aa'.repeat(32),
      wait: async () => ({
        status: 1,
        events: [this.events[this.events.length - 1]],
      }),
    };
  }
  
  async refund(swapId: string): Promise<any> {
    const swap = this.swaps.get(swapId);
    if (!swap) {
      throw new Error('Swap does not exist');
    }
    
    if (Date.now() / 1000 <= swap.timelock) {
      throw new Error('Swap not expired');
    }
    
    swap.refunded = true;
    
    this.events.push({
      event: 'SwapRefunded',
      args: {
        swapId,
        sender: swap.sender,
      },
    });
    
    return {
      hash: '0x' + 'bb'.repeat(32),
      wait: async () => ({
        status: 1,
        events: [this.events[this.events.length - 1]],
      }),
    };
  }
  
  async swaps(swapId: string): Promise<any> {
    const swap = this.swaps.get(swapId);
    if (!swap) {
      return {
        secretHash: ethers.constants.HashZero,
        amount: ethers.BigNumber.from(0),
        token: ethers.constants.AddressZero,
        sender: ethers.constants.AddressZero,
        recipient: ethers.constants.AddressZero,
        timelock: ethers.BigNumber.from(0),
        withdrawn: false,
        refunded: false,
      };
    }
    return swap;
  }
  
  getEvents(): any[] {
    return this.events;
  }
  
  clearEvents(): void {
    this.events = [];
  }
}

export class MockCosmWasmClient {
  private contracts: Map<string, MockCosmWasmContract> = new Map();
  
  async execute(
    senderAddress: string,
    contractAddress: string,
    msg: any,
    fee: any,
    memo?: string,
    funds?: any[]
  ): Promise<any> {
    const contract = this.contracts.get(contractAddress);
    if (!contract) {
      throw new Error(`Contract ${contractAddress} not found`);
    }
    
    return contract.execute(senderAddress, msg, funds);
  }
  
  async queryContractSmart(contractAddress: string, query: any): Promise<any> {
    const contract = this.contracts.get(contractAddress);
    if (!contract) {
      throw new Error(`Contract ${contractAddress} not found`);
    }
    
    return contract.query(query);
  }
  
  async getTx(txHash: string): Promise<any> {
    // Mock transaction query
    return {
      code: 0,
      height: 12345,
      txhash: txHash,
      events: [],
    };
  }
  
  async getBlock(): Promise<any> {
    return {
      header: {
        time: new Date().toISOString(),
        height: 12345,
      },
    };
  }
  
  addContract(address: string, contract: MockCosmWasmContract): void {
    this.contracts.set(address, contract);
  }
  
  disconnect(): void {
    // Mock disconnect
  }
}

export class MockCosmWasmContract {
  private state: Map<string, any> = new Map();
  
  async execute(sender: string, msg: any, funds?: any[]): Promise<any> {
    if (msg.create_swap) {
      const swapId = `swap_${Date.now()}`;
      const swap = {
        id: swapId,
        secret_hash: msg.create_swap.secret_hash,
        sender,
        recipient: msg.create_swap.recipient,
        amount: funds?.[0]?.amount || '0',
        denom: funds?.[0]?.denom || 'uosmo',
        timelock: msg.create_swap.timelock,
        withdrawn: false,
        refunded: false,
      };
      
      this.state.set(swapId, swap);
      
      return {
        transactionHash: 'ABCD' + '00'.repeat(30),
        logs: [],
        height: 12345,
        events: [{
          type: 'wasm',
          attributes: [
            { key: 'action', value: 'create_swap' },
            { key: 'swap_id', value: swapId },
          ],
        }],
      };
    }
    
    if (msg.withdraw) {
      const swap = this.state.get(msg.withdraw.id);
      if (!swap) {
        throw new Error('Swap not found');
      }
      
      // Verify secret
      // In real implementation, would hash the secret and compare
      
      swap.withdrawn = true;
      
      return {
        transactionHash: 'EFGH' + '00'.repeat(30),
        logs: [],
        height: 12346,
        events: [{
          type: 'wasm',
          attributes: [
            { key: 'action', value: 'withdraw' },
            { key: 'swap_id', value: msg.withdraw.id },
          ],
        }],
      };
    }
    
    throw new Error('Unknown execute message');
  }
  
  async query(query: any): Promise<any> {
    if (query.get_swap) {
      const swap = this.state.get(query.get_swap.id);
      if (!swap) {
        throw new Error('Swap not found');
      }
      return swap;
    }
    
    if (query.list_swaps) {
      return {
        swaps: Array.from(this.state.values()),
      };
    }
    
    throw new Error('Unknown query');
  }
}