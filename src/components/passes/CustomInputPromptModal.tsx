import React, { useState, useEffect } from 'react';
import { cn } from '../../lib/utils';
import { X } from 'lucide-react';

export interface CustomInputPromptModalProps {
  isOpen: boolean;
  title: string;
  description?: string;
  label: string;
  defaultValue?: string;
  placeholder?: string;
  confirmText?: string;
  confirmVariant?: 'primary' | 'danger' | 'emerald';
  onConfirm: (val: string) => void;
  onCancel: () => void;
}

export function CustomInputPromptModal({
  isOpen,
  title,
  description,
  label,
  defaultValue = '',
  placeholder = '',
  confirmText = 'Confirm',
  confirmVariant = 'primary',
  onConfirm,
  onCancel
}: CustomInputPromptModalProps) {
  const [val, setVal] = useState(defaultValue);

  useEffect(() => {
    setVal(defaultValue);
  }, [defaultValue, isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl border border-gray-100 max-w-md w-full p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-[#1F2937]">{title}</h3>
          <button 
            type="button"
            onClick={onCancel}
            className="p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100"
          >
            <X size={16} />
          </button>
        </div>
        {description && (
          <p className="text-xs text-[#6B7280]">{description}</p>
        )}
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold text-[#6B7280] uppercase tracking-wider">{label}</label>
          <input 
            type="text"
            autoFocus
            value={val}
            onChange={e => setVal(e.target.value)}
            placeholder={placeholder}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                onConfirm(val);
              }
            }}
            className="w-full px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-semibold focus:bg-white focus:border-[#800020] focus:ring-1 focus:ring-[#800020] outline-none transition-all"
          />
        </div>
        <div className="flex items-center justify-end gap-3 pt-2">
          <button 
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-xl border border-gray-200 text-xs font-bold text-gray-600 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button 
            type="button"
            onClick={() => onConfirm(val)}
            className={cn(
              "px-4 py-2 rounded-xl text-xs font-bold text-white shadow-sm transition-all",
              confirmVariant === 'danger' 
                ? "bg-rose-600 hover:bg-rose-700" 
                : "bg-[#800020] hover:bg-[#600018]"
            )}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
