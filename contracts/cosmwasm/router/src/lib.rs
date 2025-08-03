pub mod constants;
pub mod contract;
pub mod error;
pub mod ibc;
pub mod msg;
pub mod registry_integration;
pub mod routing;
pub mod state;

// Test-only module - not included in production builds
#[cfg(test)]
pub mod test_helpers;

pub use crate::error::ContractError;