const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("CrossChainHTLC", function () {
  let htlc;
  let mockToken;
  let mockFusionConfig;
  let owner;
  let user1;
  let user2;
  const INITIAL_SUPPLY = ethers.parseEther("1000000");
  
  beforeEach(async function () {
    [owner, user1, user2] = await ethers.getSigners();
    
    // Deploy mock ERC20 token
    const MockToken = await ethers.getContractFactory("MockERC20");
    mockToken = await MockToken.deploy("Mock Token", "MOCK", INITIAL_SUPPLY);
    await mockToken.waitForDeployment();
    
    // Deploy MockFusionConfig
    const MockFusionConfig = await ethers.getContractFactory("MockFusionConfig");
    mockFusionConfig = await MockFusionConfig.deploy();
    await mockFusionConfig.waitForDeployment();
    
    // Deploy HTLC contract
    const CrossChainHTLC = await ethers.getContractFactory("CrossChainHTLC");
    htlc = await CrossChainHTLC.deploy(await mockFusionConfig.getAddress());
    await htlc.waitForDeployment();
    
    // Transfer tokens to user1
    await mockToken.transfer(user1.address, ethers.parseEther("1000"));
  });
  
  describe("createHTLC", function () {
    it("Should create HTLC with valid parameters", async function () {
      const amount = ethers.parseEther("100");
      const secret = ethers.randomBytes(32);
      const hashlock = ethers.sha256(secret);
      const timelock = await time.latest() + 3600; // 1 hour from now
      
      // Approve HTLC contract
      await mockToken.connect(user1).approve(await htlc.getAddress(), amount);
      
      // Create HTLC
      const tx = await htlc.connect(user1).createHTLC(
        await mockToken.getAddress(),
        amount,
        hashlock,
        timelock,
        "cosmoshub-4",
        "cosmos1abc..."
      );
      
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => log.eventName === "HTLCCreated");
      const htlcId = event.args[0];
      
      // Verify HTLC details
      const htlcData = await htlc.getHTLC(htlcId);
      expect(htlcData.sender).to.equal(user1.address);
      expect(htlcData.token).to.equal(await mockToken.getAddress());
      expect(htlcData.amount).to.equal(amount);
      expect(htlcData.hashlock).to.equal(hashlock);
      expect(htlcData.timelock).to.equal(timelock);
      expect(htlcData.withdrawn).to.be.false;
      expect(htlcData.refunded).to.be.false;
      expect(htlcData.targetChain).to.equal("cosmoshub-4");
      expect(htlcData.targetAddress).to.equal("cosmos1abc...");
    });
    
    it("Should fail with invalid timelock", async function () {
      const amount = ethers.parseEther("100");
      const hashlock = ethers.randomBytes(32);
      const pastTimelock = await time.latest() - 3600;
      
      await mockToken.connect(user1).approve(await htlc.getAddress(), amount);
      
      await expect(
        htlc.connect(user1).createHTLC(
          await mockToken.getAddress(),
          amount,
          hashlock,
          pastTimelock,
          "cosmoshub-4",
          "cosmos1abc..."
        )
      ).to.be.revertedWith("Timelock must be in future");
    });
  });
  
  describe("withdraw", function () {
    it("Should withdraw with correct secret", async function () {
      const amount = ethers.parseEther("100");
      const secret = ethers.randomBytes(32);
      const hashlock = ethers.sha256(secret);
      const timelock = await time.latest() + 3600;
      
      // Create HTLC
      await mockToken.connect(user1).approve(await htlc.getAddress(), amount);
      const tx = await htlc.connect(user1).createHTLC(
        await mockToken.getAddress(),
        amount,
        hashlock,
        timelock,
        "cosmoshub-4",
        "cosmos1abc..."
      );
      
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => log.eventName === "HTLCCreated");
      const htlcId = event.args[0];
      
      // Withdraw with secret
      const balanceBefore = await mockToken.balanceOf(user2.address);
      await htlc.connect(user2).withdraw(htlcId, secret);
      const balanceAfter = await mockToken.balanceOf(user2.address);
      
      expect(balanceAfter - balanceBefore).to.equal(amount);
      
      // Verify HTLC is withdrawn
      const htlcData = await htlc.getHTLC(htlcId);
      expect(htlcData.withdrawn).to.be.true;
    });
    
    it("Should fail with incorrect secret", async function () {
      const amount = ethers.parseEther("100");
      const secret = ethers.randomBytes(32);
      const wrongSecret = ethers.randomBytes(32);
      const hashlock = ethers.sha256(secret);
      const timelock = await time.latest() + 3600;
      
      // Create HTLC
      await mockToken.connect(user1).approve(await htlc.getAddress(), amount);
      const tx = await htlc.connect(user1).createHTLC(
        await mockToken.getAddress(),
        amount,
        hashlock,
        timelock,
        "cosmoshub-4",
        "cosmos1abc..."
      );
      
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => log.eventName === "HTLCCreated");
      const htlcId = event.args[0];
      
      await expect(
        htlc.connect(user2).withdraw(htlcId, wrongSecret)
      ).to.be.revertedWith("Invalid secret");
    });
  });
  
  describe("refund", function () {
    it("Should refund after timelock expires", async function () {
      const amount = ethers.parseEther("100");
      const secret = ethers.randomBytes(32);
      const hashlock = ethers.sha256(secret);
      const timelock = await time.latest() + 3600;
      
      // Create HTLC
      await mockToken.connect(user1).approve(await htlc.getAddress(), amount);
      const tx = await htlc.connect(user1).createHTLC(
        await mockToken.getAddress(),
        amount,
        hashlock,
        timelock,
        "cosmoshub-4",
        "cosmos1abc..."
      );
      
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => log.eventName === "HTLCCreated");
      const htlcId = event.args[0];
      
      // Advance time past timelock
      await time.increaseTo(timelock + 1);
      
      // Refund
      const balanceBefore = await mockToken.balanceOf(user1.address);
      await htlc.connect(user1).refund(htlcId);
      const balanceAfter = await mockToken.balanceOf(user1.address);
      
      expect(balanceAfter - balanceBefore).to.equal(amount);
      
      // Verify HTLC is refunded
      const htlcData = await htlc.getHTLC(htlcId);
      expect(htlcData.refunded).to.be.true;
    });
    
    it("Should fail before timelock expires", async function () {
      const amount = ethers.parseEther("100");
      const secret = ethers.randomBytes(32);
      const hashlock = ethers.sha256(secret);
      const timelock = await time.latest() + 3600;
      
      // Create HTLC
      await mockToken.connect(user1).approve(await htlc.getAddress(), amount);
      const tx = await htlc.connect(user1).createHTLC(
        await mockToken.getAddress(),
        amount,
        hashlock,
        timelock,
        "cosmoshub-4",
        "cosmos1abc..."
      );
      
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => log.eventName === "HTLCCreated");
      const htlcId = event.args[0];
      
      await expect(
        htlc.connect(user1).refund(htlcId)
      ).to.be.revertedWith("Timelock not expired");
    });
  });
});

// Mock ERC20 contract for testing
const MockERC20 = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    constructor(string memory name, string memory symbol, uint256 initialSupply) ERC20(name, symbol) {
        _mint(msg.sender, initialSupply);
    }
}
`;