import { Logger } from 'pino';

/**
 * IBC-specific validation utilities
 */

// IBC channel format: channel-{N}
const IBC_CHANNEL_REGEX = /^channel-\d+$/;

// IBC port format: transfer, wasm.{contract_address}, etc.
const IBC_PORT_REGEX = /^(transfer|wasm\.[a-z0-9]+|[a-z]+)$/;

// IBC denom format: ibc/{hash} or native denom
const IBC_DENOM_REGEX = /^(ibc\/[A-F0-9]{64}|[a-z]+)$/i;

// Maximum IBC packet memo size (varies by chain, using conservative limit)
const MAX_IBC_MEMO_SIZE = 256;

// Maximum timeout for IBC packets (in seconds)
const MAX_IBC_TIMEOUT = 3600; // 1 hour

// Minimum timeout for IBC packets (in seconds)
const MIN_IBC_TIMEOUT = 60; // 1 minute

export interface IBCTransferParams {
  sourceChannel: string;
  sourcePort?: string;
  receiver: string;
  amount: string;
  denom: string;
  timeoutHeight?: number;
  timeoutTimestamp?: number;
  memo?: string;
}

export interface IBCMemoHTLC {
  type: 'htlc_create';
  htlcId: string;
  receiver: string;
  hashlock: string;
  timelock: number;
  targetChain: string;
  targetAddress: string;
  sourceChain: string;
  sourceHTLCId: string;
}

export interface IBCPacketForward {
  forward: {
    receiver: string;
    port: string;
    channel: string;
    timeout?: string;
    retries?: number;
  };
}

/**
 * Validate IBC channel format
 */
export function validateIBCChannel(channel: string): boolean {
  return IBC_CHANNEL_REGEX.test(channel);
}

/**
 * Validate IBC port format
 */
export function validateIBCPort(port: string): boolean {
  return IBC_PORT_REGEX.test(port);
}

/**
 * Validate IBC denom format
 */
export function validateIBCDenom(denom: string): boolean {
  return IBC_DENOM_REGEX.test(denom);
}

/**
 * Validate IBC timeout
 */
export function validateIBCTimeout(
  timeoutHeight?: number,
  timeoutTimestamp?: number
): { valid: boolean; error?: string } {
  // At least one timeout must be specified
  if (!timeoutHeight && !timeoutTimestamp) {
    return { valid: false, error: 'Either timeout height or timestamp must be specified' };
  }

  // Validate timeout height if provided
  if (timeoutHeight !== undefined) {
    if (timeoutHeight <= 0) {
      return { valid: false, error: 'Timeout height must be positive' };
    }
    if (timeoutHeight > Number.MAX_SAFE_INTEGER) {
      return { valid: false, error: 'Timeout height too large' };
    }
  }

  // Validate timeout timestamp if provided
  if (timeoutTimestamp !== undefined) {
    const now = Date.now();
    const minTimeout = now + MIN_IBC_TIMEOUT * 1000;
    const maxTimeout = now + MAX_IBC_TIMEOUT * 1000;

    if (timeoutTimestamp <= now) {
      return { valid: false, error: 'Timeout timestamp must be in the future' };
    }
    if (timeoutTimestamp < minTimeout) {
      return { valid: false, error: `Timeout too short (minimum ${MIN_IBC_TIMEOUT} seconds)` };
    }
    if (timeoutTimestamp > maxTimeout) {
      return { valid: false, error: `Timeout too long (maximum ${MAX_IBC_TIMEOUT} seconds)` };
    }
  }

  return { valid: true };
}

/**
 * Validate and sanitize IBC memo field
 */
export function validateIBCMemo(memo: string | object): { 
  valid: boolean; 
  sanitized?: string; 
  error?: string 
} {
  try {
    let memoStr: string;

    // Convert object to JSON string if needed
    if (typeof memo === 'object') {
      memoStr = JSON.stringify(memo);
    } else {
      memoStr = memo;
    }

    // Check size limit
    if (memoStr.length > MAX_IBC_MEMO_SIZE) {
      return { 
        valid: false, 
        error: `Memo too large (${memoStr.length} bytes, max ${MAX_IBC_MEMO_SIZE})` 
      };
    }

    // Check for potentially malicious content
    if (containsMaliciousContent(memoStr)) {
      return { valid: false, error: 'Memo contains potentially malicious content' };
    }

    // Sanitize the memo
    const sanitized = sanitizeIBCMemo(memoStr);

    return { valid: true, sanitized };
  } catch (error) {
    return { 
      valid: false, 
      error: `Invalid memo format: ${error instanceof Error ? error.message : 'Unknown error'}` 
    };
  }
}

/**
 * Validate HTLC memo structure
 */
export function validateHTLCMemo(memo: unknown): memo is IBCMemoHTLC {
  if (!memo || typeof memo !== 'object') {
    return false;
  }

  const m = memo as any;

  // Check required fields
  if (m.type !== 'htlc_create') return false;
  if (typeof m.htlcId !== 'string' || !m.htlcId) return false;
  if (typeof m.receiver !== 'string' || !m.receiver) return false;
  if (typeof m.hashlock !== 'string' || !m.hashlock) return false;
  if (typeof m.timelock !== 'number' || m.timelock <= 0) return false;
  if (typeof m.targetChain !== 'string' || !m.targetChain) return false;
  if (typeof m.targetAddress !== 'string' || !m.targetAddress) return false;
  if (typeof m.sourceChain !== 'string' || !m.sourceChain) return false;
  if (typeof m.sourceHTLCId !== 'string' || !m.sourceHTLCId) return false;

  // Validate hashlock format (64 hex chars)
  if (!/^[a-fA-F0-9]{64}$/.test(m.hashlock)) return false;

  // Validate timelock is reasonable
  const now = Math.floor(Date.now() / 1000);
  if (m.timelock <= now || m.timelock > now + 48 * 3600) return false;

  return true;
}

