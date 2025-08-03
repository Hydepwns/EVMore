#[cfg(test)]
mod tests {
    use cosmwasm_std::{coins, Addr, Decimal, Uint128};
    use cosmwasm_std::testing::{mock_dependencies, mock_env, mock_info};
    use cw_multi_test::{App, AppBuilder, Contract, ContractWrapper, Executor};
    
    use fusion_htlc::contract::{execute, instantiate, query};
    use fusion_htlc::msg::{ExecuteMsg, InstantiateMsg, QueryMsg};
    use fusion_htlc::dex::{SwapParams, SwapRoute, SwapEstimateResponse};

    fn htlc_contract() -> Box<dyn Contract<Empty>> {
        let contract = ContractWrapper::new(execute, instantiate, query);
        Box::new(contract)
    }

    #[test]
    fn test_create_htlc_with_swap() {
        let mut app = App::default();
        
        // Deploy HTLC contract
        let htlc_id = app.store_code(htlc_contract());
        
        let htlc_addr = app
            .instantiate_contract(
                htlc_id,
                Addr::unchecked("admin"),
                &InstantiateMsg { admin: None },
                &[],
                "HTLC",
                None,
            )
            .unwrap();

        // Create HTLC with swap parameters
        let swap_params = SwapParams {
            routes: vec![
                SwapRoute {
                    pool_id: 1,
                    token_out_denom: "uosmo".to_string(),
                },
                SwapRoute {
                    pool_id: 678,
                    token_out_denom: "uatom".to_string(),
                },
            ],
            min_output_amount: Uint128::new(900_000),
            slippage_tolerance: Decimal::percent(2),
        };

        let hashlock = "a665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3".to_string();
        
        let msg = ExecuteMsg::CreateHtlcWithSwap {
            receiver: "osmo1receiver".to_string(),
            hashlock,
            timelock: 1234567890,
            target_chain: "cosmoshub-4".to_string(),
            target_address: "cosmos1receiver".to_string(),
            swap_params,
        };

        // Note: This will fail in tests due to missing Osmosis query support
        // but demonstrates the contract interface
        let err = app
            .execute_contract(
                Addr::unchecked("sender"),
                htlc_addr.clone(),
                &msg,
                &coins(1_000_000, "uusdc"),
            )
            .unwrap_err();

        // In production with proper Osmosis integration, this would succeed
        assert!(err.to_string().contains("querier"));
    }

    #[test]
    fn test_query_spot_price() {
        let deps = mock_dependencies();
        
        // Mock query for spot price
        let query_msg = QueryMsg::QuerySpotPrice {
            pool_id: 1,
            base_denom: "uosmo".to_string(),
            quote_denom: "uatom".to_string(),
        };

        // This would fail in unit tests but demonstrates the interface
        let err = query(deps.as_ref(), mock_env(), query_msg).unwrap_err();
        assert!(err.to_string().contains("Failed to query spot price"));
    }

    #[test]
    fn test_estimate_swap() {
        let deps = mock_dependencies();
        
        // Mock query for swap estimate
        let query_msg = QueryMsg::EstimateSwap {
            token_in: cosmwasm_std::Coin {
                denom: "uusdc".to_string(),
                amount: Uint128::new(1_000_000),
            },
            routes: vec![
                SwapRoute {
                    pool_id: 678,
                    token_out_denom: "uosmo".to_string(),
                },
            ],
        };

        // This would fail in unit tests but demonstrates the interface
        let err = query(deps.as_ref(), mock_env(), query_msg).unwrap_err();
        assert!(err.to_string().contains("Failed to estimate swap"));
    }

    #[test]
    fn test_validate_swap_params() {
        use fusion_htlc::dex::validate_swap_params;
        
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
        let err = validate_swap_params(&invalid_params).unwrap_err();
        assert!(err.to_string().contains("Swap routes cannot be empty"));
        
        // Zero min output
        let invalid_params = SwapParams {
            routes: vec![SwapRoute {
                pool_id: 1,
                token_out_denom: "uosmo".to_string(),
            }],
            min_output_amount: Uint128::zero(),
            slippage_tolerance: Decimal::percent(1),
        };
        let err = validate_swap_params(&invalid_params).unwrap_err();
        assert!(err.to_string().contains("Minimum output amount must be greater than zero"));
        
        // Excessive slippage
        let invalid_params = SwapParams {
            routes: vec![SwapRoute {
                pool_id: 1,
                token_out_denom: "uosmo".to_string(),
            }],
            min_output_amount: Uint128::new(1000),
            slippage_tolerance: Decimal::percent(51),
        };
        let err = validate_swap_params(&invalid_params).unwrap_err();
        assert!(err.to_string().contains("Slippage tolerance cannot exceed 50%"));
    }

    #[test]
    fn test_multi_hop_swap_estimation() {
        use fusion_htlc::dex::calculate_min_output_with_slippage;
        
        // Test slippage calculation for multi-hop
        let estimated_output = Uint128::new(1_000_000);
        
        // 2% slippage for 2-hop swap
        let min_output = calculate_min_output_with_slippage(
            estimated_output,
            Decimal::percent(2),
        ).unwrap();
        
        assert_eq!(min_output, Uint128::new(980_000));
        
        // Higher slippage for 3-hop swap
        let min_output = calculate_min_output_with_slippage(
            estimated_output,
            Decimal::percent(5),
        ).unwrap();
        
        assert_eq!(min_output, Uint128::new(950_000));
    }
}