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
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          {label}
        </label>
      )}
      <div className="relative">
        <input
          type="text"
          value={value}
          onChange={handleChange}
          placeholder="0.0"
          className={`input pr-20 text-xl font-semibold ${
            !isValid ? 'border-red-500 focus:border-red-500 focus:ring-red-500' : ''
          }`}
        />
        <div className="absolute inset-y-0 right-0 flex items-center pr-3 gap-2">
          {balance && (
            <button
              type="button"
              onClick={handleMaxClick}
              className="text-xs text-primary-600 hover:text-primary-700 font-medium"
            >
              MAX
            </button>
          )}
          <span className="text-gray-500 dark:text-gray-400 font-medium">
            {token.symbol}
          </span>
        </div>
      </div>
      {!isValid && value !== '' && (
        <p className="mt-1 text-sm text-red-600">Please enter a valid amount</p>
      )}
    </div>
  );
}