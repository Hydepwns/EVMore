use cosmwasm_std::{
    entry_point, to_json_binary, BankMsg, Binary, Coin, CosmosMsg, Deps, DepsMut, Env, MessageInfo,
    Response, StdResult, Uint128,
};
use osmosis_std::types::osmosis::poolmanager::v1beta1::MsgSwapExactAmountIn;
use cw2::set_contract_version;
use cw_storage_plus::Bound;
use hex;
use sha2::{Digest, Sha256};
use fusion_plus::ProtocolConfig;

use crate::constants::HASHLOCK_LENGTH;
use crate::error::ContractError;
use crate::msg::{ExecuteMsg, HtlcResponse, InstantiateMsg, ListHtlcsResponse, QueryMsg};
use crate::state::{Config, Htlc, CONFIG, HTLCS, HTLC_COUNT};
use crate::dex::{self, SwapParams, SwapRoute};

const CONTRACT_NAME: &str = "crates.io:fusion-htlc";
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

    let config = Config {
        admin: admin.clone(),
        protocol_config: ProtocolConfig::default(),
    };

    set_contract_version(deps.storage, CONTRACT_NAME, CONTRACT_VERSION)?;
    CONFIG.save(deps.storage, &config)?;
    HTLC_COUNT.save(deps.storage, &0u64)?;

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
        ExecuteMsg::CreateHtlc {
            receiver,
            hashlock,
            timelock,
            target_chain,
            target_address,
        } => create_htlc(
            deps,
            env,
            info,
            receiver,
            hashlock,
            timelock,
            target_chain,
            target_address,
        ),
        ExecuteMsg::Withdraw { htlc_id, secret } => withdraw(deps, env, info, htlc_id, secret),
        ExecuteMsg::Refund { htlc_id } => refund(deps, env, info, htlc_id),
        ExecuteMsg::CreateHtlcWithSwap {
            receiver,
            hashlock,
            timelock,
            target_chain,
            target_address,
            swap_params,
        } => create_htlc_with_swap(
            deps,
            env,
            info,
            receiver,
            hashlock,
            timelock,
            target_chain,
            target_address,
            swap_params,
        ),
        ExecuteMsg::ExecuteSwapAndLock { htlc_id, swap_params } => {
            execute_swap_and_lock(deps, env, info, htlc_id, swap_params)
        }
    }
}

fn create_htlc(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    receiver: String,
    hashlock: String,
    timelock: u64,
    target_chain: String,
    target_address: String,
) -> Result<Response, ContractError> {
    // Validate inputs
    let receiver_addr = deps.api.addr_validate(&receiver)?;

    if info.funds.is_empty() {
        return Err(ContractError::InvalidAmount {});
    }

    if timelock <= env.block.time.seconds() {
        return Err(ContractError::InvalidTimelock {});
    }

    // Load configuration to get max timelock duration
    let config = CONFIG.load(deps.storage)?;
    let max_timelock = config.protocol_config.get_max_timelock_duration();
    
    if timelock > env.block.time.seconds() + max_timelock {
        return Err(ContractError::InvalidTimelock {});
    }

    if target_chain.is_empty() {
        return Err(ContractError::TargetChainRequired {});
    }

    if target_address.is_empty() {
        return Err(ContractError::TargetAddressRequired {});
    }

    // Validate hashlock format (should be 64 hex chars for SHA256)
    if hashlock.len() != HASHLOCK_LENGTH || hex::decode(&hashlock).is_err() {
        return Err(ContractError::InvalidHashFormat {});
    }

    // Generate HTLC ID
    let count = HTLC_COUNT.load(deps.storage)?;
    let htlc_id = format!("htlc_{}", count);

    // Create HTLC
    let htlc = Htlc {
        sender: info.sender.clone(),
        receiver: receiver_addr.clone(),
        amount: info.funds.clone(),
        hashlock: hashlock.clone(),
        timelock,
        withdrawn: false,
        refunded: false,
        target_chain: target_chain.clone(),
        target_address: target_address.clone(),
        swap_params: None,
        swap_executed: false,
    };

    // Save HTLC
    HTLCS.save(deps.storage, &htlc_id, &htlc)?;
    HTLC_COUNT.save(deps.storage, &(count + 1))?;

    Ok(Response::new()
        .add_attribute("method", "create_htlc")
        .add_attribute("htlc_id", &htlc_id)
        .add_attribute("sender", info.sender)
        .add_attribute("receiver", receiver_addr)
        .add_attribute("hashlock", hashlock)
        .add_attribute("timelock", timelock.to_string())
        .add_attribute("target_chain", target_chain)
        .add_attribute("target_address", target_address))
}

