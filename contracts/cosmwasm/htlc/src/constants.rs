/// DEPRECATED: Configuration constants for HTLC contract
/// These values are now loaded from the protocol configuration system.
/// The HTLC contract now loads configuration dynamically from storage.

/// DEPRECATED: Use config.swap.timelock.max_duration instead
/// This value is now loaded from protocol configuration
#[deprecated(note = "Use load_protocol_config().swap.timelock.max_duration instead")]
pub const MAX_TIMELOCK_DURATION: u64 = 172800;

/// Minimum timelock duration in seconds (1 hour) - still used for validation
pub const MIN_TIMELOCK_DURATION: u64 = 3600;

/// Test timelock duration in seconds (1 hour) - still used in tests
pub const TEST_TIMELOCK_DURATION: u64 = 3600;

/// Recovery buffer before timelock expires (2 hours) - still used for recovery logic
pub const RECOVERY_BUFFER: u64 = 7200;

/// Timeout buffer for IBC operations (1 hour) - still used for IBC operations
pub const TIMEOUT_BUFFER: u64 = 3600;

/// Maximum number of active HTLCs per sender
pub const MAX_HTLCS_PER_SENDER: u32 = 100;

/// Hashlock length for SHA256 (in hex characters)
pub const HASHLOCK_LENGTH: usize = 64;

/// Default sender ID for Osmosis poolmanager queries (0 = system/no specific sender)
pub const DEFAULT_SENDER_ID: u64 = 0;

/// Standard decimal precision for token amounts (18 decimals)
pub const TOKEN_DECIMAL_PRECISION: u32 = 18;