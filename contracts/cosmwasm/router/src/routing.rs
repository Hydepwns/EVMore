use cosmwasm_std::{Decimal, Deps, StdError, StdResult, Uint128};
use std::collections::{HashSet, VecDeque};
use crate::msg::{HopRoute, PoolInfo, PoolType};
use crate::state::{POOL_REGISTRY, load_protocol_config};

#[derive(Clone, Debug)]
pub struct RouteNode {
    pub denom: String,
    pub amount: Uint128,
    pub path: Vec<HopRoute>,
    pub total_fee: Decimal,
}

/// Find the best routes between two tokens
pub fn find_best_routes(
    deps: Deps,
    start_denom: String,
    end_denom: String,
    amount_in: Uint128,
    max_hops: Option<u32>,
) -> StdResult<Vec<RouteNode>> {
    // Load configuration to get max hops
    let config = load_protocol_config(deps.storage)?;
    let max_hops = max_hops.unwrap_or(config.routing.max_hops as u32).min(config.routing.max_hops as u32);
    
    // BFS to find all possible routes
    let mut queue = VecDeque::new();
    let mut visited = HashSet::new();
    let mut all_routes = Vec::new();
    
    // Start node
    let start_node = RouteNode {
        denom: start_denom.clone(),
        amount: amount_in,
        path: vec![],
        total_fee: Decimal::zero(),
    };
    
    queue.push_back(start_node);
    visited.insert(start_denom.clone());
    
    while let Some(node) = queue.pop_front() {
        if node.path.len() >= max_hops as usize {
            continue;
        }
        
        // Find all pools containing the current denom
        let pools = find_pools_with_denom(deps, &node.denom)?;
        
        for pool_id in pools {
            let pool_info = POOL_REGISTRY.load(deps.storage, pool_id)?;
            
            // Find the other denoms in the pool
            for other_denom in &pool_info.token_denoms {
                if other_denom == &node.denom || visited.contains(other_denom) {
                    continue;
                }
                
                // Calculate output amount for this hop
                let (amount_out, fee) = calculate_swap_output(
                    &pool_info,
                    &node.denom,
                    other_denom,
                    node.amount,
                )?;
                
                // Create new route node
                let mut new_path = node.path.clone();
                new_path.push(HopRoute {
                    chain_id: pool_info.chain_id.clone(),
                    pool_id: pool_info.pool_id,
                    token_in_denom: node.denom.clone(),
                    token_out_denom: other_denom.clone(),
                });
                
                let new_node = RouteNode {
                    denom: other_denom.clone(),
                    amount: amount_out,
                    path: new_path,
                    total_fee: node.total_fee + fee,
                };
                
                // If we reached the target denom, save the route
                if other_denom == &end_denom {
                    all_routes.push(new_node);
                } else {
                    // Continue exploring
                    queue.push_back(new_node);
                    if all_routes.len() < config.routing.max_routes_to_explore as usize {
                        visited.insert(other_denom.clone());
                    }
                }
            }
        }
    }
    
    // Sort routes by output amount (descending)
    all_routes.sort_by(|a, b| b.amount.cmp(&a.amount));
    
    // Return top routes
    Ok(all_routes.into_iter().take(5).collect())
}

/// Find all pools containing a specific denom
fn find_pools_with_denom(deps: Deps, denom: &str) -> StdResult<Vec<u64>> {
    let mut pools = HashSet::new();
    
    // We need to iterate through all registered pools and check if they contain the denom
    // In a real implementation, you would maintain a reverse index for efficiency
    // For now, we'll check a limited range of pool IDs
    
    // Check pools within configured range (in production, you'd track the max pool ID)
    // Load configuration for pool discovery range
    let config = load_protocol_config(deps.storage)?;
    for pool_id in config.routing.pool_discovery_range.start..=config.routing.pool_discovery_range.end {
        if let Some(pool_info) = POOL_REGISTRY.may_load(deps.storage, pool_id)? {
            if pool_info.token_denoms.contains(&denom.to_string()) {
                pools.insert(pool_id);
            }
        }
    }
    
    Ok(pools.into_iter().collect())
}