fn withdraw(
    deps: DepsMut,
    _env: Env,
    _info: MessageInfo,
    htlc_id: String,
    secret: String,
) -> Result<Response, ContractError> {
    let mut htlc = HTLCS.load(deps.storage, &htlc_id)?;

    if htlc.withdrawn {
        return Err(ContractError::AlreadyWithdrawn {});
    }

    if htlc.refunded {
        return Err(ContractError::AlreadyRefunded {});
    }

    // Decode secret from hex
    let secret_bytes = hex::decode(&secret).map_err(|_| ContractError::InvalidHashFormat {})?;

    // Calculate hash of secret
    let mut hasher = Sha256::new();
    hasher.update(&secret_bytes);
    let hash = hasher.finalize();
    let hash_hex = hex::encode(hash);

    // Verify hash matches
    if hash_hex != htlc.hashlock {
        return Err(ContractError::InvalidSecret {});
    }

    // Mark as withdrawn
    htlc.withdrawn = true;
    HTLCS.save(deps.storage, &htlc_id, &htlc)?;

    // Transfer funds to receiver
    let bank_msg = BankMsg::Send {
        to_address: htlc.receiver.to_string(),
        amount: htlc.amount,
    };

    Ok(Response::new()
        .add_message(bank_msg)
        .add_attribute("method", "withdraw")
        .add_attribute("htlc_id", htlc_id)
        .add_attribute("secret", secret))
}

fn refund(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    htlc_id: String,
) -> Result<Response, ContractError> {
    let mut htlc = HTLCS.load(deps.storage, &htlc_id)?;

    if htlc.withdrawn {
        return Err(ContractError::AlreadyWithdrawn {});
    }

    if htlc.refunded {
        return Err(ContractError::AlreadyRefunded {});
    }

    if info.sender != htlc.sender {
        return Err(ContractError::Unauthorized {});
    }

    if env.block.time.seconds() < htlc.timelock {
        return Err(ContractError::TimelockNotExpired {});
    }

    // Mark as refunded
    htlc.refunded = true;
    HTLCS.save(deps.storage, &htlc_id, &htlc)?;

    // Transfer funds back to sender
    let bank_msg = BankMsg::Send {
        to_address: htlc.sender.to_string(),
        amount: htlc.amount,
    };

    Ok(Response::new()
        .add_message(bank_msg)
        .add_attribute("method", "refund")
        .add_attribute("htlc_id", htlc_id))
}

fn create_htlc_with_swap(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    receiver: String,
    hashlock: String,
    timelock: u64,
    target_chain: String,
    target_address: String,
    swap_params: SwapParams,
) -> Result<Response, ContractError> {
    // Validate swap params
    dex::validate_swap_params(&swap_params)?;
    
    // Validate inputs
    let receiver_addr = deps.api.addr_validate(&receiver)?;
    
    if info.funds.is_empty() {
        return Err(ContractError::InvalidAmount {});
    }
    
    if timelock <= env.block.time.seconds() {
        return Err(ContractError::InvalidTimelock {});
    }
    
    // Load configuration to get max timelock duration
    let config = CONFIG.load(deps.storage)?;
    let max_timelock = config.protocol_config.get_max_timelock_duration();
    
    if timelock > env.block.time.seconds() + max_timelock {
        return Err(ContractError::InvalidTimelock {});
    }
    
    if target_chain.is_empty() {
        return Err(ContractError::TargetChainRequired {});
    }
    
    if target_address.is_empty() {
        return Err(ContractError::TargetAddressRequired {});
    }
    
    // Validate hashlock format
    if hashlock.len() != 64 || hex::decode(&hashlock).is_err() {
        return Err(ContractError::InvalidHashFormat {});
    }
    
    // Estimate swap output
    let token_in = &info.funds[0]; // Assume single token deposit
    let estimate = dex::estimate_swap(
        deps.as_ref(),
        token_in.clone(),
        swap_params.routes.clone(),
    )?;
    
    // Check if estimated output meets minimum requirement
    if estimate.token_out_amount < swap_params.min_output_amount {
        return Err(ContractError::InsufficientOutputAmount {});
    }
    
    // Generate HTLC ID
    let count = HTLC_COUNT.load(deps.storage)?;
    let htlc_id = format!("htlc_{}", count);
    
    // Create HTLC with swap params
    let htlc = Htlc {
        sender: info.sender.clone(),
        receiver: receiver_addr.clone(),
        amount: info.funds.clone(),
        hashlock: hashlock.clone(),
        timelock,
        withdrawn: false,
        refunded: false,
        target_chain: target_chain.clone(),
        target_address: target_address.clone(),
        swap_params: Some(swap_params.clone()),
        swap_executed: false,
    };
    
    // Save HTLC
    HTLCS.save(deps.storage, &htlc_id, &htlc)?;
    HTLC_COUNT.save(deps.storage, &(count + 1))?;
    
    Ok(Response::new()
        .add_attribute("method", "create_htlc_with_swap")
        .add_attribute("htlc_id", &htlc_id)
        .add_attribute("sender", info.sender)
        .add_attribute("receiver", receiver_addr)
        .add_attribute("hashlock", hashlock)
        .add_attribute("timelock", timelock.to_string())
        .add_attribute("target_chain", target_chain)
        .add_attribute("target_address", target_address)
        .add_attribute("estimated_output", estimate.token_out_amount.to_string())
        .add_attribute("price_impact", estimate.price_impact.to_string()))
}

