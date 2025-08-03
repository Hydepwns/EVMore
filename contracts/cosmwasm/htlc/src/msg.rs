use cosmwasm_schema::{cw_serde, QueryResponses};
use cosmwasm_std::Coin;
use crate::dex::{SwapParams, PriceQueryResponse, SwapEstimateResponse};

#[cw_serde]
pub struct InstantiateMsg {
    pub admin: Option<String>,
}

#[cw_serde]
pub enum ExecuteMsg {
    CreateHtlc {
        receiver: String,
        hashlock: String, // hex encoded hash
        timelock: u64,    // unix timestamp
        target_chain: String,
        target_address: String,
    },
    Withdraw {
        htlc_id: String,
        secret: String, // hex encoded secret
    },
    Refund {
        htlc_id: String,
    },
    CreateHtlcWithSwap {
        receiver: String,
        hashlock: String,
        timelock: u64,
        target_chain: String,
        target_address: String,
        swap_params: SwapParams,
    },
    ExecuteSwapAndLock {
        htlc_id: String,
        swap_params: SwapParams,
    },
}

#[cw_serde]
#[derive(QueryResponses)]
pub enum QueryMsg {
    #[returns(HtlcResponse)]
    GetHtlc { htlc_id: String },
    
    #[returns(ListHtlcsResponse)]
    ListHtlcs {
        start_after: Option<String>,
        limit: Option<u32>,
    },
    
    #[returns(PriceQueryResponse)]
    QuerySpotPrice {
        pool_id: u64,
        base_denom: String,
        quote_denom: String,
    },
    
    #[returns(SwapEstimateResponse)]
    EstimateSwap {
        token_in: Coin,
        routes: Vec<crate::dex::SwapRoute>,
    },
}

#[cw_serde]
pub struct HtlcResponse {
    pub id: String,
    pub sender: String,
    pub receiver: String,
    pub amount: Vec<Coin>,
    pub hashlock: String,
    pub timelock: u64,
    pub withdrawn: bool,
    pub refunded: bool,
    pub target_chain: String,
    pub target_address: String,
    pub swap_params: Option<SwapParams>,
    pub swap_executed: bool,
}

#[cw_serde]
pub struct ListHtlcsResponse {
    pub htlcs: Vec<HtlcResponse>,
}