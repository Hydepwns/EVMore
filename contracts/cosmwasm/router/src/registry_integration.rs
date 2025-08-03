use cosmwasm_std::{Deps, StdResult, StdError, WasmQuery, QueryRequest, to_json_binary};
use serde::{Deserialize, Serialize};

/// ChainInfo structure from registry contract
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
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

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub enum ChainType {
    Cosmos,
    Ethereum,
    Other(String),
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct ChainMetadata {
    pub rpc_endpoints: Vec<String>,
    pub rest_endpoints: Vec<String>,
    pub explorer_url: Option<String>,
    pub logo_url: Option<String>,
    pub block_time_seconds: u64,
}

/// Query message for registry contract
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RegistryQueryMsg {
    GetChain { chain_id: String },
}

/// Response from registry contract
#[derive(Serialize, Deserialize)]
pub struct ChainInfoResponse {
    pub chain: ChainInfo,
}

/// Query the chain registry for router address
pub fn query_router_address_from_registry(
    deps: Deps,
    registry_contract: &str,
    chain_id: &str,
) -> StdResult<String> {
    // Query the registry contract
    let query_msg = RegistryQueryMsg::GetChain {
        chain_id: chain_id.to_string(),
    };
    
    let query = QueryRequest::Wasm(WasmQuery::Smart {
        contract_addr: registry_contract.to_string(),
        msg: to_json_binary(&query_msg)?,
    });
    
    let response: ChainInfoResponse = deps.querier.query(&query)?;
    
    // Check if chain is active
    if !response.chain.active {
        return Err(StdError::generic_err(format!("Chain {} is not active", chain_id)));
    }
    
    // Get router address
    response.chain.router_contract
        .ok_or_else(|| StdError::generic_err(format!("No router registered for chain {}", chain_id)))
}

/// Helper function to validate chain is supported
pub fn is_chain_supported(
    deps: Deps,
    registry_contract: &str,
    chain_id: &str,
) -> StdResult<bool> {
    match query_router_address_from_registry(deps, registry_contract, chain_id) {
        Ok(_) => Ok(true),
        Err(_) => Ok(false),
    }
}