fn execute_swap_and_lock(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    htlc_id: String,
    swap_params: SwapParams,
) -> Result<Response, ContractError> {
    // Load HTLC
    let mut htlc = HTLCS.load(deps.storage, &htlc_id)?;
    
    // Verify sender is authorized (either sender or admin)
    let config = CONFIG.load(deps.storage)?;
    if info.sender != htlc.sender && info.sender != config.admin {
        return Err(ContractError::Unauthorized {});
    }
    
    // Check if swap already executed
    if htlc.swap_executed {
        return Err(ContractError::SwapAlreadyExecuted {});
    }
    
    // Validate swap params
    dex::validate_swap_params(&swap_params)?;
    
    // Build swap message
    let swap_msg = build_osmosis_swap_msg(
        &htlc.amount[0], // Assume single token
        &swap_params.routes,
        swap_params.min_output_amount,
        env.contract.address.to_string(),
    )?;
    
    // Update HTLC state
    htlc.swap_executed = true;
    htlc.swap_params = Some(swap_params);
    HTLCS.save(deps.storage, &htlc_id, &htlc)?;
    
    Ok(Response::new()
        .add_message(swap_msg)
        .add_attribute("method", "execute_swap_and_lock")
        .add_attribute("htlc_id", htlc_id))
}

fn build_osmosis_swap_msg(
    token_in: &Coin,
    routes: &[SwapRoute],
    min_output_amount: Uint128,
    sender: String,
) -> StdResult<CosmosMsg> {
    use osmosis_std::types::osmosis::poolmanager::v1beta1::SwapAmountInRoute;
    
    let osmo_routes: Vec<SwapAmountInRoute> = routes
        .iter()
        .map(|r| SwapAmountInRoute {
            pool_id: r.pool_id,
            token_out_denom: r.token_out_denom.clone(),
        })
        .collect();
    
    let msg = MsgSwapExactAmountIn {
        sender,
        routes: osmo_routes,
        token_in: Some(osmosis_std::types::cosmos::base::v1beta1::Coin {
            denom: token_in.denom.clone(),
            amount: token_in.amount.to_string(),
        }),
        token_out_min_amount: min_output_amount.to_string(),
    };
    
    Ok(msg.into())
}

#[cfg_attr(not(feature = "library"), entry_point)]
pub fn query(deps: Deps, _env: Env, msg: QueryMsg) -> StdResult<Binary> {
    match msg {
        QueryMsg::GetHtlc { htlc_id } => to_json_binary(&query_htlc(deps, htlc_id)?),
        QueryMsg::ListHtlcs { start_after, limit } => {
            to_json_binary(&query_list_htlcs(deps, start_after, limit)?)
        }
        QueryMsg::QuerySpotPrice { pool_id, base_denom, quote_denom } => {
            to_json_binary(&dex::query_spot_price(deps, pool_id, base_denom, quote_denom)?)
        }
        QueryMsg::EstimateSwap { token_in, routes } => {
            to_json_binary(&dex::estimate_swap(deps, token_in, routes)?)
        }
    }
}

