import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';

interface NetworkConfig {
  name: string;
  type: 'ethereum' | 'cosmos';
  deployScript: string;
  envVars?: Record<string, string>;
}

const networks: NetworkConfig[] = [
  {
    name: 'ethereum-sepolia',
    type: 'ethereum',
    deployScript: 'npx hardhat run scripts/deploy/deploy-ethereum.ts --network sepolia',
  },
  {
    name: 'osmosis-testnet',
    type: 'cosmos',
    deployScript: './scripts/deploy/deploy-cosmwasm.sh',
    envVars: {
      CHAIN_ID: 'osmo-test-5',
      NODE: 'https://rpc.testnet.osmosis.zone:443',
    },
  },
  {
    name: 'juno-testnet',
    type: 'cosmos',
    deployScript: './scripts/deploy/deploy-cosmwasm.sh',
    envVars: {
      CHAIN_ID: 'uni-6',
      NODE: 'https://rpc.testnet.juno.strange.love:443',
    },
  },
];

async function deployToNetwork(network: NetworkConfig) {
  console.log(chalk.blue(`\n🚀 Deploying to ${network.name}...`));

  try {
    // Set environment variables if provided
    const env = { ...process.env, ...network.envVars };

    // Execute deployment script
    execSync(network.deployScript, {
      stdio: 'inherit',
      env,
      cwd: path.join(__dirname, '../..'),
    });

    console.log(chalk.green(`✅ Successfully deployed to ${network.name}`));
    return true;
  } catch (error) {
    console.error(chalk.red(`❌ Failed to deploy to ${network.name}:`), error);
    return false;
  }
}

async function main() {
  console.log(chalk.bold.blue('🌐 1inch Fusion+ Cosmos Extension - Multi-Network Deployment\n'));

  // Check if specific network is requested
  const targetNetwork = process.argv[2];
  
  if (targetNetwork) {
    const network = networks.find(n => n.name === targetNetwork);
    if (!network) {
      console.error(chalk.red(`❌ Unknown network: ${targetNetwork}`));
      console.log('Available networks:', networks.map(n => n.name).join(', '));
      process.exit(1);
    }
    
    await deployToNetwork(network);
  } else {
    // Deploy to all networks
    console.log(chalk.yellow('Deploying to all networks...'));
    
    const results = [];
    for (const network of networks) {
      const success = await deployToNetwork(network);
      results.push({ network: network.name, success });
    }
    
    // Summary
    console.log(chalk.bold.blue('\n📊 Deployment Summary:'));
    results.forEach(({ network, success }) => {
      const status = success ? chalk.green('✅ Success') : chalk.red('❌ Failed');
      console.log(`  ${network}: ${status}`);
    });
    
    // Generate deployment manifest
    const manifestPath = path.join(__dirname, '../../deployments/manifest.json');
    const manifest = {
      version: '1.0.0',
      deployedAt: new Date().toISOString(),
      networks: results.filter(r => r.success).map(r => r.network),
      contracts: await gatherDeploymentAddresses(),
    };
    
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    console.log(chalk.green(`\n📄 Deployment manifest saved to: ${manifestPath}`));
  }
}

async function gatherDeploymentAddresses() {
  const deploymentsDir = path.join(__dirname, '../../deployments');
  const files = fs.readdirSync(deploymentsDir).filter(f => f.endsWith('.json') && f !== 'manifest.json');
  
  const addresses: Record<string, any> = {};
  
  for (const file of files) {
    const content = JSON.parse(fs.readFileSync(path.join(deploymentsDir, file), 'utf8'));
    const network = file.replace('.json', '');
    addresses[network] = content;
  }
  
  return addresses;
}

// Handle errors
process.on('unhandledRejection', (error) => {
  console.error(chalk.red('Unhandled error:'), error);
  process.exit(1);
});

// Run deployment
main().catch((error) => {
  console.error(chalk.red('Deployment failed:'), error);
  process.exit(1);
});