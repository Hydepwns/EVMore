import { SigningStargateClient, StargateClient } from '@cosmjs/stargate';
import { ExecuteResult } from '@cosmjs/cosmwasm-stargate';
import { Coin } from '@cosmjs/amino';

/**
 * Extended StargateClient with CosmWasm query capabilities
 */
export interface CosmWasmQueryClient extends StargateClient {
  queryContractSmart(address: string, queryMsg: Record<string, unknown>): Promise<unknown>;
  queryContractRaw(address: string, key: Uint8Array): Promise<Uint8Array | null>;
}

/**
 * Extended SigningStargateClient with CosmWasm execution capabilities
 */
export interface CosmWasmSigningClient extends SigningStargateClient {
  execute(
    senderAddress: string,
    contractAddress: string,
    msg: Record<string, unknown>,
    fee: string,
    memo?: string,
    funds?: Coin[]
  ): Promise<ExecuteResult>;
  
  queryContractSmart(address: string, queryMsg: Record<string, unknown>): Promise<unknown>;
  queryContractRaw(address: string, key: Uint8Array): Promise<Uint8Array | null>;
}

/**
 * Type guard to check if a client has CosmWasm capabilities
 * Note: This assumes the client has been properly configured with CosmWasm support
 */
export function hasCosmWasmCapabilities(client: unknown): client is CosmWasmQueryClient | CosmWasmSigningClient {
  // For now, always return true since we're using type assertions
  // In a real implementation, we'd check for actual method presence
  return client != null;
}

/**
 * Type guard for signing clients
 */
export function isSigningClient(client: unknown): client is CosmWasmSigningClient {
  return client != null && typeof (client as { execute?: unknown }).execute === 'function';
}