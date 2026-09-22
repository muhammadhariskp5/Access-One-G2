import React, { useState } from 'react';
import { AlertTriangle, Info, Clock, X } from 'lucide-react';
import { BrandingSettings } from '../../types';
import { cn } from '../../lib/utils';

interface MaintenanceBannerProps {
  company: BrandingSettings | null;
  className?: string;
}

export function MaintenanceBanner({ company, className }: MaintenanceBannerProps) {
  const [dismissed, setDismissed] = useState(false);

  if (!company?.maintenanceActive || dismissed) {
    return null;
  }

  const severity = company.maintenanceSeverity || 'info';
  const message = company.maintenanceMessage || 'System maintenance is currently in progress. Operations may be temporarily affected.';
  const estimatedEnd = company.maintenanceEstimatedEnd;

  const bgClasses = 
    severity === 'critical'
      ? "bg-rose-600 text-white border-b border-rose-700 shadow-sm"
      : severity === 'warning'
      ? "bg-amber-500 text-amber-950 border-b border-amber-600 shadow-sm"
      : "bg-blue-600 text-white border-b border-blue-700 shadow-sm";

  return (
    <div className={cn("sticky top-0 z-[120] py-2 px-4 text-xs font-semibold flex items-center justify-between gap-3 transition-all", bgClasses, className)}>
      <div className="flex items-center gap-2.5 max-w-5xl mx-auto flex-1 min-w-0">
        <span className="w-5 h-5 rounded-md bg-black/15 flex items-center justify-center shrink-0">
          {severity === 'critical' ? (
            <AlertTriangle size={13} className="animate-bounce" />
          ) : severity === 'warning' ? (
            <AlertTriangle size={13} />
          ) : (
            <Info size={13} />
          )}
        </span>
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <span className="font-black uppercase tracking-wider text-[10px] opacity-90 shrink-0">
            System Maintenance:
          </span>
          <span className="font-medium text-xs break-words">
            {message}
          </span>
        </div>

        {estimatedEnd && (
          <span className="hidden sm:inline-flex items-center gap-1 shrink-0 text-[11px] font-mono opacity-90 bg-black/15 px-2 py-0.5 rounded ml-auto">
            <Clock size={11} />
            <span>Est. End: {new Date(estimatedEnd).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' })}</span>
          </span>
        )}
      </div>

      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="p-1 rounded hover:bg-black/15 transition-colors shrink-0 text-current cursor-pointer"
        title="Dismiss announcement"
      >
        <X size={14} />
      </button>
    </div>
  );
}
