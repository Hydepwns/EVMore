import { Loader2 } from 'lucide-react';

interface SwapButtonProps {
  onClick: () => void;
  disabled?: boolean;
  isLoading?: boolean;
}

export default function SwapButton({ onClick, disabled, isLoading }: SwapButtonProps) {
  const getButtonText = () => {
    if (isLoading) return 'Swapping...';
    if (disabled) return 'Enter an amount';
    return 'Swap Now';
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled || isLoading}
      className={`
        w-full py-4 px-6 rounded-2xl font-semibold text-lg flex items-center justify-center gap-3
        transition-all duration-300 transform hover:scale-[1.02] active:scale-[0.98]
        ${disabled || isLoading 
          ? 'bg-white/10 text-white/50 cursor-not-allowed border border-white/20' 
          : 'bg-gradient-to-r from-primary-500 to-secondary-500 hover:from-primary-600 hover:to-secondary-600 text-white shadow-glow hover:shadow-lg'
        }
      `}
    >
      {isLoading && <Loader2 className="w-5 h-5 animate-spin" />}
      {getButtonText()}
    </button>
  );
}