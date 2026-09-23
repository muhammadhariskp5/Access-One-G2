import React, { useState } from 'react';
import { Columns, Check, RotateCcw, ArrowUp, ArrowDown, Eye, EyeOff, X } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface ColumnDefinition {
  id: string;
  label: string;
  required?: boolean;
}

interface ColumnCustomizerModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  availableColumns: ColumnDefinition[];
  currentColumnIds: string[];
  defaultColumnIds: string[];
  onSave: (newColumnIds: string[]) => void;
  isSaving?: boolean;
}

export const ColumnCustomizerModal: React.FC<ColumnCustomizerModalProps> = ({
  isOpen,
  onClose,
  title = "Customize & Arrange Columns",
  description = "Toggle column visibility and re-order their sequence. Your preferences are saved automatically for your user account.",
  availableColumns,
  currentColumnIds,
  defaultColumnIds,
  onSave,
  isSaving = false
}) => {
  if (!isOpen) return null;

  // Working state of ordered column IDs
  // Include any available columns that might not yet be in currentColumnIds
  const initialOrderedIds = (() => {
    const existing = [...currentColumnIds];
    availableColumns.forEach(c => {
      if (!existing.includes(c.id)) {
        existing.push(c.id);
      }
    });
    return existing;
  })();

  const [orderedIds, setOrderedIds] = useState<string[]>(initialOrderedIds);
  const [visibleIds, setVisibleIds] = useState<string[]>(currentColumnIds);

  const toggleVisibility = (id: string, required?: boolean) => {
    if (required) return;
    setVisibleIds(prev => {
      if (prev.includes(id)) {
        // Must keep at least one column visible
        if (prev.length <= 1) return prev;
        return prev.filter(c => c !== id);
      } else {
        return [...prev, id];
      }
    });
  };

  const moveUp = (index: number) => {
    if (index <= 0) return;
    setOrderedIds(prev => {
      const next = [...prev];
      const temp = next[index - 1];
      next[index - 1] = next[index];
      next[index] = temp;
      return next;
    });
  };

  const moveDown = (index: number) => {
    if (index >= orderedIds.length - 1) return;
    setOrderedIds(prev => {
      const next = [...prev];
      const temp = next[index + 1];
      next[index + 1] = next[index];
      next[index] = temp;
      return next;
    });
  };

  const handleResetToDefault = () => {
    setOrderedIds(defaultColumnIds);
    setVisibleIds(defaultColumnIds);
  };

  const handleApply = () => {
    // Return visible columns in their specified order
    const finalOrderedVisible = orderedIds.filter(id => visibleIds.includes(id));
    onSave(finalOrderedVisible);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in">
      <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-gray-100 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-gray-100 flex items-center justify-between bg-gradient-to-r from-gray-50 to-white">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-[#800020]/10 text-[#800020] flex items-center justify-center shrink-0">
              <Columns size={16} />
            </div>
            <div>
              <h3 className="text-sm font-extrabold text-gray-900">{title}</h3>
              <p className="text-[11px] text-gray-500 mt-0.5">{description}</p>
            </div>
          </div>
          <button 
            type="button" 
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        {/* Column List */}
        <div className="p-4 sm:p-5 overflow-y-auto space-y-2 flex-1">
          <div className="flex items-center justify-between text-[11px] font-bold text-gray-500 uppercase tracking-wider pb-1">
            <span>Column Name & Visibility</span>
            <span>Arrange Order</span>
          </div>

          <div className="space-y-1.5">
            {orderedIds.map((colId, index) => {
              const def = availableColumns.find(c => c.id === colId);
              if (!def) return null;
              const isVisible = visibleIds.includes(colId);

              return (
                <div 
                  key={colId}
                  className={cn(
                    "flex items-center justify-between p-2.5 rounded-xl border transition-all text-xs select-none",
                    isVisible ? "bg-white border-gray-200/90 shadow-2xs" : "bg-gray-50/70 border-dashed border-gray-200 opacity-60"
                  )}
                >
                  {/* Left: Checkbox & Name */}
                  <label className="flex items-center gap-2.5 cursor-pointer flex-1 min-w-0 pr-2">
                    <input 
                      type="checkbox"
                      checked={isVisible}
                      disabled={def.required}
                      onChange={() => toggleVisibility(colId, def.required)}
                      className="rounded border-gray-300 text-[#800020] focus:ring-[#800020] w-4 h-4 disabled:opacity-50 cursor-pointer"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className={cn("font-bold truncate", isVisible ? "text-gray-900" : "text-gray-500")}>
                          {def.label}
                        </span>
                        {def.required && (
                          <span className="text-[9px] font-bold px-1.5 py-0.2 bg-gray-100 text-gray-500 rounded uppercase">
                            Required
                          </span>
                        )}
                      </div>
                    </div>
                  </label>

                  {/* Right: Re-order controls */}
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => moveUp(index)}
                      disabled={index === 0}
                      className="p-1 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-20 cursor-pointer transition-colors"
                      title="Move Column Up"
                    >
                      <ArrowUp size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveDown(index)}
                      disabled={index === orderedIds.length - 1}
                      className="p-1 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-20 cursor-pointer transition-colors"
                      title="Move Column Down"
                    >
                      <ArrowDown size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-100 bg-gray-50/80 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={handleResetToDefault}
            className="text-xs text-gray-600 hover:text-[#800020] font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <RotateCcw size={12} />
            <span>Reset to Default</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 text-xs font-bold text-gray-600 hover:bg-gray-200/60 rounded-xl transition-all cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleApply}
              disabled={isSaving}
              className="px-4 py-2 bg-[#800020] hover:bg-[#600018] text-white text-xs font-bold rounded-xl shadow-2xs transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <Check size={13} />
              <span>{isSaving ? "Saving..." : "Save Preferences"}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
