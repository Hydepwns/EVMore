import { useState, useEffect } from 'react';
import TransactionHistory from '../components/StatusMonitor/TransactionHistory';
import type { SwapTransaction } from '../types';
import { swapAPI } from '../services/api';

export default function HistoryPage() {
  const [transactions, setTransactions] = useState<SwapTransaction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadTransactions();
    // Refresh every 10 seconds
    const interval = setInterval(loadTransactions, 10000);
    return () => clearInterval(interval);
  }, []);

  const loadTransactions = async () => {
    try {
      const history = await swapAPI.getTransactionHistory();
      setTransactions(history);
    } catch (error) {
      console.error('Failed to load transactions:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center animate-fade-in">
      {/* Hero Section */}
      <div className="text-center mb-8">
        <h1 className="text-4xl md:text-5xl font-bold text-white mb-4 animate-slide-down">
          Transaction <span className="bg-gradient-to-r from-secondary-400 to-accent-400 bg-clip-text text-transparent">History</span>
        </h1>
        <p className="text-lg text-white/80 max-w-2xl mx-auto animate-slide-up">
          View your recent cross-chain swaps and track their status in real-time
        </p>
      </div>

      {/* Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8 w-full max-w-6xl">
        <div className="bg-white/10 backdrop-blur-sm rounded-xl p-6 border border-white/20 shadow-lg animate-slide-up">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-300 text-sm font-medium">Total Transactions</p>
              <p className="text-2xl font-bold text-white">{transactions.length}</p>
            </div>
            <div className="w-12 h-12 bg-gradient-to-br from-primary-600 to-secondary-600 rounded-lg flex items-center justify-center">
              <i className="fas fa-list-alt text-white text-lg"></i>
            </div>
          </div>
        </div>
        
        <div className="bg-white/10 backdrop-blur-sm rounded-xl p-6 border border-white/20 shadow-lg animate-slide-up" style={{animationDelay: '0.1s'}}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-300 text-sm font-medium">Completed</p>
              <p className="text-2xl font-bold text-white">{transactions.filter(t => t.status === 'completed').length}</p>
            </div>
            <div className="w-12 h-12 bg-gradient-to-br from-secondary-600 to-accent-600 rounded-lg flex items-center justify-center">
              <i className="fas fa-check-circle text-white text-lg"></i>
            </div>
          </div>
        </div>
        
        <div className="bg-white/10 backdrop-blur-sm rounded-xl p-6 border border-white/20 shadow-lg animate-slide-up" style={{animationDelay: '0.2s'}}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-300 text-sm font-medium">Pending</p>
              <p className="text-2xl font-bold text-white">{transactions.filter(t => t.status === 'pending').length}</p>
            </div>
            <div className="w-12 h-12 bg-gradient-to-br from-accent-600 to-primary-600 rounded-lg flex items-center justify-center">
              <i className="fas fa-clock text-white text-lg"></i>
            </div>
          </div>
        </div>
        
        <div className="bg-white/10 backdrop-blur-sm rounded-xl p-6 border border-white/20 shadow-lg animate-slide-up" style={{animationDelay: '0.3s'}}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-300 text-sm font-medium">Failed</p>
              <p className="text-2xl font-bold text-white">{transactions.filter(t => t.status === 'failed').length}</p>
            </div>
            <div className="w-12 h-12 bg-gradient-to-br from-red-500 to-red-600 rounded-lg flex items-center justify-center">
              <i className="fas fa-times-circle text-white text-lg"></i>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="w-full max-w-6xl">
        {loading ? (
          <div className="glass-card text-center py-16">
            <div className="w-16 h-16 bg-gradient-to-br from-primary-500/20 to-secondary-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
              <i className="fas fa-spinner fa-spin text-white text-2xl"></i>
            </div>
            <p className="text-white/80 text-lg">Loading transactions...</p>
            <p className="text-white/60 text-sm mt-2">Please wait while we fetch your transaction history</p>
          </div>
        ) : (
          <TransactionHistory transactions={transactions} />
        )}
      </div>
    </div>
  );
}