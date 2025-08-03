import { useState } from 'react';
import { ArrowDown, Settings, Info } from 'lucide-react';
import ChainSelector from './ChainSelector';
import TokenSelector from './TokenSelector';
import AmountInput from './AmountInput';
import SwapButton from './SwapButton';
import type { Chain, Token, SwapParams, PartialFillParams } from '../../types';
import { SUPPORTED_CHAINS, SUPPORTED_TOKENS } from '../../utils/constants';
import { validateSwapParams } from '../../utils/validators';
import { parseTokenAmount } from '../../utils/formatters';

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
    <div className="card">
      <div className="flex justify-between items-center mb-6">
        <h3 className="text-xl font-semibold">Swap</h3>
        <button className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors">
          <Settings className="w-5 h-5" />
        </button>
      </div>

      <div className="space-y-4">
        {/* From Section */}
        <div className="bg-gray-50 dark:bg-gray-700 rounded-xl p-4">
          <div className="flex justify-between mb-2">
            <span className="text-sm text-gray-600 dark:text-gray-400">From</span>
            <span className="text-sm text-gray-600 dark:text-gray-400">
              Balance: --
            </span>
          </div>
          
          <div className="flex gap-3">
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
            <div className="mt-3">
              <AmountInput
                value={amount}
                onChange={setAmount}
                token={fromToken}
                label="Amount"
              />
            </div>
          )}
        </div>

        {/* Swap Direction Button */}
        <div className="flex justify-center -my-2">
          <button
            onClick={handleSwapChains}
            className="p-3 bg-white dark:bg-gray-800 border-2 border-gray-200 dark:border-gray-600 rounded-xl hover:border-primary-500 transition-colors"
          >
            <ArrowDown className="w-5 h-5" />
          </button>
        </div>

        {/* To Section */}
        <div className="bg-gray-50 dark:bg-gray-700 rounded-xl p-4">
          <div className="flex justify-between mb-2">
            <span className="text-sm text-gray-600 dark:text-gray-400">To</span>
            <span className="text-sm text-gray-600 dark:text-gray-400">
              You receive: --
            </span>
          </div>
          
          <div className="flex gap-3">
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

        {/* Partial Fill Section */}
        <div className="border-t pt-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium">Enable Partial Fills</label>
              <Info className="w-4 h-4 text-gray-400" />
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={partialFillEnabled}
                onChange={(e) => setPartialFillEnabled(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 dark:peer-focus:ring-primary-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary-600"></div>
            </label>
          </div>
          
          {partialFillEnabled && (
            <div className="mt-3 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
              <label className="text-sm font-medium mb-2 block">
                Partial Fill Amount: {partialFillPercentage}%
              </label>
              <input
                type="range"
                min="10"
                max="90"
                value={partialFillPercentage}
                onChange={(e) => setPartialFillPercentage(Number(e.target.value))}
                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700"
              />
              <div className="flex justify-between text-xs text-gray-500 mt-1">
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
          disabled={!fromChain || !toChain || !fromToken || !toToken || !amount || isLoading}
          isLoading={isLoading}
        />
      </div>
    </div>
  );
}