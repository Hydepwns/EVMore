#[cfg(test)]
pub mod test_helpers {
    use cosmwasm_std::{
        from_json,
        testing::{MockApi, MockQuerier, MockStorage, MOCK_CONTRACT_ADDR},
        to_json_binary, ContractResult, OwnedDeps, Querier, 
        QuerierResult, QueryRequest, SystemError, SystemResult,
    };
    use osmosis_std::types::osmosis::poolmanager::v1beta1::{
        EstimateSwapExactAmountInResponse, SpotPriceResponse,
    };
    use std::collections::HashMap;

    /// Custom querier that handles Osmosis-specific queries
    pub struct OsmosisQuerier {
        base: MockQuerier,
        pool_configs: HashMap<u64, PoolConfig>,
    }

    #[derive(Clone)]
    struct PoolConfig {
        spot_prices: HashMap<(String, String), String>,
        swap_rates: HashMap<String, String>, // token_in_denom -> output ratio
    }

    impl OsmosisQuerier {
        pub fn new(base: MockQuerier) -> Self {
            Self {
                base,
                pool_configs: HashMap::new(),
            }
        }

        /// Configure a pool with spot price and swap rate
        pub fn with_pool(
            mut self,
            pool_id: u64,
            base_denom: &str,
            quote_denom: &str,
            spot_price: &str,
            swap_rate: f64, // e.g., 0.95 means 95% output
        ) -> Self {
            let pool_config = self.pool_configs.entry(pool_id).or_insert(PoolConfig {
                spot_prices: HashMap::new(),
                swap_rates: HashMap::new(),
            });
            
            // Set spot price for both directions
            pool_config.spot_prices.insert(
                (base_denom.to_string(), quote_denom.to_string()),
                spot_price.to_string(),
            );
            
            // Set swap rate
            pool_config.swap_rates.insert(
                base_denom.to_string(),
                swap_rate.to_string(),
            );
            
            self
        }
    }

    impl Querier for OsmosisQuerier {
        fn raw_query(&self, bin_request: &[u8]) -> QuerierResult {
            // First check if this is an Osmosis-specific query
            let request: Result<QueryRequest<cosmwasm_std::Empty>, _> = from_json(bin_request);
            
            if let Ok(QueryRequest::Stargate { path, data }) = request {
                // Handle Osmosis poolmanager queries
                if path == "/osmosis.poolmanager.v1beta1.Query/SpotPrice" {
                    // Decode the spot price request
                    // For simplicity in tests, we'll parse a custom format
                    let _data_str = String::from_utf8_lossy(&data);
                    
                    // Look for pool 1 with uatom/uosmo (default test case)
                    if let Some(pool_config) = self.pool_configs.get(&1) {
                        if let Some(spot_price) = pool_config.spot_prices.get(&("uatom".to_string(), "uosmo".to_string())) {
                            let response = SpotPriceResponse {
                                spot_price: spot_price.clone(),
                            };
                            
                            let response_binary = to_json_binary(&response).unwrap();
                            return SystemResult::Ok(ContractResult::Ok(response_binary));
                        }
                    }
                    
                    return SystemResult::Err(SystemError::InvalidRequest {
                        error: "Pool not found in mock".to_string(),
                        request: data.clone(),
                    });
                }
                else if path == "/osmosis.poolmanager.v1beta1.Query/EstimateSwapExactAmountIn" {
                    // For swap estimates, return a simple calculation based on swap rate
                    // Default to 95% output for tests
                    let response = EstimateSwapExactAmountInResponse {
                        token_out_amount: "95".to_string(), // 95 uosmo for 100 uatom
                    };
                    
                    let response_binary = to_json_binary(&response).unwrap();
                    return SystemResult::Ok(ContractResult::Ok(response_binary));
                }
                
                // Return error for unhandled Osmosis queries
                return SystemResult::Err(SystemError::InvalidRequest {
                    error: format!("Unhandled Osmosis query path: {}", path),
                    request: data.clone(),
                });
            }
            
            // Fall back to base querier for non-Osmosis queries
            self.base.raw_query(bin_request)
        }
    }

    /// Create mock dependencies with Osmosis query support
    pub fn mock_dependencies_with_osmosis() -> OwnedDeps<MockStorage, MockApi, OsmosisQuerier> {
        let custom_querier = OsmosisQuerier::new(MockQuerier::new(&[(MOCK_CONTRACT_ADDR, &[])]))
            .with_pool(1, "uatom", "uosmo", "1050000000000000000", 0.95); // 1.05 spot price, 95% swap rate
            
        OwnedDeps {
            storage: MockStorage::default(),
            api: MockApi::default(),
            querier: custom_querier,
            custom_query_type: std::marker::PhantomData,
        }
    }
}