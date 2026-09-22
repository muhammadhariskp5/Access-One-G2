import React, { useState } from 'react';
import { Category, Location, AccessCode } from '../../types';
import { cn, parseToYMD } from '../../lib/utils';
import { Shield, ShieldCheck, Check, Ban, Calendar, Plus } from 'lucide-react';

export interface FormAccessMatrixProps {
  categories: Category[];
  locations: Location[];
  accessCodes: AccessCode[];
  selections: Record<string, { accessCodes: string[]; expiryDate: string }>;
  selectionOrder: string[];
  onToggle: (locationId: string, areaCode: string) => void;
  onSetExpiry?: (locationId: string, date: string) => void;
}

export function FormAccessMatrix({ 
  categories, 
  locations, 
  accessCodes, 
  selections, 
  selectionOrder,
  onToggle,
  onSetExpiry
}: FormAccessMatrixProps) {
  const [activeCategoryId, setActiveCategoryId] = useState<string>(() => {
    const selectedLocIds = Object.keys(selections);
    if (selectedLocIds.length > 0) {
      const firstSelectedLoc = locations.find(l => l.id === selectedLocIds[0]);
      if (firstSelectedLoc) return firstSelectedLoc.categoryId;
    }
    return categories[0]?.id || '';
  });

  // Determine "Main" code for each category based on selectionOrder
  const categoryMainCode: Record<string, string> = {};
  categories.forEach(cat => {
    const catLocIds = locations.filter(l => l.categoryId === cat.id).map(l => l.id);
    const firstSelectedInCat = selectionOrder.find(so => {
      const [locId] = so.split(':');
      return catLocIds.includes(locId);
    });
    if (firstSelectedInCat) {
      categoryMainCode[cat.id] = firstSelectedInCat;
    }
  });

  const selectedLocs = Object.keys(selections);

  return (
    <div className="space-y-6">
      {/* Category Selection Bar */}
      <div className="flex flex-wrap gap-2 p-2 bg-gray-50/50 rounded-2xl border border-gray-100">
        {categories.map(cat => {
          const hasSelection = locations.some(l => l.categoryId === cat.id && (selections[l.id]?.accessCodes || []).length > 0);
          const isActive = activeCategoryId === cat.id;
          return (
            <button
              key={cat.id}
              onClick={() => setActiveCategoryId(cat.id)}
              className={cn(
                "px-4 py-2 rounded-xl text-[11px] font-bold uppercase tracking-wider transition-all border flex items-center gap-2",
                isActive 
                  ? "bg-[#800020] text-white border-[#800020] shadow-sm scale-[1.02]" 
                  : "bg-white text-[#64748B] border-gray-200 hover:border-[#800020]/20"
              )}
            >
              <Shield size={12} className={isActive ? "text-white" : "text-[#800020]"} />
              {cat.name}
              {hasSelection && (
                <div className="w-1.5 h-1.5 rounded-full bg-[#800020] shadow-[0_0_8px_rgba(128,0,32,0.3)]" />
              )}
            </button>
          );
        })}
      </div>

      <div className="flex flex-col lg:flex-row gap-5">
        {/* Matrix Table */}
        <div className="flex-1 border border-[#E5E7EB] rounded-2xl overflow-hidden bg-white shadow-2xs max-h-[380px] flex flex-col">
          <div className="overflow-x-auto overflow-y-auto flex-1 custom-scrollbar">
            <table className="w-full text-left border-collapse min-w-[480px]">
              <thead className="bg-gray-50 border-b border-[#E5E7EB] sticky top-0 z-10">
                <tr>
                  <th className="pl-6 pr-4 py-3 text-[10px] font-black text-[#64748B] uppercase tracking-widest w-[35%] bg-gray-50">Location</th>
                  <th className="px-6 py-3 text-[10px] font-black text-[#64748B] uppercase tracking-widest bg-gray-50">Access Codes (Multiple Possible)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {locations
                  .filter(l => l.categoryId === activeCategoryId && l.status !== 'inactive')
                  .map(loc => {
                    const locCodes = accessCodes.filter(ac => ac.locationId === loc.id);
                    const selection = selections[loc.id];
                    const isSelected = (selection?.accessCodes || []).length > 0;

                    return (
                      <tr key={loc.id} className={cn(
                        "transition-all duration-200 group",
                        isSelected ? "bg-[#800020]/5" : "hover:bg-gray-50/50"
                      )}>
                        <td className="pl-6 pr-4 py-2.5">
                          <div className="flex items-center gap-3">
                            <div className={cn(
                              "w-1 h-6 rounded-full transition-all duration-300 shrink-0",
                              isSelected ? "bg-[#800020] shadow-sm" : "bg-gray-200"
                            )} />
                            <div className="min-w-0">
                              <p className="text-xs font-bold text-[#1E293B] truncate">{loc.name}</p>
                              <p className="text-[9px] text-[#64748B] font-bold mt-0.5 tracking-tight uppercase">Ref: {loc.code}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-2.5">
                          <div className="flex flex-wrap gap-1.5">
                            {locCodes.map(code => {
                              const active = selection?.accessCodes.includes(code.areaCode);
                              
                              return (
                                <button
                                  key={code.id}
                                  onClick={() => onToggle(loc.id, code.areaCode)}
                                  className={cn(
                                    "px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-tight transition-all border flex items-center gap-1",
                                    active 
                                      ? "bg-[#800020] text-white border-[#800020] shadow-sm scale-[1.03]" 
                                      : "bg-white text-[#94A3B8] border-gray-200 hover:border-[#800020]/30 hover:text-[#800020] hover:scale-[1.02]"
                                  )}
                                >
                                  {code.areaCode}
                                  {active && <Check size={10} className="text-white/70" />}
                                </button>
                              );
                            })}
                            {locCodes.length === 0 && (
                              <div className="flex items-center gap-1 text-gray-300 text-[10px] font-bold uppercase italic">
                                <Ban size={11} />
                                Restricted
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Local Summary */}
        <div className="w-full lg:w-72 shrink-0 space-y-3">
          <div className="p-4 bg-gray-50/80 rounded-2xl border border-gray-100 shadow-2xs">
            <h5 className="text-[11px] font-black text-[#1E293B] uppercase tracking-widest mb-3 flex items-center gap-2">
              <ShieldCheck size={14} className="text-[#800020]" />
              Selection Summary
            </h5>
            <div className="space-y-2.5 max-h-[310px] overflow-y-auto pr-1 custom-scrollbar">
              {selectedLocs.length > 0 ? selectedLocs.map(locId => {
                const loc = locations.find(l => l.id === locId);
                const selection = selections[locId];
                return (
                  <div key={locId} className="bg-white p-3 rounded-2xl border border-gray-100 shadow-sm animate-in fade-in slide-in-from-right-2">
                    <p className="text-[11px] font-bold text-[#1E293B] leading-tight mb-2">{loc?.name}</p>
                    <div className="flex flex-wrap gap-1">
                      {selection.accessCodes.map(ac => (
                        <span key={ac} className="px-1.5 py-0.5 bg-gray-50 border border-gray-100 text-[#64748B] text-[8px] font-black rounded uppercase">
                          {ac}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              }) : (
                <div className="py-12 text-center">
                  <div className="w-10 h-10 bg-white rounded-2xl border-2 border-dashed border-gray-200 flex items-center justify-center mx-auto mb-3">
                    <Plus size={16} className="text-gray-300" />
                  </div>
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">No access selected</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
