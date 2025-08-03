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
          <Listbox.Label className="block text-sm font-medium text-white/90 mb-2">
            {label}
          </Listbox.Label>
        )}
        <Listbox.Button className="relative w-full cursor-pointer rounded-xl bg-white/10 backdrop-blur-md border border-white/20 py-3 pl-4 pr-10 text-left shadow-glass focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent transition-all duration-200 hover:bg-white/20">
          <span className="block truncate">
            {selectedToken ? (
              <span className="flex items-center gap-3">
                <div className="w-8 h-8 bg-gradient-to-br from-accent-500/20 to-primary-500/20 rounded-lg flex items-center justify-center">
                  <span className="text-sm">{selectedToken.icon}</span>
                </div>
                <div>
                  <span className="text-white font-medium">{selectedToken.symbol}</span>
                  <span className="text-xs text-white/60 block">{selectedToken.name}</span>
                </div>
              </span>
            ) : (
              <span className="text-white/50">Select token</span>
            )}
          </span>
          <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
            <ChevronDown className="h-5 w-5 text-white/60" aria-hidden="true" />
          </span>
        </Listbox.Button>
        <Transition
          as={Fragment}
          leave="transition ease-in duration-100"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <Listbox.Options className="absolute z-10 mt-2 max-h-60 w-full overflow-auto rounded-xl bg-white/10 backdrop-blur-md border border-white/20 py-2 text-base shadow-glass ring-1 ring-white/10 focus:outline-none">
            {availableTokens.map((token) => (
              <Listbox.Option
                key={token.address}
                className={({ active }) =>
                  `relative cursor-pointer select-none py-3 pl-4 pr-10 transition-colors duration-200 ${
                    active ? 'bg-white/20 text-white' : 'text-white/90 hover:text-white'
                  }`
                }
                value={token}
              >
                {({ selected }) => (
                  <>
                    <span className={`block truncate ${selected ? 'font-semibold' : 'font-medium'}`}>
                      <span className="inline-flex items-center gap-3">
                        <div className="w-8 h-8 bg-gradient-to-br from-accent-500/20 to-primary-500/20 rounded-lg flex items-center justify-center">
                          <span className="text-sm">{token.icon}</span>
                        </div>
                        <div>
                          <span>{token.symbol}</span>
                          <span className="text-xs text-white/60 block">({token.name})</span>
                        </div>
                      </span>
                    </span>
                    {selected ? (
                      <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-primary-400">
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