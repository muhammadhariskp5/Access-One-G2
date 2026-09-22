import React from 'react';
import { Table, CheckCircle2, AlertCircle, Trash2, X, FileText, Search } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface BulkImportColumn<T> {
  key: string;
  label: string;
  render?: (row: T) => React.ReactNode;
}

interface BulkImportReviewProps<T> {
  data: T[];
  columns: BulkImportColumn<T>[];
  onApply: () => void;
  onCancel: () => void;
  onUpdateRow?: (index: number, field: string, value: any) => void;
  onDeleteRow?: (index: number) => void;
  onToggleSkip?: (index: number) => void;
  onManualMatch?: (index: number) => void;
  title: string;
  description?: string;
  isImporting?: boolean;
  applyLabel?: string;
  matchedCount?: number;
  unmatchedCount?: number;
}

export function BulkImportReview<T extends { skip?: boolean; isDuplicate?: boolean; errors?: string[]; _status?: string }>({
  data,
  columns,
  onApply,
  onCancel,
  onUpdateRow,
  onDeleteRow,
  onToggleSkip,
  onManualMatch,
  title,
  description,
  isImporting,
  applyLabel,
  matchedCount,
  unmatchedCount
}: BulkImportReviewProps<T>) {
  const [searchTerm, setSearchTerm] = React.useState('');
  const activeCount = data.filter(r => !r.skip).length;

  const filteredData = data.filter(row => {
    if (!searchTerm) return true;
    return columns.some(col => {
      const val = (row as any)[col.key]?.toString()?.toLowerCase();
      return val?.includes(searchTerm.toLowerCase());
    });
  });

  return (
    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-300">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xs font-bold text-[#1A1A1A] uppercase tracking-wider flex items-center gap-2">
            <Table size={14} className="text-[#800020]" />
            {title}
          </h3>
          {description && <p className="text-[10px] text-[#6B7280] mt-0.5">{description}</p>}
        </div>
        <button 
          onClick={onCancel}
          className="p-2 text-[#9CA3AF] hover:text-[#800020] transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      {(matchedCount !== undefined || unmatchedCount !== undefined) && (
        <div className="grid grid-cols-2 gap-3">
          {matchedCount !== undefined && (
            <div className="p-3 bg-emerald-50 border border-emerald-100 rounded-xl">
              <p className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider">Matched</p>
              <p className="text-lg font-bold text-emerald-800">{matchedCount}</p>
            </div>
          )}
          {unmatchedCount !== undefined && (
            <div className="p-3 bg-amber-50 border border-amber-100 rounded-xl">
              <p className="text-[10px] font-bold text-amber-700 uppercase tracking-wider">Unmatched</p>
              <p className="text-lg font-bold text-amber-800">{unmatchedCount}</p>
            </div>
          )}
        </div>
      )}

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9CA3AF]" size={14} />
        <input 
          type="text"
          placeholder="Filter review data..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full pl-9 pr-4 py-2 bg-[#F9FAFB] border border-[#E5E7EB] rounded-xl text-[10px] font-medium outline-none focus:ring-1 focus:ring-[#800020] transition-all"
        />
      </div>

      <div className="border border-[#E5E7EB] rounded-2xl overflow-hidden bg-white shadow-sm">
        <div className="max-h-[300px] overflow-auto">
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 bg-[#F9FAFB] z-10 border-b border-[#E5E7EB]">
              <tr>
                {(onToggleSkip || onDeleteRow) && (
                  <th className="px-3 py-2 w-10">
                    <div className="w-4" />
                  </th>
                )}
                {columns.map(col => (
                  <th key={col.key} className="px-3 py-2 text-[9px] font-bold text-[#6B7280] uppercase tracking-wider">
                    {col.label}
                  </th>
                ))}
                {(onDeleteRow || onUpdateRow) && (
                  <th className="px-3 py-2 text-[9px] font-bold text-[#6B7280] uppercase tracking-wider text-right">
                    Actions
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F3F4F6]">
              {filteredData.map((row, idx) => (
                <tr key={idx} className={cn(
                  "hover:bg-[#F9FAFB] transition-colors",
                  row.skip && "opacity-50 grayscale bg-gray-50",
                  row.isDuplicate && !row.skip && "bg-amber-50/50"
                )}>
                  {(onToggleSkip || onDeleteRow) && (
                    <td className="px-3 py-2">
                      {onToggleSkip && (
                        <input 
                          type="checkbox" 
                          checked={!row.skip}
                          onChange={() => onToggleSkip(idx)}
                          className="rounded border-[#E5E7EB] text-[#800020] focus:ring-[#800020]"
                        />
                      )}
                    </td>
                  )}
                  {columns.map(col => (
                    <td key={col.key} className="px-3 py-2">
                      {col.render ? col.render(row) : (
                        <span className="text-[10px] font-medium text-[#4B5563]">
                          {(row as any)[col.key]?.toString() || '-'}
                        </span>
                      )}
                    </td>
                  ))}
                  {(onDeleteRow || onUpdateRow) && (
                    <td className="px-3 py-2 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {row.isDuplicate && (
                          <div className="group relative">
                            <AlertCircle size={12} className="text-amber-500" />
                            <div className="absolute bottom-full right-0 mb-2 w-32 p-2 bg-black text-white text-[8px] rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
                              Duplicate detected
                            </div>
                          </div>
                        )}
                        {onDeleteRow && (
                          <button 
                            onClick={() => onDeleteRow(idx)}
                            className="p-1 text-[#9CA3AF] hover:text-rose-600 transition-colors"
                          >
                            <Trash2 size={12} />
                          </button>
                        )}
                        {onManualMatch && row._status === 'Unmatched' && (
                          <button 
                            onClick={() => onManualMatch(idx)}
                            className="px-2 py-1 bg-[#800020]/10 text-[#800020] rounded text-[8px] font-bold hover:bg-[#800020]/20 transition-all"
                          >
                            Match Manually
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <button 
        onClick={onApply}
        disabled={activeCount === 0 || isImporting}
        className="w-full py-3 bg-[#800020] text-white rounded-xl font-bold text-xs hover:bg-[#600018] transition-all disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg shadow-[#800020]/20"
      >
        {isImporting ? (
          <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
        ) : (
          <CheckCircle2 size={14} />
        )}
        {applyLabel || `Apply ${activeCount} Records`}
      </button>
    </div>
  );
}
