/**
 * Test helpers for Ethereum contract tests
 * Uses centralized configuration for test values
 */

const { ethers } = require("hardhat");

// Import test configuration values
const testConfig = {
  // Default test values - these can be overridden by environment variables
  testTimelock: parseInt(process.env.TEST_TIMELOCK_DURATION || "3600"), // 1 hour
  testAmount: process.env.TEST_TOKEN_AMOUNT || "1000",
  testCosmosAddress: process.env.TEST_COSMOS_ADDRESS || "cosmos1abc123def456ghi789jkl012mno345pqr678stu",
  testHashlock: process.env.TEST_HASHLOCK || "0xa665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3",
  testSecret: process.env.TEST_SECRET || "0x0101010101010101010101010101010101010101010101010101010101010101"
};

/**
 * Get test timelock (current time + configured duration)
 */
async function getTestTimelock(offsetSeconds = 0) {
  const { time } = require("@nomicfoundation/hardhat-network-helpers");
  const latest = await time.latest();
  return latest + testConfig.testTimelock + offsetSeconds;
}

/**
 * Generate test HTLC parameters
 */
async function generateTestHTLCParams(overrides = {}) {
  const secret = overrides.secret || ethers.randomBytes(32);
  const hashlock = overrides.hashlock || ethers.sha256(secret);
  const timelock = overrides.timelock || await getTestTimelock();
  
  return {
    amount: ethers.parseEther(overrides.amount || "100"),
    token: overrides.token,
    hashlock,
    timelock,
    targetChain: overrides.targetChain || "cosmoshub-4",
    targetAddress: overrides.targetAddress || testConfig.testCosmosAddress,
    secret
  };
}

/**
 * Create a test HTLC
 */
async function createTestHTLC(htlc, mockToken, user, params = {}) {
  const htlcParams = await generateTestHTLCParams(params);
  
  // Approve token transfer
  await mockToken.connect(user).approve(
    await htlc.getAddress(),
    htlcParams.amount
  );
  
  // Create HTLC
  const tx = await htlc.connect(user).createHTLC(
    htlcParams.token || await mockToken.getAddress(),
    htlcParams.amount,
    htlcParams.hashlock,
    htlcParams.timelock,
    htlcParams.targetChain,
    htlcParams.targetAddress
  );
  
  const receipt = await tx.wait();
  const event = receipt.logs.find(log => log.fragment?.name === 'HTLCCreated');
  const htlcId = event.args[0];
  
  return {
    htlcId,
    ...htlcParams,
    tx,
    receipt
  };
}

module.exports = {
  testConfig,
  getTestTimelock,
  generateTestHTLCParams,
  createTestHTLC
};