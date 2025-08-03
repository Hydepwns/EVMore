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
    return 'Swap';
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled || isLoading}
      className="w-full btn btn-primary text-lg py-3 flex items-center justify-center gap-2"
    >
      {isLoading && <Loader2 className="w-5 h-5 animate-spin" />}
      {getButtonText()}
    </button>
  );
}