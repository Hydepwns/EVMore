use cosmwasm_std::{
    entry_point, to_json_binary, Binary, Deps, DepsMut, Env, MessageInfo,
    Response, StdResult, StdError, CosmosMsg, IbcMsg, IbcTimeout, Timestamp,
    Uint128, Decimal,
};
use cw2::set_contract_version;

use crate::error::ContractError;
use crate::msg::{
    ChainConfig, ChainConfigResponse, ConfigResponse, EstimateResponse, ExecuteMsg,
    HopRoute, InstantiateMsg, PoolInfo, PoolInfoResponse, QueryMsg, RouteResponse,
};
use crate::routing::{calculate_price_impact, estimate_multi_hop_swap, find_best_routes};
use crate::state::{Config, CONFIG, CHAIN_CONFIGS, POOL_PAIRS, POOL_REGISTRY, ROUTER_REGISTRY, 
                  save_protocol_config};
use crate::constants::{IBC_TIMEOUT_BUFFER};
use fusion_plus::ProtocolConfig;

const CONTRACT_NAME: &str = "crates.io:fusion-router";
const CONTRACT_VERSION: &str = env!("CARGO_PKG_VERSION");

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

    let registry_contract = msg.registry_contract
        .map(|a| deps.api.addr_validate(&a))
        .transpose()?;
    
    let config = Config {
        admin: admin.clone(),
        registry_contract,
    };

    set_contract_version(deps.storage, CONTRACT_NAME, CONTRACT_VERSION)?;
    CONFIG.save(deps.storage, &config)?;

    // Initialize protocol configuration
    let protocol_config = ProtocolConfig::with_override(msg.protocol_config);
    save_protocol_config(deps.storage, &protocol_config)?;

    // Save initial chain configurations
    for chain_config in msg.supported_chains {
        CHAIN_CONFIGS.save(deps.storage, &chain_config.chain_id, &chain_config)?;
    }

    Ok(Response::new()
        .add_attribute("method", "instantiate")
        .add_attribute("admin", admin))
}

#[cfg_attr(not(feature = "library"), entry_point)]
pub fn execute(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    msg: ExecuteMsg,
) -> Result<Response, ContractError> {
    match msg {
        ExecuteMsg::UpdateChainConfig { chain_id, config } => {
            update_chain_config(deps, info, chain_id, config)
        }
        ExecuteMsg::RegisterPool { pool_info } => register_pool(deps, info, pool_info),
        ExecuteMsg::UpdatePoolInfo { pool_id, pool_info } => {
            update_pool_info(deps, info, pool_id, pool_info)
        }
        ExecuteMsg::ExecuteMultiHopSwap {
            routes,
            min_output,
            timeout_timestamp,
        } => execute_multi_hop_swap(deps, env, info, routes, min_output, timeout_timestamp),
        ExecuteMsg::RegisterRouter { chain_id, router_address } => {
            register_router(deps, info, chain_id, router_address)
        }
        ExecuteMsg::RemoveRouter { chain_id } => {
            remove_router(deps, info, chain_id)
        }
        ExecuteMsg::UpdateRegistryContract { registry_contract } => {
            update_registry_contract(deps, info, registry_contract)
        }
    }
}

fn update_chain_config(
    deps: DepsMut,
    info: MessageInfo,
    chain_id: String,
    chain_config: ChainConfig,
) -> Result<Response, ContractError> {
    // Only admin can update chain configs
    let config = CONFIG.load(deps.storage)?;
    if info.sender != config.admin {
        return Err(ContractError::Unauthorized {});
    }

    CHAIN_CONFIGS.save(deps.storage, &chain_id, &chain_config)?;

    Ok(Response::new()
        .add_attribute("method", "update_chain_config")
        .add_attribute("chain_id", chain_id))
}

