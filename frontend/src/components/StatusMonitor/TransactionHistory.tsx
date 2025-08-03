import type { SwapTransaction } from '../../types';
import { formatAddress, formatAmount, formatDate } from '../../utils/formatters';
import { ExternalLink, Clock, CheckCircle, XCircle, Loader2 } from 'lucide-react';

interface TransactionHistoryProps {
  transactions: SwapTransaction[];
}

export default function TransactionHistory({ transactions }: TransactionHistoryProps) {
  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="w-5 h-5 text-green-500" />;
      case 'failed':
      case 'cancelled':
        return <XCircle className="w-5 h-5 text-red-500" />;
      case 'pending':
      case 'initiating':
        return <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />;
      default:
        return <Clock className="w-5 h-5 text-gray-500" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'text-green-600 bg-green-50 dark:bg-green-900/20';
      case 'failed':
      case 'cancelled':
        return 'text-red-600 bg-red-50 dark:bg-red-900/20';
      case 'pending':
      case 'initiating':
        return 'text-blue-600 bg-blue-50 dark:bg-blue-900/20';
      default:
        return 'text-gray-600 bg-gray-50 dark:bg-gray-900/20';
    }
  };

  if (transactions.length === 0) {
    return (
      <div className="card text-center py-12">
        <Clock className="w-12 h-12 text-gray-400 mx-auto mb-4" />
        <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
          No transactions yet
        </h3>
        <p className="text-gray-600 dark:text-gray-400">
          Your swap history will appear here
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {transactions.map((tx) => (
        <div key={tx.id} className="card hover:shadow-xl transition-shadow">
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-3">
              {getStatusIcon(tx.status)}
              <div>
                <h4 className="font-medium text-gray-900 dark:text-white">
                  {tx.fromToken.symbol} → {tx.toToken.symbol}
                </h4>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {formatDate(new Date(tx.createdAt))}
                </p>
              </div>
            </div>
            <span className={`px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(tx.status)}`}>
              {tx.status}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">From</p>
              <div className="flex items-center gap-2">
                <span>{tx.fromChain.icon}</span>
                <span className="font-medium">
                  {formatAmount(tx.amount, tx.fromToken.decimals)} {tx.fromToken.symbol}
                </span>
              </div>
            </div>
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">To</p>
              <div className="flex items-center gap-2">
                <span>{tx.toChain.icon}</span>
                <span className="font-medium">
                  -- {tx.toToken.symbol}
                </span>
              </div>
            </div>
          </div>

          {tx.txHash && (
            <div className="flex items-center justify-between pt-4 border-t border-gray-200 dark:border-gray-700">
              <span className="text-sm text-gray-600 dark:text-gray-400">
                Transaction Hash
              </span>
              <a
                href={`${tx.fromChain.blockExplorer}/tx/${tx.txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-sm text-primary-600 hover:text-primary-700"
              >
                {formatAddress(tx.txHash, 6)}
                <ExternalLink className="w-4 h-4" />
              </a>
            </div>
          )}

          {tx.partialFills && tx.partialFills.length > 0 && (
            <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
              <h5 className="text-sm font-medium mb-2">Partial Fills</h5>
              <div className="space-y-2">
                {tx.partialFills.map((fill) => (
                  <div key={fill.id} className="flex items-center justify-between text-sm">
                    <span>{fill.fillPercentage}% - {formatAmount(fill.amount, tx.fromToken.decimals)} {tx.fromToken.symbol}</span>
                    <span className={`px-2 py-1 rounded text-xs ${getStatusColor(fill.status)}`}>
                      {fill.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}