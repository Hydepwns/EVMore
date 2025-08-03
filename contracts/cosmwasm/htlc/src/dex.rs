use cosmwasm_std::{Coin, Decimal, Deps, StdError, StdResult, Uint128};
use cosmwasm_schema::cw_serde;
use std::str::FromStr;
use osmosis_std::types::osmosis::poolmanager::v1beta1::{
    PoolmanagerQuerier, SwapAmountInRoute,
};
use crate::constants::{DEFAULT_SENDER_ID, TOKEN_DECIMAL_PRECISION};

#[cw_serde]
pub struct SwapParams {
    pub routes: Vec<SwapRoute>,
    pub min_output_amount: Uint128,
    pub slippage_tolerance: Decimal,
}

#[cw_serde]
pub struct SwapRoute {
    pub pool_id: u64,
    pub token_out_denom: String,
}

#[cw_serde]
pub struct PriceQueryResponse {
    pub spot_price: Decimal,
    pub token_in_denom: String,
    pub token_out_denom: String,
}

#[cw_serde]
pub struct SwapEstimateResponse {
    pub token_out_amount: Uint128,
    pub price_impact: Decimal,
    pub swap_fee: Decimal,
}

/// Query spot price from Osmosis pool
pub fn query_spot_price(
    deps: Deps,
    pool_id: u64,
    base_denom: String,
    quote_denom: String,
) -> StdResult<PriceQueryResponse> {
    let poolmanager = PoolmanagerQuerier::new(&deps.querier);
    
    let spot_price_response = poolmanager
        .spot_price(pool_id, base_denom.clone(), quote_denom.clone())
        .map_err(|e| StdError::generic_err(format!("Failed to query spot price: {}", e)))?;
    
    let spot_price = Decimal::from_atomics(
        spot_price_response.spot_price.parse::<u128>()
            .map_err(|e| StdError::generic_err(format!("Failed to parse spot price: {}", e)))?,
        TOKEN_DECIMAL_PRECISION,
    ).map_err(|e| StdError::generic_err(format!("Failed to create decimal: {}", e)))?;
    
    Ok(PriceQueryResponse {
        spot_price,
        token_in_denom: base_denom,
        token_out_denom: quote_denom,
    })
}

/// Estimate swap output amount with price impact calculation
pub fn estimate_swap(
    deps: Deps,
    token_in: Coin,
    routes: Vec<SwapRoute>,
) -> StdResult<SwapEstimateResponse> {
    let poolmanager = PoolmanagerQuerier::new(&deps.querier);
    
    // Convert our routes to Osmosis routes
    let osmo_routes: Vec<SwapAmountInRoute> = routes
        .into_iter()
        .map(|r| SwapAmountInRoute {
            pool_id: r.pool_id,
            token_out_denom: r.token_out_denom,
        })
        .collect();
    
    let estimate_response = poolmanager
        .estimate_swap_exact_amount_in(DEFAULT_SENDER_ID, token_in.to_string(), osmo_routes.clone())
        .map_err(|e| StdError::generic_err(format!("Failed to estimate swap: {}", e)))?;
    
    let token_out_amount = Uint128::from_str(&estimate_response.token_out_amount)?;
    
    // Calculate price impact by comparing spot price with effective price
    let price_impact = calculate_price_impact(
        deps,
        &token_in,
        token_out_amount,
        &osmo_routes,
    )?;
    
    // Get swap fee from the pool
    let swap_fee = get_pool_swap_fee(deps, osmo_routes[0].pool_id)?;
    
    Ok(SwapEstimateResponse {
        token_out_amount,
        price_impact,
        swap_fee,
    })
}

