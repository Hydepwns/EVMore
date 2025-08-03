use cosmwasm_std::{
    entry_point, to_json_binary, Binary, Deps, DepsMut, Env, MessageInfo,
    Response, StdResult, Order,
};
use cw2::set_contract_version;
use cw_storage_plus::Bound;
use std::collections::{HashSet, VecDeque};

use crate::error::ContractError;
use crate::msg::{
    ChainInfo, ChainInfoResponse, ConfigResponse, ExecuteMsg, IBCPath,
    IBCPathResponse, InstantiateMsg, ListChainsResponse, ListIBCPathsResponse,
    QueryMsg, RouteResponse,
};
use crate::state::{
    Config, CONFIG, CHAINS, IBC_PATHS, CHAIN_CONNECTIONS, CHAIN_COUNT, PATH_COUNT,
};

const CONTRACT_NAME: &str = "crates.io:fusion-registry";
const CONTRACT_VERSION: &str = env!("CARGO_PKG_VERSION");
const MAX_ROUTE_HOPS: u32 = 4;

#[cfg_attr(not(feature = "library"), entry_point)]
pub fn instantiate(
    deps: DepsMut,
    _env: Env,
    info: MessageInfo,
    msg: InstantiateMsg,
) -> Result<Response, ContractError> {
    let admin = msg
        .admin
        .map(|a| deps.api.addr_validate(&a))
        .transpose()?
        .unwrap_or_else(|| info.sender.clone());

    let config = Config {
        admin: admin.clone(),
    };

    set_contract_version(deps.storage, CONTRACT_NAME, CONTRACT_VERSION)?;
    CONFIG.save(deps.storage, &config)?;
    CHAIN_COUNT.save(deps.storage, &0u64)?;
    PATH_COUNT.save(deps.storage, &0u64)?;

    Ok(Response::new()
        .add_attribute("method", "instantiate")
        .add_attribute("admin", admin))
}

#[cfg_attr(not(feature = "library"), entry_point)]
pub fn execute(
    deps: DepsMut,
    _env: Env,
    info: MessageInfo,
    msg: ExecuteMsg,
) -> Result<Response, ContractError> {
    match msg {
        ExecuteMsg::RegisterChain { chain_info } => register_chain(deps, info, chain_info),
        ExecuteMsg::UpdateChain { chain_id, chain_info } => {
            update_chain(deps, info, chain_id, chain_info)
        }
        ExecuteMsg::RegisterIBCPath { path } => register_ibc_path(deps, info, path),
        ExecuteMsg::UpdateIBCPath { path_id, path } => {
            update_ibc_path(deps, info, path_id, path)
        }
        ExecuteMsg::RemoveChain { chain_id } => remove_chain(deps, info, chain_id),
        ExecuteMsg::RemoveIBCPath { path_id } => remove_ibc_path(deps, info, path_id),
        ExecuteMsg::UpdateAdmin { new_admin } => update_admin(deps, info, new_admin),
    }
}

fn register_chain(
    deps: DepsMut,
    info: MessageInfo,
    chain_info: ChainInfo,
) -> Result<Response, ContractError> {
    let config = CONFIG.load(deps.storage)?;
    if info.sender != config.admin {
        return Err(ContractError::Unauthorized {});
    }

    // Check if chain already exists
    if CHAINS.may_load(deps.storage, &chain_info.chain_id)?.is_some() {
        return Err(ContractError::ChainAlreadyExists {
            chain_id: chain_info.chain_id.clone(),
        });
    }

    // Validate chain info
    if chain_info.chain_id.is_empty() || chain_info.native_denom.is_empty() {
        return Err(ContractError::InvalidChainConfig {});
    }

    // Save chain info
    CHAINS.save(deps.storage, &chain_info.chain_id, &chain_info)?;
    
    // Increment chain count
    let count = CHAIN_COUNT.load(deps.storage)?;
    CHAIN_COUNT.save(deps.storage, &(count + 1))?;

    Ok(Response::new()
        .add_attribute("method", "register_chain")
        .add_attribute("chain_id", chain_info.chain_id))
}

