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
        return <CheckCircle className="w-5 h-5 text-green-400" />;
      case 'failed':
      case 'cancelled':
        return <XCircle className="w-5 h-5 text-red-400" />;
      case 'pending':
      case 'initiating':
        return <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />;
      default:
        return <Clock className="w-5 h-5 text-white/60" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'text-green-400 bg-green-500/10 border-green-500/20';
      case 'failed':
      case 'cancelled':
        return 'text-red-400 bg-red-500/10 border-red-500/20';
      case 'pending':
      case 'initiating':
        return 'text-blue-400 bg-blue-500/10 border-blue-500/20';
      default:
        return 'text-white/60 bg-white/10 border-white/20';
    }
  };

  if (transactions.length === 0) {
    return (
      <div className="glass-card text-center py-16">
        <div className="w-16 h-16 bg-gradient-to-br from-primary-500/20 to-secondary-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
          <Clock className="w-8 h-8 text-white/60" />
        </div>
        <h3 className="text-xl font-semibold text-white mb-3">
          No transactions yet
        </h3>
        <p className="text-white/60">
          Your swap history will appear here once you make your first cross-chain swap
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {transactions.map((tx, index) => (
        <div 
          key={tx.id} 
          className="glass-card hover:shadow-glow transition-all duration-300 transform hover:scale-[1.02] animate-slide-up"
          style={{ animationDelay: `${index * 0.1}s` }}
        >
          <div className="flex items-start justify-between mb-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-gradient-to-br from-primary-500/20 to-secondary-500/20 rounded-xl flex items-center justify-center">
                {getStatusIcon(tx.status)}
              </div>
              <div>
                <h4 className="text-lg font-semibold text-white mb-1">
                  {tx.fromToken.symbol} → {tx.toToken.symbol}
                </h4>
                <p className="text-sm text-white/60">
                  {formatDate(new Date(tx.createdAt))}
                </p>
              </div>
            </div>
            <span className={`px-4 py-2 rounded-xl text-sm font-medium border ${getStatusColor(tx.status)}`}>
              {tx.status.charAt(0).toUpperCase() + tx.status.slice(1)}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            <div className="bg-white/5 rounded-xl p-4 border border-white/10">
              <p className="text-sm text-white/60 mb-2 font-medium">From</p>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg flex items-center justify-center">
                  <span className="text-sm">{tx.fromChain.icon}</span>
                </div>
                <div>
                  <p className="font-semibold text-white">
                    {formatAmount(tx.amount, tx.fromToken.decimals)} {tx.fromToken.symbol}
                  </p>
                  <p className="text-xs text-white/60">{tx.fromChain.name}</p>
                </div>
              </div>
            </div>
            <div className="bg-white/5 rounded-xl p-4 border border-white/10">
              <p className="text-sm text-white/60 mb-2 font-medium">To</p>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-gradient-to-br from-purple-500 to-purple-600 rounded-lg flex items-center justify-center">
                  <span className="text-sm">{tx.toChain.icon}</span>
                </div>
                <div>
                  <p className="font-semibold text-white">
                    -- {tx.toToken.symbol}
                  </p>
                  <p className="text-xs text-white/60">{tx.toChain.name}</p>
                </div>
              </div>
            </div>
          </div>

          {tx.txHash && (
            <div className="flex items-center justify-between pt-4 border-t border-white/10">
              <span className="text-sm text-white/60 font-medium">
                Transaction Hash
              </span>
              <a
                href={`${tx.fromChain.blockExplorer}/tx/${tx.txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-sm text-primary-400 hover:text-primary-300 transition-colors duration-200 bg-white/5 px-3 py-2 rounded-lg hover:bg-white/10"
              >
                {formatAddress(tx.txHash, 6)}
                <ExternalLink className="w-4 h-4" />
              </a>
            </div>
          )}

          {tx.partialFills && tx.partialFills.length > 0 && (
            <div className="mt-6 pt-4 border-t border-white/10">
              <h5 className="text-sm font-semibold mb-4 text-white">Partial Fills</h5>
              <div className="space-y-3">
                {tx.partialFills.map((fill) => (
                  <div key={fill.id} className="flex items-center justify-between bg-white/5 rounded-lg p-3 border border-white/10">
                    <div className="flex items-center gap-3">
                      <div className="w-2 h-2 bg-gradient-to-r from-primary-500 to-secondary-500 rounded-full"></div>
                      <span className="text-sm text-white">
                        {fill.fillPercentage}% - {formatAmount(fill.amount, tx.fromToken.decimals)} {tx.fromToken.symbol}
                      </span>
                    </div>
                    <span className={`px-3 py-1 rounded-lg text-xs font-medium border ${getStatusColor(fill.status)}`}>
                      {fill.status.charAt(0).toUpperCase() + fill.status.slice(1)}
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