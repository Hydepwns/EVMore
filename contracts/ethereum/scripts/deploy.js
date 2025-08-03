const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  
  console.log("Deploying contracts with the account:", deployer.address);
  console.log("Account balance:", (await hre.ethers.provider.getBalance(deployer.address)).toString());
  
  // Deploy CrossChainHTLC
  console.log("\nDeploying CrossChainHTLC...");
  const CrossChainHTLC = await hre.ethers.getContractFactory("CrossChainHTLC");
  const htlc = await CrossChainHTLC.deploy();
  await htlc.waitForDeployment();
  console.log("CrossChainHTLC deployed to:", await htlc.getAddress());
  
  // Deploy FusionResolver
  console.log("\nDeploying FusionResolver...");
  const FusionResolver = await hre.ethers.getContractFactory("FusionResolver");
  const resolver = await FusionResolver.deploy(await htlc.getAddress());
  await resolver.waitForDeployment();
  console.log("FusionResolver deployed to:", await resolver.getAddress());
  
  // Deploy MockERC20 for testing
  if (hre.network.name === "localhost" || hre.network.name === "hardhat") {
    console.log("\nDeploying MockERC20 for testing...");
    const MockERC20 = await hre.ethers.getContractFactory("MockERC20");
    const mockToken = await MockERC20.deploy(
      "Mock USDC",
      "mUSDC",
      hre.ethers.parseEther("1000000")
    );
    await mockToken.waitForDeployment();
    console.log("MockERC20 deployed to:", await mockToken.getAddress());
  }
  
  console.log("\nDeployment complete!");
  
  // Save deployment addresses
  const fs = require("fs");
  const deploymentInfo = {
    network: hre.network.name,
    contracts: {
      CrossChainHTLC: await htlc.getAddress(),
      FusionResolver: await resolver.getAddress(),
    }
  };
  
  if (hre.network.name === "localhost" || hre.network.name === "hardhat") {
    deploymentInfo.contracts.MockERC20 = await mockToken.getAddress();
  }
  
  fs.writeFileSync(
    `deployments-${hre.network.name}.json`,
    JSON.stringify(deploymentInfo, null, 2)
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });