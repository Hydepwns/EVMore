/**
 * Comprehensive Input Validation Example
 * 
 * This example demonstrates the input validation and sanitization
 * implementation in the 1inch Fusion+ Cosmos Extension.
 */

import express from 'express';
import { createValidationMiddleware } from '../../relayer/src/middleware/input-validation';
import { validateIBCTransferParams, validateHTLCMemo } from '../../relayer/src/validation/ibc-validation';
import { validateCrossChainSwapParams, RateLimitChecker } from '../../sdk/src/validation/enhanced-validation';
import { createLogger } from '../../relayer/src/utils/logger';

// Example: API Endpoint Validation
function demonstrateAPIValidation() {
  const app = express();
  const logger = createLogger({ level: 'info' });
  const validation = createValidationMiddleware(logger);

  app.use(express.json({ limit: '1mb' }));

  // 1. Emergency stop with validation
  app.post('/emergency-stop', validation.validateEmergencyStop, (req, res) => {
    // Input is already validated and sanitized
    const { reason } = req.body;
    console.log('Emergency stop reason (sanitized):', reason);
    res.json({ status: 'stopped', reason });
  });

  // 2. Blacklist management with IP validation
  app.post('/blacklist/:ip', validation.validateBlacklistAdd, (req, res) => {
    const { ip } = req.params;
    const { reason, duration } = req.body;
    console.log('Blacklisting IP:', ip);
    console.log('Reason (sanitized):', reason);
    console.log('Duration:', duration || 'permanent');
    res.json({ blacklisted: ip, reason, duration });
  });

  // 3. Circuit breaker control with name validation
  app.post('/circuit-breaker/:name/trip', validation.validateCircuitBreaker, (req, res) => {
    const { name } = req.params;
    const { reason } = req.body;
    console.log('Tripping circuit breaker:', name);
    console.log('Reason:', reason || 'Manual trip');
    res.json({ circuitBreaker: name, status: 'open', reason });
  });

  // 4. Custom validation for swap endpoints
  app.post('/swap/create', [
    validation.validateSwapCreation,
    validation.validateDEXSwap
  ], (req, res) => {
    // All swap parameters are validated
    console.log('Creating swap with validated parameters');
    res.json({ status: 'swap_created', validated: true });
  });

  return app;
}

// Example: IBC Transfer Validation
async function demonstrateIBCValidation() {
  console.log('\n=== IBC Transfer Validation ===');

  // Valid IBC transfer
  const validTransfer = {
    sourceChannel: 'channel-0',
    sourcePort: 'transfer',
    receiver: 'osmo1abc123def456...',
    amount: '1000000',
    denom: 'uatom',
    timeoutTimestamp: Date.now() + 300000, // 5 minutes
    memo: JSON.stringify({
      type: 'htlc_create',
      htlcId: '0x' + '1'.repeat(64),
      receiver: 'osmo1xyz789...',
      hashlock: '2'.repeat(64),
      timelock: Math.floor(Date.now() / 1000) + 3600,
      targetChain: 'osmosis-1',
      targetAddress: 'osmo1xyz789...',
      sourceChain: 'ethereum',
      sourceHTLCId: '0x' + '1'.repeat(64)
    })
  };

  const result = validateIBCTransferParams(validTransfer);
  console.log('Valid transfer:', result.valid);
  console.log('Errors:', result.errors);

  // Invalid IBC transfer (bad channel)
  const invalidTransfer = {
    ...validTransfer,
    sourceChannel: 'invalid-channel',
    timeoutTimestamp: Date.now() - 1000 // Past timestamp
  };

  const invalidResult = validateIBCTransferParams(invalidTransfer);
  console.log('\nInvalid transfer:', invalidResult.valid);
  console.log('Errors:', invalidResult.errors);

  // Validate HTLC memo
  const htlcMemo = JSON.parse(validTransfer.memo!);
  const memoValid = validateHTLCMemo(htlcMemo);
  console.log('\nHTLC memo valid:', memoValid);
}

// Example: SDK Parameter Validation
async function demonstrateSDKValidation() {
  console.log('\n=== SDK Parameter Validation ===');

  // Valid swap parameters
  const validSwap = {
    sourceChain: 'ethereum' as const,
    targetChain: 'osmosis-1',
    amount: '100.5',
    sender: '0x742d35Cc6634C0532925a3b844Bc9e7595f8b23a',
    receiver: 'osmo1clpqr4nrk4khgkxj78fcwwh6dl3uw4ep88n0y4',
    sourceTokenAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
    sourceTokenDecimals: 6,
    targetTokenAddress: 'uosmo',
    minOutputAmount: '95.0',
    slippageTolerance: 2.5,
    timelock: Math.floor(Date.now() / 1000) + 7200, // 2 hours
    memo: 'Cross-chain swap via 1inch Fusion+'
  };

  const validation = validateCrossChainSwapParams(validSwap);
  console.log('Valid swap:', validation.valid);
  console.log('Sanitized amount:', validation.sanitized?.amount);
  console.log('Sanitized addresses:', {
    sender: validation.sanitized?.sender,
    receiver: validation.sanitized?.receiver
  });

  // Invalid swap parameters
  const invalidSwap = {
    ...validSwap,
    amount: '-100', // Negative amount
    sender: 'invalid-address',
    slippageTolerance: 100, // Too high
    timelock: Math.floor(Date.now() / 1000) - 1000 // Past timelock
  };

  const invalidValidation = validateCrossChainSwapParams(invalidSwap);
  console.log('\nInvalid swap:', invalidValidation.valid);
  console.log('Errors:', invalidValidation.errors);
}

// Example: Rate Limiting
function demonstrateRateLimiting() {
  console.log('\n=== Rate Limiting Example ===');

  const rateLimiter = new RateLimitChecker(5, 10000); // 5 attempts per 10 seconds

  // Simulate multiple requests
  const userId = 'user123';
  
  for (let i = 1; i <= 7; i++) {
    const result = rateLimiter.checkLimit(userId);
    console.log(`Attempt ${i}:`, {
      allowed: result.allowed,
      remaining: result.remainingAttempts
    });
  }

  // Reset for a user
  rateLimiter.reset(userId);
  console.log('\nAfter reset:');
  const afterReset = rateLimiter.checkLimit(userId);
  console.log('Allowed:', afterReset.allowed);
  console.log('Remaining:', afterReset.remainingAttempts);
}

// Example: Security Pattern Detection
function demonstrateSecurityChecks() {
  console.log('\n=== Security Pattern Detection ===');

  const suspiciousInputs = [
    'normal input',
    '<script>alert("xss")</script>',
    "'; DROP TABLE users; --",
    'rm -rf /',
    'https://example.com/../../../etc/passwd',
    'data\x00with\x00null\x00bytes'
  ];

  for (const input of suspiciousInputs) {
    console.log(`\nChecking: "${input}"`);
    
    // Basic sanitization
    const sanitized = input
      .replace(/<[^>]*>/g, '') // Remove HTML tags
      .replace(/[;&|]/g, '') // Remove command separators
      .replace(/\.\./g, '') // Remove path traversal
      .replace(/\x00/g, ''); // Remove null bytes
    
    console.log(`Sanitized: "${sanitized}"`);
    console.log('Safe:', sanitized === input ? 'Yes' : 'No - potentially malicious');
  }
}

// Example: Comprehensive Validation Flow
async function demonstrateCompleteFlow() {
  console.log('\n=== Complete Validation Flow ===');

  // 1. Receive user input
  const userInput = {
    swap: {
      amount: '  1000.50  ', // Whitespace
      sender: '0X742D35CC6634C0532925A3B844BC9E7595F8B23A', // Mixed case
      receiver: 'osmo1clpqr4nrk4khgkxj78fcwwh6dl3uw4ep88n0y4',
      memo: 'Test swap <script>alert(1)</script>' // Potential XSS
    },
    ibc: {
      channel: 'channel-141',
      memo: {
        forward: {
          receiver: 'cosmos1xyz...',
          port: 'transfer',
          channel: 'channel-0',
          retries: 3
        }
      }
    }
  };

  // 2. Validate and sanitize swap
  console.log('Original amount:', userInput.swap.amount);
  console.log('Original sender:', userInput.swap.sender);
  console.log('Original memo:', userInput.swap.memo);

  // 3. Apply sanitization
  const sanitized = {
    amount: userInput.swap.amount.trim(),
    sender: userInput.swap.sender.toLowerCase(),
    receiver: userInput.swap.receiver,
    memo: userInput.swap.memo.replace(/<[^>]*>/g, '')
  };

  console.log('\nSanitized:');
  console.log('Amount:', sanitized.amount);
  console.log('Sender:', sanitized.sender);
  console.log('Memo:', sanitized.memo);

  // 4. Validate IBC parameters
  const ibcValid = userInput.ibc.channel.match(/^channel-\d+$/);
  console.log('\nIBC channel valid:', !!ibcValid);

  // 5. Final security check
  const allInputsSafe = !userInput.swap.memo.includes('<script>');
  console.log('Security check passed:', allInputsSafe);
}

// Run all examples
async function main() {
  console.log('Input Validation and Sanitization Examples\n');

  // API validation
  const app = demonstrateAPIValidation();
  console.log('API server with validation configured');

  // IBC validation
  await demonstrateIBCValidation();

  // SDK validation
  await demonstrateSDKValidation();

  // Rate limiting
  demonstrateRateLimiting();

  // Security checks
  demonstrateSecurityChecks();

  // Complete flow
  await demonstrateCompleteFlow();

  console.log('\n✅ All validation examples completed');
}

// Execute examples
main().catch(console.error);