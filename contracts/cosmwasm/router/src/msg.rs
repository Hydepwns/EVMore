use cosmwasm_schema::{cw_serde, QueryResponses};
use cosmwasm_std::{Coin, Decimal, Uint128};
use fusion_plus::ProtocolConfig;

#[cw_serde]
pub struct InstantiateMsg {
    pub admin: Option<String>,
    pub supported_chains: Vec<ChainConfig>,
    pub registry_contract: Option<String>,
    /// Optional protocol configuration override
    pub protocol_config: Option<ProtocolConfig>,
}

#[cw_serde]
pub struct ChainConfig {
    pub chain_id: String,
    pub chain_prefix: String,
    pub ibc_channel: String,
    pub native_denom: String,
}

#[cw_serde]
pub enum ExecuteMsg {
    UpdateChainConfig {
        chain_id: String,
        config: ChainConfig,
    },
    RegisterPool {
        pool_info: PoolInfo,
    },
    UpdatePoolInfo {
        pool_id: u64,
        pool_info: PoolInfo,
    },
    ExecuteMultiHopSwap {
        routes: Vec<HopRoute>,
        min_output: Uint128,
        timeout_timestamp: u64,
    },
    RegisterRouter {
        chain_id: String,
        router_address: String,
    },
    RemoveRouter {
        chain_id: String,
    },
    UpdateRegistryContract {
        registry_contract: Option<String>,
    },
}

#[cw_serde]
#[derive(QueryResponses)]
pub enum QueryMsg {
    #[returns(ConfigResponse)]
    GetConfig {},
    
    #[returns(ChainConfigResponse)]
    GetChainConfig { chain_id: String },
    
    #[returns(PoolInfoResponse)]
    GetPoolInfo { pool_id: u64 },
    
    #[returns(RouteResponse)]
    FindBestRoute {
        start_denom: String,
        end_denom: String,
        amount_in: Uint128,
        max_hops: Option<u32>,
    },
    
    #[returns(EstimateResponse)]
    EstimateMultiHopSwap {
        routes: Vec<HopRoute>,
        amount_in: Uint128,
    },
}

#[cw_serde]
pub struct PoolInfo {
    pub pool_id: u64,
    pub chain_id: String,
    pub pool_type: PoolType,
    pub token_denoms: Vec<String>,
    pub liquidity: Vec<Coin>,
    pub swap_fee: Decimal,
    pub exit_fee: Decimal,
}

#[cw_serde]
pub enum PoolType {
    Balancer,
    StableSwap,
    ConcentratedLiquidity,
}

#[cw_serde]
pub struct HopRoute {
    pub chain_id: String,
    pub pool_id: u64,
    pub token_in_denom: String,
    pub token_out_denom: String,
}

#[cw_serde]
pub struct ConfigResponse {
    pub admin: String,
    pub supported_chains: Vec<ChainConfig>,
}

#[cw_serde]
pub struct ChainConfigResponse {
    pub config: ChainConfig,
}

#[cw_serde]
pub struct PoolInfoResponse {
    pub pool_info: PoolInfo,
}

#[cw_serde]
pub struct RouteResponse {
    pub routes: Vec<Vec<HopRoute>>,
    pub estimated_output: Uint128,
    pub total_fees: Decimal,
    pub price_impact: Decimal,
}

#[cw_serde]
pub struct EstimateResponse {
    pub amount_out: Uint128,
    pub price_impact: Decimal,
    pub route_fees: Vec<RouteFee>,
}

#[cw_serde]
pub struct IbcPacketData {
    pub sender: String,
    pub receiver: String,
    pub denom: String,
    pub amount: Uint128,
    pub memo: Option<String>,
}

#[cw_serde]
pub struct SwapInstruction {
    pub pool_id: u64,
    pub token_out_denom: String,
    pub min_output: Option<Uint128>,
    pub forward: Option<ForwardInstruction>,
}

#[cw_serde]
pub struct ForwardInstruction {
    pub port: String,
    pub channel: String,
    pub receiver: String,
    pub timeout: u64,
    pub retries: u8,
    pub next: Option<Box<SwapInstruction>>,
}

#[cw_serde]
pub struct RouteFee {
    pub chain_id: String,
    pub pool_id: u64,
    pub fee_amount: Uint128,
    pub fee_denom: String,
}