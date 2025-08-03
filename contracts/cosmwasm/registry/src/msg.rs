use cosmwasm_schema::{cw_serde, QueryResponses};
use cosmwasm_std::Addr;

#[cw_serde]
pub struct InstantiateMsg {
    pub admin: Option<String>,
}

#[cw_serde]
pub enum ExecuteMsg {
    RegisterChain {
        chain_info: ChainInfo,
    },
    UpdateChain {
        chain_id: String,
        chain_info: ChainInfo,
    },
    RegisterIBCPath {
        path: IBCPath,
    },
    UpdateIBCPath {
        path_id: String,
        path: IBCPath,
    },
    RemoveChain {
        chain_id: String,
    },
    RemoveIBCPath {
        path_id: String,
    },
    UpdateAdmin {
        new_admin: String,
    },
}

#[cw_serde]
#[derive(QueryResponses)]
pub enum QueryMsg {
    #[returns(ChainInfoResponse)]
    GetChain { chain_id: String },
    
    #[returns(ListChainsResponse)]
    ListChains {
        start_after: Option<String>,
        limit: Option<u32>,
    },
    
    #[returns(IBCPathResponse)]
    GetIBCPath {
        source_chain: String,
        dest_chain: String,
    },
    
    #[returns(ListIBCPathsResponse)]
    ListIBCPaths {
        chain_id: Option<String>,
        start_after: Option<String>,
        limit: Option<u32>,
    },
    
    #[returns(ConfigResponse)]
    GetConfig {},
    
    #[returns(RouteResponse)]
    FindRoute {
        source_chain: String,
        dest_chain: String,
        max_hops: Option<u32>,
    },
}

#[cw_serde]
pub struct ChainInfo {
    pub chain_id: String,
    pub chain_name: String,
    pub chain_type: ChainType,
    pub native_denom: String,
    pub prefix: String,
    pub gas_price: String,
    pub htlc_contract: Option<String>,
    pub router_contract: Option<String>,
    pub active: bool,
    pub metadata: ChainMetadata,
}

#[cw_serde]
pub enum ChainType {
    Cosmos,
    Ethereum,
    Other(String),
}

#[cw_serde]
pub struct ChainMetadata {
    pub rpc_endpoints: Vec<String>,
    pub rest_endpoints: Vec<String>,
    pub explorer_url: Option<String>,
    pub logo_url: Option<String>,
    pub block_time_seconds: u64,
}

#[cw_serde]
pub struct IBCPath {
    pub path_id: String,
    pub source_chain: String,
    pub dest_chain: String,
    pub source_channel: String,
    pub dest_channel: String,
    pub source_port: String,
    pub dest_port: String,
    pub order: IBCOrder,
    pub version: String,
    pub active: bool,
    pub fee_info: Option<FeeInfo>,
}

#[cw_serde]
pub enum IBCOrder {
    Ordered,
    Unordered,
}

#[cw_serde]
pub struct FeeInfo {
    pub fee_denom: String,
    pub fee_amount: String,
    pub gas_limit: u64,
}

#[cw_serde]
pub struct ConfigResponse {
    pub admin: Addr,
    pub chain_count: u64,
    pub path_count: u64,
}

#[cw_serde]
pub struct ChainInfoResponse {
    pub chain: ChainInfo,
}

#[cw_serde]
pub struct ListChainsResponse {
    pub chains: Vec<ChainInfo>,
}

#[cw_serde]
pub struct IBCPathResponse {
    pub path: IBCPath,
}

#[cw_serde]
pub struct ListIBCPathsResponse {
    pub paths: Vec<IBCPath>,
}

#[cw_serde]
pub struct RouteResponse {
    pub routes: Vec<Vec<IBCPath>>,
    pub shortest_path_length: u32,
}