use cosmwasm_std::{StdError, IbcOrder};
use thiserror::Error;

#[derive(Error, Debug)]
pub enum ContractError {
    #[error("{0}")]
    Std(#[from] StdError),

    #[error("Unauthorized")]
    Unauthorized {},

    #[error("Chain not supported: {chain_id}")]
    ChainNotSupported { chain_id: String },

    #[error("Pool not found: {pool_id}")]
    PoolNotFound { pool_id: u64 },

    #[error("Invalid route: no path found")]
    NoRouteFound {},

    #[error("Invalid route: too many hops (max: {max}, requested: {requested})")]
    TooManyHops { max: u32, requested: u32 },

    #[error("Insufficient liquidity in pool {pool_id}")]
    InsufficientLiquidity { pool_id: u64 },

    #[error("Slippage exceeded: expected {expected}, got {actual}")]
    SlippageExceeded { expected: String, actual: String },

    #[error("Invalid pool configuration")]
    InvalidPoolConfig {},

    #[error("Duplicate pool registration: {pool_id}")]
    DuplicatePool { pool_id: u64 },

    #[error("Invalid IBC channel order: expected {expected:?}, got {actual:?}")]
    InvalidIbcChannelOrder { expected: IbcOrder, actual: IbcOrder },

    #[error("Invalid IBC version: expected {expected}, got {actual}")]
    InvalidIbcVersion { expected: String, actual: String },

    #[error("Invalid input: {msg}")]
    InvalidInput { msg: String },
}