fn register_pool(
    deps: DepsMut,
    info: MessageInfo,
    pool_info: PoolInfo,
) -> Result<Response, ContractError> {
    // Only admin can register pools
    let config = CONFIG.load(deps.storage)?;
    if info.sender != config.admin {
        return Err(ContractError::Unauthorized {});
    }

    // Check if pool already exists
    if POOL_REGISTRY.may_load(deps.storage, pool_info.pool_id)?.is_some() {
        return Err(ContractError::DuplicatePool {
            pool_id: pool_info.pool_id,
        });
    }

    // Validate pool info
    if pool_info.token_denoms.len() < 2 {
        return Err(ContractError::InvalidPoolConfig {});
    }

    // Save pool info
    POOL_REGISTRY.save(deps.storage, pool_info.pool_id, &pool_info)?;

    // Update pool pairs index
    for i in 0..pool_info.token_denoms.len() {
        for j in i + 1..pool_info.token_denoms.len() {
            let denom1 = &pool_info.token_denoms[i];
            let denom2 = &pool_info.token_denoms[j];
            
            // Store both orderings for easy lookup
            let key1 = (denom1.as_str(), denom2.as_str());
            let key2 = (denom2.as_str(), denom1.as_str());
            
            // Add pool to existing pools for this pair
            let mut pools1 = POOL_PAIRS.may_load(deps.storage, key1)?.unwrap_or_default();
            let mut pools2 = POOL_PAIRS.may_load(deps.storage, key2)?.unwrap_or_default();
            
            pools1.push(pool_info.pool_id);
            pools2.push(pool_info.pool_id);
            
            POOL_PAIRS.save(deps.storage, key1, &pools1)?;
            POOL_PAIRS.save(deps.storage, key2, &pools2)?;
        }
    }

    Ok(Response::new()
        .add_attribute("method", "register_pool")
        .add_attribute("pool_id", pool_info.pool_id.to_string())
        .add_attribute("chain_id", pool_info.chain_id))
}

fn update_pool_info(
    deps: DepsMut,
    info: MessageInfo,
    pool_id: u64,
    pool_info: PoolInfo,
) -> Result<Response, ContractError> {
    // Only admin can update pool info
    let config = CONFIG.load(deps.storage)?;
    if info.sender != config.admin {
        return Err(ContractError::Unauthorized {});
    }

    // Check if pool exists
    if POOL_REGISTRY.may_load(deps.storage, pool_id)?.is_none() {
        return Err(ContractError::PoolNotFound { pool_id });
    }

    // Validate pool info
    if pool_info.token_denoms.len() < 2 || pool_info.pool_id != pool_id {
        return Err(ContractError::InvalidPoolConfig {});
    }

    // Update pool info
    POOL_REGISTRY.save(deps.storage, pool_id, &pool_info)?;

    Ok(Response::new()
        .add_attribute("method", "update_pool_info")
        .add_attribute("pool_id", pool_id.to_string()))
}

fn execute_multi_hop_swap(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    routes: Vec<HopRoute>,
    min_output: Uint128,
    timeout_timestamp: u64,
) -> Result<Response, ContractError> {
    // Validate timeout
    if timeout_timestamp <= env.block.time.seconds() {
        return Err(ContractError::Std(StdError::generic_err("Invalid timeout")));
    }

    // Validate routes
    if routes.is_empty() {
        return Err(ContractError::NoRouteFound {});
    }

    // Estimate output
    let amount_in = info.funds[0].amount; // Assume single token
    let (estimated_output, _) = estimate_multi_hop_swap(deps.as_ref(), routes.clone(), amount_in)?;

    // Check slippage
    if estimated_output < min_output {
        return Err(ContractError::SlippageExceeded {
            expected: min_output.to_string(),
            actual: estimated_output.to_string(),
        });
    }

    // Build IBC transfer messages for multi-hop execution
    let messages = build_multi_hop_messages(
        deps.as_ref(),
        &env,
        &info,
        routes.clone(),
        amount_in,
        min_output,
        timeout_timestamp,
    )?;

    Ok(Response::new()
        .add_messages(messages)
        .add_attribute("method", "execute_multi_hop_swap")
        .add_attribute("routes", format!("{:?}", routes))
        .add_attribute("estimated_output", estimated_output.to_string()))
}