/// Calculate price impact for a swap
fn calculate_price_impact(
    deps: Deps,
    token_in: &Coin,
    token_out_amount: Uint128,
    routes: &[SwapAmountInRoute],
) -> StdResult<Decimal> {
    // For single route swaps
    if routes.len() == 1 {
        let route = &routes[0];
        
        // Get spot price before swap
        let spot_price = query_spot_price(
            deps,
            route.pool_id,
            token_in.denom.clone(),
            route.token_out_denom.clone(),
        )?;
        
        // Calculate effective price
        let effective_price = Decimal::from_ratio(token_in.amount, token_out_amount);
        
        // Price impact = (effective_price - spot_price) / spot_price
        let price_impact = effective_price
            .checked_sub(spot_price.spot_price)
            .unwrap_or_default()
            .checked_div(spot_price.spot_price)
            .unwrap_or_default();
        
        Ok(price_impact)
    } else {
        // For multi-hop swaps, aggregate price impact
        // This is a simplified calculation
        Ok(Decimal::percent(1)) // Default 1% for multi-hop
    }
}

/// Get swap fee for a pool
fn get_pool_swap_fee(deps: Deps, pool_id: u64) -> StdResult<Decimal> {
    // Query pool details to get swap fee
    // For now, return default Osmosis swap fee
    let _ = deps;
    let _ = pool_id;
    Ok(Decimal::permille(3)) // 0.3% default
}

/// Validate swap parameters
pub fn validate_swap_params(swap_params: &SwapParams) -> StdResult<()> {
    if swap_params.routes.is_empty() {
        return Err(StdError::generic_err("Swap routes cannot be empty"));
    }
    
    if swap_params.min_output_amount.is_zero() {
        return Err(StdError::generic_err("Minimum output amount must be greater than zero"));
    }
    
    if swap_params.slippage_tolerance > Decimal::percent(50) {
        return Err(StdError::generic_err("Slippage tolerance cannot exceed 50%"));
    }
    
    Ok(())
}

/// Calculate minimum output amount with slippage protection
pub fn calculate_min_output_with_slippage(
    estimated_output: Uint128,
    slippage_tolerance: Decimal,
) -> StdResult<Uint128> {
    let slippage_factor = Decimal::one()
        .checked_sub(slippage_tolerance)
        .map_err(|_| StdError::generic_err("Invalid slippage tolerance"))?;
    
    let min_output = estimated_output * slippage_factor;
    Ok(min_output)
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_validate_swap_params() {
        // Valid params
        let valid_params = SwapParams {
            routes: vec![SwapRoute {
                pool_id: 1,
                token_out_denom: "uosmo".to_string(),
            }],
            min_output_amount: Uint128::new(1000),
            slippage_tolerance: Decimal::percent(1),
        };
        assert!(validate_swap_params(&valid_params).is_ok());
        
        // Empty routes
        let invalid_params = SwapParams {
            routes: vec![],
            min_output_amount: Uint128::new(1000),
            slippage_tolerance: Decimal::percent(1),
        };
        assert!(validate_swap_params(&invalid_params).is_err());
        
        // Zero min output
        let invalid_params = SwapParams {
            routes: vec![SwapRoute {
                pool_id: 1,
                token_out_denom: "uosmo".to_string(),
            }],
            min_output_amount: Uint128::zero(),
            slippage_tolerance: Decimal::percent(1),
        };
        assert!(validate_swap_params(&invalid_params).is_err());
        
        // Excessive slippage
        let invalid_params = SwapParams {
            routes: vec![SwapRoute {
                pool_id: 1,
                token_out_denom: "uosmo".to_string(),
            }],
            min_output_amount: Uint128::new(1000),
            slippage_tolerance: Decimal::percent(51),
        };
        assert!(validate_swap_params(&invalid_params).is_err());
    }
    
    #[test]
    fn test_calculate_min_output_with_slippage() {
        let estimated = Uint128::new(10000);
        
        // 1% slippage
        let min_output = calculate_min_output_with_slippage(
            estimated,
            Decimal::percent(1),
        ).unwrap();
        assert_eq!(min_output, Uint128::new(9900));
        
        // 5% slippage
        let min_output = calculate_min_output_with_slippage(
            estimated,
            Decimal::percent(5),
        ).unwrap();
        assert_eq!(min_output, Uint128::new(9500));
        
        // 0% slippage
        let min_output = calculate_min_output_with_slippage(
            estimated,
            Decimal::zero(),
        ).unwrap();
        assert_eq!(min_output, estimated);
    }
}