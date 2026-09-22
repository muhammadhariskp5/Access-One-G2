import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, CheckCircle2, AlertOctagon, RefreshCw, AlertCircle, ChevronDown, ChevronRight, Code } from 'lucide-react';
import { cn } from '../../lib/utils';

interface ToastProps {
  message: string;
  type: 'success' | 'error';
  reason?: string;
  onClose: () => void;
  onRetry?: () => void;
}

export function Toast({ message, type, reason, onClose, onRetry }: ToastProps) {
  const [showDetails, setShowDetails] = useState(false);

  if (type === 'error') {
    // Parse message and reason if message contains separator like ": " or " - "
    let mainMsg = message;
    let computedReason = reason;

    if (!computedReason && message.includes(': ')) {
      const parts = message.split(': ');
      mainMsg = parts[0];
      computedReason = parts.slice(1).join(': ');
    } else if (!computedReason && message.includes(' - ')) {
      const parts = message.split(' - ');
      mainMsg = parts[0];
      computedReason = parts.slice(1).join(' - ');
    }

    if (!computedReason) {
      computedReason = message;
      mainMsg = 'An error occurred while performing this operation.';
    }

    return (
      <div className="fixed inset-0 z-[200] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, scale: 0.92, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.92, y: 12 }}
          className="bg-white rounded-2xl shadow-2xl border-2 border-red-500/80 max-w-lg w-full overflow-hidden flex flex-col"
        >
          {/* Header */}
          <div className="bg-red-50 px-5 py-4 border-b border-red-100 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="p-2 bg-red-100 text-red-700 rounded-xl shrink-0">
                <AlertOctagon size={20} />
              </div>
              <div>
                <h3 className="text-sm font-extrabold text-red-950 uppercase tracking-wider">Error Encountered</h3>
                <p className="text-[11px] font-semibold text-red-700">Action could not be completed</p>
              </div>
            </div>
            <button 
              onClick={onClose} 
              className="p-1.5 text-red-400 hover:text-red-700 hover:bg-red-100/80 rounded-lg transition-colors cursor-pointer"
              title="Close error popup"
            >
              <X size={18} />
            </button>
          </div>

          {/* Body */}
          <div className="p-5 space-y-4">
            <div className="flex items-start gap-3">
              <AlertCircle size={18} className="text-red-600 shrink-0 mt-0.5" />
              <div className="flex-1">
                <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Error Overview</h4>
                <p className="text-sm font-bold text-gray-900 mt-0.5 leading-snug">{mainMsg}</p>
              </div>
            </div>

            {/* Toggle Details Button */}
            <div className="pt-1">
              <button
                onClick={() => setShowDetails(!showDetails)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-800 text-xs font-bold rounded-lg border border-red-200/80 transition-all cursor-pointer"
              >
                <Code size={13} className="text-red-600" />
                <span>{showDetails ? "Hide Details" : "Details / Technical Reason"}</span>
                {showDetails ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
            </div>

            {/* Technical Reason Expandable Box */}
            <AnimatePresence>
              {showDetails && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <div className="bg-slate-900 text-slate-100 rounded-xl p-4 text-xs font-mono border border-slate-800 space-y-2 shadow-inner">
                    <div className="text-[10px] font-bold text-red-400 uppercase tracking-wider flex items-center justify-between border-b border-slate-800 pb-1.5">
                      <span>Technical Failure Cause</span>
                      <span className="text-slate-500 font-normal">Timestamp: {new Date().toLocaleTimeString()}</span>
                    </div>
                    <p className="text-xs text-red-300 font-semibold leading-relaxed break-words whitespace-pre-wrap">
                      {computedReason}
                    </p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Footer */}
          <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-2.5">
            {onRetry && (
              <button 
                onClick={() => {
                  onRetry();
                  onClose();
                }}
                className="flex items-center gap-1.5 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-xl shadow-xs transition-all cursor-pointer"
              >
                <RefreshCw size={13} />
                <span>Retry Action</span>
              </button>
            )}
            <button 
              onClick={onClose} 
              className="px-5 py-2 bg-red-600 hover:bg-red-700 text-white font-bold text-xs rounded-xl shadow-md transition-all cursor-pointer"
            >
              Close
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  // Success Toast
  return (
    <motion.div 
      initial={{ opacity: 0, y: 50 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 50 }}
      className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[100] px-6 py-3.5 rounded-2xl shadow-2xl flex items-center gap-4 font-bold text-sm min-w-[320px] justify-between bg-emerald-600 text-white border border-emerald-500"
    >
      <div className="flex items-center gap-3">
        <CheckCircle2 size={20} />
        <span>{message}</span>
      </div>
      <button onClick={onClose} className="p-1 opacity-70 hover:opacity-100 transition-all cursor-pointer" title="Close toast">
        <X size={16} />
      </button>
    </motion.div>
  );
}

