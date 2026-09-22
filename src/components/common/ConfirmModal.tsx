import React from 'react';
import { motion } from 'motion/react';

interface ConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  message: string;
  onConfirm: () => void;
}

export function ConfirmModal({ isOpen, onClose, title, message, onConfirm }: ConfirmModalProps) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="bg-white rounded-3xl w-full max-w-md overflow-hidden shadow-2xl"
      >
        <div className="p-6 border-b border-[#F3F4F6] bg-[#F9FAFB]">
          <h3 className="text-xl font-bold text-[#1A1A1A]">{title}</h3>
        </div>
        <div className="p-6">
          <p className="text-[#4B5563] font-medium">{message}</p>
        </div>
        <div className="p-6 bg-[#F9FAFB] border-t border-[#F3F4F6] flex justify-end gap-3">
          <button 
            onClick={onClose}
            className="px-6 py-2 text-sm font-bold text-[#6B7280] hover:bg-white rounded-xl transition-all"
          >
            Cancel
          </button>
          <button 
            onClick={() => { onConfirm(); onClose(); }}
            className="px-6 py-2 text-sm font-bold bg-red-600 text-white rounded-xl hover:bg-red-700 transition-all shadow-lg shadow-red-600/20"
          >
            Confirm
          </button>
        </div>
      </motion.div>
    </div>
  );
}
