use cosmwasm_schema::cw_serde;
use cosmwasm_std::Addr;
use cw_storage_plus::{Item, Map};
use crate::msg::{ChainInfo, IBCPath};

#[cw_serde]
pub struct Config {
    pub admin: Addr,
}

pub const CONFIG: Item<Config> = Item::new("config");
pub const CHAINS: Map<&str, ChainInfo> = Map::new("chains");
pub const IBC_PATHS: Map<&str, IBCPath> = Map::new("ibc_paths");
pub const CHAIN_CONNECTIONS: Map<(&str, &str), String> = Map::new("chain_connections"); // (source, dest) -> path_id
pub const CHAIN_COUNT: Item<u64> = Item::new("chain_count");
pub const PATH_COUNT: Item<u64> = Item::new("path_count");