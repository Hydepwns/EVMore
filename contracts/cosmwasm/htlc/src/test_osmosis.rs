#[cfg(test)]
mod tests {
    use cosmwasm_std::{
        testing::{mock_env, mock_info},
        coins, Decimal, Uint128,
    };
    use sha2::Digest;
    use crate::{
        contract::{instantiate, execute},
        msg::{ExecuteMsg, InstantiateMsg},
        dex::{SwapParams, SwapRoute, query_spot_price, estimate_swap},
        test_helpers::test_helpers::mock_dependencies_with_osmosis,
    };
    
    #[test]
    fn test_osmosis_spot_price_query() {
        let deps = mock_dependencies_with_osmosis();
        
        // Query spot price for the mocked pool
        let result = query_spot_price(
            deps.as_ref(),
            1,
            "uatom".to_string(),
            "uosmo".to_string(),
        ).unwrap();
        
        // Verify the spot price from our mock (1.05)
        assert_eq!(result.spot_price, Decimal::from_atomics(1050000000000000000u128, 18).unwrap());
        assert_eq!(result.token_in_denom, "uatom");
        assert_eq!(result.token_out_denom, "uosmo");
    }
    
    #[test]
    fn test_osmosis_swap_estimate() {
        let deps = mock_dependencies_with_osmosis();
        
        // Estimate swap for 100 uatom
        let token_in = cosmwasm_std::Coin {
            denom: "uatom".to_string(),
            amount: Uint128::new(100),
        };
        
        let routes = vec![SwapRoute {
            pool_id: 1,
            token_out_denom: "uosmo".to_string(),
        }];
        
        let result = estimate_swap(
            deps.as_ref(),
            token_in.clone(),
            routes,
        ).unwrap();
        
        // Verify the estimate from our mock (95% output)
        assert_eq!(result.token_out_amount, Uint128::new(95));
        // Price impact should be calculated
        assert!(result.price_impact > Decimal::zero());
        // Swap fee should be 0.3%
        assert_eq!(result.swap_fee, Decimal::permille(3));
    }
    
    #[test]
    fn test_create_htlc_with_multi_hop_swap() {
        use crate::test_helpers::test_helpers::OsmosisQuerier;
        use cosmwasm_std::testing::{MockApi, MockQuerier, MockStorage, MOCK_CONTRACT_ADDR};
        
        // Create custom querier with multiple pools
        let custom_querier = OsmosisQuerier::new(MockQuerier::new(&[(MOCK_CONTRACT_ADDR, &[])]))
            .with_pool(1, "uatom", "uusdc", "10000000000000000000", 0.98) // 10.0 spot price, 98% rate
            .with_pool(2, "uusdc", "uosmo", "2000000000000000000", 0.97); // 2.0 spot price, 97% rate
            
        let mut deps = cosmwasm_std::OwnedDeps {
            storage: MockStorage::default(),
            api: MockApi::default(),
            querier: custom_querier,
            custom_query_type: std::marker::PhantomData,
        };
        
        let env = mock_env();
        let info = mock_info("admin", &[]);
        
        // Instantiate
        let msg = InstantiateMsg { admin: None };
        instantiate(deps.as_mut(), env.clone(), info, msg).unwrap();
        
        // Create HTLC with multi-hop swap
        let sender_info = mock_info("sender", &coins(100, "uatom"));
        let mut hasher = sha2::Sha256::new();
        sha2::Digest::update(&mut hasher, b"mysecret");
        let hashlock = hex::encode(hasher.finalize());
        
        let swap_params = SwapParams {
            routes: vec![
                SwapRoute {
                    pool_id: 1,
                    token_out_denom: "uusdc".to_string(),
                },
                SwapRoute {
                    pool_id: 2,
                    token_out_denom: "uosmo".to_string(),
                },
            ],
            min_output_amount: Uint128::new(85), // Expecting ~95% of 100 after 2 hops
            slippage_tolerance: Decimal::percent(5),
        };
        
        let msg = ExecuteMsg::CreateHtlcWithSwap {
            receiver: "receiver".to_string(),
            hashlock: hashlock.clone(),
            timelock: env.block.time.seconds() + 3600,
            target_chain: "cosmoshub-4".to_string(),
            target_address: "cosmos1abc...".to_string(),
            swap_params: swap_params.clone(),
        };
        
        // This should succeed with multi-hop support
        let res = execute(deps.as_mut(), env.clone(), sender_info, msg).unwrap();
        
        // Verify the response
        assert_eq!(res.attributes[0].value, "create_htlc_with_swap");
        assert_eq!(res.attributes[1].value, "htlc_0");
        
        // Verify HTLC was created with multi-hop swap params
        let htlc = crate::state::HTLCS.load(&deps.storage, "htlc_0").unwrap();
        assert!(htlc.swap_params.is_some());
        let saved_params = htlc.swap_params.unwrap();
        assert_eq!(saved_params.routes.len(), 2);
        assert_eq!(saved_params.routes[0].pool_id, 1);
        assert_eq!(saved_params.routes[1].pool_id, 2);
    }
}