#[cfg_attr(not(feature = "library"), entry_point)]
pub fn query(deps: Deps, _env: Env, msg: QueryMsg) -> StdResult<Binary> {
    match msg {
        QueryMsg::GetConfig {} => to_json_binary(&query_config(deps)?),
        QueryMsg::GetChainConfig { chain_id } => {
            to_json_binary(&query_chain_config(deps, chain_id)?)
        }
        QueryMsg::GetPoolInfo { pool_id } => to_json_binary(&query_pool_info(deps, pool_id)?),
        QueryMsg::FindBestRoute {
            start_denom,
            end_denom,
            amount_in,
            max_hops,
        } => to_json_binary(&query_find_best_route(
            deps,
            start_denom,
            end_denom,
            amount_in,
            max_hops,
        )?),
        QueryMsg::EstimateMultiHopSwap { routes, amount_in } => {
            to_json_binary(&query_estimate_multi_hop(deps, routes, amount_in)?)
        }
    }
}

fn query_config(deps: Deps) -> StdResult<ConfigResponse> {
    let config = CONFIG.load(deps.storage)?;
    
    // Load all chain configs
    let supported_chains: StdResult<Vec<ChainConfig>> = CHAIN_CONFIGS
        .range(deps.storage, None, None, cosmwasm_std::Order::Ascending)
        .map(|item| item.map(|(_, config)| config))
        .collect();

    Ok(ConfigResponse {
        admin: config.admin.to_string(),
        supported_chains: supported_chains?,
    })
}

fn query_chain_config(deps: Deps, chain_id: String) -> StdResult<ChainConfigResponse> {
    let config = CHAIN_CONFIGS.load(deps.storage, &chain_id)?;
    Ok(ChainConfigResponse { config })
}

fn query_pool_info(deps: Deps, pool_id: u64) -> StdResult<PoolInfoResponse> {
    let pool_info = POOL_REGISTRY.load(deps.storage, pool_id)?;
    Ok(PoolInfoResponse { pool_info })
}

fn query_find_best_route(
    deps: Deps,
    start_denom: String,
    end_denom: String,
    amount_in: Uint128,
    max_hops: Option<u32>,
) -> StdResult<RouteResponse> {
    let routes = find_best_routes(deps, start_denom, end_denom, amount_in, max_hops)?;

    if routes.is_empty() {
        return Ok(RouteResponse {
            routes: vec![],
            estimated_output: Uint128::zero(),
            total_fees: Decimal::zero(),
            price_impact: Decimal::zero(),
        });
    }

    // Get the best route (first one, as they're sorted by output)
    let best_route = routes[0].clone();
    
    // Calculate price impact
    let price_impact = calculate_price_impact(deps, &best_route.path, amount_in)?;

    Ok(RouteResponse {
        routes: routes.into_iter().map(|r| r.path).collect(),
        estimated_output: best_route.amount,
        total_fees: best_route.total_fee,
        price_impact,
    })
}

fn query_estimate_multi_hop(
    deps: Deps,
    routes: Vec<HopRoute>,
    amount_in: Uint128,
) -> StdResult<EstimateResponse> {
    let (amount_out, _total_fee) = estimate_multi_hop_swap(deps, routes.clone(), amount_in)?;
    let price_impact = calculate_price_impact(deps, &routes, amount_in)?;

    // Calculate per-hop fees
    let mut route_fees = vec![];
    let mut current_amount = amount_in;
    
    for hop in routes {
        let pool_info = POOL_REGISTRY.load(deps.storage, hop.pool_id)?;
        let fee_amount = current_amount * pool_info.swap_fee;
        
        route_fees.push(crate::msg::RouteFee {
            chain_id: hop.chain_id,
            pool_id: hop.pool_id,
            fee_amount,
            fee_denom: hop.token_in_denom.clone(),
        });
        
        // Update current amount for next hop
        let (out_amount, _) = crate::routing::calculate_swap_output(
            &pool_info,
            &hop.token_in_denom,
            &hop.token_out_denom,
            current_amount,
        )?;
        current_amount = out_amount;
    }

    Ok(EstimateResponse {
        amount_out,
        price_impact,
        route_fees,
    })
}