fn query_htlc(deps: Deps, htlc_id: String) -> StdResult<HtlcResponse> {
    let htlc = HTLCS.load(deps.storage, &htlc_id)?;

    Ok(HtlcResponse {
        id: htlc_id,
        sender: htlc.sender.to_string(),
        receiver: htlc.receiver.to_string(),
        amount: htlc.amount,
        hashlock: htlc.hashlock,
        timelock: htlc.timelock,
        withdrawn: htlc.withdrawn,
        refunded: htlc.refunded,
        target_chain: htlc.target_chain,
        target_address: htlc.target_address,
        swap_params: htlc.swap_params,
        swap_executed: htlc.swap_executed,
    })
}

fn query_list_htlcs(
    deps: Deps,
    start_after: Option<String>,
    limit: Option<u32>,
) -> StdResult<ListHtlcsResponse> {
    let limit = limit.unwrap_or(10).min(100);

    let start = start_after.as_ref().map(|s| Bound::exclusive(s.as_str()));

    let htlcs: StdResult<Vec<HtlcResponse>> = HTLCS
        .range(deps.storage, start, None, cosmwasm_std::Order::Ascending)
        .take(limit as usize)
        .map(|item| {
            let (id, htlc) = item?;
            Ok(HtlcResponse {
                id,
                sender: htlc.sender.to_string(),
                receiver: htlc.receiver.to_string(),
                amount: htlc.amount,
                hashlock: htlc.hashlock,
                timelock: htlc.timelock,
                withdrawn: htlc.withdrawn,
                refunded: htlc.refunded,
                target_chain: htlc.target_chain,
                target_address: htlc.target_address,
                swap_params: htlc.swap_params,
                swap_executed: htlc.swap_executed,
            })
        })
        .collect();

    Ok(ListHtlcsResponse { htlcs: htlcs? })
}

#[cfg(test)]
mod tests {
    use super::*;
    use cosmwasm_std::testing::{mock_dependencies, mock_env, mock_info};
    use cosmwasm_std::{coins, Decimal, Uint128};
    use crate::dex::{SwapParams, SwapRoute};

    #[test]
    fn test_instantiate() {
        let mut deps = mock_dependencies();
        let env = mock_env();
        let info = mock_info("admin", &[]);

        let msg = InstantiateMsg { admin: None };
        let res = instantiate(deps.as_mut(), env, info, msg).unwrap();
        assert_eq!(0, res.messages.len());
    }

    #[test]
    fn test_create_htlc() {
        let mut deps = mock_dependencies();
        let env = mock_env();
        let info = mock_info("admin", &[]);

        // Instantiate
        let msg = InstantiateMsg { admin: None };
        instantiate(deps.as_mut(), env.clone(), info, msg).unwrap();

        // Create HTLC
        let sender_info = mock_info("sender", &coins(100, "uatom"));
        let _secret = hex::encode(b"mysecret");
        let mut hasher = Sha256::new();
        hasher.update(b"mysecret");
        let hashlock = hex::encode(hasher.finalize());

        let msg = ExecuteMsg::CreateHtlc {
            receiver: "receiver".to_string(),
            hashlock,
            timelock: env.block.time.seconds() + 3600,
            target_chain: "cosmoshub-4".to_string(),
            target_address: "cosmos1abc...".to_string(),
        };

        let res = execute(deps.as_mut(), env.clone(), sender_info, msg).unwrap();
        assert_eq!(res.attributes.len(), 8);
        
        // Verify HTLC was created properly
        let htlc = HTLCS.load(&deps.storage, "htlc_0").unwrap();
        assert_eq!(htlc.swap_params, None);
        assert_eq!(htlc.swap_executed, false);
    }
    
