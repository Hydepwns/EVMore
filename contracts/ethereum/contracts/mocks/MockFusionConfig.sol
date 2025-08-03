// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../FusionConfig.sol";

contract MockFusionConfig is FusionConfig {
    constructor() FusionConfig(msg.sender) {
        // Set reasonable test values
        maxTimelockDuration = 7 days;
        minTimelockDuration = 1 hours;
        maxHtlcsPerAddress = 10;
        rateLimitWindow = 3600;
        maxHtlcsPerWindow = 5;
        minHtlcAmount = 100;
        maxHtlcAmount = 1000000 ether;
        emergencyPauseEnabled = false;
    }
}