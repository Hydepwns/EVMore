import { ethers } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';

interface DeploymentAddresses {
  network: string;
  CrossChainHTLC: string;
  FusionResolver: string;
  deployedAt: string;
}

async function main() {
  console.log('🚀 Starting Ethereum contracts deployment...\n');

  // Get network info
  const network = await ethers.provider.getNetwork();
  const [deployer] = await ethers.getSigners();
  
  console.log('📍 Network:', network.name);
  console.log('👤 Deployer:', deployer.address);
  console.log('💰 Balance:', ethers.formatEther(await ethers.provider.getBalance(deployer.address)), 'ETH\n');

  // Deploy CrossChainHTLC
  console.log('📦 Deploying CrossChainHTLC...');
  const CrossChainHTLC = await ethers.getContractFactory('CrossChainHTLC');
  const htlc = await CrossChainHTLC.deploy();
  await htlc.waitForDeployment();
  const htlcAddress = await htlc.getAddress();
  console.log('✅ CrossChainHTLC deployed to:', htlcAddress);

  // Deploy FusionResolver
  console.log('\n📦 Deploying FusionResolver...');
  const FusionResolver = await ethers.getContractFactory('FusionResolver');
  const resolver = await FusionResolver.deploy(
    htlcAddress,
    '0x1111111254EEB25477B68fb85Ed929f73A960582' // 1inch Aggregation Router v5
  );
  await resolver.waitForDeployment();
  const resolverAddress = await resolver.getAddress();
  console.log('✅ FusionResolver deployed to:', resolverAddress);

  // Save deployment addresses
  const addresses: DeploymentAddresses = {
    network: network.name,
    CrossChainHTLC: htlcAddress,
    FusionResolver: resolverAddress,
    deployedAt: new Date().toISOString(),
  };

  const deploymentsDir = path.join(__dirname, '../../deployments');
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }

  const filePath = path.join(deploymentsDir, `ethereum-${network.name}.json`);
  fs.writeFileSync(filePath, JSON.stringify(addresses, null, 2));
  
  console.log('\n✅ Deployment complete!');
  console.log('📄 Addresses saved to:', filePath);
  
  // Verify contracts if not on localhost
  if (network.name !== 'localhost' && network.name !== 'hardhat') {
    console.log('\n🔍 Verifying contracts on Etherscan...');
    
    try {
      await verifyContract(htlcAddress, []);
      await verifyContract(resolverAddress, [htlcAddress, '0x1111111254EEB25477B68fb85Ed929f73A960582']);
      console.log('✅ Contracts verified!');
    } catch (error) {
      console.error('❌ Verification failed:', error);
    }
  }
}

async function verifyContract(address: string, constructorArguments: any[]) {
  try {
    await ethers.run('verify:verify', {
      address,
      constructorArguments,
    });
  } catch (error: any) {
    if (error.message.toLowerCase().includes('already verified')) {
      console.log(`Contract ${address} is already verified`);
    } else {
      throw error;
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });