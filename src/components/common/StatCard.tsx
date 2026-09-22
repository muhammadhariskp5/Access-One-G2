import React from 'react';
import { cn } from '../../lib/utils';

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  color: string;
  trend?: string;
  onClick?: () => void;
}

export function StatCard({ icon, label, value, color, trend, onClick }: StatCardProps) {
  return (
    <div 
      onClick={onClick}
      className={cn(
        "bg-white p-3 rounded-lg border border-slate-200/90 shadow-2xs hover:border-[#800020]/40 transition-all group flex items-center justify-between",
        onClick && "cursor-pointer hover:bg-slate-50/50 active:scale-[0.99]"
      )}
    >
      <div className="min-w-0 pr-2">
        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider truncate mb-0.5">{label}</p>
        <p className="text-xl font-black text-slate-900 tracking-tight leading-none">{value}</p>
        {trend && (
          <span className="text-[9px] font-semibold text-slate-400 mt-1 block">
            {trend}
          </span>
        )}
      </div>
      <div className={cn("p-2 rounded-md shrink-0 transition-colors", color)}>
        {React.cloneElement(icon as React.ReactElement, { size: 16 })}
      </div>
    </div>
  );
}