fn build_multi_hop_messages(
    deps: Deps,
    _env: &Env,
    info: &MessageInfo,
    routes: Vec<HopRoute>,
    amount_in: Uint128,
    min_output: Uint128,
    timeout_timestamp: u64,
) -> StdResult<Vec<CosmosMsg>> {
    let mut messages = vec![];
    let mut current_amount = amount_in;
    let mut current_denom = info.funds[0].denom.clone();
    
    // Calculate timeout for IBC transfers (buffer before the overall timeout)
    let ibc_timeout = IbcTimeout::with_timestamp(Timestamp::from_seconds(
        timeout_timestamp.saturating_sub(IBC_TIMEOUT_BUFFER)
    ));
    
    for (i, hop) in routes.iter().enumerate() {
        // Get chain config
        let chain_config = CHAIN_CONFIGS.load(deps.storage, &hop.chain_id)?;
        
        // Build memo for the destination chain
        let _memo = build_hop_memo(
            deps,
            hop,
            i == routes.len() - 1, // is final hop
            min_output,
            &routes[i + 1..], // remaining hops
        )?;
        
        // Build memo for the destination chain
        let memo = build_hop_memo(
            deps,
            hop,
            i == routes.len() - 1, // is final hop
            min_output,
            &routes[i + 1..], // remaining hops
        )?;
        
        // Create IBC packet data with memo support
        let packet_data = crate::msg::IbcPacketData {
            sender: info.sender.to_string(),
            receiver: if i == routes.len() - 1 {
                // Final hop - send to actual receiver
                info.sender.to_string()
            } else {
                // Intermediate hop - send to router contract on next chain
                get_router_address(deps, &hop.chain_id)?
            },
            denom: current_denom.clone(),
            amount: current_amount,
            memo: Some(memo),
        };
        
        // Use our custom IBC send packet message
        let ibc_msg = IbcMsg::SendPacket {
            channel_id: chain_config.ibc_channel.clone(),
            data: to_json_binary(&packet_data)?,
            timeout: ibc_timeout.clone(),
        };
        
        messages.push(CosmosMsg::Ibc(ibc_msg));
        
        // Update current amount and denom for next hop
        if i < routes.len() - 1 {
            let pool_info = POOL_REGISTRY.load(deps.storage, hop.pool_id)?;
            let (output_amount, _) = crate::routing::calculate_swap_output(
                &pool_info,
                &current_denom,
                &hop.token_out_denom,
                current_amount,
            )?;
            current_amount = output_amount;
            current_denom = hop.token_out_denom.clone();
        }
    }
    
    Ok(messages)
}