/// Calculate output amount for a swap in a pool
pub fn calculate_swap_output(
    pool_info: &PoolInfo,
    token_in_denom: &str,
    token_out_denom: &str,
    amount_in: Uint128,
) -> StdResult<(Uint128, Decimal)> {
    // Find token balances in the pool
    let balance_in = pool_info.liquidity.iter()
        .find(|c| c.denom == token_in_denom)
        .ok_or_else(|| StdError::generic_err("Token in not found in pool"))?
        .amount;
        
    let balance_out = pool_info.liquidity.iter()
        .find(|c| c.denom == token_out_denom)
        .ok_or_else(|| StdError::generic_err("Token out not found in pool"))?
        .amount;
    
    // Apply swap fee
    let amount_in_with_fee = amount_in * (Decimal::one() - pool_info.swap_fee);
    
    // Calculate output based on pool type
    let amount_out = match pool_info.pool_type {
        PoolType::Balancer => {
            // Simplified constant product formula
            // amount_out = balance_out * (1 - (balance_in / (balance_in + amount_in_with_fee)))
            let ratio = Decimal::from_ratio(balance_in, balance_in + amount_in_with_fee);
            let out_ratio = Decimal::one() - ratio;
            balance_out * out_ratio
        }
        PoolType::StableSwap => {
            // Simplified stable swap formula (assumes 1:1 for stablecoins)
            // In reality, this would use a more complex curve
            amount_in_with_fee
        }
        PoolType::ConcentratedLiquidity => {
            // Simplified CL formula
            // Would need tick information and current price in production
            let price = Decimal::from_ratio(balance_out, balance_in);
            amount_in_with_fee * price
        }
    };
    
    Ok((amount_out, pool_info.swap_fee))
}

/// Estimate output for a multi-hop swap
pub fn estimate_multi_hop_swap(
    deps: Deps,
    routes: Vec<HopRoute>,
    amount_in: Uint128,
) -> StdResult<(Uint128, Decimal)> {
    let mut current_amount = amount_in;
    let mut total_fee = Decimal::zero();
    
    for hop in routes {
        let pool_info = POOL_REGISTRY.load(deps.storage, hop.pool_id)?;
        
        let (amount_out, fee) = calculate_swap_output(
            &pool_info,
            &hop.token_in_denom,
            &hop.token_out_denom,
            current_amount,
        )?;
        
        current_amount = amount_out;
        total_fee = total_fee + fee;
    }
    
    Ok((current_amount, total_fee))
}

/// Calculate price impact for a swap route
pub fn calculate_price_impact(
    deps: Deps,
    routes: &[HopRoute],
    amount_in: Uint128,
) -> StdResult<Decimal> {
    // Get spot price (with minimal amount)
    // Load configuration for minimal amount
    let config = load_protocol_config(deps.storage)?;
    let minimal_amount = config.routing.minimal_amount;
    let (spot_out, _) = estimate_multi_hop_swap(deps, routes.to_vec(), minimal_amount)?;
    let spot_price = Decimal::from_ratio(minimal_amount, spot_out);
    
    // Get execution price
    let (exec_out, _) = estimate_multi_hop_swap(deps, routes.to_vec(), amount_in)?;
    let exec_price = Decimal::from_ratio(amount_in, exec_out);
    
    // Price impact = (exec_price - spot_price) / spot_price
    let price_impact = if exec_price > spot_price {
        (exec_price - spot_price) / spot_price
    } else {
        Decimal::zero()
    };
    
    Ok(price_impact)
}

#[cfg(test)]
mod tests {
    use super::*;
    use cosmwasm_std::Decimal;
    
    #[test]
    fn test_calculate_swap_output_balancer() {
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
            swap_fee: Decimal::permille(3), // 0.3%
            exit_fee: Decimal::zero(),
        };
        
        let (amount_out, fee) = calculate_swap_output(
            &pool_info,
            "uatom",
            "uosmo",
            Uint128::new(100_000),
        ).unwrap();
        
        // With 100k uatom in, we should get less than 200k uosmo out
        assert!(amount_out < Uint128::new(200_000));
        assert!(amount_out > Uint128::new(150_000)); // Sanity check
        assert_eq!(fee, Decimal::permille(3));
    }
    
    #[test]
    fn test_calculate_swap_output_stableswap() {
        let pool_info = PoolInfo {
            pool_id: 2,
            chain_id: "osmosis-1".to_string(),
            pool_type: PoolType::StableSwap,
            token_denoms: vec!["usdc".to_string(), "usdt".to_string()],
            liquidity: vec![
                cosmwasm_std::Coin {
                    denom: "usdc".to_string(),
                    amount: Uint128::new(10_000_000),
                },
                cosmwasm_std::Coin {
                    denom: "usdt".to_string(),
                    amount: Uint128::new(10_000_000),
                },
            ],
            swap_fee: Decimal::permille(1), // 0.1%
            exit_fee: Decimal::zero(),
        };
        
        let (amount_out, fee) = calculate_swap_output(
            &pool_info,
            "usdc",
            "usdt",
            Uint128::new(100_000),
        ).unwrap();
        
        // For stableswap, output should be very close to input minus fee
        let expected = Uint128::new(100_000) * (Decimal::one() - Decimal::permille(1));
        assert_eq!(amount_out, expected);
        assert_eq!(fee, Decimal::permille(1));
    }
}