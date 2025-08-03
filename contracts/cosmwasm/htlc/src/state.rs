use cosmwasm_schema::cw_serde;
use cosmwasm_std::{Addr, Coin};
use cw_storage_plus::{Item, Map};
use crate::dex::SwapParams;
use fusion_plus::ProtocolConfig;

#[cw_serde]
pub struct Config {
    pub admin: Addr,
    pub protocol_config: ProtocolConfig,
}

#[cw_serde]
pub struct Htlc {
    pub sender: Addr,
    pub receiver: Addr,
    pub amount: Vec<Coin>,
    pub hashlock: String,
    pub timelock: u64,
    pub withdrawn: bool,
    pub refunded: bool,
    pub target_chain: String,
    pub target_address: String,
    pub swap_params: Option<SwapParams>,
    pub swap_executed: bool,
}

pub const CONFIG: Item<Config> = Item::new("config");
pub const HTLCS: Map<&str, Htlc> = Map::new("htlcs");
pub const HTLC_COUNT: Item<u64> = Item::new("htlc_count");