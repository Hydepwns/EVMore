import { Fragment } from 'react';
import { Listbox, Transition } from '@headlessui/react';
import { ChevronDown, Check } from 'lucide-react';
import type { Token } from '../../types';

interface TokenSelectorProps {
  selectedToken: Token | null;
  onTokenSelect: (token: Token) => void;
  availableTokens: Token[];
  label?: string;
}

export default function TokenSelector({
  selectedToken,
  onTokenSelect,
  availableTokens,
  label
}: TokenSelectorProps) {
  return (
    <Listbox value={selectedToken} onChange={onTokenSelect}>
      <div className="relative flex-1">
        {label && (
          <Listbox.Label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            {label}
          </Listbox.Label>
        )}
        <Listbox.Button className="relative w-full cursor-pointer rounded-lg bg-white dark:bg-gray-800 py-2 pl-3 pr-10 text-left shadow-md focus:outline-none focus-visible:border-primary-500 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-opacity-75 focus-visible:ring-offset-2 focus-visible:ring-offset-primary-300 sm:text-sm">
          <span className="block truncate">
            {selectedToken ? (
              <span className="flex items-center gap-2">
                <span>{selectedToken.icon}</span>
                <span>{selectedToken.symbol}</span>
              </span>
            ) : (
              <span className="text-gray-400">Select token</span>
            )}
          </span>
          <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
            <ChevronDown className="h-5 w-5 text-gray-400" aria-hidden="true" />
          </span>
        </Listbox.Button>
        <Transition
          as={Fragment}
          leave="transition ease-in duration-100"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <Listbox.Options className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md bg-white dark:bg-gray-800 py-1 text-base shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none sm:text-sm">
            {availableTokens.map((token) => (
              <Listbox.Option
                key={token.address}
                className={({ active }) =>
                  `relative cursor-pointer select-none py-2 pl-10 pr-4 ${
                    active ? 'bg-primary-100 text-primary-900 dark:bg-primary-900 dark:text-primary-100' : 'text-gray-900 dark:text-gray-100'
                  }`
                }
                value={token}
              >
                {({ selected }) => (
                  <>
                    <span className={`block truncate ${selected ? 'font-medium' : 'font-normal'}`}>
                      <span className="inline-flex items-center gap-2">
                        <span>{token.icon}</span>
                        <span>{token.symbol}</span>
                        <span className="text-xs text-gray-500">({token.name})</span>
                      </span>
                    </span>
                    {selected ? (
                      <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-primary-600">
                        <Check className="h-5 w-5" aria-hidden="true" />
                      </span>
                    ) : null}
                  </>
                )}
              </Listbox.Option>
            ))}
          </Listbox.Options>
        </Transition>
      </div>
    </Listbox>
  );
}