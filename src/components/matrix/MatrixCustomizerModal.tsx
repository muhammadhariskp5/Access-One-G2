import React, { useState, useEffect, useMemo } from 'react';
import { Columns, Layers, Check, RotateCcw, ArrowUp, ArrowDown, ArrowUpToLine, ArrowDownToLine, Eye, EyeOff, X, MapPin, CheckSquare, ArrowDownAZ, SlidersHorizontal, ChevronDown, ChevronUp } from 'lucide-react';
import { Category, Location } from '../../types';
import { ColumnDefinition } from '../common/ColumnCustomizerModal';
import { cn } from '../../lib/utils';

export interface MatrixCustomizerModalProps {
  isOpen: boolean;
  onClose: () => void;
  // Personnel Columns
  availableColumns: ColumnDefinition[];
  currentColumnIds: string[];
  defaultColumnIds: string[];
  onSaveColumns: (newCols: string[]) => Promise<void> | void;
  // Pass Categories
  categories: Category[];
  groupedLocations: Record<string, Location[]>;
  currentCategoryIds: string[];
  defaultCategoryIds: string[];
  onSaveCategories: (newCats: string[]) => Promise<void> | void;
  // Locations Order
  currentLocationIds?: string[];
  defaultLocationIds?: string[];
  onSaveLocations?: (newLocs: string[]) => Promise<void> | void;
  isSaving?: boolean;
}

