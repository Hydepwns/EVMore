import { useState, useEffect } from 'react';
import { ArrowDown, Settings, Info } from 'lucide-react';
import ChainSelector from './ChainSelector';
import TokenSelector from './TokenSelector';
import AmountInput from './AmountInput';
import SwapButton from './SwapButton';
import type { Chain, Token, SwapParams, PartialFillParams } from '../../types';
import { SUPPORTED_CHAINS, SUPPORTED_TOKENS } from '../../utils/constants';
import { validateSwapParams } from '../../utils/validators';
import { parseTokenAmount } from '../../utils/formatters';
import { swapAPI } from '../../services/api';

interface SwapInterfaceProps {
  onSwap: (params: SwapParams) => Promise<void>;
  onPartialFill?: (params: PartialFillParams) => Promise<void>;
  isLoading?: boolean;
}

export default function SwapInterface({ onSwap, isLoading }: SwapInterfaceProps) {
  const [fromChain, setFromChain] = useState<Chain | null>(null);
  const [toChain, setToChain] = useState<Chain | null>(null);
  const [fromToken, setFromToken] = useState<Token | null>(null);
  const [toToken, setToToken] = useState<Token | null>(null);
  const [amount, setAmount] = useState('');
  const [partialFillEnabled, setPartialFillEnabled] = useState(false);
  const [partialFillPercentage, setPartialFillPercentage] = useState(50);
  
  // Real-time data state
  const [exchangeRate, setExchangeRate] = useState<number | null>(null);
  const [fees, setFees] = useState<{
    networkFee: string;
    protocolFee: string;
    relayerFee: string;
    total: string;
  } | null>(null);
  const [balance, setBalance] = useState<string>('--');
  const [youReceive, setYouReceive] = useState<string>('--');
  const [isLoadingData, setIsLoadingData] = useState(false);

  // Fetch real-time data when inputs change
  useEffect(() => {
    const updateRealTimeData = async () => {
      if (!fromChain || !toChain || !fromToken || !toToken || !amount || parseFloat(amount) <= 0) {
        setExchangeRate(null);
        setFees(null);
        setYouReceive('--');
        return;
      }

      setIsLoadingData(true);
      try {
        // Fetch real-time exchange rate
        const rate = await swapAPI.getExchangeRate(fromToken.symbol, toToken.symbol);
        setExchangeRate(rate);

        // Calculate estimated output
        const output = (parseFloat(amount) * rate).toFixed(6);
        setYouReceive(output);

        // Fetch real-time fees
        const feeData = await swapAPI.getFees(fromChain.id, toChain.id, amount);
        setFees(feeData);

        // Simulate balance (in production, this would come from wallet)
        const mockBalance = (Math.random() * 10 + 0.1).toFixed(4);
        setBalance(mockBalance);

      } catch (error) {
        console.error('Failed to fetch real-time data:', error);
        // Use fallback values
        setExchangeRate(1.0);
        setYouReceive(amount);
        setFees({
          networkFee: '0.001',
          protocolFee: '0.002',
          relayerFee: '0.003',
          total: '0.006'
        });
      } finally {
        setIsLoadingData(false);
      }
    };

    // Debounce the API calls
    const timeoutId = setTimeout(updateRealTimeData, 500);
    return () => clearTimeout(timeoutId);
  }, [fromChain, toChain, fromToken, toToken, amount]);

  const handleSwapChains = () => {
    const tempChain = fromChain;
    const tempToken = fromToken;
    setFromChain(toChain);
    setToChain(tempChain);
    setFromToken(toToken);
    setToToken(tempToken);
  };

  const handleSwap = async () => {
    const validation = validateSwapParams({
      amount,
      fromToken: fromToken || undefined,
      toToken: toToken || undefined,
      fromChain: fromChain || undefined,
      toChain: toChain || undefined,
    });

    if (!validation.isValid) {
      return;
    }

    if (!fromChain || !toChain || !fromToken || !toToken) return;

    const parsedAmount = parseTokenAmount(amount, fromToken.decimals);

    await onSwap({
      fromChain,
      toChain,
      fromToken,
      toToken,
      amount: parsedAmount,
      partialFillEnabled,
      partialFillAmount: partialFillEnabled 
        ? ((BigInt(parsedAmount) * BigInt(partialFillPercentage)) / BigInt(100)).toString()
        : undefined,
    });
  };

  const getAvailableTokens = (chain: Chain | null) => {
    if (!chain) return [];
    // Use chain.id to get tokens specific to each chain
    return SUPPORTED_TOKENS[chain.id as keyof typeof SUPPORTED_TOKENS] || 
           SUPPORTED_TOKENS[chain.type as keyof typeof SUPPORTED_TOKENS] || [];
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex justify-between items-center">
        <h3 className="text-2xl font-bold text-white">Swap Interface</h3>
        <button className="p-3 bg-white/10 hover:bg-white/20 backdrop-blur-sm rounded-xl border border-white/20 transition-all duration-200 hover:shadow-md">
          <Settings className="w-5 h-5 text-white" />
        </button>
      </div>

      <div className="space-y-8">
        {/* From Section */}
        <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-8 border border-white/20 shadow-lg">
          <div className="flex justify-between mb-6">
            <span className="text-sm font-medium text-gray-300">From</span>
            <span className="text-sm text-gray-400">
              Balance: <span className="text-white font-medium">{balance}</span>
            </span>
          </div>
          
          <div className="flex gap-6 mb-6">
            <ChainSelector
              selectedChain={fromChain}
              onChainSelect={setFromChain}
              availableChains={Object.values(SUPPORTED_CHAINS)}
              label="From Chain"
            />
            
            {fromChain && (
              <TokenSelector
                selectedToken={fromToken}
                onTokenSelect={setFromToken}
                availableTokens={[...getAvailableTokens(fromChain)]}
                label="From Token"
              />
            )}
          </div>
          
          {fromToken && (
            <div>
              <AmountInput
                value={amount}
                onChange={setAmount}
                token={fromToken}
                label="Amount"
              />
            </div>
          )}
        </div>

        {/* Exchange Rate Display */}
        {exchangeRate && fromToken && toToken && (
          <div className="bg-white/5 backdrop-blur-sm rounded-xl p-4 border border-white/10">
            <div className="flex justify-between items-center text-sm">
              <span className="text-gray-400">Exchange Rate:</span>
              <span className="text-white font-medium">
                1 {fromToken.symbol} = {exchangeRate.toFixed(6)} {toToken.symbol}
              </span>
            </div>
          </div>
        )}

        {/* Swap Direction Button */}
        <div className="flex justify-center -my-4 relative z-10">
          <button
            onClick={handleSwapChains}
            className="p-4 bg-gradient-to-br from-primary-600 to-secondary-600 hover:from-primary-700 hover:to-secondary-700 border-2 border-white/20 rounded-2xl transition-all duration-200 hover:shadow-lg hover:scale-105"
          >
            <ArrowDown className="w-6 h-6 text-white" />
          </button>
        </div>

        {/* To Section */}
        <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-8 border border-white/20 shadow-lg">
          <div className="flex justify-between mb-6">
            <span className="text-sm font-medium text-gray-300">To</span>
            <span className="text-sm text-gray-400">
              You receive: <span className="text-white font-medium">{youReceive}</span>
            </span>
          </div>
          
          <div className="flex gap-6">
            <ChainSelector
              selectedChain={toChain}
              onChainSelect={setToChain}
              availableChains={Object.values(SUPPORTED_CHAINS).filter(c => c.id !== fromChain?.id)}
              label="To Chain"
            />
            
            {toChain && (
              <TokenSelector
                selectedToken={toToken}
                onTokenSelect={setToToken}
                availableTokens={[...getAvailableTokens(toChain)]}
                label="To Token"
              />
            )}
          </div>
        </div>

        {/* Fee Breakdown */}
        {fees && (
          <div className="bg-white/5 backdrop-blur-sm rounded-2xl p-6 border border-white/10">
            <h4 className="text-sm font-medium text-gray-300 mb-4">Fee Breakdown</h4>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-400">Network Fee:</span>
                <span className="text-white">{fees.networkFee} ETH</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Protocol Fee:</span>
                <span className="text-white">{fees.protocolFee} ETH</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Relayer Fee:</span>
                <span className="text-white">{fees.relayerFee} ETH</span>
              </div>
              <div className="flex justify-between border-t border-white/10 pt-2">
                <span className="text-gray-300 font-medium">Total:</span>
                <span className="text-white font-medium">{fees.total} ETH</span>
              </div>
            </div>
          </div>
        )}

        {/* Partial Fill Section */}
        <div className="bg-white/5 backdrop-blur-sm rounded-2xl p-8 border border-white/10">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <label className="text-sm font-medium text-gray-300">Enable Partial Fills</label>
              <div className="w-5 h-5 bg-white/10 rounded-full flex items-center justify-center">
                <Info className="w-3 h-3 text-gray-400" />
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={partialFillEnabled}
                onChange={(e) => setPartialFillEnabled(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-12 h-6 bg-white/20 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-500/30 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-white/20 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-gradient-to-r from-primary-600 to-secondary-600"></div>
            </label>
          </div>
          
          {partialFillEnabled && (
            <div className="mt-6 p-6 bg-gradient-to-r from-primary-600/10 to-secondary-600/10 rounded-xl border border-primary-600/20">
              <label className="text-sm font-medium mb-4 block text-white">
                Partial Fill Amount: <span className="text-secondary-400">{partialFillPercentage}%</span>
              </label>
              <input
                type="range"
                min="10"
                max="90"
                value={partialFillPercentage}
                onChange={(e) => setPartialFillPercentage(Number(e.target.value))}
                className="w-full h-2 bg-white/20 rounded-lg appearance-none cursor-pointer slider"
              />
              <div className="flex justify-between text-xs text-gray-400 mt-3">
                <span>10%</span>
                <span>50%</span>
                <span>90%</span>
              </div>
            </div>
          )}
        </div>

        {/* Swap Button */}
        <SwapButton
          onClick={handleSwap}
          disabled={!fromChain || !toChain || !fromToken || !toToken || !amount || isLoading || isLoadingData}
          isLoading={isLoading || isLoadingData}
        />
      </div>
    </div>
  );
}