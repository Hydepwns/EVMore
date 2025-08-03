export interface SwapOrder {
  id: string;
  orderId: string; // On-chain order ID
  status: SwapStatus;
  source: SwapEndpoint;
  destination: SwapEndpoint;
  amount: SwapAmount;
  timelock: TimelockConfig;
  secret: SecretPair;
  metadata: SwapMetadata;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
}

export enum SwapStatus {
  PENDING = 'pending',
  LOCKED = 'locked',
  COMMITTED = 'committed',
  REVEALED = 'revealed',
  COMPLETED = 'completed',
  REFUNDED = 'refunded',
  FAILED = 'failed',
  EXPIRED = 'expired'
}

export interface SwapEndpoint {
  chainId: string;
  address: string;
  tokenAddress?: string; // For ERC20/Ethereum
  tokenDenom?: string;   // For Cosmos
}

export interface SwapAmount {
  value: string; // BigNumber string
  decimals: number;
  displayValue: string;
  usdValue?: string;
  symbol: string;
}

export interface TimelockConfig {
  startTime: number;
  duration: number;
  expiryTime: number;
  buffer: number;
}

export interface SecretPair {
  hash: string;
  preimage?: string;
  algorithm: 'sha256' | 'keccak256';
}

export interface SwapMetadata {
  sourceTransaction?: string;
  targetTransaction?: string;
  relayerSignature?: string;
  fees?: SwapFees;
  route?: SwapRoute[];
  estimatedGas?: string;
  actualGas?: string;
  notes?: string;
}

export interface SwapFees {
  networkFee: string;
  protocolFee: string;
  relayerFee: string;
  total: string;
}

export interface SwapRoute {
  hopIndex: number;
  fromChain: string;
  toChain: string;
  fromToken: string;
  toToken: string;
  expectedAmount: string;
  minimumAmount: string;
  poolId?: string;
  dexRoute?: DexRoute;
}

export interface DexRoute {
  poolId: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOut: string;
  priceImpact: number;
}

export interface SwapQuote {
  fromAmount: string;
  toAmount: string;
  minimumReceived: string;
  priceImpact: number;
  estimatedGas: string;
  route: SwapRoute[];
  fees: SwapFees;
  estimatedExecutionTime: number;
  slippageTolerance: number;
  deadline: number;
}

export interface CrossChainSwapParams {
  fromChain: string;
  toChain: string;
  fromToken: string;
  toToken: string;
  fromAmount: string;
  toAddress: string;
  slippageTolerance?: number;
  deadline?: number;
  metadata?: Record<string, any>;
}

// Note: HTLCOrder legacy type moved to migration/type-aliases.ts

export interface HTLCDetails {
  htlcId: string;
  sender: string;
  receiver: string;
  token: string;
  amount: string;
  hashlock: string;
  timelock: number;
  withdrawn: boolean;
  refunded: boolean;
  targetChain: string;
  targetAddress: string;
  swapParams?: {
    routes: SwapRoute[];
    minOutputAmount: string;
    slippageTolerance: number;
  };
  swapExecuted?: boolean;
}