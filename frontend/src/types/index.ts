export interface Chain {
  id: string;
  name: string;
  type: 'ethereum' | 'cosmos';
  icon: string;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  rpcUrl: string;
  chainId: string | number;
  blockExplorer: string;
}

export interface Token {
  symbol: string;
  name: string;
  decimals: number;
  address: string;
  icon: string;
}

export interface SwapParams {
  fromChain: Chain;
  toChain: Chain;
  fromToken: Token;
  toToken: Token;
  amount: string;
  recipientAddress?: string;
  partialFillEnabled?: boolean;
  partialFillAmount?: string;
}

export interface PartialFillParams {
  originalOrderId: string;
  amount: string;
  percentage: number;
}

export interface SwapTransaction {
  id: string;
  fromChain: Chain;
  toChain: Chain;
  fromToken: Token;
  toToken: Token;
  amount: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  txHash?: string;
  partialFills?: PartialFillOrder[];
}

export interface PartialFillOrder {
  id: string;
  originalOrderId: string;
  amount: string;
  fillPercentage: number;
  status: string;
  createdAt: Date;
  executedAt?: Date;
  remainingAmount?: string;
}

export interface WalletState {
  ethereum: {
    isConnected: boolean;
    address: string | null;
    balance: string | null;
  };
  cosmos: {
    isConnected: boolean;
    address: string | null;
    balance: string | null;
  };
}