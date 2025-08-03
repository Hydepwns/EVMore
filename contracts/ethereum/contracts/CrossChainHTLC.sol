// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./FusionConfig.sol";

contract CrossChainHTLC is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;
    
    // Reference to configuration contract
    FusionConfig public fusionConfig;

    struct HTLC {
        address sender;
        address token;
        uint256 amount;
        bytes32 hashlock;
        uint256 timelock;
        bool withdrawn;
        bool refunded;
        string targetChain;
        string targetAddress;
    }

    mapping(bytes32 => HTLC) public htlcs;
    
    // DoS Protection state
    mapping(address => bytes32[]) public addressHtlcs; // Active HTLCs per address
    mapping(address => uint256[]) public addressHtlcTimestamps; // Creation timestamps for rate limiting
    mapping(address => bool) public blacklistedAddresses; // Blacklisted addresses
    
    event HTLCCreated(
        bytes32 indexed htlcId,
        address indexed sender,
        address indexed token,
        uint256 amount,
        bytes32 hashlock,
        uint256 timelock,
        string targetChain,
        string targetAddress
    );

    event HTLCWithdrawn(bytes32 indexed htlcId, bytes32 secret);
    event HTLCRefunded(bytes32 indexed htlcId);
    
    // DoS Protection Events
    event AddressBlacklisted(address indexed account, string reason);
    event AddressWhitelisted(address indexed account);
    event RateLimitExceeded(address indexed account, uint256 attempts, uint256 window);

    modifier htlcExists(bytes32 _htlcId) {
        require(htlcs[_htlcId].sender != address(0), "HTLC does not exist");
        _;
    }

    modifier notExecuted(bytes32 _htlcId) {
        require(!htlcs[_htlcId].withdrawn, "HTLC already withdrawn");
        require(!htlcs[_htlcId].refunded, "HTLC already refunded");
        _;
    }
    
    modifier notBlacklisted(address _account) {
        require(!blacklistedAddresses[_account], "Address is blacklisted");
        _;
    }
    
    modifier notEmergencyPaused() {
        require(!fusionConfig.emergencyPauseEnabled(), "Emergency pause active");
        _;
    }

    constructor(address _fusionConfig) Ownable(msg.sender) {
        require(_fusionConfig != address(0), "Invalid config address");
        fusionConfig = FusionConfig(_fusionConfig);
    }

    function createHTLC(
        address _token,
        uint256 _amount,
        bytes32 _hashlock,
        uint256 _timelock,
        string memory _targetChain,
        string memory _targetAddress
    ) external nonReentrant notBlacklisted(msg.sender) notEmergencyPaused returns (bytes32 htlcId) {
        // Get DoS protection configuration
        (
            uint256 maxHtlcs,
            uint256 rateWindow,
            uint256 maxPerWindow,
            uint256 minAmount,
            uint256 maxAmount,
        ) = fusionConfig.getDoSConfig();
        
        // Basic validations
        require(_amount >= minAmount, "Amount below minimum");
        require(_amount <= maxAmount, "Amount exceeds maximum");
        require(_timelock > block.timestamp, "Timelock must be in future");
        require(_timelock <= block.timestamp + fusionConfig.maxTimelockDuration(), "Timelock too far in future");
        require(bytes(_targetChain).length > 0, "Target chain required");
        require(bytes(_targetAddress).length > 0, "Target address required");
        
        // DoS Protection: Check active HTLC limit per address
        _cleanupExpiredHtlcs(msg.sender);
        require(addressHtlcs[msg.sender].length < maxHtlcs, "Too many active HTLCs");
        
        // DoS Protection: Check rate limiting
        _enforceRateLimit(msg.sender, rateWindow, maxPerWindow);

        htlcId = keccak256(
            abi.encodePacked(
                msg.sender,
                _token,
                _amount,
                _hashlock,
                _timelock,
                block.timestamp
            )
        );

        require(htlcs[htlcId].sender == address(0), "HTLC already exists");

        htlcs[htlcId] = HTLC({
            sender: msg.sender,
            token: _token,
            amount: _amount,
            hashlock: _hashlock,
            timelock: _timelock,
            withdrawn: false,
            refunded: false,
            targetChain: _targetChain,
            targetAddress: _targetAddress
        });
        
        // Track HTLC for DoS protection
        addressHtlcs[msg.sender].push(htlcId);
        addressHtlcTimestamps[msg.sender].push(block.timestamp);

        IERC20(_token).safeTransferFrom(msg.sender, address(this), _amount);

        emit HTLCCreated(
            htlcId,
            msg.sender,
            _token,
            _amount,
            _hashlock,
            _timelock,
            _targetChain,
            _targetAddress
        );
    }

    function withdraw(
        bytes32 _htlcId,
        bytes32 _secret
    ) external nonReentrant htlcExists(_htlcId) notExecuted(_htlcId) {
        HTLC storage htlc = htlcs[_htlcId];
        
        require(sha256(abi.encodePacked(_secret)) == htlc.hashlock, "Invalid secret");
        
        htlc.withdrawn = true;
        
        // Remove HTLC from sender's active list
        _removeHtlcFromAddress(htlc.sender, _htlcId);
        
        IERC20(htlc.token).safeTransfer(msg.sender, htlc.amount);
        
        emit HTLCWithdrawn(_htlcId, _secret);
    }

    function refund(
        bytes32 _htlcId
    ) external nonReentrant htlcExists(_htlcId) notExecuted(_htlcId) {
        HTLC storage htlc = htlcs[_htlcId];
        
        require(block.timestamp >= htlc.timelock, "Timelock not expired");
        require(msg.sender == htlc.sender, "Only sender can refund");
        
        htlc.refunded = true;
        
        // Remove HTLC from sender's active list
        _removeHtlcFromAddress(htlc.sender, _htlcId);
        
        IERC20(htlc.token).safeTransfer(htlc.sender, htlc.amount);
        
        emit HTLCRefunded(_htlcId);
    }

    function getHTLC(bytes32 _htlcId) external view returns (
        address sender,
        address token,
        uint256 amount,
        bytes32 hashlock,
        uint256 timelock,
        bool withdrawn,
        bool refunded,
        string memory targetChain,
        string memory targetAddress
    ) {
        HTLC memory htlc = htlcs[_htlcId];
        return (
            htlc.sender,
            htlc.token,
            htlc.amount,
            htlc.hashlock,
            htlc.timelock,
            htlc.withdrawn,
            htlc.refunded,
            htlc.targetChain,
            htlc.targetAddress
        );
    }
    
    /**
     * @notice Update the configuration contract address
     * @param _fusionConfig New configuration contract address
     */
    function setFusionConfig(address _fusionConfig) external onlyOwner {
        require(_fusionConfig != address(0), "Invalid config address");
        fusionConfig = FusionConfig(_fusionConfig);
    }
    
    /**
     * @notice Blacklist an address (emergency only)
     * @param _account Address to blacklist
     * @param _reason Reason for blacklisting
     */
    function blacklistAddress(address _account, string memory _reason) external onlyOwner {
        blacklistedAddresses[_account] = true;
        emit AddressBlacklisted(_account, _reason);
    }
    
    /**
     * @notice Remove address from blacklist
     * @param _account Address to whitelist
     */
    function whitelistAddress(address _account) external onlyOwner {
        blacklistedAddresses[_account] = false;
        emit AddressWhitelisted(_account);
    }
    
    /**
     * @notice Get active HTLC count for an address
     * @param _account Address to check
     * @return count Number of active HTLCs
     */
    function getActiveHtlcCount(address _account) external view returns (uint256 count) {
        return addressHtlcs[_account].length;
    }
    
    /**
     * @notice Get active HTLCs for an address
     * @param _account Address to check
     * @return htlcIds Array of active HTLC IDs
     */
    function getActiveHtlcs(address _account) external view returns (bytes32[] memory htlcIds) {
        return addressHtlcs[_account];
    }
    
    /**
     * @notice Clean up expired HTLCs for an address (anyone can call)
     * @param _account Address to clean up
     */
    function cleanupExpiredHtlcs(address _account) external {
        _cleanupExpiredHtlcs(_account);
    }
    
    /**
     * @notice Internal function to enforce rate limiting
     * @param _account Address to check
     * @param _window Rate limit window in seconds
     * @param _maxPerWindow Maximum HTLCs per window
     */
    function _enforceRateLimit(address _account, uint256 _window, uint256 _maxPerWindow) internal {
        uint256 windowStart = block.timestamp - _window;
        uint256 count = 0;
        
        // Count HTLCs created within the window
        uint256[] storage timestamps = addressHtlcTimestamps[_account];
        for (uint256 i = 0; i < timestamps.length; i++) {
            if (timestamps[i] >= windowStart) {
                count++;
            }
        }
        
        if (count >= _maxPerWindow) {
            emit RateLimitExceeded(_account, count, _window);
            revert("Rate limit exceeded");
        }
        
        // Clean up old timestamps to prevent unbounded growth
        _cleanupOldTimestamps(_account, windowStart);
    }
    
    /**
     * @notice Internal function to remove expired HTLCs from tracking
     * @param _account Address to clean up
     */
    function _cleanupExpiredHtlcs(address _account) internal {
        bytes32[] storage htlcIds = addressHtlcs[_account];
        
        // Remove expired HTLCs (iterate backwards to avoid index issues)
        for (uint256 i = htlcIds.length; i > 0; i--) {
            bytes32 htlcId = htlcIds[i - 1];
            HTLC storage htlc = htlcs[htlcId];
            
            // Remove if expired, withdrawn, or refunded
            if (htlc.timelock <= block.timestamp || htlc.withdrawn || htlc.refunded) {
                // Swap with last element and pop
                htlcIds[i - 1] = htlcIds[htlcIds.length - 1];
                htlcIds.pop();
            }
        }
    }
    
    /**
     * @notice Internal function to remove specific HTLC from address tracking
     * @param _account Address to update
     * @param _htlcId HTLC ID to remove
     */
    function _removeHtlcFromAddress(address _account, bytes32 _htlcId) internal {
        bytes32[] storage htlcIds = addressHtlcs[_account];
        
        for (uint256 i = 0; i < htlcIds.length; i++) {
            if (htlcIds[i] == _htlcId) {
                // Swap with last element and pop
                htlcIds[i] = htlcIds[htlcIds.length - 1];
                htlcIds.pop();
                break;
            }
        }
    }
    
    /**
     * @notice Internal function to clean up old timestamps
     * @param _account Address to clean up
     * @param _cutoff Timestamp cutoff (older timestamps are removed)
     */
    function _cleanupOldTimestamps(address _account, uint256 _cutoff) internal {
        uint256[] storage timestamps = addressHtlcTimestamps[_account];
        
        // Remove old timestamps (iterate backwards)
        for (uint256 i = timestamps.length; i > 0; i--) {
            if (timestamps[i - 1] < _cutoff) {
                // Swap with last element and pop
                timestamps[i - 1] = timestamps[timestamps.length - 1];
                timestamps.pop();
            }
        }
    }
}