fn build_hop_memo(
    deps: Deps,
    hop: &HopRoute,
    is_final: bool,
    min_output: Uint128,
    remaining_hops: &[HopRoute],
) -> StdResult<String> {
    #[derive(serde::Serialize)]
    struct HopMemo {
        swap: SwapInstruction,
        forward: Option<ForwardInstruction>,
    }
    
    #[derive(serde::Serialize)]
    struct SwapInstruction {
        pool_id: u64,
        token_out_denom: String,
        min_output: Option<String>,
    }
    
    #[derive(serde::Serialize)]
    struct ForwardInstruction {
        port: String,
        channel: String,
        receiver: String,
        timeout: u64,
        retries: u8,
        next: Option<Box<HopMemo>>,
    }
    
    let swap = SwapInstruction {
        pool_id: hop.pool_id,
        token_out_denom: hop.token_out_denom.clone(),
        min_output: if is_final {
            Some(min_output.to_string())
        } else {
            None
        },
    };
    
    let forward = if !is_final && !remaining_hops.is_empty() {
        let next_hop = &remaining_hops[0];
        let next_chain_config = CHAIN_CONFIGS
            .may_load(deps.storage, &next_hop.chain_id)?
            .ok_or_else(|| StdError::generic_err("Next chain config not found"))?;
        
        Some(ForwardInstruction {
            port: "transfer".to_string(),
            channel: next_chain_config.ibc_channel,
            receiver: get_router_address(deps, &next_hop.chain_id)?,
            timeout: IBC_TIMEOUT_BUFFER,
            retries: 0,
            next: None, // Simplified for now to avoid recursion complexity
        })
    } else {
        None
    };
    
    let memo = HopMemo { swap, forward };
    
    serde_json::to_string(&memo)
        .map_err(|e| StdError::generic_err(format!("Failed to serialize memo: {}", e)))
}

fn get_router_address(deps: Deps, chain_id: &str) -> StdResult<String> {
    let config = CONFIG.load(deps.storage)?;
    
    // First try to get from chain registry if configured
    if let Some(registry_contract) = config.registry_contract {
        match crate::registry_integration::query_router_address_from_registry(
            deps,
            registry_contract.as_str(),
            chain_id,
        ) {
            Ok(router_address) => return Ok(router_address),
            Err(_) => {
                // Fall back to local registry if chain registry query fails
            }
        }
    }
    
    // Fall back to local router registry
    ROUTER_REGISTRY.load(deps.storage, chain_id)
        .map_err(|_| StdError::generic_err(format!("No router registered for chain: {}", chain_id)))
}

fn register_router(
    deps: DepsMut,
    info: MessageInfo,
    chain_id: String,
    router_address: String,
) -> Result<Response, ContractError> {
    // Only admin can register routers
    let config = CONFIG.load(deps.storage)?;
    if info.sender != config.admin {
        return Err(ContractError::Unauthorized {});
    }

    // Validate the router address format
    if router_address.is_empty() {
        return Err(ContractError::InvalidInput { 
            msg: "Router address cannot be empty".to_string() 
        });
    }

    // Save the router address
    ROUTER_REGISTRY.save(deps.storage, &chain_id, &router_address)?;

    Ok(Response::new()
        .add_attribute("action", "register_router")
        .add_attribute("chain_id", chain_id)
        .add_attribute("router_address", router_address))
}

fn remove_router(
    deps: DepsMut,
    info: MessageInfo,
    chain_id: String,
) -> Result<Response, ContractError> {
    // Only admin can remove routers
    let config = CONFIG.load(deps.storage)?;
    if info.sender != config.admin {
        return Err(ContractError::Unauthorized {});
    }

    // Remove the router address
    ROUTER_REGISTRY.remove(deps.storage, &chain_id);

    Ok(Response::new()
        .add_attribute("action", "remove_router")
        .add_attribute("chain_id", chain_id))
}

