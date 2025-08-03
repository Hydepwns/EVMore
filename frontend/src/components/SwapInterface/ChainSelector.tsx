import { Fragment } from 'react';
import { Listbox, Transition } from '@headlessui/react';
import { ChevronDown, Check } from 'lucide-react';
import type { Chain } from '../../types';

interface ChainSelectorProps {
  selectedChain: Chain | null;
  onChainSelect: (chain: Chain) => void;
  availableChains: Chain[];
  label?: string;
}

export default function ChainSelector({
  selectedChain,
  onChainSelect,
  availableChains,
  label
}: ChainSelectorProps) {
  return (
    <Listbox value={selectedChain} onChange={onChainSelect}>
      <div className="relative flex-1">
        {label && (
          <Listbox.Label className="block text-sm font-medium text-white/90 mb-2">
            {label}
          </Listbox.Label>
        )}
        <Listbox.Button className="relative w-full cursor-pointer rounded-xl bg-white/10 backdrop-blur-md border border-white/20 py-3 pl-4 pr-10 text-left shadow-glass focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent transition-all duration-200 hover:bg-white/20">
          <span className="block truncate">
            {selectedChain ? (
              <span className="flex items-center gap-3">
                <div className="w-8 h-8 bg-gradient-to-br from-primary-500/20 to-secondary-500/20 rounded-lg flex items-center justify-center">
                  <span className="text-sm">{selectedChain.icon}</span>
                </div>
                <span className="text-white font-medium">{selectedChain.name}</span>
              </span>
            ) : (
              <span className="text-white/50">Select chain</span>
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
            {availableChains.map((chain) => (
              <Listbox.Option
                key={chain.id}
                className={({ active }) =>
                  `relative cursor-pointer select-none py-3 pl-4 pr-10 transition-colors duration-200 ${
                    active ? 'bg-white/20 text-white' : 'text-white/90 hover:text-white'
                  }`
                }
                value={chain}
              >
                {({ selected }) => (
                  <>
                    <span className={`block truncate ${selected ? 'font-semibold' : 'font-medium'}`}>
                      <span className="inline-flex items-center gap-3">
                        <div className="w-8 h-8 bg-gradient-to-br from-primary-500/20 to-secondary-500/20 rounded-lg flex items-center justify-center">
                          <span className="text-sm">{chain.icon}</span>
                        </div>
                        <span>{chain.name}</span>
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