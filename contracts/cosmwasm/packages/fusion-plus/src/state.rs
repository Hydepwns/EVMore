use cosmwasm_std::{Addr, StdResult, Storage};
use cw_storage_plus::Item;

use crate::config::{ProtocolConfig, PROTOCOL_CONFIG};

/// Protocol configuration storage
pub const CONFIG: Item<ProtocolConfig> = Item::new(PROTOCOL_CONFIG);
/// Admin address storage
pub const ADMIN: Item<Addr> = Item::new("admin");

/// Configuration storage helpers
pub fn load_config(storage: &dyn Storage) -> StdResult<ProtocolConfig> {
    CONFIG.load(storage)
}

pub fn save_config(storage: &mut dyn Storage, config: &ProtocolConfig) -> StdResult<()> {
    // Validate before saving
    config.validate()?;
    CONFIG.save(storage, config)
}

pub fn load_admin(storage: &dyn Storage) -> StdResult<Addr> {
    ADMIN.load(storage)
}

pub fn save_admin(storage: &mut dyn Storage, admin: &Addr) -> StdResult<()> {
    ADMIN.save(storage, admin)
}

/// Helper to get timelock cascade values based on hop number
pub fn get_timelock_for_hop(config: &ProtocolConfig, hop: u8) -> u64 {
    match hop {
        0 => config.swap.timelock.cascade.ethereum,
        1 => config.swap.timelock.cascade.cosmos_hop1,
        2 => config.swap.timelock.cascade.cosmos_hop2,
        _ => config.swap.timelock.cascade.final_hop,
    }
}

/// Helper to validate timelock against configuration
pub fn validate_timelock(config: &ProtocolConfig, timelock: u64, current_time: u64) -> StdResult<()> {
    use cosmwasm_std::StdError;
    
    if timelock <= current_time {
        return Err(StdError::generic_err("Timelock must be in the future"));
    }
    
    let max_duration = config.get_max_timelock_duration();
    if timelock > current_time + max_duration {
        return Err(StdError::generic_err(format!(
            "Timelock exceeds maximum duration of {} seconds", 
            max_duration
        )));
    }
    
    Ok(())
}