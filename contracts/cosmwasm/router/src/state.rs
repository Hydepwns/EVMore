use cosmwasm_schema::cw_serde;
use cosmwasm_std::Addr;
use cw_storage_plus::{Item, Map};
use crate::msg::{ChainConfig, PoolInfo};
use fusion_plus::{ProtocolConfig, load_config, save_config};

#[cw_serde]
pub struct Config {
    pub admin: Addr,
    pub registry_contract: Option<Addr>,
}

pub const CONFIG: Item<Config> = Item::new("config");
pub const CHAIN_CONFIGS: Map<&str, ChainConfig> = Map::new("chain_configs");
pub const POOL_REGISTRY: Map<u64, PoolInfo> = Map::new("pool_registry");
pub const POOL_PAIRS: Map<(&str, &str), Vec<u64>> = Map::new("pool_pairs"); // (denom1, denom2) -> pool_ids
pub const ROUTER_REGISTRY: Map<&str, String> = Map::new("router_registry"); // chain_id -> router_address

/// Load protocol configuration from storage  
pub fn load_protocol_config(storage: &dyn cosmwasm_std::Storage) -> cosmwasm_std::StdResult<ProtocolConfig> {
    load_config(storage)
}

/// Save protocol configuration to storage with validation
pub fn save_protocol_config(storage: &mut dyn cosmwasm_std::Storage, config: &ProtocolConfig) -> cosmwasm_std::StdResult<()> {
    save_config(storage, config)
}