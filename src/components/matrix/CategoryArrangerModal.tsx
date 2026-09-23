import React, { useState, useEffect } from 'react';
import { Layers, Check, RotateCcw, ArrowUp, ArrowDown, ArrowUpToLine, ArrowDownToLine, Eye, EyeOff, X, GripVertical, MapPin, CheckSquare, Square, ArrowDownAZ } from 'lucide-react';
import { Category, Location } from '../../types';
import { cn } from '../../lib/utils';

export interface CategoryArrangerModalProps {
  isOpen: boolean;
  onClose: () => void;
  categories: Category[];
  groupedLocations: Record<string, Location[]>;
  currentCategoryIds: string[];
  defaultCategoryIds: string[];
  onSave: (orderedVisibleIds: string[]) => Promise<void> | void;
  isSaving?: boolean;
}

export const CategoryArrangerModal: React.FC<CategoryArrangerModalProps> = ({
  isOpen,
  onClose,
  categories,
  groupedLocations,
  currentCategoryIds,
  defaultCategoryIds,
  onSave,
  isSaving = false
}) => {
  if (!isOpen) return null;

  // Build full list of all available categories (including uncategorized if it has locations)
  const allAvailableList = React.useMemo(() => {
    const list: { id: string; name: string; locationCount: number }[] = categories.map(cat => ({
      id: cat.id,
      name: cat.name,
      locationCount: groupedLocations[cat.id]?.length || 0
    }));

    const uncategorizedCount = groupedLocations['uncategorized']?.length || 0;
    if (uncategorizedCount > 0) {
      list.push({
        id: 'uncategorized',
        name: 'General / Uncategorized Locations',
        locationCount: uncategorizedCount
      });
    }

    return list;
  }, [categories, groupedLocations]);

  // Initial working sequence of all categories
  const computeInitialSequence = () => {
    const existing = [...currentCategoryIds];
    // Append any available category that isn't in currentCategoryIds yet
    allAvailableList.forEach(cat => {
      if (!existing.includes(cat.id)) {
        existing.push(cat.id);
      }
    });
    // Filter to only categories that actually exist
    const validIds = allAvailableList.map(c => c.id);
    return existing.filter(id => validIds.includes(id));
  };

  const [orderedIds, setOrderedIds] = useState<string[]>(computeInitialSequence);
  const [visibleIds, setVisibleIds] = useState<string[]>(() => {
    const validIds = allAvailableList.map(c => c.id);
    const initialVisible = currentCategoryIds.filter(id => validIds.includes(id));
    return initialVisible.length > 0 ? initialVisible : validIds;
  });

  // Re-sync if categories or currentCategoryIds change when opening
  useEffect(() => {
    if (isOpen) {
      setOrderedIds(computeInitialSequence());
      const validIds = allAvailableList.map(c => c.id);
      const initialVisible = currentCategoryIds.filter(id => validIds.includes(id));
      setVisibleIds(initialVisible.length > 0 ? initialVisible : validIds);
    }
  }, [isOpen, currentCategoryIds, allAvailableList]);

  const toggleVisibility = (id: string) => {
    setVisibleIds(prev => {
      if (prev.includes(id)) {
        // Prevent hiding everything; keep at least one category visible
        if (prev.length <= 1) return prev;
        return prev.filter(c => c !== id);
      } else {
        return [...prev, id];
      }
    });
  };

  const handleSelectAll = () => {
    setVisibleIds(allAvailableList.map(c => c.id));
  };

  const handleSelectActiveOnly = () => {
    const activeWithLocations = allAvailableList
      .filter(c => c.locationCount > 0)
      .map(c => c.id);
    if (activeWithLocations.length > 0) {
      setVisibleIds(activeWithLocations);
    }
  };

  const handleSortAlphabetical = () => {
    const sorted = [...orderedIds].sort((aId, bId) => {
      const nameA = allAvailableList.find(c => c.id === aId)?.name || '';
      const nameB = allAvailableList.find(c => c.id === bId)?.name || '';
      return nameA.localeCompare(nameB);
    });
    setOrderedIds(sorted);
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

  const moveToTop = (index: number) => {
    if (index <= 0) return;
    setOrderedIds(prev => {
      const next = [...prev];
      const [item] = next.splice(index, 1);
      next.unshift(item);
      return next;
    });
  };

  const moveToBottom = (index: number) => {
    if (index >= orderedIds.length - 1) return;
    setOrderedIds(prev => {
      const next = [...prev];
      const [item] = next.splice(index, 1);
      next.push(item);
      return next;
    });
  };

  const handleResetToDefault = () => {
    const validIds = allAvailableList.map(c => c.id);
    const defaults = defaultCategoryIds.filter(id => validIds.includes(id));
    const finalDefaults = defaults.length > 0 ? defaults : validIds;
    setOrderedIds(finalDefaults);
    setVisibleIds(finalDefaults);
  };

  const handleApply = async () => {
    // Return visible categories in their customized arranged order
    const finalOrderedVisible = orderedIds.filter(id => visibleIds.includes(id));
    await onSave(finalOrderedVisible);
    onClose();
  };

  const categoryMap = React.useMemo(() => {
    return new Map<string, { id: string; name: string; locationCount: number }>(
      allAvailableList.map(c => [c.id, c])
    );
  }, [allAvailableList]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in">
      <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-gray-100 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-gray-100 flex items-center justify-between bg-gradient-to-r from-rose-50/50 via-white to-white">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-[#800020]/10 text-[#800020]">
              <Layers size={18} />
            </div>
            <div>
              <h3 className="font-bold text-gray-900 text-sm sm:text-base leading-tight">
                Arrange Pass Categories
              </h3>
              <p className="text-[11px] text-gray-500 font-medium">
                Reorder category columns and choose which pass categories are displayed in the matrix
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Toolbar Quick Actions */}
        <div className="px-4 py-2.5 bg-gray-50/80 border-b border-gray-100 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="font-bold text-gray-700 text-[11px]">
              Active: {visibleIds.length} of {allAvailableList.length} Categories
            </span>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={handleSelectAll}
              className="px-2 py-1 bg-white hover:bg-gray-100 border border-gray-200 rounded-md text-[10px] font-bold text-gray-700 transition-colors flex items-center gap-1"
              title="Show all available categories"
            >
              <CheckSquare size={11} className="text-[#800020]" />
              <span>All</span>
            </button>
            <button
              onClick={handleSelectActiveOnly}
              className="px-2 py-1 bg-white hover:bg-gray-100 border border-gray-200 rounded-md text-[10px] font-bold text-gray-700 transition-colors flex items-center gap-1"
              title="Show only categories with linked locations"
            >
              <MapPin size={11} className="text-emerald-600" />
              <span>With Locations</span>
            </button>
            <button
              onClick={handleSortAlphabetical}
              className="px-2 py-1 bg-white hover:bg-gray-100 border border-gray-200 rounded-md text-[10px] font-bold text-gray-700 transition-colors flex items-center gap-1"
              title="Sort categories alphabetically A-Z"
            >
              <ArrowDownAZ size={11} className="text-blue-600" />
              <span>A-Z</span>
            </button>
          </div>
        </div>

        {/* Categories Reorderable List */}
        <div className="p-4 overflow-y-auto space-y-2 flex-1 max-h-[50vh]">
          {orderedIds.map((id, index) => {
            const cat = categoryMap.get(id);
            if (!cat) return null;

            const isVisible = visibleIds.includes(id);
            const isFirst = index === 0;
            const isLast = index === orderedIds.length - 1;

            return (
              <div
                key={id}
                className={cn(
                  "flex items-center justify-between p-2.5 rounded-xl border transition-all select-none group",
                  isVisible
                    ? "bg-white border-gray-200 shadow-2xs hover:border-[#800020]/40"
                    : "bg-gray-50/70 border-gray-100 text-gray-400 opacity-60"
                )}
              >
                {/* Left: Drag indicator, Checkbox, Name, Location badge */}
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <span className="text-[10px] font-mono font-bold text-gray-400 w-4 text-center">
                    {index + 1}
                  </span>

                  <button
                    type="button"
                    onClick={() => toggleVisibility(id)}
                    className={cn(
                      "w-5 h-5 rounded-md flex items-center justify-center border transition-all cursor-pointer",
                      isVisible
                        ? "bg-[#800020] border-[#800020] text-white"
                        : "bg-white border-gray-300 hover:border-gray-400 text-transparent"
                    )}
                    title={isVisible ? "Hide from matrix" : "Show in matrix"}
                  >
                    <Check size={13} strokeWidth={3} />
                  </button>

                  <div className="min-w-0 flex-1 cursor-pointer" onClick={() => toggleVisibility(id)}>
                    <div className="flex items-center gap-2">
                      <span className={cn(
                        "text-xs font-bold truncate block",
                        isVisible ? "text-gray-900" : "text-gray-400 line-through"
                      )}>
                        {cat.name}
                      </span>
                      {cat.locationCount > 0 ? (
                        <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-blue-50 text-blue-700 border border-blue-100 shrink-0">
                          {cat.locationCount} {cat.locationCount === 1 ? 'loc' : 'locs'}
                        </span>
                      ) : (
                        <span className="px-1.5 py-0.5 rounded-full text-[9px] font-medium bg-gray-100 text-gray-400 shrink-0">
                          0 locs
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Right: Order controls */}
                <div className="flex items-center gap-1 shrink-0 ml-2">
                  <button
                    type="button"
                    onClick={() => moveToTop(index)}
                    disabled={isFirst}
                    className="p-1 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-20 disabled:hover:bg-transparent transition-colors"
                    title="Move to top"
                  >
                    <ArrowUpToLine size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveUp(index)}
                    disabled={isFirst}
                    className="p-1 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-20 disabled:hover:bg-transparent transition-colors"
                    title="Move up"
                  >
                    <ArrowUp size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveDown(index)}
                    disabled={isLast}
                    className="p-1 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-20 disabled:hover:bg-transparent transition-colors"
                    title="Move down"
                  >
                    <ArrowDown size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveToBottom(index)}
                    disabled={isLast}
                    className="p-1 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-20 disabled:hover:bg-transparent transition-colors"
                    title="Move to bottom"
                  >
                    <ArrowDownToLine size={13} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-100 bg-gray-50 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={handleResetToDefault}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-gray-200 bg-white hover:bg-gray-100 text-gray-700 text-xs font-bold transition-all shadow-2xs"
          >
            <RotateCcw size={12} />
            <span>Reset Defaults</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-xl border border-gray-200 bg-white hover:bg-gray-100 text-gray-700 text-xs font-bold transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleApply}
              disabled={isSaving}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-[#800020] hover:bg-[#600018] text-white text-xs font-bold transition-all shadow-sm shadow-[#800020]/20 disabled:opacity-50"
            >
              <Check size={13} />
              <span>{isSaving ? 'Saving...' : 'Apply & Save Order'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