fn update_chain(
    deps: DepsMut,
    info: MessageInfo,
    chain_id: String,
    chain_info: ChainInfo,
) -> Result<Response, ContractError> {
    let config = CONFIG.load(deps.storage)?;
    if info.sender != config.admin {
        return Err(ContractError::Unauthorized {});
    }

    // Check if chain exists
    if CHAINS.may_load(deps.storage, &chain_id)?.is_none() {
        return Err(ContractError::ChainNotFound { chain_id });
    }

    // Ensure chain_id matches
    if chain_id != chain_info.chain_id {
        return Err(ContractError::InvalidChainConfig {});
    }

    // Update chain info
    CHAINS.save(deps.storage, &chain_id, &chain_info)?;

    Ok(Response::new()
        .add_attribute("method", "update_chain")
        .add_attribute("chain_id", chain_id))
}

fn register_ibc_path(
    deps: DepsMut,
    info: MessageInfo,
    path: IBCPath,
) -> Result<Response, ContractError> {
    let config = CONFIG.load(deps.storage)?;
    if info.sender != config.admin {
        return Err(ContractError::Unauthorized {});
    }

    // Check if path already exists
    if IBC_PATHS.may_load(deps.storage, &path.path_id)?.is_some() {
        return Err(ContractError::PathAlreadyExists {
            path_id: path.path_id.clone(),
        });
    }

    // Verify both chains exist
    if CHAINS.may_load(deps.storage, &path.source_chain)?.is_none() {
        return Err(ContractError::ChainNotFound {
            chain_id: path.source_chain.clone(),
        });
    }
    if CHAINS.may_load(deps.storage, &path.dest_chain)?.is_none() {
        return Err(ContractError::ChainNotFound {
            chain_id: path.dest_chain.clone(),
        });
    }

    // Save IBC path
    IBC_PATHS.save(deps.storage, &path.path_id, &path)?;
    
    // Save connection mapping
    CHAIN_CONNECTIONS.save(
        deps.storage,
        (&path.source_chain, &path.dest_chain),
        &path.path_id,
    )?;
    
    // Also save reverse mapping for bidirectional paths
    CHAIN_CONNECTIONS.save(
        deps.storage,
        (&path.dest_chain, &path.source_chain),
        &path.path_id,
    )?;

    // Increment path count
    let count = PATH_COUNT.load(deps.storage)?;
    PATH_COUNT.save(deps.storage, &(count + 1))?;

    Ok(Response::new()
        .add_attribute("method", "register_ibc_path")
        .add_attribute("path_id", path.path_id)
        .add_attribute("source", path.source_chain)
        .add_attribute("dest", path.dest_chain))
}

fn update_ibc_path(
    deps: DepsMut,
    info: MessageInfo,
    path_id: String,
    path: IBCPath,
) -> Result<Response, ContractError> {
    let config = CONFIG.load(deps.storage)?;
    if info.sender != config.admin {
        return Err(ContractError::Unauthorized {});
    }

    // Check if path exists
    let old_path = IBC_PATHS.load(deps.storage, &path_id)?;

    // Ensure path_id matches
    if path_id != path.path_id {
        return Err(ContractError::InvalidPathConfig {});
    }

    // If chains changed, update connections
    if old_path.source_chain != path.source_chain || old_path.dest_chain != path.dest_chain {
        // Remove old connections
        CHAIN_CONNECTIONS.remove(deps.storage, (&old_path.source_chain, &old_path.dest_chain));
        CHAIN_CONNECTIONS.remove(deps.storage, (&old_path.dest_chain, &old_path.source_chain));
        
        // Add new connections
        CHAIN_CONNECTIONS.save(
            deps.storage,
            (&path.source_chain, &path.dest_chain),
            &path_id,
        )?;
        CHAIN_CONNECTIONS.save(
            deps.storage,
            (&path.dest_chain, &path.source_chain),
            &path_id,
        )?;
    }

    // Update path
    IBC_PATHS.save(deps.storage, &path_id, &path)?;

    Ok(Response::new()
        .add_attribute("method", "update_ibc_path")
        .add_attribute("path_id", path_id))
}

fn remove_chain(
    deps: DepsMut,
    info: MessageInfo,
    chain_id: String,
) -> Result<Response, ContractError> {
    let config = CONFIG.load(deps.storage)?;
    if info.sender != config.admin {
        return Err(ContractError::Unauthorized {});
    }

    // Check if chain exists
    if CHAINS.may_load(deps.storage, &chain_id)?.is_none() {
        return Err(ContractError::ChainNotFound { chain_id: chain_id.clone() });
    }

    // Remove chain
    CHAINS.remove(deps.storage, &chain_id);
    
    // Decrement chain count
    let count = CHAIN_COUNT.load(deps.storage)?;
    CHAIN_COUNT.save(deps.storage, &(count.saturating_sub(1)))?;

    Ok(Response::new()
        .add_attribute("method", "remove_chain")
        .add_attribute("chain_id", chain_id))
}

