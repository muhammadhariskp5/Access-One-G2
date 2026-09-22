import React from 'react';
import { Calendar, X } from 'lucide-react';
import { cn } from '../../lib/utils';

interface DateRangeFilterProps {
  startDate: string;
  endDate: string;
  onStartDateChange: (val: string) => void;
  onEndDateChange: (val: string) => void;
  onClear?: () => void;
  className?: string;
  label?: string;
}

export const DateRangeFilter: React.FC<DateRangeFilterProps> = ({
  startDate,
  endDate,
  onStartDateChange,
  onEndDateChange,
  onClear,
  className = '',
}) => {
  const hasFilter = Boolean(startDate || endDate);

  const handleClear = () => {
    onStartDateChange('');
    onEndDateChange('');
    if (onClear) onClear();
  };

  return (
    <div 
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] transition-all",
        hasFilter 
          ? "border-[#800020]/30 bg-rose-50/30 text-[#800020]" 
          : "border-[#E5E7EB] bg-white text-gray-600 hover:border-gray-300",
        className
      )}
    >
      <Calendar size={12} className={hasFilter ? "text-[#800020]" : "text-gray-400"} />
      
      <input 
        type="date"
        value={startDate}
        onChange={(e) => onStartDateChange(e.target.value)}
        title="Start Date"
        className="bg-transparent border-0 outline-none font-medium text-[11px] text-gray-800 focus:ring-0 p-0 w-[100px] cursor-pointer"
      />
      
      <span className="text-gray-300 font-light select-none">–</span>
      
      <input 
        type="date"
        value={endDate}
        onChange={(e) => onEndDateChange(e.target.value)}
        title="End Date"
        className="bg-transparent border-0 outline-none font-medium text-[11px] text-gray-800 focus:ring-0 p-0 w-[100px] cursor-pointer"
      />

      {hasFilter && (
        <button 
          onClick={handleClear}
          type="button"
          className="ml-0.5 p-0.5 text-gray-400 hover:text-[#800020] hover:bg-rose-100/50 rounded transition-colors cursor-pointer"
          title="Clear date filter"
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
};