    #[test]
    fn test_create_htlc_with_swap() {
        use crate::test_helpers::test_helpers::mock_dependencies_with_osmosis;
        
        let mut deps = mock_dependencies_with_osmosis();
        let env = mock_env();
        let info = mock_info("admin", &[]);
        
        // Instantiate
        let msg = InstantiateMsg { admin: None };
        instantiate(deps.as_mut(), env.clone(), info, msg).unwrap();
        
        // Create HTLC with swap
        let sender_info = mock_info("sender", &coins(100, "uatom"));
        let _secret = hex::encode(b"mysecret");
        let mut hasher = Sha256::new();
        hasher.update(b"mysecret");
        let hashlock = hex::encode(hasher.finalize());
        
        let swap_params = SwapParams {
            routes: vec![SwapRoute {
                pool_id: 1,
                token_out_denom: "uosmo".to_string(),
            }],
            min_output_amount: Uint128::new(90),
            slippage_tolerance: Decimal::percent(1),
        };
        
        let msg = ExecuteMsg::CreateHtlcWithSwap {
            receiver: "receiver".to_string(),
            hashlock: hashlock.clone(),
            timelock: env.block.time.seconds() + 3600,
            target_chain: "cosmoshub-4".to_string(),
            target_address: "cosmos1abc...".to_string(),
            swap_params: swap_params.clone(),
        };
        
        // Now with proper Osmosis query support, this should succeed
        let res = execute(deps.as_mut(), env.clone(), sender_info, msg).unwrap();
        
        // Verify the response
        assert_eq!(res.attributes.len(), 10);
        assert_eq!(res.attributes[0].value, "create_htlc_with_swap");
        assert_eq!(res.attributes[1].value, "htlc_0");
        assert_eq!(res.attributes[3].value, "receiver");
        assert_eq!(res.attributes[4].value, hashlock);
        assert_eq!(res.attributes[8].value, "95"); // estimated output from mock
        
        // Verify HTLC was created with swap params
        let htlc = HTLCS.load(&deps.storage, "htlc_0").unwrap();
        assert_eq!(htlc.sender, "sender");
        assert_eq!(htlc.receiver, "receiver");
        assert_eq!(htlc.amount, coins(100, "uatom"));
        assert!(htlc.swap_params.is_some());
        assert_eq!(htlc.swap_params.unwrap(), swap_params);
        assert_eq!(htlc.swap_executed, false);
    }

    #[test]
    fn test_claim_htlc() {
        let mut deps = mock_dependencies();
        let env = mock_env();
        let info = mock_info("admin", &[]);
        
        // Instantiate
        let msg = InstantiateMsg { admin: None };
        instantiate(deps.as_mut(), env.clone(), info, msg).unwrap();
        
        // Create HTLC
        let sender_info = mock_info("sender", &coins(100, "uatom"));
        let secret = b"mysecret";
        let mut hasher = Sha256::new();
        hasher.update(secret);
        let hashlock = hex::encode(hasher.finalize());
        
        let msg = ExecuteMsg::CreateHtlc {
            receiver: "receiver".to_string(),
            hashlock: hashlock.clone(),
            timelock: env.block.time.seconds() + 3600,
            target_chain: "cosmoshub-4".to_string(),
            target_address: "cosmos1abc...".to_string(),
        };
        
        execute(deps.as_mut(), env.clone(), sender_info, msg).unwrap();
        
        // Get the HTLC ID (uses counter-based ID)
        let htlc_id = "htlc_0".to_string();
        
        // Claim with correct secret
        let receiver_info = mock_info("receiver", &[]);
        let msg = ExecuteMsg::Withdraw {
            htlc_id: htlc_id.clone(),
            secret: hex::encode(secret),
        };
        
        let res = execute(deps.as_mut(), env.clone(), receiver_info, msg).unwrap();
        assert_eq!(res.messages.len(), 1);
        
        // Verify HTLC is marked as withdrawn
        let htlc = HTLCS.load(&deps.storage, &htlc_id).unwrap();
        assert!(htlc.withdrawn);
    }

    #[test]
    fn test_claim_htlc_wrong_secret() {
        let mut deps = mock_dependencies();
        let env = mock_env();
        let info = mock_info("admin", &[]);
        
        // Instantiate
        let msg = InstantiateMsg { admin: None };
        instantiate(deps.as_mut(), env.clone(), info, msg).unwrap();
        
        // Create HTLC
        let sender_info = mock_info("sender", &coins(100, "uatom"));
        let secret = b"mysecret";
        let mut hasher = Sha256::new();
        hasher.update(secret);
        let hashlock = hex::encode(hasher.finalize());
        
        let msg = ExecuteMsg::CreateHtlc {
            receiver: "receiver".to_string(),
            hashlock: hashlock.clone(),
            timelock: env.block.time.seconds() + 3600,
            target_chain: "cosmoshub-4".to_string(),
            target_address: "cosmos1abc...".to_string(),
        };
        
        execute(deps.as_mut(), env.clone(), sender_info, msg).unwrap();
        
        // Get the HTLC ID (uses counter-based ID)
        let htlc_id = "htlc_0".to_string();
        
        // Try to claim with wrong secret
        let receiver_info = mock_info("receiver", &[]);
        let msg = ExecuteMsg::Withdraw {
            htlc_id,
            secret: hex::encode(b"wrongsecret"),
        };
        
        let err = execute(deps.as_mut(), env, receiver_info, msg).unwrap_err();
        match err {
            ContractError::InvalidSecret {} => {}
            _ => panic!("Expected InvalidHashlock error, got {:?}", err),
        }
    }

