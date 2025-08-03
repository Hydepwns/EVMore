#[cfg(test)]
mod integration_tests {
    use cosmwasm_std::{
        coins, testing::{mock_dependencies, mock_env, mock_info}, to_json_binary,
        Addr, BankMsg, Coin, CosmosMsg, Decimal, IbcMsg, Uint128,
    };
    use fusion_htlc::{
        contract as htlc_contract,
        msg::{ExecuteMsg as HtlcExecuteMsg, InstantiateMsg as HtlcInstantiateMsg},
        state::HTLCS,
    };
    use fusion_router::{
        contract as router_contract,
        msg::{
            ChainConfig, ExecuteMsg as RouterExecuteMsg, HopRoute,
            InstantiateMsg as RouterInstantiateMsg, PoolInfo, PoolType,
        },
    };
    use sha2::{Digest, Sha256};

    #[test]
    fn test_htlc_to_router_integration() {
        // Setup HTLC contract
        let mut htlc_deps = mock_dependencies();
        let htlc_env = mock_env();
        let htlc_info = mock_info("admin", &[]);
        
        htlc_contract::instantiate(
            htlc_deps.as_mut(),
            htlc_env.clone(),
            htlc_info.clone(),
            HtlcInstantiateMsg { admin: None },
        )
        .unwrap();

        // Setup Router contract
        let mut router_deps = mock_dependencies();
        let router_env = mock_env();
        let router_info = mock_info("admin", &[]);
        
        router_contract::instantiate(
            router_deps.as_mut(),
            router_env.clone(),
            router_info.clone(),
            RouterInstantiateMsg {
                admin: None,
                supported_chains: vec![
                    ChainConfig {
                        chain_id: "osmosis-1".to_string(),
                        chain_prefix: "osmo".to_string(),
                        ibc_channel: "channel-0".to_string(),
                        native_denom: "uosmo".to_string(),
                    },
                ],
            },
        )
        .unwrap();

        // Register router address
        router_contract::execute(
            router_deps.as_mut(),
            router_env.clone(),
            router_info.clone(),
            RouterExecuteMsg::RegisterRouter {
                chain_id: "osmosis-1".to_string(),
                router_address: "osmo1router".to_string(),
            },
        )
        .unwrap();

        // Register pool
        router_contract::execute(
            router_deps.as_mut(),
            router_env.clone(),
            router_info.clone(),
            RouterExecuteMsg::RegisterPool {
                pool_info: PoolInfo {
                    pool_id: 1,
                    chain_id: "osmosis-1".to_string(),
                    pool_type: PoolType::Balancer,
                    token_denoms: vec!["uatom".to_string(), "uosmo".to_string()],
                    liquidity: vec![
                        Coin::new(1_000_000, "uatom"),
                        Coin::new(2_000_000, "uosmo"),
                    ],
                    swap_fee: Decimal::permille(3),
                    exit_fee: Decimal::zero(),
                },
            },
        )
        .unwrap();

        // Create HTLC with cross-chain intent
        let sender_info = mock_info("sender", &coins(1000, "uatom"));
        let secret = b"mysecret";
        let mut hasher = Sha256::new();
        hasher.update(secret);
        let hashlock = hex::encode(hasher.finalize());

        let htlc_res = htlc_contract::execute(
            htlc_deps.as_mut(),
            htlc_env.clone(),
            sender_info,
            HtlcExecuteMsg::CreateHtlc {
                receiver: "receiver".to_string(),
                hashlock: hashlock.clone(),
                timelock: htlc_env.block.time.seconds() + 3600,
                target_chain: "osmosis-1".to_string(),
                target_address: "osmo1receiver".to_string(),
            },
        )
        .unwrap();

        // Verify HTLC was created
        let htlc = HTLCS.load(&htlc_deps.storage, "htlc_0").unwrap();
        assert_eq!(htlc.target_chain, Some("osmosis-1".to_string()));
        assert_eq!(htlc.target_address, Some("osmo1receiver".to_string()));

        // Simulate cross-chain swap after HTLC claim
        let user_info = mock_info("user", &[Coin::new(1000, "uatom")]);
        let router_res = router_contract::execute(
            router_deps.as_mut(),
            router_env.clone(),
            user_info,
            RouterExecuteMsg::ExecuteMultiHopSwap {
                routes: vec![HopRoute {
                    chain_id: "osmosis-1".to_string(),
                    pool_id: 1,
                    token_in_denom: "uatom".to_string(),
                    token_out_denom: "uosmo".to_string(),
                }],
                min_output: Uint128::new(100),
                timeout_timestamp: router_env.block.time.seconds() + 3600,
            },
        )
        .unwrap();

        // Verify IBC message was created
        assert_eq!(router_res.messages.len(), 1);
        match &router_res.messages[0].msg {
            CosmosMsg::Ibc(IbcMsg::SendPacket { channel_id, .. }) => {
                assert_eq!(channel_id, "channel-0");
            }
            _ => panic!("Expected IBC SendPacket message"),
        }
    }

