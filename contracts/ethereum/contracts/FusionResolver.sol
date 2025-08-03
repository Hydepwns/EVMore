// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./CrossChainHTLC.sol";
import "./FusionConfig.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

interface IResolver {
    function resolveOrders(
        address resolver,
        bytes calldata data
    ) external view returns (bool);
}

contract FusionResolver is IResolver, Ownable {
    CrossChainHTLC public immutable htlcContract;
    FusionConfig public fusionConfig;
    
    mapping(address => bool) public authorizedResolvers;
    
    struct CrossChainOrder {
        address maker;
        address fromToken;
        uint256 fromAmount;
        string toChain;
        string toAddress;
        address toToken;
        uint256 minToAmount;
        bytes32 secretHash;
        uint256 deadline;
    }
    
    event OrderResolved(
        bytes32 indexed orderId,
        bytes32 indexed htlcId,
        address resolver
    );
    
    event ResolverAuthorized(address indexed resolver, bool authorized);
    
    modifier onlyAuthorized() {
        require(authorizedResolvers[msg.sender] || msg.sender == owner(), "Not authorized");
        _;
    }
    
    constructor(address _htlcContract, address _fusionConfig) Ownable(msg.sender) {
        htlcContract = CrossChainHTLC(_htlcContract);
        fusionConfig = FusionConfig(_fusionConfig);
    }
    
    function setResolverAuthorization(
        address _resolver,
        bool _authorized
    ) external onlyOwner {
        authorizedResolvers[_resolver] = _authorized;
        emit ResolverAuthorized(_resolver, _authorized);
    }
    
    function resolveOrders(
        address resolver,
        bytes calldata data
    ) external view override returns (bool) {
        require(authorizedResolvers[resolver], "Resolver not authorized");
        
        (bytes32 orderId, ) = abi.decode(data, (bytes32, bytes));
        
        return true;
    }
    
    function createCrossChainOrder(
        CrossChainOrder calldata order
    ) external onlyAuthorized returns (bytes32) {
        require(order.deadline > block.timestamp, "Order expired");
        require(order.fromAmount > 0, "Invalid amount");
        
        IERC20(order.fromToken).transferFrom(
            order.maker,
            address(this),
            order.fromAmount
        );
        
        IERC20(order.fromToken).approve(address(htlcContract), order.fromAmount);
        
        uint256 timelock = order.deadline;
        if (timelock > block.timestamp + fusionConfig.maxTimelockDuration()) {
            timelock = block.timestamp + fusionConfig.maxTimelockDuration();
        }
        
        bytes32 htlcId = htlcContract.createHTLC(
            order.fromToken,
            order.fromAmount,
            order.secretHash,
            timelock,
            order.toChain,
            order.toAddress
        );
        
        bytes32 orderId = keccak256(abi.encode(order, block.timestamp));
        
        emit OrderResolved(orderId, htlcId, msg.sender);
        
        return orderId;
    }
    
    function emergencyWithdraw(
        address token,
        uint256 amount,
        address to
    ) external onlyOwner {
        IERC20(token).transfer(to, amount);
    }
    
    /**
     * @notice Update the configuration contract address
     * @param _fusionConfig New configuration contract address
     */
    function setFusionConfig(address _fusionConfig) external onlyOwner {
        require(_fusionConfig != address(0), "Invalid config address");
        fusionConfig = FusionConfig(_fusionConfig);
    }
}