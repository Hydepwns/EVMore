use cosmwasm_std::Uint128;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// Global configuration constants for the Fusion+ protocol
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct ProtocolConfig {
    pub swap: SwapConfig,
    pub routing: RoutingConfig,
    pub chains: Vec<ChainConfig>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct SwapConfig {
    pub timelock: TimelockConfig,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct TimelockConfig {
    /// Maximum timelock duration in seconds (default: 48 hours)
    pub max_duration: u64,
    /// Timelock cascade for multi-hop swaps
    pub cascade: TimelockCascade,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct TimelockCascade {
    pub ethereum: u64,
    pub cosmos_hop1: u64,
    pub cosmos_hop2: u64,
    pub final_hop: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct RoutingConfig {
    /// Maximum number of hops allowed in a route
    pub max_hops: u8,
    /// Maximum number of routes to explore during pathfinding
    pub max_routes_to_explore: u32,
    /// Minimal amount for routing
    pub minimal_amount: Uint128,
    /// Pool discovery range
    pub pool_discovery_range: PoolDiscoveryRange,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct PoolDiscoveryRange {
    pub start: u64,
    pub end: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct ChainConfig {
    pub chain_id: String,
    pub address_prefix: String,
    pub denom: String,
    pub decimals: u8,
    pub router_address: String,
    pub ibc_channels: Vec<IbcChannel>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct IbcChannel {
    pub target_chain: String,
    pub channel_id: String,
}

/// Default configuration values
impl Default for ProtocolConfig {
    fn default() -> Self {
        Self {
            swap: SwapConfig {
                timelock: TimelockConfig {
                    max_duration: 172800, // 48 hours
                    cascade: TimelockCascade {
                        ethereum: 172800,      // 48 hours
                        cosmos_hop1: 86400,    // 24 hours
                        cosmos_hop2: 43200,    // 12 hours
                        final_hop: 21600,      // 6 hours
                    },
                },
            },
            routing: RoutingConfig {
                max_hops: 4,
                max_routes_to_explore: 100,
                minimal_amount: Uint128::new(1000),
                pool_discovery_range: PoolDiscoveryRange {
                    start: 1,
                    end: 1000,
                },
            },
            chains: vec![
                ChainConfig {
                    chain_id: "osmosis-1".to_string(),
                    address_prefix: "osmo".to_string(),
                    denom: "uosmo".to_string(),
                    decimals: 6,
                    router_address: "osmo1router_placeholder".to_string(),
                    ibc_channels: vec![
                        IbcChannel {
                            target_chain: "cosmos".to_string(),
                            channel_id: "channel-0".to_string(),
                        },
                        IbcChannel {
                            target_chain: "juno".to_string(),
                            channel_id: "channel-42".to_string(),
                        },
                    ],
                },
                ChainConfig {
                    chain_id: "cosmoshub-4".to_string(),
                    address_prefix: "cosmos".to_string(),
                    denom: "uatom".to_string(),
                    decimals: 6,
                    router_address: "cosmos1router_placeholder".to_string(),
                    ibc_channels: vec![IbcChannel {
                        target_chain: "osmosis".to_string(),
                        channel_id: "channel-141".to_string(),
                    }],
                },
                ChainConfig {
                    chain_id: "juno-1".to_string(),
                    address_prefix: "juno".to_string(),
                    denom: "ujuno".to_string(),
                    decimals: 6,
                    router_address: "juno1router_placeholder".to_string(),
                    ibc_channels: vec![IbcChannel {
                        target_chain: "osmosis".to_string(),
                        channel_id: "channel-0".to_string(),
                    }],
                },
            ],
        }
    }
}

/// Helper functions for accessing configuration
impl ProtocolConfig {
    pub fn get_max_timelock_duration(&self) -> u64 {
        self.swap.timelock.max_duration
    }

    pub fn get_max_hops(&self) -> u8 {
        self.routing.max_hops
    }

    pub fn get_chain_config(&self, chain_id: &str) -> Option<&ChainConfig> {
        self.chains.iter().find(|c| c.chain_id == chain_id)
    }

    pub fn get_router_address(&self, chain_id: &str) -> Option<String> {
        self.get_chain_config(chain_id)
            .map(|c| c.router_address.clone())
    }

    pub fn get_ibc_channel(&self, from_chain: &str, to_chain: &str) -> Option<String> {
        self.get_chain_config(from_chain)
            .and_then(|c| {
                c.ibc_channels.iter()
                    .find(|ch| ch.target_chain == to_chain)
                    .map(|ch| ch.channel_id.clone())
            })
    }
}

/// Storage key for protocol configuration
pub const PROTOCOL_CONFIG: &str = "protocol_config";

/// Configuration loader that can load from various sources
impl ProtocolConfig {
    /// Load configuration from environment or default values
    pub fn load_from_env() -> Self {
        // For now, use defaults. In production, this would load from environment variables
        // or configuration files passed during contract instantiation
        Self::default()
    }

    /// Create configuration with optional override
    pub fn with_override(override_config: Option<ProtocolConfig>) -> Self {
        override_config.unwrap_or_else(|| Self::default())
    }

    /// Validate configuration values
    pub fn validate(&self) -> cosmwasm_std::StdResult<()> {
        // Validate timelock cascade
        if self.swap.timelock.cascade.ethereum <= self.swap.timelock.cascade.cosmos_hop1 {
            return Err(cosmwasm_std::StdError::generic_err(
                "Ethereum timelock must be greater than first Cosmos hop"
            ));
        }
        
        if self.swap.timelock.cascade.cosmos_hop1 <= self.swap.timelock.cascade.cosmos_hop2 {
            return Err(cosmwasm_std::StdError::generic_err(
                "Cosmos hop 1 timelock must be greater than hop 2"
            ));
        }
        
        if self.swap.timelock.cascade.cosmos_hop2 <= self.swap.timelock.cascade.final_hop {
            return Err(cosmwasm_std::StdError::generic_err(
                "Cosmos hop 2 timelock must be greater than final hop"
            ));
        }

        // Validate routing parameters
        if self.routing.max_hops == 0 || self.routing.max_hops > 10 {
            return Err(cosmwasm_std::StdError::generic_err(
                "Max hops must be between 1 and 10"
            ));
        }

        if self.routing.max_routes_to_explore == 0 || self.routing.max_routes_to_explore > 1000 {
            return Err(cosmwasm_std::StdError::generic_err(
                "Max routes to explore must be between 1 and 1000"
            ));
        }

        // Validate pool discovery range
        if self.routing.pool_discovery_range.start >= self.routing.pool_discovery_range.end {
            return Err(cosmwasm_std::StdError::generic_err(
                "Pool discovery start must be less than end"
            ));
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config() {
        let config = ProtocolConfig::default();
        assert_eq!(config.swap.timelock.max_duration, 172800);
        assert_eq!(config.routing.max_hops, 4);
        assert_eq!(config.chains.len(), 3);
    }

    #[test]
    fn test_get_chain_config() {
        let config = ProtocolConfig::default();
        let osmosis = config.get_chain_config("osmosis-1");
        assert!(osmosis.is_some());
        assert_eq!(osmosis.unwrap().address_prefix, "osmo");
    }

    #[test]
    fn test_get_ibc_channel() {
        let config = ProtocolConfig::default();
        let channel = config.get_ibc_channel("osmosis-1", "cosmos");
        assert_eq!(channel, Some("channel-0".to_string()));
    }
}