fn remove_ibc_path(
    deps: DepsMut,
    info: MessageInfo,
    path_id: String,
) -> Result<Response, ContractError> {
    let config = CONFIG.load(deps.storage)?;
    if info.sender != config.admin {
        return Err(ContractError::Unauthorized {});
    }

    // Load path to get connections
    let path = IBC_PATHS.load(deps.storage, &path_id)?;

    // Remove path
    IBC_PATHS.remove(deps.storage, &path_id);
    
    // Remove connections
    CHAIN_CONNECTIONS.remove(deps.storage, (&path.source_chain, &path.dest_chain));
    CHAIN_CONNECTIONS.remove(deps.storage, (&path.dest_chain, &path.source_chain));
    
    // Decrement path count
    let count = PATH_COUNT.load(deps.storage)?;
    PATH_COUNT.save(deps.storage, &(count.saturating_sub(1)))?;

    Ok(Response::new()
        .add_attribute("method", "remove_ibc_path")
        .add_attribute("path_id", path_id))
}

fn update_admin(
    deps: DepsMut,
    info: MessageInfo,
    new_admin: String,
) -> Result<Response, ContractError> {
    let mut config = CONFIG.load(deps.storage)?;
    if info.sender != config.admin {
        return Err(ContractError::Unauthorized {});
    }

    config.admin = deps.api.addr_validate(&new_admin)?;
    CONFIG.save(deps.storage, &config)?;

    Ok(Response::new()
        .add_attribute("method", "update_admin")
        .add_attribute("new_admin", new_admin))
}

#[cfg_attr(not(feature = "library"), entry_point)]
pub fn query(deps: Deps, _env: Env, msg: QueryMsg) -> StdResult<Binary> {
    match msg {
        QueryMsg::GetChain { chain_id } => to_json_binary(&query_chain(deps, chain_id)?),
        QueryMsg::ListChains { start_after, limit } => {
            to_json_binary(&query_list_chains(deps, start_after, limit)?)
        }
        QueryMsg::GetIBCPath { source_chain, dest_chain } => {
            to_json_binary(&query_ibc_path(deps, source_chain, dest_chain)?)
        }
        QueryMsg::ListIBCPaths { chain_id, start_after, limit } => {
            to_json_binary(&query_list_ibc_paths(deps, chain_id, start_after, limit)?)
        }
        QueryMsg::GetConfig {} => to_json_binary(&query_config(deps)?),
        QueryMsg::FindRoute { source_chain, dest_chain, max_hops } => {
            to_json_binary(&query_find_route(deps, source_chain, dest_chain, max_hops)?)
        }
    }
}

fn query_chain(deps: Deps, chain_id: String) -> StdResult<ChainInfoResponse> {
    let chain = CHAINS.load(deps.storage, &chain_id)?;
    Ok(ChainInfoResponse { chain })
}

fn query_list_chains(
    deps: Deps,
    start_after: Option<String>,
    limit: Option<u32>,
) -> StdResult<ListChainsResponse> {
    let limit = limit.unwrap_or(10).min(100);
    let start = start_after.as_ref().map(|s| Bound::exclusive(s.as_str()));

    let chains: StdResult<Vec<ChainInfo>> = CHAINS
        .range(deps.storage, start, None, Order::Ascending)
        .take(limit as usize)
        .map(|item| item.map(|(_, chain)| chain))
        .collect();

    Ok(ListChainsResponse { chains: chains? })
}

fn query_ibc_path(
    deps: Deps,
    source_chain: String,
    dest_chain: String,
) -> StdResult<IBCPathResponse> {
    let path_id = CHAIN_CONNECTIONS.load(deps.storage, (&source_chain, &dest_chain))?;
    let path = IBC_PATHS.load(deps.storage, &path_id)?;
    Ok(IBCPathResponse { path })
}

fn query_list_ibc_paths(
    deps: Deps,
    chain_id: Option<String>,
    start_after: Option<String>,
    limit: Option<u32>,
) -> StdResult<ListIBCPathsResponse> {
    let limit = limit.unwrap_or(10).min(100);
    let start = start_after.as_ref().map(|s| Bound::exclusive(s.as_str()));

    let paths: StdResult<Vec<IBCPath>> = if let Some(chain_id) = chain_id {
        // Filter paths by chain
        IBC_PATHS
            .range(deps.storage, start, None, Order::Ascending)
            .take(limit as usize)
            .filter_map(|item| {
                item.ok().and_then(|(_, path)| {
                    if path.source_chain == chain_id || path.dest_chain == chain_id {
                        Some(Ok(path))
                    } else {
                        None
                    }
                })
            })
            .collect()
    } else {
        // Return all paths
        IBC_PATHS
            .range(deps.storage, start, None, Order::Ascending)
            .take(limit as usize)
            .map(|item| item.map(|(_, path)| path))
            .collect()
    };

    Ok(ListIBCPathsResponse { paths: paths? })
}

