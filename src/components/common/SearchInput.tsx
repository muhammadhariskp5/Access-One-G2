import React, { useState, useEffect, useRef } from 'react';
import { Search, X } from 'lucide-react';
import { cn } from '../../lib/utils';

interface SearchInputProps {
  value: string;
  onSearch?: (value: string) => void;
  onChange?: (value: string) => void;
  placeholder?: string;
  className?: string;
  shortcutHint?: string;
  autoFocus?: boolean;
  id?: string;
}

export function SearchInput({ 
  value, 
  onSearch, 
  onChange, 
  placeholder = "Search...", 
  className,
  shortcutHint,
  autoFocus = false,
  id = "search-input"
}: SearchInputProps) {
  const [localValue, setLocalValue] = useState(value);
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const notifyChange = (val: string) => {
    if (onChange) onChange(val);
    if (onSearch) onSearch(val);
  };

  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      notifyChange(localValue);
    } else if (e.key === 'Escape') {
      setLocalValue('');
      notifyChange('');
      inputRef.current?.blur();
    }
  };

  const handleClear = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setLocalValue('');
    notifyChange('');
    inputRef.current?.focus();
  };

  return (
    <div className={cn("relative group flex items-center w-full", className)}>
      <Search 
        className={cn(
          "absolute left-2.5 top-1/2 -translate-y-1/2 transition-colors pointer-events-none",
          isFocused ? "text-[#800020]" : "text-slate-400 group-hover:text-slate-500"
        )} 
        size={13} 
      />
      <input 
        ref={inputRef}
        id={id}
        type="text" 
        value={localValue}
        autoFocus={autoFocus}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        onChange={(e) => {
          setLocalValue(e.target.value);
          notifyChange(e.target.value);
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="w-full pl-8 pr-14 py-1.5 bg-slate-50/90 hover:bg-white focus:bg-white border border-slate-200/90 hover:border-slate-300 focus:border-[#800020] rounded-lg text-xs font-medium text-slate-900 outline-none focus:ring-1 focus:ring-[#800020] transition-all shadow-2xs placeholder:text-slate-400"
      />
      
      {/* Right side controls: Clear 'X' or Shortcut Pill */}
      <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
        {localValue ? (
          <button 
            type="button"
            id={`${id}-clear-btn`}
            onClick={handleClear}
            className="p-1 hover:bg-slate-200/70 rounded-md text-slate-400 hover:text-slate-600 transition-all cursor-pointer"
            title="Clear search (Esc)"
          >
            <X size={12} />
          </button>
        ) : shortcutHint ? (
          <kbd className="hidden sm:inline-flex items-center px-1.5 py-0.5 text-[9px] font-semibold text-slate-400 bg-slate-100/90 border border-slate-200 rounded tracking-wider shadow-2xs pointer-events-none">
            {shortcutHint}
          </kbd>
        ) : null}
      </div>
    </div>
  );
}
