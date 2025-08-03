import type { Token } from '../../types';
import { isValidAmount } from '../../utils/validators';

interface AmountInputProps {
  value: string;
  onChange: (value: string) => void;
  token: Token;
  label?: string;
  balance?: string;
}

export default function AmountInput({
  value,
  onChange,
  token,
  label,
  balance
}: AmountInputProps) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    
    // Allow empty string, numbers, and single decimal point
    if (newValue === '' || /^\d*\.?\d*$/.test(newValue)) {
      onChange(newValue);
    }
  };

  const handleMaxClick = () => {
    if (balance) {
      onChange(balance);
    }
  };

  const isValid = value === '' || isValidAmount(value);

  return (
    <div>
      {label && (
        <label className="block text-sm font-medium text-white/90 mb-2">
          {label}
        </label>
      )}
      <div className="relative">
        <input
          type="text"
          value={value}
          onChange={handleChange}
          placeholder="0.0"
          className={`glass-input pr-24 text-xl font-semibold ${
            !isValid ? 'border-red-400 focus:border-red-400 focus:ring-red-400/50' : ''
          }`}
        />
        <div className="absolute inset-y-0 right-0 flex items-center pr-4 gap-3">
          {balance && (
            <button
              type="button"
              onClick={handleMaxClick}
              className="text-xs text-primary-400 hover:text-primary-300 font-semibold transition-colors duration-200 bg-white/10 px-2 py-1 rounded-lg hover:bg-white/20"
            >
              MAX
            </button>
          )}
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-gradient-to-br from-accent-500/20 to-primary-500/20 rounded-lg flex items-center justify-center">
              <span className="text-xs">{token.icon}</span>
            </div>
            <span className="text-white/80 font-medium">
              {token.symbol}
            </span>
          </div>
        </div>
      </div>
      {!isValid && value !== '' && (
        <p className="mt-2 text-sm text-red-400 flex items-center gap-2">
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          Please enter a valid amount
        </p>
      )}
    </div>
  );
}