fn query_config(deps: Deps) -> StdResult<ConfigResponse> {
    let config = CONFIG.load(deps.storage)?;
    let chain_count = CHAIN_COUNT.load(deps.storage)?;
    let path_count = PATH_COUNT.load(deps.storage)?;
    
    Ok(ConfigResponse {
        admin: config.admin,
        chain_count,
        path_count,
    })
}

fn query_find_route(
    deps: Deps,
    source_chain: String,
    dest_chain: String,
    max_hops: Option<u32>,
) -> StdResult<RouteResponse> {
    let max_hops = max_hops.unwrap_or(MAX_ROUTE_HOPS).min(MAX_ROUTE_HOPS);
    
    // BFS to find all routes
    let mut routes = Vec::new();
    let mut visited = HashSet::new();
    let mut queue = VecDeque::new();
    
    // Start with source chain
    queue.push_back((source_chain.clone(), vec![]));
    visited.insert(source_chain.clone());
    
    while let Some((current_chain, path)) = queue.pop_front() {
        if path.len() >= max_hops as usize {
            continue;
        }
        
        // Find all connections from current chain
        let connections: Vec<_> = CHAIN_CONNECTIONS
            .prefix(&current_chain)
            .range(deps.storage, None, None, Order::Ascending)
            .filter_map(|item| item.ok())
            .collect();
        
        for (dest, path_id) in connections {
            // dest is the destination chain id
            
            if let Ok(ibc_path) = IBC_PATHS.load(deps.storage, &path_id) {
                if !ibc_path.active {
                    continue;
                }
                
                let mut new_path = path.clone();
                new_path.push(ibc_path.clone());
                
                if dest == dest_chain {
                    // Found a route
                    routes.push(new_path);
                } else if !visited.contains(&dest) && new_path.len() < max_hops as usize {
                    visited.insert(dest.clone());
                    queue.push_back((dest, new_path));
                }
            }
        }
    }
    
    let shortest_path_length = routes
        .iter()
        .map(|r| r.len() as u32)
        .min()
        .unwrap_or(0);
    
    Ok(RouteResponse {
        routes,
        shortest_path_length,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use cosmwasm_std::testing::{mock_dependencies, mock_env, mock_info};
    use crate::msg::{ChainType, ChainMetadata};

    #[test]
    fn test_instantiate() {
        let mut deps = mock_dependencies();
        let env = mock_env();
        let info = mock_info("admin", &[]);

        let msg = InstantiateMsg { admin: None };
        let res = instantiate(deps.as_mut(), env, info, msg).unwrap();
        assert_eq!(2, res.attributes.len());
    }

    #[test]
    fn test_register_chain() {
        let mut deps = mock_dependencies();
        let env = mock_env();
        let info = mock_info("admin", &[]);

        // Instantiate
        let msg = InstantiateMsg { admin: None };
        instantiate(deps.as_mut(), env.clone(), info.clone(), msg).unwrap();

        // Register chain
        let chain_info = ChainInfo {
            chain_id: "osmosis-1".to_string(),
            chain_name: "Osmosis".to_string(),
            chain_type: ChainType::Cosmos,
            native_denom: "uosmo".to_string(),
            prefix: "osmo".to_string(),
            gas_price: "0.025uosmo".to_string(),
            htlc_contract: Some("osmo1htlc...".to_string()),
            router_contract: Some("osmo1router...".to_string()),
            active: true,
            metadata: ChainMetadata {
                rpc_endpoints: vec!["https://rpc.osmosis.zone".to_string()],
                rest_endpoints: vec!["https://rest.osmosis.zone".to_string()],
                explorer_url: Some("https://mintscan.io/osmosis".to_string()),
                logo_url: None,
                block_time_seconds: 6,
            },
        };

        let msg = ExecuteMsg::RegisterChain { chain_info };
        let res = execute(deps.as_mut(), env, info, msg).unwrap();
        assert_eq!(res.attributes.len(), 2);
    }
}