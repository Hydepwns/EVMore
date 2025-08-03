use cosmwasm_std::StdError;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum ContractError {
    #[error("{0}")]
    Std(#[from] StdError),

    #[error("Unauthorized")]
    Unauthorized {},

    #[error("HTLC does not exist")]
    HtlcNotFound {},

    #[error("HTLC already exists")]
    HtlcAlreadyExists {},

    #[error("Invalid secret")]
    InvalidSecret {},

    #[error("Timelock not expired")]
    TimelockNotExpired {},

    #[error("Timelock already expired")]
    TimelockExpired {},

    #[error("HTLC already withdrawn")]
    AlreadyWithdrawn {},

    #[error("HTLC already refunded")]
    AlreadyRefunded {},

    #[error("Invalid amount")]
    InvalidAmount {},

    #[error("Invalid timelock")]
    InvalidTimelock {},

    #[error("Invalid hash format")]
    InvalidHashFormat {},

    #[error("Target chain required")]
    TargetChainRequired {},

    #[error("Target address required")]
    TargetAddressRequired {},
    
    #[error("Insufficient output amount")]
    InsufficientOutputAmount {},
    
    #[error("Swap already executed")]
    SwapAlreadyExecuted {},
}