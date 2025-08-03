/// DEPRECATED: Configuration constants for Router contract
/// These values are now loaded from the protocol configuration system.
/// Use load_protocol_config() and access config.routing.* instead.

/// DEPRECATED: Use config.routing.max_hops instead
#[deprecated(note = "Use load_protocol_config().routing.max_hops instead")]
pub const MAX_ROUTE_HOPS: usize = 4;

/// DEPRECATED: Use config.routing.max_routes_to_explore instead  
#[deprecated(note = "Use load_protocol_config().routing.max_routes_to_explore instead")]
pub const MAX_ROUTES_TO_EXPLORE: usize = 100;

/// DEPRECATED: Use dynamic channel discovery instead
#[deprecated(note = "Use dynamic IBC channel discovery from chain registry")]
pub const DEFAULT_IBC_CHANNEL: &str = "channel-0";

/// IBC transfer timeout in seconds (still used for IBC operations)
pub const IBC_TRANSFER_TIMEOUT: u64 = 600; // 10 minutes

/// IBC timeout buffer in seconds (buffer before overall timeout expires)
pub const IBC_TIMEOUT_BUFFER: u64 = 300; // 5 minutes

// DEPRECATED: Use config.routing.pool_discovery_range instead
// Note: These constants have been removed as they are no longer used.
// Pool discovery now uses dynamic configuration loaded from protocol config.