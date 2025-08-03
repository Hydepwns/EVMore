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
    <div className="flex flex-col items-center space-y-12 animate-fade-in">
      {/* Hero Section */}
      <div className="text-center mb-12">
        <h1 className="text-4xl md:text-5xl font-bold text-white mb-6 animate-slide-down">
          Cross-Chain <span className="text-secondary-400">Swap</span>
        </h1>
        <p className="text-xl text-gray-300 max-w-3xl mx-auto animate-slide-up">
          Swap tokens seamlessly between Ethereum and Cosmos ecosystems with lightning-fast execution and minimal fees
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-12 w-full max-w-5xl">
        <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-8 border border-white/20 shadow-lg animate-slide-up">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-300 text-sm font-medium mb-2">Total Volume</p>
              <p className="text-3xl font-bold text-white">$2.4M</p>
            </div>
            <div className="w-14 h-14 bg-gradient-to-br from-primary-600 to-secondary-600 rounded-xl flex items-center justify-center">
              <i className="fas fa-chart-line text-white text-xl"></i>
            </div>
          </div>
        </div>
        
        <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-8 border border-white/20 shadow-lg animate-slide-up" style={{animationDelay: '0.1s'}}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-300 text-sm font-medium mb-2">Active Swaps</p>
              <p className="text-3xl font-bold text-white">1,247</p>
            </div>
            <div className="w-14 h-14 bg-gradient-to-br from-secondary-600 to-accent-600 rounded-xl flex items-center justify-center">
              <i className="fas fa-exchange-alt text-white text-xl"></i>
            </div>
          </div>
        </div>
        
        <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-8 border border-white/20 shadow-lg animate-slide-up" style={{animationDelay: '0.2s'}}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-300 text-sm font-medium mb-2">Success Rate</p>
              <p className="text-3xl font-bold text-white">99.8%</p>
            </div>
            <div className="w-14 h-14 bg-gradient-to-br from-accent-600 to-primary-600 rounded-xl flex items-center justify-center">
              <i className="fas fa-check-circle text-white text-xl"></i>
            </div>
          </div>
        </div>
      </div>

      {/* Main Swap Interface */}
      <div className="w-full max-w-4xl">
        <div className="bg-white/10 backdrop-blur-sm rounded-3xl p-10 border border-white/20 shadow-lg">
          <div className="mb-8">
            <WalletConnect />
          </div>
          
          <SwapInterface 
            onSwap={handleSwap}
            onPartialFill={handlePartialFill}
            isLoading={isSwapping}
          />
        </div>
      </div>

      {/* Chain Visual */}
      <div className="flex items-center justify-center space-x-12 mt-16 animate-bounce-gentle">
        <div className="flex items-center space-x-4">
          <div className="w-20 h-20 bg-gradient-to-br from-blue-600 to-blue-700 rounded-full flex items-center justify-center shadow-lg">
            <i className="fab fa-ethereum text-white text-2xl"></i>
          </div>
          <span className="text-white font-semibold text-lg">Ethereum</span>
        </div>
        
        <div className="flex flex-col items-center space-y-3">
          <div className="w-16 h-1 bg-gradient-to-r from-primary-600 to-secondary-600 rounded-full"></div>
          <div className="w-12 h-12 bg-gradient-to-br from-primary-600 to-secondary-600 rounded-full flex items-center justify-center shadow-lg">
            <i className="fas fa-exchange-alt text-white text-lg"></i>
          </div>
        </div>
        
        <div className="flex items-center space-x-4">
          <span className="text-white font-semibold text-lg">Cosmos</span>
          <div className="w-20 h-20 bg-gradient-to-br from-purple-600 to-purple-700 rounded-full flex items-center justify-center shadow-lg">
            <i className="fas fa-atom text-white text-2xl"></i>
          </div>
        </div>
      </div>
    </div>
  );
}