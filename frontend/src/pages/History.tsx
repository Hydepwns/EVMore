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
    <div className="flex flex-col items-center">
      <div className="w-full max-w-4xl">
        <div className="mb-6">
          <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
            Transaction History
          </h2>
          <p className="text-gray-600 dark:text-gray-400">
            View your recent cross-chain swaps and their status
          </p>
        </div>
        
        {loading ? (
          <div className="card text-center py-12">
            <div className="animate-spin w-12 h-12 border-4 border-primary-600 border-t-transparent rounded-full mx-auto mb-4"></div>
            <p className="text-gray-600 dark:text-gray-400">Loading transactions...</p>
          </div>
        ) : (
          <TransactionHistory transactions={transactions} />
        )}
      </div>
    </div>
  );
}