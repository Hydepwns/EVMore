// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title FusionConfig
 * @notice Centralized configuration contract for the Fusion+ protocol
 * @dev This contract stores configuration values that can be updated by the owner
 */
contract FusionConfig is Ownable {
    
    constructor(address initialOwner) Ownable(initialOwner) {}
    // Timelock configuration
    uint256 public maxTimelockDuration = 172800; // 48 hours in seconds
    uint256 public minTimelockDuration = 3600; // 1 hour in seconds
    
    // Timelock cascade for multi-hop swaps
    uint256 public timelockCascadeEthereum = 172800; // 48 hours
    uint256 public timelockCascadeCosmos1 = 86400; // 24 hours
    uint256 public timelockCascadeCosmos2 = 43200; // 12 hours
    uint256 public timelockCascadeFinal = 21600; // 6 hours
    
    // Recovery configuration
    uint256 public recoveryBuffer = 7200; // 2 hours before timelock expires
    uint256 public timeoutBuffer = 3600; // 1 hour buffer for IBC operations
    
    // DoS Protection Configuration
    uint256 public maxHtlcsPerAddress = 10; // Max active HTLCs per address
    uint256 public rateLimitWindow = 3600; // 1 hour rate limit window
    uint256 public maxHtlcsPerWindow = 5; // Max HTLCs per address per window
    uint256 public minHtlcAmount = 1000000; // Minimum HTLC amount (1 USDC with 6 decimals)
    uint256 public maxHtlcAmount = 1000000000000; // Maximum HTLC amount (1M USDC)
    bool public emergencyPauseEnabled = false; // Emergency pause flag
    
    // Events
    event MaxTimelockDurationUpdated(uint256 oldValue, uint256 newValue);
    event MinTimelockDurationUpdated(uint256 oldValue, uint256 newValue);
    event TimelockCascadeUpdated(
        uint256 ethereum,
        uint256 cosmos1,
        uint256 cosmos2,
        uint256 final_
    );
    event RecoveryBufferUpdated(uint256 oldValue, uint256 newValue);
    event TimeoutBufferUpdated(uint256 oldValue, uint256 newValue);
    
    // DoS Protection Events
    event DoSLimitsUpdated(
        uint256 maxHtlcsPerAddress,
        uint256 rateLimitWindow,
        uint256 maxHtlcsPerWindow
    );
    event HtlcAmountLimitsUpdated(uint256 minAmount, uint256 maxAmount);
    event EmergencyPauseToggled(bool enabled);
    
    /**
     * @notice Update the maximum timelock duration
     * @param _maxTimelockDuration New maximum timelock duration in seconds
     */
    function setMaxTimelockDuration(uint256 _maxTimelockDuration) external onlyOwner {
        require(_maxTimelockDuration > minTimelockDuration, "Max must be greater than min");
        emit MaxTimelockDurationUpdated(maxTimelockDuration, _maxTimelockDuration);
        maxTimelockDuration = _maxTimelockDuration;
    }
    
    /**
     * @notice Update the minimum timelock duration
     * @param _minTimelockDuration New minimum timelock duration in seconds
     */
    function setMinTimelockDuration(uint256 _minTimelockDuration) external onlyOwner {
        require(_minTimelockDuration > 0, "Min must be greater than 0");
        require(_minTimelockDuration < maxTimelockDuration, "Min must be less than max");
        emit MinTimelockDurationUpdated(minTimelockDuration, _minTimelockDuration);
        minTimelockDuration = _minTimelockDuration;
    }
    
    /**
     * @notice Update the timelock cascade values
     * @param _ethereum Timelock for Ethereum (origin chain)
     * @param _cosmos1 Timelock for first Cosmos hop
     * @param _cosmos2 Timelock for second Cosmos hop
     * @param _final Timelock for final hop
     */
    function setTimelockCascade(
        uint256 _ethereum,
        uint256 _cosmos1,
        uint256 _cosmos2,
        uint256 _final
    ) external onlyOwner {
        require(_ethereum > _cosmos1, "Each hop must have shorter timelock");
        require(_cosmos1 > _cosmos2, "Each hop must have shorter timelock");
        require(_cosmos2 > _final, "Each hop must have shorter timelock");
        require(_final >= minTimelockDuration, "Final must be >= min duration");
        
        timelockCascadeEthereum = _ethereum;
        timelockCascadeCosmos1 = _cosmos1;
        timelockCascadeCosmos2 = _cosmos2;
        timelockCascadeFinal = _final;
        
        emit TimelockCascadeUpdated(_ethereum, _cosmos1, _cosmos2, _final);
    }
    
    /**
     * @notice Update the recovery buffer
     * @param _recoveryBuffer New recovery buffer in seconds
     */
    function setRecoveryBuffer(uint256 _recoveryBuffer) external onlyOwner {
        require(_recoveryBuffer > 0, "Recovery buffer must be greater than 0");
        emit RecoveryBufferUpdated(recoveryBuffer, _recoveryBuffer);
        recoveryBuffer = _recoveryBuffer;
    }
    
    /**
     * @notice Update the timeout buffer
     * @param _timeoutBuffer New timeout buffer in seconds
     */
    function setTimeoutBuffer(uint256 _timeoutBuffer) external onlyOwner {
        require(_timeoutBuffer > 0, "Timeout buffer must be greater than 0");
        emit TimeoutBufferUpdated(timeoutBuffer, _timeoutBuffer);
        timeoutBuffer = _timeoutBuffer;
    }
    
    /**
     * @notice Update DoS protection limits
     * @param _maxHtlcsPerAddress Maximum active HTLCs per address
     * @param _rateLimitWindow Rate limit time window in seconds
     * @param _maxHtlcsPerWindow Maximum HTLCs per address per window
     */
    function setDoSLimits(
        uint256 _maxHtlcsPerAddress,
        uint256 _rateLimitWindow,
        uint256 _maxHtlcsPerWindow
    ) external onlyOwner {
        require(_maxHtlcsPerAddress > 0 && _maxHtlcsPerAddress <= 100, "Invalid max HTLCs per address");
        require(_rateLimitWindow > 0, "Rate limit window must be > 0");
        require(_maxHtlcsPerWindow > 0 && _maxHtlcsPerWindow <= _maxHtlcsPerAddress, "Invalid rate limit");
        
        maxHtlcsPerAddress = _maxHtlcsPerAddress;
        rateLimitWindow = _rateLimitWindow;
        maxHtlcsPerWindow = _maxHtlcsPerWindow;
        
        emit DoSLimitsUpdated(_maxHtlcsPerAddress, _rateLimitWindow, _maxHtlcsPerWindow);
    }
    
    /**
     * @notice Update HTLC amount limits
     * @param _minAmount Minimum HTLC amount
     * @param _maxAmount Maximum HTLC amount
     */
    function setHtlcAmountLimits(uint256 _minAmount, uint256 _maxAmount) external onlyOwner {
        require(_minAmount > 0, "Min amount must be > 0");
        require(_maxAmount > _minAmount, "Max amount must be > min amount");
        
        minHtlcAmount = _minAmount;
        maxHtlcAmount = _maxAmount;
        
        emit HtlcAmountLimitsUpdated(_minAmount, _maxAmount);
    }
    
    /**
     * @notice Toggle emergency pause
     * @param _enabled Whether emergency pause is enabled
     */
    function setEmergencyPause(bool _enabled) external onlyOwner {
        emergencyPauseEnabled = _enabled;
        emit EmergencyPauseToggled(_enabled);
    }
    
    /**
     * @notice Get all configuration values in a single call
     * @return maxTimelock Maximum timelock duration
     * @return minTimelock Minimum timelock duration  
     * @return cascadeEthereum Ethereum cascade timelock
     * @return cascadeCosmos1 First Cosmos hop timelock
     * @return cascadeCosmos2 Second Cosmos hop timelock
     * @return cascadeFinal Final hop timelock
     * @return recovery Recovery buffer duration
     * @return timeout Timeout buffer duration
     */
    function getConfig() external view returns (
        uint256 maxTimelock,
        uint256 minTimelock,
        uint256 cascadeEthereum,
        uint256 cascadeCosmos1,
        uint256 cascadeCosmos2,
        uint256 cascadeFinal,
        uint256 recovery,
        uint256 timeout
    ) {
        return (
            maxTimelockDuration,
            minTimelockDuration,
            timelockCascadeEthereum,
            timelockCascadeCosmos1,
            timelockCascadeCosmos2,
            timelockCascadeFinal,
            recoveryBuffer,
            timeoutBuffer
        );
    }
    
    /**
     * @notice Get DoS protection configuration
     * @return maxHtlcs Maximum active HTLCs per address
     * @return rateWindow Rate limit window duration
     * @return maxPerWindow Maximum HTLCs per address per window
     * @return minAmount Minimum HTLC amount
     * @return maxAmount Maximum HTLC amount
     * @return emergencyPaused Whether emergency pause is active
     */
    function getDoSConfig() external view returns (
        uint256 maxHtlcs,
        uint256 rateWindow,
        uint256 maxPerWindow,
        uint256 minAmount,
        uint256 maxAmount,
        bool emergencyPaused
    ) {
        return (
            maxHtlcsPerAddress,
            rateLimitWindow,
            maxHtlcsPerWindow,
            minHtlcAmount,
            maxHtlcAmount,
            emergencyPauseEnabled
        );
    }
}