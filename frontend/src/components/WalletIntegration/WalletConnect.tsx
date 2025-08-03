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
      ? { 
          name: 'Ethereum (Sepolia)', 
          icon: '🔷', 
          explorer: 'https://sepolia.etherscan.io/address/',
          gradient: 'from-blue-500 to-blue-600'
        }
      : { 
          name: 'Osmosis (Testnet)', 
          icon: '💧', 
          explorer: 'https://testnet.mintscan.io/osmosis-testnet/account/',
          gradient: 'from-purple-500 to-purple-600'
        };

    return (
      <div className="bg-white/10 backdrop-blur-md rounded-xl p-6 border border-white/20 shadow-glass">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 bg-gradient-to-br ${chainInfo.gradient} rounded-lg flex items-center justify-center`}>
              <span className="text-lg">{chainInfo.icon}</span>
            </div>
            <h3 className="font-semibold text-white">{chainInfo.name}</h3>
          </div>
          {address && (
            <button
              onClick={onDisconnect}
              className="text-sm text-red-400 hover:text-red-300 flex items-center gap-1 transition-colors duration-200"
            >
              <LogOut className="w-4 h-4" />
              Disconnect
            </button>
          )}
        </div>
        
        {address ? (
          <div className="bg-white/5 rounded-lg p-3 border border-white/10">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm font-mono text-white/90">{formatAddress(address)}</span>
              <button
                onClick={() => copyAddress(address)}
                className="p-1 hover:bg-white/10 rounded transition-colors duration-200"
              >
                <Copy className="w-4 h-4 text-white/70 hover:text-white" />
              </button>
              <a
                href={`${chainInfo.explorer}${address}`}
                target="_blank"
                rel="noopener noreferrer"
                className="p-1 hover:bg-white/10 rounded transition-colors duration-200"
              >
                <ExternalLink className="w-4 h-4 text-white/70 hover:text-white" />
              </a>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
              <span className="text-xs text-green-400 font-medium">Connected</span>
            </div>
          </div>
        ) : (
          <button
            onClick={onConnect}
            disabled={isConnecting}
            className={`
              w-full py-3 px-4 rounded-xl font-medium flex items-center justify-center gap-2
              transition-all duration-200 transform hover:scale-[1.02] active:scale-[0.98]
              ${isConnecting 
                ? 'bg-white/10 text-white/50 cursor-not-allowed border border-white/20' 
                : 'bg-gradient-to-r from-primary-500 to-secondary-500 hover:from-primary-600 hover:to-secondary-600 text-white shadow-glow hover:shadow-lg'
              }
            `}
          >
            <Wallet className="w-4 h-4" />
            {isConnecting ? 'Connecting...' : 'Connect Wallet'}
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <h3 className="text-xl font-bold text-white mb-4">Wallet Connection</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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