    #[test]
    fn test_multi_contract_swap_flow() {
        // This test simulates a complete cross-chain swap flow
        // 1. User creates HTLC on source chain
        // 2. Relayer detects HTLC creation
        // 3. Router executes multi-hop swap
        // 4. HTLC is claimed with secret
        
        let mut htlc_deps = mock_dependencies();
        let mut router_deps = mock_dependencies();
        let env = mock_env();
        
        // Initialize both contracts
        htlc_contract::instantiate(
            htlc_deps.as_mut(),
            env.clone(),
            mock_info("admin", &[]),
            HtlcInstantiateMsg { admin: None },
        )
        .unwrap();
        
        router_contract::instantiate(
            router_deps.as_mut(),
            env.clone(),
            mock_info("admin", &[]),
            RouterInstantiateMsg {
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
            },
        )
        .unwrap();
        
        // Setup pools for multi-hop
        let pools = vec![
            PoolInfo {
                pool_id: 1,
                chain_id: "osmosis-1".to_string(),
                pool_type: PoolType::Balancer,
                token_denoms: vec!["uatom".to_string(), "uosmo".to_string()],
                liquidity: vec![
                    Coin::new(1_000_000, "uatom"),
                    Coin::new(2_000_000, "uosmo"),
                ],
                swap_fee: Decimal::permille(3),
                exit_fee: Decimal::zero(),
            },
            PoolInfo {
                pool_id: 2,
                chain_id: "osmosis-1".to_string(),
                pool_type: PoolType::Balancer,
                token_denoms: vec!["uosmo".to_string(), "ujuno".to_string()],
                liquidity: vec![
                    Coin::new(2_000_000, "uosmo"),
                    Coin::new(3_000_000, "ujuno"),
                ],
                swap_fee: Decimal::permille(3),
                exit_fee: Decimal::zero(),
            },
        ];
        
        for pool in pools {
            router_contract::execute(
                router_deps.as_mut(),
                env.clone(),
                mock_info("admin", &[]),
                RouterExecuteMsg::RegisterPool { pool_info: pool },
            )
            .unwrap();
        }
        
        // Create HTLC
        let secret = b"cross-chain-secret";
        let mut hasher = Sha256::new();
        hasher.update(secret);
        let hashlock = hex::encode(hasher.finalize());
        
        htlc_contract::execute(
            htlc_deps.as_mut(),
            env.clone(),
            mock_info("sender", &coins(1000, "uatom")),
            HtlcExecuteMsg::CreateHtlc {
                receiver: "receiver".to_string(),
                hashlock: hashlock.clone(),
                timelock: env.block.time.seconds() + 7200, // 2 hours
                target_chain: "juno-1".to_string(),
                target_address: "juno1finalreceiver".to_string(),
            },
        )
        .unwrap();
        
        // Verify HTLC state
        let htlc = HTLCS.load(&htlc_deps.storage, "htlc_0").unwrap();
        assert!(!htlc.withdrawn);
        assert!(!htlc.refunded);
        assert_eq!(htlc.amount[0].amount, Uint128::new(1000));
        
        // Simulate claiming with correct secret
        let claim_res = htlc_contract::execute(
            htlc_deps.as_mut(),
            env.clone(),
            mock_info("receiver", &[]),
            HtlcExecuteMsg::Withdraw {
                htlc_id: "htlc_0".to_string(),
                secret: hex::encode(secret),
            },
        )
        .unwrap();
        
        // Verify funds were sent to receiver
        assert_eq!(claim_res.messages.len(), 1);
        match &claim_res.messages[0].msg {
            CosmosMsg::Bank(BankMsg::Send { to_address, amount }) => {
                assert_eq!(to_address, "receiver");
                assert_eq!(amount[0].amount, Uint128::new(1000));
            }
            _ => panic!("Expected bank send message"),
        }
        
        // Verify HTLC is marked as withdrawn
        let htlc = HTLCS.load(&htlc_deps.storage, "htlc_0").unwrap();
        assert!(htlc.withdrawn);
    }
}