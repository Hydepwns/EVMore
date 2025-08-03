import { useState } from 'react';
import SwapInterface from '../components/SwapInterface/SwapInterface';
import WalletConnect from '../components/WalletIntegration/WalletConnect';
import type { SwapParams, PartialFillParams } from '../types';
import { swapAPI } from '../services/api';
import toast from 'react-hot-toast';

export default function SwapPage() {
  const [isSwapping, setIsSwapping] = useState(false);

  const handleSwap = async (params: SwapParams) => {
    setIsSwapping(true);
    try {
      const txId = await swapAPI.initiateSwap(params);
      toast.success('Swap initiated successfully!');
      
      // Monitor transaction status (simulate completion after 10 seconds for demo)
      setTimeout(async () => {
        const status = await swapAPI.getTransactionStatus(txId);
        if (status === 'pending') {
          // Simulate completion for demo
          await swapAPI.simulateCompletion(txId);
          toast.success('Swap completed successfully! 🎉');
        }
      }, 10000);
      
    } catch (error) {
      toast.error('Failed to initiate swap');
      console.error('Swap error:', error);
    } finally {
      setIsSwapping(false);
    }
  };

  const handlePartialFill = async (params: PartialFillParams) => {
    try {
      await swapAPI.createPartialFill(
        params.originalOrderId, 
        params.amount, 
        params.percentage
      );
      toast.success('Partial fill created successfully!');
    } catch (error) {
      toast.error('Failed to create partial fill');
      console.error('Partial fill error:', error);
    }
  };

  return (
    <div className="flex flex-col items-center space-y-8">
      <div className="w-full max-w-2xl">
        <div className="mb-6">
          <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
            Cross-Chain Swap
          </h2>
          <p className="text-gray-600 dark:text-gray-400">
            Swap tokens seamlessly between Ethereum and Cosmos ecosystems
          </p>
        </div>
        
        <div className="mb-6">
          <WalletConnect />
        </div>
        
        <SwapInterface 
          onSwap={handleSwap}
          onPartialFill={handlePartialFill}
          isLoading={isSwapping}
        />
      </div>
    </div>
  );
}