import React from 'react';
import { motion } from 'motion/react';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  maxWidth?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl' | '5xl' | '6xl' | '7xl' | 'full';
}

export function Modal({ isOpen, onClose, title, children, maxWidth, size = '2xl' }: ModalProps) {
  if (!isOpen) return null;

  const sizeClasses: Record<string, string> = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
    '2xl': 'max-w-2xl',
    '3xl': 'max-w-3xl',
    '4xl': 'max-w-4xl',
    '5xl': 'max-w-5xl',
    '6xl': 'max-w-6xl',
    '7xl': 'max-w-7xl',
    full: 'max-w-[96vw] w-[96vw]'
  };

  const selectedSize = maxWidth || sizeClasses[size] || 'max-w-2xl';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 md:p-6 bg-slate-900/40 backdrop-blur-xs">
      <motion.div 
        initial={{ opacity: 0, scale: 0.98, y: 6 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className={cn("bg-white rounded-2xl overflow-hidden shadow-2xl flex flex-col border border-slate-200/80 w-full max-h-[90vh]", selectedSize)}
      >
        <div className="px-4 py-3 border-b border-slate-200/80 flex items-center justify-between bg-slate-50/90 shrink-0">
          <h3 className="text-xs font-extrabold text-slate-900 uppercase tracking-wider">{title}</h3>
          <button onClick={onClose} className="p-1 hover:bg-slate-200/60 rounded-lg transition-colors text-slate-400 hover:text-slate-600 cursor-pointer">
            <X size={16} />
          </button>
        </div>
        <div className="p-4 md:p-5 overflow-y-auto flex-1 custom-scrollbar min-h-0">
          {children}
        </div>
      </motion.div>
    </div>
  );
}