    #[test]
    fn test_refund_htlc() {
        let mut deps = mock_dependencies();
        let mut env = mock_env();
        let info = mock_info("admin", &[]);
        
        // Instantiate
        let msg = InstantiateMsg { admin: None };
        instantiate(deps.as_mut(), env.clone(), info, msg).unwrap();
        
        // Create HTLC
        let sender_info = mock_info("sender", &coins(100, "uatom"));
        let mut hasher = Sha256::new();
        hasher.update(b"mysecret");
        let hashlock = hex::encode(hasher.finalize());
        
        let msg = ExecuteMsg::CreateHtlc {
            receiver: "receiver".to_string(),
            hashlock: hashlock.clone(),
            timelock: env.block.time.seconds() + 3600,
            target_chain: "cosmoshub-4".to_string(),
            target_address: "cosmos1abc...".to_string(),
        };
        
        execute(deps.as_mut(), env.clone(), sender_info.clone(), msg).unwrap();
        
        // Get the HTLC ID (uses counter-based ID)
        let htlc_id = "htlc_0".to_string();
        
        // Advance time past timelock
        env.block.time = env.block.time.plus_seconds(3601);
        
        // Refund
        let msg = ExecuteMsg::Refund { htlc_id: htlc_id.clone() };
        let res = execute(deps.as_mut(), env, sender_info, msg).unwrap();
        assert_eq!(res.messages.len(), 1);
        
        // Verify HTLC is marked as refunded
        let htlc = HTLCS.load(&deps.storage, &htlc_id).unwrap();
        assert!(htlc.refunded);
    }

    #[test]
    fn test_refund_htlc_before_timelock() {
        let mut deps = mock_dependencies();
        let env = mock_env();
        let info = mock_info("admin", &[]);
        
        // Instantiate
        let msg = InstantiateMsg { admin: None };
        instantiate(deps.as_mut(), env.clone(), info, msg).unwrap();
        
        // Create HTLC
        let sender_info = mock_info("sender", &coins(100, "uatom"));
        let mut hasher = Sha256::new();
        hasher.update(b"mysecret");
        let hashlock = hex::encode(hasher.finalize());
        
        let msg = ExecuteMsg::CreateHtlc {
            receiver: "receiver".to_string(),
            hashlock: hashlock.clone(),
            timelock: env.block.time.seconds() + 3600,
            target_chain: "cosmoshub-4".to_string(),
            target_address: "cosmos1abc...".to_string(),
        };
        
        execute(deps.as_mut(), env.clone(), sender_info.clone(), msg).unwrap();
        
        // Get the HTLC ID (uses counter-based ID)
        let htlc_id = "htlc_0".to_string();
        
        // Try to refund before timelock expires
        let msg = ExecuteMsg::Refund { htlc_id };
        let err = execute(deps.as_mut(), env, sender_info, msg).unwrap_err();
        
        match err {
            ContractError::TimelockNotExpired {} => {}
            _ => panic!("Expected NotExpired error, got {:?}", err),
        }
    }

    #[test]
    fn test_create_htlc_invalid_timelock() {
        let mut deps = mock_dependencies();
        let env = mock_env();
        let info = mock_info("admin", &[]);
        
        // Instantiate
        let msg = InstantiateMsg { admin: None };
        instantiate(deps.as_mut(), env.clone(), info, msg).unwrap();
        
        // Try to create HTLC with timelock too far in future (> 48 hours)
        let sender_info = mock_info("sender", &coins(100, "uatom"));
        let mut hasher = Sha256::new();
        hasher.update(b"mysecret");
        let hashlock = hex::encode(hasher.finalize());
        
        let msg = ExecuteMsg::CreateHtlc {
            receiver: "receiver".to_string(),
            hashlock,
            timelock: env.block.time.seconds() + 49 * 3600, // > 48 hours
            target_chain: "cosmoshub-4".to_string(),
            target_address: "cosmos1abc...".to_string(),
        };
        
        let err = execute(deps.as_mut(), env, sender_info, msg).unwrap_err();
        match err {
            ContractError::InvalidTimelock {} => {}
            _ => panic!("Expected InvalidTimelock error, got {:?}", err),
        }
    }
}