export const MatrixCustomizerModal: React.FC<MatrixCustomizerModalProps> = ({
  isOpen,
  onClose,
  availableColumns,
  currentColumnIds,
  defaultColumnIds,
  onSaveColumns,
  categories,
  groupedLocations,
  currentCategoryIds,
  defaultCategoryIds,
  onSaveCategories,
  currentLocationIds,
  defaultLocationIds,
  onSaveLocations,
  isSaving = false
}) => {
  const [activeTab, setActiveTab] = useState<'columns' | 'categories'>('columns');

  // --- Columns State ---
  const initialOrderedColumns = useMemo(() => {
    const existing = [...currentColumnIds];
    availableColumns.forEach(c => {
      if (!existing.includes(c.id)) {
        existing.push(c.id);
      }
    });
    return existing;
  }, [currentColumnIds, availableColumns]);

  const [orderedColIds, setOrderedColIds] = useState<string[]>(initialOrderedColumns);
  const [visibleColIds, setVisibleColIds] = useState<string[]>(currentColumnIds);

  // --- Categories State ---
  const allAvailableCategories = useMemo(() => {
    const list: { id: string; name: string; locationCount: number }[] = categories.map(cat => ({
      id: cat.id,
      name: cat.name,
      locationCount: groupedLocations[cat.id]?.length || 0
    }));

    const uncategorizedCount = groupedLocations['uncategorized']?.length || 0;
    if (uncategorizedCount > 0) {
      list.push({
        id: 'uncategorized',
        name: 'General Locations',
        locationCount: uncategorizedCount
      });
    }

    return list;
  }, [categories, groupedLocations]);

  const initialOrderedCategories = useMemo(() => {
    const existing = [...currentCategoryIds];
    allAvailableCategories.forEach(cat => {
      if (!existing.includes(cat.id)) {
        existing.push(cat.id);
      }
    });
    const validIds = allAvailableCategories.map(c => c.id);
    return existing.filter(id => validIds.includes(id));
  }, [currentCategoryIds, allAvailableCategories]);

  const [orderedCatIds, setOrderedCatIds] = useState<string[]>(initialOrderedCategories);
  const [visibleCatIds, setVisibleCatIds] = useState<string[]>(() => {
    const validIds = allAvailableCategories.map(c => c.id);
    const initialVisible = currentCategoryIds.filter(id => validIds.includes(id));
    return initialVisible.length > 0 ? initialVisible : validIds;
  });

  // --- Locations State ---
  const [catLocationsMap, setCatLocationsMap] = useState<Record<string, Location[]>>({});
  const [expandedCatIds, setExpandedCatIds] = useState<Set<string>>(new Set());

  // Re-sync on modal open
  useEffect(() => {
    if (isOpen) {
      setOrderedColIds(initialOrderedColumns);
      setVisibleColIds(currentColumnIds);

      setOrderedCatIds(initialOrderedCategories);
      const validIds = allAvailableCategories.map(c => c.id);
      const initialVisible = currentCategoryIds.filter(id => validIds.includes(id));
      setVisibleCatIds(initialVisible.length > 0 ? initialVisible : validIds);

      // Initialize locations map from groupedLocations
      const copy: Record<string, Location[]> = {};
      Object.keys(groupedLocations).forEach(k => {
        copy[k] = [...(groupedLocations[k] || [])];
      });
      setCatLocationsMap(copy);

      // Auto-expand any category with locations
      const expandAll = new Set<string>();
      Object.keys(groupedLocations).forEach(k => {
        if ((groupedLocations[k]?.length || 0) > 0) {
          expandAll.add(k);
        }
      });
      setExpandedCatIds(expandAll);
    }
  }, [isOpen, initialOrderedColumns, currentColumnIds, initialOrderedCategories, currentCategoryIds, allAvailableCategories, groupedLocations]);

  if (!isOpen) return null;

  // --- Column handlers ---
  const toggleColumnVisibility = (id: string, required?: boolean) => {
    if (required) return;
    setVisibleColIds(prev => {
      if (prev.includes(id)) {
        if (prev.length <= 1) return prev;
        return prev.filter(c => c !== id);
      } else {
        return [...prev, id];
      }
    });
  };

  const moveColumnUp = (index: number) => {
    if (index <= 0) return;
    setOrderedColIds(prev => {
      const next = [...prev];
      const temp = next[index - 1];
      next[index - 1] = next[index];
      next[index] = temp;
      return next;
    });
  };

  const moveColumnDown = (index: number) => {
    if (index >= orderedColIds.length - 1) return;
    setOrderedColIds(prev => {
      const next = [...prev];
      const temp = next[index + 1];
      next[index + 1] = next[index];
      next[index] = temp;
      return next;
    });
  };

  // --- Category handlers ---
  const toggleCategoryVisibility = (id: string) => {
    setVisibleCatIds(prev => {
      if (prev.includes(id)) {
        if (prev.length <= 1) return prev;
        return prev.filter(c => c !== id);
      } else {
        return [...prev, id];
      }
    });
  };

  const moveCategoryUp = (index: number) => {
    if (index <= 0) return;
    setOrderedCatIds(prev => {
      const next = [...prev];
      const temp = next[index - 1];
      next[index - 1] = next[index];
      next[index] = temp;
      return next;
    });
  };

  const moveCategoryDown = (index: number) => {
    if (index >= orderedCatIds.length - 1) return;
    setOrderedCatIds(prev => {
      const next = [...prev];
      const temp = next[index + 1];
      next[index + 1] = next[index];
      next[index] = temp;
      return next;
    });
  };

  const moveCategoryToTop = (index: number) => {
    if (index <= 0) return;
    setOrderedCatIds(prev => {
      const next = [...prev];
      const [item] = next.splice(index, 1);
      next.unshift(item);
      return next;
    });
  };

  const moveCategoryToBottom = (index: number) => {
    if (index >= orderedCatIds.length - 1) return;
    setOrderedCatIds(prev => {
      const next = [...prev];
      const [item] = next.splice(index, 1);
      next.push(item);
      return next;
    });
  };

  const toggleCategoryExpand = (catId: string) => {
    setExpandedCatIds(prev => {
      const next = new Set(prev);
      if (next.has(catId)) {
        next.delete(catId);
      } else {
        next.add(catId);
      }
      return next;
    });
  };

  // --- Location reordering within category ---
  const moveLocationUp = (categoryId: string, locIndex: number) => {
    if (locIndex <= 0) return;
    setCatLocationsMap(prev => {
      const currentList = [...(prev[categoryId] || [])];
      const temp = currentList[locIndex - 1];
      currentList[locIndex - 1] = currentList[locIndex];
      currentList[locIndex] = temp;
      return { ...prev, [categoryId]: currentList };
    });
  };

  const moveLocationDown = (categoryId: string, locIndex: number) => {
    setCatLocationsMap(prev => {
      const currentList = [...(prev[categoryId] || [])];
      if (locIndex >= currentList.length - 1) return prev;
      const temp = currentList[locIndex + 1];
      currentList[locIndex + 1] = currentList[locIndex];
      currentList[locIndex] = temp;
      return { ...prev, [categoryId]: currentList };
    });
  };

  const handleSelectAllCategories = () => {
    setVisibleCatIds(allAvailableCategories.map(c => c.id));
  };

  const handleSelectCategoriesWithLocations = () => {
    const withLocs = allAvailableCategories.filter(c => c.locationCount > 0).map(c => c.id);
    if (withLocs.length > 0) {
      setVisibleCatIds(withLocs);
    }
  };

  const handleSortCategoriesAlphabetical = () => {
    const sorted = [...orderedCatIds].sort((aId, bId) => {
      const nameA = allAvailableCategories.find(c => c.id === aId)?.name || '';
      const nameB = allAvailableCategories.find(c => c.id === bId)?.name || '';
      return nameA.localeCompare(nameB);
    });
    setOrderedCatIds(sorted);
  };

  // --- Reset & Save ---
  const handleReset = () => {
    if (activeTab === 'columns') {
      setOrderedColIds(defaultColumnIds);
      setVisibleColIds(defaultColumnIds);
    } else {
      const validIds = allAvailableCategories.map(c => c.id);
      const defaults = defaultCategoryIds.filter(id => validIds.includes(id));
      const finalDefaults = defaults.length > 0 ? defaults : validIds;
      setOrderedCatIds(finalDefaults);
      setVisibleCatIds(finalDefaults);

      // Reset locations back to groupedLocations
      const copy: Record<string, Location[]> = {};
      Object.keys(groupedLocations).forEach(k => {
        copy[k] = [...(groupedLocations[k] || [])];
      });
      setCatLocationsMap(copy);
    }
  };

  const handleApplyAndSave = async () => {
    const finalOrderedColumns = orderedColIds.filter(id => visibleColIds.includes(id));
    const finalOrderedCategories = orderedCatIds.filter(id => visibleCatIds.includes(id));

    // Gather ordered locations across all categories
    const allOrderedLocationIds: string[] = [];
    orderedCatIds.forEach(catId => {
      const locs = catLocationsMap[catId] || groupedLocations[catId] || [];
      locs.forEach(l => allOrderedLocationIds.push(l.id));
    });
    if (catLocationsMap['uncategorized']) {
      catLocationsMap['uncategorized'].forEach(l => allOrderedLocationIds.push(l.id));
    }

    const tasks: Promise<any>[] = [
      Promise.resolve(onSaveColumns(finalOrderedColumns)),
      Promise.resolve(onSaveCategories(finalOrderedCategories))
    ];

    if (onSaveLocations) {
      tasks.push(Promise.resolve(onSaveLocations(allOrderedLocationIds)));
    }

    await Promise.all(tasks);
    onClose();
  };

  const columnMap = new Map<string, ColumnDefinition>(availableColumns.map(c => [c.id, c]));
  const categoryMap = new Map<string, { id: string; name: string; locationCount: number }>(
    allAvailableCategories.map(c => [c.id, c])
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in">
      <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-gray-100 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-gray-100 flex items-center justify-between bg-gradient-to-r from-rose-50/50 via-white to-white">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-[#800020]/10 text-[#800020]">
              <SlidersHorizontal size={18} />
            </div>
            <div>
              <h3 className="font-bold text-gray-900 text-sm sm:text-base leading-tight">
                Customize Matrix Columns & Categories
              </h3>
              <p className="text-[11px] text-gray-500 font-medium">
                Arrange personnel columns, pass categories, and location sequence
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Tab Selection */}
        <div className="flex border-b border-gray-200 bg-gray-50/50 p-1.5 gap-1.5">
          <button
            type="button"
            onClick={() => setActiveTab('columns')}
            className={cn(
              "flex-1 py-2 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer",
              activeTab === 'columns'
                ? "bg-white text-[#800020] shadow-2xs border border-gray-200"
                : "text-gray-600 hover:text-gray-900 hover:bg-gray-100/70"
            )}
          >
            <Columns size={14} />
            <span>Personnel Columns</span>
            <span className={cn(
              "px-1.5 py-0.2 rounded-full text-[10px] font-bold",
              activeTab === 'columns' ? "bg-rose-100 text-[#800020]" : "bg-gray-200 text-gray-600"
            )}>
              {visibleColIds.length} / {availableColumns.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('categories')}
            className={cn(
              "flex-1 py-2 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer",
              activeTab === 'categories'
                ? "bg-white text-[#800020] shadow-2xs border border-gray-200"
                : "text-gray-600 hover:text-gray-900 hover:bg-gray-100/70"
            )}
          >
            <Layers size={14} />
            <span>Pass Categories & Locations</span>
            <span className={cn(
              "px-1.5 py-0.2 rounded-full text-[10px] font-bold",
              activeTab === 'categories' ? "bg-rose-100 text-[#800020]" : "bg-gray-200 text-gray-600"
            )}>
              {visibleCatIds.length} / {allAvailableCategories.length}
            </span>
          </button>
        </div>

        {/* TAB 1: PERSONNEL COLUMNS */}
        {activeTab === 'columns' && (
          <>
            <div className="px-4 py-2 bg-gray-50/70 border-b border-gray-100 flex items-center justify-between text-[11px] text-gray-500 font-medium">
              <span>Toggle visibility and sequence for personnel information</span>
              <span className="font-bold text-gray-700">{visibleColIds.length} visible</span>
            </div>
            <div className="p-4 overflow-y-auto space-y-2 flex-1 max-h-[50vh]">
              {orderedColIds.map((id, index) => {
                const col = columnMap.get(id);
                if (!col) return null;

                const isVisible = visibleColIds.includes(id);
                const isFirst = index === 0;
                const isLast = index === orderedColIds.length - 1;

                return (
                  <div
                    key={id}
                    className={cn(
                      "flex items-center justify-between p-2.5 rounded-xl border transition-all select-none",
                      isVisible
                        ? "bg-white border-gray-200 shadow-2xs hover:border-[#800020]/40"
                        : "bg-gray-50/70 border-gray-100 text-gray-400 opacity-60"
                    )}
                  >
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <span className="text-[10px] font-mono font-bold text-gray-400 w-4 text-center">
                        {index + 1}
                      </span>

                      <button
                        type="button"
                        onClick={() => toggleColumnVisibility(id, col.required)}
                        disabled={col.required}
                        className={cn(
                          "w-5 h-5 rounded-md flex items-center justify-center border transition-all",
                          col.required
                            ? "bg-gray-100 border-gray-300 text-gray-400 cursor-not-allowed"
                            : isVisible
                            ? "bg-[#800020] border-[#800020] text-white cursor-pointer"
                            : "bg-white border-gray-300 hover:border-gray-400 text-transparent cursor-pointer"
                        )}
                        title={col.required ? "Required column" : isVisible ? "Hide column" : "Show column"}
                      >
                        <Check size={13} strokeWidth={3} />
                      </button>

                      <div
                        className={cn("min-w-0 flex-1", !col.required && "cursor-pointer")}
                        onClick={() => toggleColumnVisibility(id, col.required)}
                      >
                        <div className="flex items-center gap-2">
                          <span className={cn(
                            "text-xs font-bold truncate block",
                            isVisible ? "text-gray-900" : "text-gray-400 line-through"
                          )}>
                            {col.label}
                          </span>
                          {col.required && (
                            <span className="text-[9px] bg-amber-50 text-amber-700 px-1.5 py-0.2 rounded border border-amber-200 font-semibold">
                              Required
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0 ml-2">
                      <button
                        type="button"
                        onClick={() => moveColumnUp(index)}
                        disabled={isFirst}
                        className="p-1 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-20 disabled:hover:bg-transparent transition-colors cursor-pointer"
                        title="Move column up"
                      >
                        <ArrowUp size={13} />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveColumnDown(index)}
                        disabled={isLast}
                        className="p-1 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-20 disabled:hover:bg-transparent transition-colors cursor-pointer"
                        title="Move column down"
                      >
                        <ArrowDown size={13} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* TAB 2: PASS CATEGORIES & LOCATIONS */}
        {activeTab === 'categories' && (
          <>
            <div className="px-4 py-2 bg-gray-50/80 border-b border-gray-100 flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="font-bold text-gray-700 text-[11px]">
                Showing {visibleCatIds.length} of {allAvailableCategories.length} Categories
              </span>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={handleSelectAllCategories}
                  className="px-2 py-1 bg-white hover:bg-gray-100 border border-gray-200 rounded-md text-[10px] font-bold text-gray-700 transition-colors flex items-center gap-1 cursor-pointer"
                  title="Show all available categories"
                >
                  <CheckSquare size={11} className="text-[#800020]" />
                  <span>All</span>
                </button>
                <button
                  type="button"
                  onClick={handleSelectCategoriesWithLocations}
                  className="px-2 py-1 bg-white hover:bg-gray-100 border border-gray-200 rounded-md text-[10px] font-bold text-gray-700 transition-colors flex items-center gap-1 cursor-pointer"
                  title="Show only categories with linked locations"
                >
                  <MapPin size={11} className="text-emerald-600" />
                  <span>With Locations</span>
                </button>
                <button
                  type="button"
                  onClick={handleSortCategoriesAlphabetical}
                  className="px-2 py-1 bg-white hover:bg-gray-100 border border-gray-200 rounded-md text-[10px] font-bold text-gray-700 transition-colors flex items-center gap-1 cursor-pointer"
                  title="Sort categories alphabetically A-Z"
                >
                  <ArrowDownAZ size={11} className="text-blue-600" />
                  <span>A-Z</span>
                </button>
              </div>
            </div>

            <div className="p-4 overflow-y-auto space-y-2.5 flex-1 max-h-[50vh]">
              {orderedCatIds.map((id, index) => {
                const cat = categoryMap.get(id);
                if (!cat) return null;

                const isVisible = visibleCatIds.includes(id);
                const isFirst = index === 0;
                const isLast = index === orderedCatIds.length - 1;
                const locs = catLocationsMap[id] || groupedLocations[id] || [];
                const isExpanded = expandedCatIds.has(id);

                return (
                  <div
                    key={id}
                    className={cn(
                      "p-2.5 rounded-xl border transition-all select-none",
                      isVisible
                        ? "bg-white border-gray-200 shadow-2xs hover:border-[#800020]/40"
                        : "bg-gray-50/70 border-gray-100 text-gray-400 opacity-60"
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        <span className="text-[10px] font-mono font-bold text-gray-400 w-4 text-center">
                          {index + 1}
                        </span>

                        <button
                          type="button"
                          onClick={() => toggleCategoryVisibility(id)}
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

                        <div className="min-w-0 flex-1 cursor-pointer" onClick={() => toggleCategoryVisibility(id)}>
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

                      <div className="flex items-center gap-1 shrink-0 ml-2">
                        {locs.length > 0 && (
                          <button
                            type="button"
                            onClick={() => toggleCategoryExpand(id)}
                            className="px-1.5 py-1 rounded-md text-[10px] font-bold text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition-colors flex items-center gap-1 cursor-pointer mr-1"
                            title={isExpanded ? "Collapse locations" : "Expand locations"}
                          >
                            <span>Locations</span>
                            {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => moveCategoryToTop(index)}
                          disabled={isFirst}
                          className="p-1 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-20 disabled:hover:bg-transparent transition-colors cursor-pointer"
                          title="Move to top"
                        >
                          <ArrowUpToLine size={13} />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveCategoryUp(index)}
                          disabled={isFirst}
                          className="p-1 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-20 disabled:hover:bg-transparent transition-colors cursor-pointer"
                          title="Move up"
                        >
                          <ArrowUp size={13} />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveCategoryDown(index)}
                          disabled={isLast}
                          className="p-1 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-20 disabled:hover:bg-transparent transition-colors cursor-pointer"
                          title="Move down"
                        >
                          <ArrowDown size={13} />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveCategoryToBottom(index)}
                          disabled={isLast}
                          className="p-1 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-20 disabled:hover:bg-transparent transition-colors cursor-pointer"
                          title="Move to bottom"
                        >
                          <ArrowDownToLine size={13} />
                        </button>
                      </div>
                    </div>

                    {/* Expandable Location Sequence within Category */}
                    {locs.length > 0 && isExpanded && (
                      <div className="mt-2.5 pt-2 border-t border-gray-100 space-y-1.5 pl-6 pr-1">
                        <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider flex items-center justify-between">
                          <span>Locations Sequence ({locs.length})</span>
                          <span className="text-[9px] text-gray-400 lowercase">order appears left-to-right</span>
                        </div>
                        {locs.map((loc, lIdx) => (
                          <div
                            key={loc.id}
                            className="flex items-center justify-between py-1 px-2.5 rounded-lg bg-gray-50/90 text-xs border border-gray-200/70"
                          >
                            <div className="flex items-center gap-2 truncate flex-1 min-w-0">
                              <span className="font-mono text-[10px] font-bold text-gray-400 w-3">
                                {lIdx + 1}
                              </span>
                              <span className="font-semibold text-gray-800 text-[11px] truncate">
                                {loc.name}
                              </span>
                              {loc.code && (
                                <span className="text-[9px] font-bold bg-white px-1.5 py-0.2 rounded border text-gray-600 shrink-0">
                                  {loc.code}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-1 shrink-0 ml-2">
                              <button
                                type="button"
                                onClick={() => moveLocationUp(id, lIdx)}
                                disabled={lIdx === 0}
                                className="p-1 rounded text-gray-400 hover:text-gray-800 hover:bg-white disabled:opacity-20 transition-colors cursor-pointer"
                                title="Move location up (left in matrix)"
                              >
                                <ArrowUp size={11} />
                              </button>
                              <button
                                type="button"
                                onClick={() => moveLocationDown(id, lIdx)}
                                disabled={lIdx === locs.length - 1}
                                className="p-1 rounded text-gray-400 hover:text-gray-800 hover:bg-white disabled:opacity-20 transition-colors cursor-pointer"
                                title="Move location down (right in matrix)"
                              >
                                <ArrowDown size={11} />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* Footer */}
        <div className="p-4 border-t border-gray-100 bg-gray-50 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={handleReset}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-gray-200 bg-white hover:bg-gray-100 text-gray-700 text-xs font-bold transition-all shadow-2xs cursor-pointer"
          >
            <RotateCcw size={12} />
            <span>Reset {activeTab === 'columns' ? 'Columns' : 'Categories & Locations'}</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-xl border border-gray-200 bg-white hover:bg-gray-100 text-gray-700 text-xs font-bold transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleApplyAndSave}
              disabled={isSaving}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-[#800020] hover:bg-[#600018] text-white text-xs font-bold transition-all shadow-sm shadow-[#800020]/20 disabled:opacity-50 cursor-pointer"
            >
              <Check size={13} />
              <span>{isSaving ? 'Saving...' : 'Apply & Save Settings'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
