# Configuration Validation

The relayer includes comprehensive configuration validation to ensure operational safety and prevent runtime errors.

## Validation Overview

Configuration validation occurs at two levels:

1. **Basic Validation**: Checks for required fields (existing behavior)
2. **Comprehensive Validation**: Deep validation of all configuration values including:
   - Format validation (URLs, addresses, etc.)
   - Range validation (ports, timeouts, etc.)
   - Cross-configuration consistency
   - Network connectivity tests (optional)

## Running Configuration Validation

### Standalone Validation

You can validate your configuration without starting the relayer:

```bash
npm run validate:config
```

This command will:
- Load environment variables
- Parse the configuration
- Run all validation checks
- Display errors and warnings
- Exit with appropriate status code

### Validation During Startup

The relayer automatically validates configuration during startup. If validation fails, the relayer will:
- Display detailed error messages
- Show warnings for non-critical issues
- Exit with an error code

## Configuration Fields

### General Configuration

| Field | Required | Type | Validation |
|-------|----------|------|------------|
| `LOG_LEVEL` | No | string | Must be: debug, info, warn, error |
| `PORT` | No | number | Range: 1-65535 |
| `ENABLE_METRICS` | No | boolean | true/false |
| `SHUTDOWN_TIMEOUT` | No | number | Must be non-negative, warns if < 10000ms |

### Ethereum Configuration

| Field | Required | Type | Validation |
|-------|----------|------|------------|
| `ETHEREUM_RPC_URL` | Yes | URL | Valid URL format, connectivity test |
| `ETHEREUM_HTLC_CONTRACT` | Yes | address | Valid Ethereum address format |
| `ETHEREUM_RESOLVER_CONTRACT` | No | address | Valid Ethereum address format |
| `ETHEREUM_PRIVATE_KEY` | Yes | string | Valid private key format |
| `ETHEREUM_CHAIN_ID` | Yes | number | Positive integer, matches RPC |
| `ETHEREUM_CONFIRMATIONS` | No | number | Non-negative, warns if 0 |
| `ETHEREUM_GAS_LIMIT` | No | number | Minimum: 21000, warns if > 10M |
| `ETHEREUM_GAS_PRICE` | No | string | Valid gwei format |

### Cosmos Configuration

| Field | Required | Type | Validation |
|-------|----------|------|------------|
| `COSMOS_RPC_URL` | Yes | URL | Valid URL format |
| `COSMOS_REST_URL` | Yes | URL | Valid URL format |
| `COSMOS_CHAIN_ID` | Yes | string | Non-empty string |
| `COSMOS_HTLC_CONTRACT` | Yes | address | Valid Bech32 format, correct prefix |
| `COSMOS_MNEMONIC` | Yes | string | 12 or 24 words |
| `COSMOS_GAS_PRICE` | Yes | string | Format: `<amount><denom>` |
| `COSMOS_GAS_LIMIT` | No | number | Warns if < 100000 or > 10M |
| `COSMOS_DENOM` | Yes | string | Lowercase letters only |
| `COSMOS_ADDRESS_PREFIX` | Yes | string | Lowercase letters only |

### Chain Registry Configuration

| Field | Required | Type | Validation |
|-------|----------|------|------------|
| `CHAIN_REGISTRY_URL` | No | URL | Valid URL format |
| `CHAIN_REGISTRY_CACHE_TIMEOUT` | No | number | Warns if < 60s or > 24h |
| `CHAIN_REGISTRY_REFRESH_INTERVAL` | No | number | Minimum: 60s, should be > cache timeout |

### Relay Configuration

| Field | Required | Type | Validation |
|-------|----------|------|------------|
| `RELAY_MAX_RETRIES` | No | number | Non-negative, warns if > 10 |
| `RELAY_RETRY_DELAY` | No | number | Warns if < 1000ms or > 60000ms |
| `RELAY_BATCH_SIZE` | No | number | Minimum: 1, warns if > 100 |
| `RELAY_PROCESSING_INTERVAL` | No | number | Warns if < 1000ms |
| `RELAY_TIMEOUT_BUFFER` | No | number | Minimum: 300s, warns if > 7200s |

### Recovery Configuration

| Field | Required | Type | Validation |
|-------|----------|------|------------|
| `RECOVERY_ENABLED` | No | boolean | true/false |
| `RECOVERY_CHECK_INTERVAL` | No | number | Warns if < 10s or > 5m |
| `RECOVERY_REFUND_BUFFER` | No | number | Minimum: 600s, must be < timeout buffer |

## Cross-Configuration Validation

The validator also checks consistency across different configuration sections:

1. **Recovery vs Relay Buffers**: Recovery refund buffer must be less than relay timeout buffer
2. **Processing Capacity**: Processing interval should allow enough time for configured batch size
3. **Network Consistency**: Warns if Ethereum and Cosmos are on different network types (mainnet/testnet)

## Validation Errors vs Warnings

- **Errors**: Critical issues that will prevent the relayer from functioning correctly
  - Missing required fields
  - Invalid formats (addresses, URLs, etc.)
  - Values outside acceptable ranges
  - Inconsistent configuration

- **Warnings**: Non-critical issues that may impact performance or reliability
  - Suboptimal timeout values
  - Potentially problematic settings
  - Performance considerations

## Example Output

### Successful Validation
```
✅ Configuration is valid
```

### Failed Validation
```
❌ Configuration validation failed

Errors:
  ❌ ethereum.htlcContractAddress: Invalid Ethereum contract address
  ❌ cosmos.mnemonic: Mnemonic must be 12 or 24 words
  ❌ recovery.refundBuffer: Recovery refund buffer must be less than relay timeout buffer

Warnings:
  ⚠️  ethereum.confirmations: Zero confirmations may lead to reorg issues
  ⚠️  relay.batchSize: Large batch sizes may cause timeout issues
```

## Environment-Specific Validation

The validator automatically detects test environments (`NODE_ENV=test`) and skips:
- Network connectivity tests
- RPC endpoint validation

This allows tests to run without requiring actual blockchain connections.

## Custom Validation Rules

You can extend the validator by adding custom validation rules in `src/config/validator.ts`:

```typescript
// Example: Add custom validation for a new field
private validateCustomField(value: string): void {
  if (!value.match(/^CUSTOM-\d+$/)) {
    this.addError('custom.field', 'Must match pattern CUSTOM-<number>');
  }
}
```

## Best Practices

1. **Run validation before deployment**: Use `npm run validate:config` in CI/CD
2. **Address all errors**: The relayer won't start with validation errors
3. **Review warnings**: They often indicate potential issues
4. **Test configuration changes**: Validate after any environment variable changes
5. **Use appropriate values**: Follow the recommended ranges in validation messages