/**
 * Validate packet forward memo structure
 */
export function validatePacketForwardMemo(memo: unknown): memo is IBCPacketForward {
  if (!memo || typeof memo !== 'object') {
    return false;
  }

  const m = memo as any;

  // Check forward field
  if (!m.forward || typeof m.forward !== 'object') return false;

  const f = m.forward;

  // Check required forward fields
  if (typeof f.receiver !== 'string' || !f.receiver) return false;
  if (typeof f.port !== 'string' || !validateIBCPort(f.port)) return false;
  if (typeof f.channel !== 'string' || !validateIBCChannel(f.channel)) return false;

  // Check optional fields
  if (f.timeout !== undefined && typeof f.timeout !== 'string') return false;
  if (f.retries !== undefined && (typeof f.retries !== 'number' || f.retries < 0 || f.retries > 5)) return false;

  return true;
}

/**
 * Validate complete IBC transfer parameters
 */
export function validateIBCTransferParams(
  params: IBCTransferParams,
  logger?: Logger
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Validate channel
  if (!validateIBCChannel(params.sourceChannel)) {
    errors.push('Invalid source channel format');
  }

  // Validate port if provided
  if (params.sourcePort && !validateIBCPort(params.sourcePort)) {
    errors.push('Invalid source port format');
  }

  // Validate receiver (basic check - should be chain-specific)
  if (!params.receiver || params.receiver.length < 10) {
    errors.push('Invalid receiver address');
  }

  // Validate amount
  try {
    const amount = BigInt(params.amount);
    if (amount <= 0n) {
      errors.push('Amount must be positive');
    }
  } catch {
    errors.push('Invalid amount format');
  }

  // Validate denom
  if (!validateIBCDenom(params.denom)) {
    errors.push('Invalid denom format');
  }

  // Validate timeout
  const timeoutValidation = validateIBCTimeout(params.timeoutHeight, params.timeoutTimestamp);
  if (!timeoutValidation.valid) {
    errors.push(timeoutValidation.error!);
  }

  // Validate memo if provided
  if (params.memo) {
    const memoValidation = validateIBCMemo(params.memo);
    if (!memoValidation.valid) {
      errors.push(memoValidation.error!);
    }
  }

  if (logger && errors.length > 0) {
    logger.warn({ params, errors }, 'IBC transfer validation failed');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Check for potentially malicious content in memo
 */
function containsMaliciousContent(content: string): boolean {
  const suspicious = [
    // Script injection attempts
    /<script/i,
    /javascript:/i,
    /on\w+\s*=/i,
    
    // SQL injection patterns
    /union\s+select/i,
    /drop\s+table/i,
    /insert\s+into/i,
    /update\s+set/i,
    
    // Command injection
    /;\s*rm\s+-rf/i,
    /&&\s*curl/i,
    /\|\s*sh/i,
    
    // Path traversal
    /\.\.[\/\\]/,
    
    // Null bytes
    /\x00/,
    
    // Unicode direction override
    /[\u202A-\u202E\u2066-\u2069]/
  ];

  return suspicious.some(pattern => pattern.test(content));
}

/**
 * Sanitize IBC memo content
 */
function sanitizeIBCMemo(memo: string): string {
  // Remove any control characters except newline and tab
  let sanitized = memo.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  
  // Remove Unicode direction override characters
  sanitized = sanitized.replace(/[\u202A-\u202E\u2066-\u2069]/g, '');
  
  // Escape any remaining special characters
  sanitized = sanitized
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');
  
  return sanitized;
}

/**
 * Validate IBC multi-hop route
 */
export function validateMultiHopRoute(
  hops: Array<{ channel: string; port?: string }>,
  maxHops: number = 4
): { valid: boolean; error?: string } {
  if (!Array.isArray(hops)) {
    return { valid: false, error: 'Hops must be an array' };
  }

  if (hops.length === 0) {
    return { valid: false, error: 'At least one hop is required' };
  }

  if (hops.length > maxHops) {
    return { valid: false, error: `Too many hops (max ${maxHops})` };
  }

  for (let i = 0; i < hops.length; i++) {
    const hop = hops[i];
    
    if (!hop || typeof hop !== 'object') {
      return { valid: false, error: `Invalid hop at index ${i}` };
    }

    if (!validateIBCChannel(hop.channel)) {
      return { valid: false, error: `Invalid channel at hop ${i}` };
    }

    if (hop.port && !validateIBCPort(hop.port)) {
      return { valid: false, error: `Invalid port at hop ${i}` };
    }
  }

  return { valid: true };
}

// Export validation patterns for reuse
export const IBCValidationPatterns = {
  CHANNEL: IBC_CHANNEL_REGEX,
  PORT: IBC_PORT_REGEX,
  DENOM: IBC_DENOM_REGEX,
} as const;