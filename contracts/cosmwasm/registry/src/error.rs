use cosmwasm_std::StdError;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum ContractError {
    #[error("{0}")]
    Std(#[from] StdError),

    #[error("Unauthorized")]
    Unauthorized {},

    #[error("Chain already registered: {chain_id}")]
    ChainAlreadyExists { chain_id: String },

    #[error("Chain not found: {chain_id}")]
    ChainNotFound { chain_id: String },

    #[error("IBC path already registered: {path_id}")]
    PathAlreadyExists { path_id: String },

    #[error("IBC path not found: {path_id}")]
    PathNotFound { path_id: String },

    #[error("Invalid chain configuration")]
    InvalidChainConfig {},

    #[error("Invalid IBC path configuration")]
    InvalidPathConfig {},

    #[error("No route found")]
    NoRouteFound {},

    #[error("Maximum hop limit exceeded: {max_hops}")]
    MaxHopsExceeded { max_hops: u32 },
}