fn update_registry_contract(
    deps: DepsMut,
    info: MessageInfo,
    registry_contract: Option<String>,
) -> Result<Response, ContractError> {
    // Only admin can update registry contract
    let mut config = CONFIG.load(deps.storage)?;
    if info.sender != config.admin {
        return Err(ContractError::Unauthorized {});
    }
    
    // Validate and update registry contract address
    config.registry_contract = registry_contract
        .map(|addr| deps.api.addr_validate(&addr))
        .transpose()?;
    
    CONFIG.save(deps.storage, &config)?;
    
    Ok(Response::new()
        .add_attribute("action", "update_registry_contract")
        .add_attribute("registry_contract", 
            config.registry_contract
                .map(|a| a.to_string())
                .unwrap_or_else(|| "none".to_string())
        ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use cosmwasm_std::testing::{mock_dependencies, mock_env, mock_info};
    use cosmwasm_std::{Decimal, Uint128, Coin, CosmosMsg, IbcMsg};
    use crate::msg::PoolType;

    #[test]
    fn test_instantiate() {
        let mut deps = mock_dependencies();
        let env = mock_env();
        let info = mock_info("admin", &[]);

        let msg = InstantiateMsg {
            admin: None,
            supported_chains: vec![
                ChainConfig {
                    chain_id: "osmosis-1".to_string(),
                    chain_prefix: "osmo".to_string(),
                    ibc_channel: "channel-0".to_string(),
                    native_denom: "uosmo".to_string(),
                },
            ],
            registry_contract: None,
            protocol_config: None,
        };
        
        let res = instantiate(deps.as_mut(), env, info, msg).unwrap();
        assert_eq!(2, res.attributes.len());
    }

    #[test]
    fn test_register_pool() {
        let mut deps = mock_dependencies();
        let env = mock_env();
        let info = mock_info("admin", &[]);

        // Instantiate
        let msg = InstantiateMsg {
            admin: None,
            supported_chains: vec![],
            registry_contract: None,
            protocol_config: None,
        };
        instantiate(deps.as_mut(), env.clone(), info.clone(), msg).unwrap();

        // Register pool
        let pool_info = PoolInfo {
            pool_id: 1,
            chain_id: "osmosis-1".to_string(),
            pool_type: PoolType::Balancer,
            token_denoms: vec!["uatom".to_string(), "uosmo".to_string()],
            liquidity: vec![
                cosmwasm_std::Coin {
                    denom: "uatom".to_string(),
                    amount: Uint128::new(1_000_000),
                },
                cosmwasm_std::Coin {
                    denom: "uosmo".to_string(),
                    amount: Uint128::new(2_000_000),
                },
            ],
            swap_fee: Decimal::permille(3),
            exit_fee: Decimal::zero(),
        };

        let msg = ExecuteMsg::RegisterPool { pool_info };
        let res = execute(deps.as_mut(), env, info, msg).unwrap();
        assert_eq!(res.attributes.len(), 3);
    }

    #[test]
    fn test_multi_hop_execution() {
        let mut deps = mock_dependencies();
        let env = mock_env();
        let info = mock_info("admin", &[]);

        // Initialize with multiple chains
        let msg = InstantiateMsg {
            admin: None,
            supported_chains: vec![
                ChainConfig {
                    chain_id: "osmosis-1".to_string(),
                    chain_prefix: "osmo".to_string(),
                    ibc_channel: "channel-0".to_string(),
                    native_denom: "uosmo".to_string(),
                },
                ChainConfig {
                    chain_id: "juno-1".to_string(),
                    chain_prefix: "juno".to_string(),
                    ibc_channel: "channel-1".to_string(),
                    native_denom: "ujuno".to_string(),
                },
            ],
            registry_contract: None,
            protocol_config: None,
        };
        instantiate(deps.as_mut(), env.clone(), info.clone(), msg).unwrap();

        // Register routers for testing
        let msg = ExecuteMsg::RegisterRouter {
            chain_id: "osmosis-1".to_string(),
            router_address: "osmo1router123".to_string(),
        };
        execute(deps.as_mut(), env.clone(), info.clone(), msg).unwrap();

        let msg = ExecuteMsg::RegisterRouter {
            chain_id: "juno-1".to_string(),
            router_address: "juno1router456".to_string(),
        };
        execute(deps.as_mut(), env.clone(), info.clone(), msg).unwrap();

        // Register pools
        let pool1 = PoolInfo {
            pool_id: 1,
            chain_id: "osmosis-1".to_string(),
            pool_type: PoolType::Balancer,
            token_denoms: vec!["uatom".to_string(), "uosmo".to_string()],
            liquidity: vec![
                cosmwasm_std::Coin {
                    denom: "uatom".to_string(),
                    amount: Uint128::new(1_000_000),
                },
                cosmwasm_std::Coin {
                    denom: "uosmo".to_string(),
                    amount: Uint128::new(2_000_000),
                },
            ],
            swap_fee: Decimal::permille(3),
            exit_fee: Decimal::zero(),
        };
        execute(deps.as_mut(), env.clone(), info.clone(), ExecuteMsg::RegisterPool { pool_info: pool1 }).unwrap();

        // Test multi-hop swap
        let routes = vec![
            HopRoute {
                chain_id: "osmosis-1".to_string(),
                pool_id: 1,
                token_in_denom: "uatom".to_string(),
                token_out_denom: "uosmo".to_string(),
            },
        ];

        let user_info = mock_info("user", &[Coin::new(100_000, "uatom")]);
        let msg = ExecuteMsg::ExecuteMultiHopSwap {
            routes,
            min_output: Uint128::new(100),
            timeout_timestamp: env.block.time.seconds() + 3600,
        };

        let res = execute(deps.as_mut(), env.clone(), user_info, msg).unwrap();
        
        // Should have 1 IBC message
        assert_eq!(res.messages.len(), 1);
        
        // Verify it's an IBC message
        match &res.messages[0].msg {
            CosmosMsg::Ibc(IbcMsg::SendPacket { channel_id, .. }) => {
                assert_eq!(channel_id, "channel-0");
            }
            _ => panic!("Expected IBC SendPacket message"),
        }
    }

    #[test]
    fn test_slippage_protection() {
        let mut deps = mock_dependencies();
        let env = mock_env();
        let info = mock_info("admin", &[]);

        // Setup
        let msg = InstantiateMsg {
            admin: None,
            supported_chains: vec![
                ChainConfig {
                    chain_id: "osmosis-1".to_string(),
                    chain_prefix: "osmo".to_string(),
                    ibc_channel: "channel-0".to_string(),
                    native_denom: "uosmo".to_string(),
                },
            ],
            registry_contract: None,
            protocol_config: None,
        };
        instantiate(deps.as_mut(), env.clone(), info.clone(), msg).unwrap();

        // Register router
        execute(deps.as_mut(), env.clone(), info.clone(), ExecuteMsg::RegisterRouter {
            chain_id: "osmosis-1".to_string(),
            router_address: "osmo1router".to_string(),
        }).unwrap();

        // Register pool with low liquidity for high slippage
        let pool = PoolInfo {
            pool_id: 1,
            chain_id: "osmosis-1".to_string(),
            pool_type: PoolType::Balancer,
            token_denoms: vec!["uatom".to_string(), "uosmo".to_string()],
            liquidity: vec![
                cosmwasm_std::Coin {
                    denom: "uatom".to_string(),
                    amount: Uint128::new(1000), // Very low liquidity
                },
                cosmwasm_std::Coin {
                    denom: "uosmo".to_string(),
                    amount: Uint128::new(2000),
                },
            ],
            swap_fee: Decimal::permille(3),
            exit_fee: Decimal::zero(),
        };
        execute(deps.as_mut(), env.clone(), info.clone(), ExecuteMsg::RegisterPool { pool_info: pool }).unwrap();

        // Try swap with high amount relative to liquidity
        let routes = vec![
            HopRoute {
                chain_id: "osmosis-1".to_string(),
                pool_id: 1,
                token_in_denom: "uatom".to_string(),
                token_out_denom: "uosmo".to_string(),
            },
        ];

        let user_info = mock_info("user", &[Coin::new(500, "uatom")]); // 50% of pool liquidity
        let msg = ExecuteMsg::ExecuteMultiHopSwap {
            routes,
            min_output: Uint128::new(1500), // Expecting too much output
            timeout_timestamp: env.block.time.seconds() + 3600,
        };

        // Should fail due to slippage
        let err = execute(deps.as_mut(), env, user_info, msg).unwrap_err();
        match err {
            ContractError::SlippageExceeded { .. } => {}
            _ => panic!("Expected SlippageExceeded error"),
        }
    }
}