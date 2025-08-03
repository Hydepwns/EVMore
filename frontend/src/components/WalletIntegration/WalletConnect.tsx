import { useState } from 'react';
import { Wallet, LogOut, Copy, ExternalLink } from 'lucide-react';
import { formatAddress } from '../../utils/formatters';
import toast from 'react-hot-toast';

export default function WalletConnect() {
  const [ethereumAddress, setEthereumAddress] = useState<string | null>(null);
  const [cosmosAddress, setCosmosAddress] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);

  const connectEthereum = async () => {
    setIsConnecting(true);
    try {
      if (!window.ethereum) {
        toast.error('Please install MetaMask');
        return;
      }

      const accounts = await window.ethereum.request({ 
        method: 'eth_requestAccounts' 
      });
      
      if (accounts.length > 0) {
        setEthereumAddress(accounts[0]);
        toast.success('Ethereum wallet connected');
      }
    } catch (error) {
      console.error('Failed to connect Ethereum wallet:', error);
      toast.error('Failed to connect wallet');
    } finally {
      setIsConnecting(false);
    }
  };

  const connectCosmos = async () => {
    setIsConnecting(true);
    try {
      if (!window.keplr) {
        window.open('https://www.keplr.app/', '_blank');
        toast.error('Please install Keplr wallet extension');
        return;
      }

      // Try Osmosis testnet as it's more commonly available
      const chainId = 'osmo-test-5';
      
      try {
        await window.keplr.experimentalSuggestChain({
          chainId: chainId,
          chainName: 'Osmosis Testnet',
          rpc: 'https://rpc.testnet.osmosis.zone',
          rest: 'https://lcd.testnet.osmosis.zone',
          bip44: {
            coinType: 118,
          },
          bech32Config: {
            bech32PrefixAccAddr: 'osmo',
            bech32PrefixAccPub: 'osmopub',
            bech32PrefixValAddr: 'osmovaloper',
            bech32PrefixValPub: 'osmovaloperpub',
            bech32PrefixConsAddr: 'osmovalcons',
            bech32PrefixConsPub: 'osmovalconspub',
          },
          currencies: [{
            coinDenom: 'OSMO',
            coinMinimalDenom: 'uosmo',
            coinDecimals: 6,
          }],
          feeCurrencies: [{
            coinDenom: 'OSMO',
            coinMinimalDenom: 'uosmo',
            coinDecimals: 6,
            gasPriceStep: {
              low: 0.0025,
              average: 0.025,
              high: 0.04,
            },
          }],
          stakeCurrency: {
            coinDenom: 'OSMO',
            coinMinimalDenom: 'uosmo',
            coinDecimals: 6,
          },
          features: ['cosmwasm'],
        });
      } catch (error) {
        console.log('Chain might already be added:', error);
      }

      await window.keplr.enable(chainId);
      const offlineSigner = window.keplr.getOfflineSigner(chainId);
      const accounts = await offlineSigner.getAccounts();
      
      if (accounts.length > 0) {
        setCosmosAddress(accounts[0].address);
        toast.success('Osmosis testnet wallet connected');
      }
    } catch (error) {
      console.error('Failed to connect Cosmos wallet:', error);
      toast.error('Failed to connect wallet');
    } finally {
      setIsConnecting(false);
    }
  };

  const disconnect = (type: 'ethereum' | 'cosmos') => {
    if (type === 'ethereum') {
      setEthereumAddress(null);
      toast.success('Ethereum wallet disconnected');
    } else {
      setCosmosAddress(null);
      toast.success('Cosmos wallet disconnected');
    }
  };

  const copyAddress = (address: string) => {
    navigator.clipboard.writeText(address);
    toast.success('Address copied to clipboard');
  };

  const WalletCard = ({ 
    type, 
    address, 
    onConnect, 
    onDisconnect 
  }: { 
    type: 'ethereum' | 'cosmos';
    address: string | null;
    onConnect: () => void;
    onDisconnect: () => void;
  }) => {
    const chainInfo = type === 'ethereum' 
      ? { name: 'Ethereum (Sepolia)', icon: '🔷', explorer: 'https://sepolia.etherscan.io/address/' }
      : { name: 'Osmosis (Testnet)', icon: '💧', explorer: 'https://testnet.mintscan.io/osmosis-testnet/account/' };

    return (
      <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-xl">{chainInfo.icon}</span>
            <h3 className="font-medium">{chainInfo.name}</h3>
          </div>
          {address && (
            <button
              onClick={onDisconnect}
              className="text-sm text-red-600 hover:text-red-700 flex items-center gap-1"
            >
              <LogOut className="w-4 h-4" />
              Disconnect
            </button>
          )}
        </div>
        
        {address ? (
          <div className="flex items-center gap-2">
            <span className="text-sm font-mono">{formatAddress(address)}</span>
            <button
              onClick={() => copyAddress(address)}
              className="p-1 hover:bg-gray-200 dark:hover:bg-gray-600 rounded"
            >
              <Copy className="w-4 h-4" />
            </button>
            <a
              href={`${chainInfo.explorer}${address}`}
              target="_blank"
              rel="noopener noreferrer"
              className="p-1 hover:bg-gray-200 dark:hover:bg-gray-600 rounded"
            >
              <ExternalLink className="w-4 h-4" />
            </a>
          </div>
        ) : (
          <button
            onClick={onConnect}
            disabled={isConnecting}
            className="btn btn-outline btn-sm w-full flex items-center justify-center gap-2"
          >
            <Wallet className="w-4 h-4" />
            Connect Wallet
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="card">
      <h3 className="text-lg font-semibold mb-4">Wallet Connection</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <WalletCard
          type="ethereum"
          address={ethereumAddress}
          onConnect={connectEthereum}
          onDisconnect={() => disconnect('ethereum')}
        />
        <WalletCard
          type="cosmos"
          address={cosmosAddress}
          onConnect={connectCosmos}
          onDisconnect={() => disconnect('cosmos')}
        />
      </div>
    </div>
  );
}