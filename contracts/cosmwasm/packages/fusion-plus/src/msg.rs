use cosmwasm_std::Addr;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::config::ProtocolConfig;

/// Shared instantiate message structure
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct InstantiateMsg {
    /// Optional protocol configuration override
    pub config: Option<ProtocolConfig>,
    /// Contract-specific admin address
    pub admin: Option<String>,
}

/// Shared execute message types
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ExecuteMsg {
    /// Update protocol configuration (admin only)
    UpdateConfig { config: ProtocolConfig },
    /// Update admin address (admin only)
    UpdateAdmin { admin: Addr },
}

/// Shared query message types
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum QueryMsg {
    /// Get current protocol configuration
    GetConfig {},
    /// Get admin address
    GetAdmin {},
}

/// Configuration query response
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct ConfigResponse {
    pub config: ProtocolConfig,
}

/// Admin query response
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct AdminResponse {
    pub admin: Addr,
}