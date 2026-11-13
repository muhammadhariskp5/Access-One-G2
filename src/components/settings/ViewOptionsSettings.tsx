import React, { useState, useEffect } from 'react';
import { 
  Sliders, 
  Monitor, 
  Table, 
  Calendar, 
  Bell, 
  Volume2, 
  VolumeX, 
  Eye, 
  Check, 
  RotateCcw, 
  Save, 
  Sparkles,
  LayoutGrid,
  Clock
} from 'lucide-react';
import { UserProfile, UserViewPreferences } from '../../types';
import { apiFetch, cn } from '../../lib/utils';

interface ViewOptionsSettingsProps {
  currentUser: UserProfile | null;
  onSuccess: () => void;
  showToast: (msg: string, type?: 'success' | 'error') => void;
}

const DEFAULT_PREFERENCES: UserViewPreferences = {
  tableDensity: 'comfortable',
  dateFormat: 'DD/MM/YYYY',
  defaultLandingPage: '/',
  itemsPerPage: 25,
  enableSound: true,
  expiryWarningDays: 30,
  matrixExpiredDays: 30,
  badgeStyle: 'bold'
};

export function ViewOptionsSettings({ currentUser, onSuccess, showToast }: ViewOptionsSettingsProps) {
  // Load initial preferences from currentUser or localStorage
  const [preferences, setPreferences] = useState<UserViewPreferences>(() => {
    try {
      const stored = localStorage.getItem('accessone_view_preferences');
      if (stored) {
        return { ...DEFAULT_PREFERENCES, ...JSON.parse(stored) };
      }
    } catch (e) { /* ignore */ }
    return { ...DEFAULT_PREFERENCES, ...(currentUser?.preferences || {}) };
  });

  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (currentUser?.preferences) {
      setPreferences(prev => ({ ...prev, ...currentUser.preferences }));
    }
  }, [currentUser]);

  const handleSave = async (updated?: UserViewPreferences) => {
    const prefsToSave = updated || preferences;
    setIsSaving(true);
    try {
      // 1. Save to local storage for immediate persistence
      localStorage.setItem('accessone_view_preferences', JSON.stringify(prefsToSave));

      // 2. Dispatch custom event so listeners throughout the app update in real time
      window.dispatchEvent(new CustomEvent('view_preferences_updated', { detail: prefsToSave }));

      // 3. Persist to server user profile
      const res = await apiFetch('/api/users/profile', {
        method: 'PATCH',
        body: JSON.stringify({ preferences: prefsToSave })
      });

      if (!res.ok) {
        throw new Error('Failed to synchronize preferences to user profile');
      }

      showToast('View options and display preferences saved!', 'success');
      onSuccess();
    } catch (err: any) {
      // Still keep local preference
      showToast('Preferences applied locally. ' + (err.message || ''), 'success');
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    setPreferences(DEFAULT_PREFERENCES);
    handleSave(DEFAULT_PREFERENCES);
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-bold text-slate-900">User Display & View Options</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Personalize your viewing experience, table layouts, date formats, and alert thresholds.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleReset}
            className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <RotateCcw size={13} />
            Reset Defaults
          </button>
          <button
            type="button"
            onClick={() => handleSave()}
            disabled={isSaving}
            className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-[#800020] text-white hover:bg-[#66001a] transition-all shadow-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            <Save size={13} />
            {isSaving ? 'Saving...' : 'Save Preferences'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        
        {/* Table Density */}
        <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-2xs space-y-3">
          <div className="flex items-center gap-2 text-slate-800 font-bold text-xs">
            <Table size={16} className="text-[#800020]" />
            <span>Table Layout Density</span>
          </div>
          <p className="text-[11px] text-slate-500 leading-relaxed">
            Choose between a compact high-density view for data-heavy operations or a spacious, comfortable view.
          </p>
          <div className="grid grid-cols-2 gap-2.5 pt-1">
            <button
              type="button"
              onClick={() => setPreferences({ ...preferences, tableDensity: 'comfortable' })}
              className={cn(
                "p-3 rounded-lg border text-left transition-all cursor-pointer",
                preferences.tableDensity === 'comfortable'
                  ? "border-[#800020] bg-[#800020]/5 text-[#800020] font-bold ring-1 ring-[#800020]/20"
                  : "border-slate-200 hover:border-slate-300 text-slate-700"
              )}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-bold">Comfortable</span>
                {preferences.tableDensity === 'comfortable' && <Check size={14} className="text-[#800020]" />}
              </div>
              <p className="text-[10px] text-slate-500">Spacious padding (12px), ideal for scanning and relaxed review.</p>
            </button>

            <button
              type="button"
              onClick={() => setPreferences({ ...preferences, tableDensity: 'compact' })}
              className={cn(
                "p-3 rounded-lg border text-left transition-all cursor-pointer",
                preferences.tableDensity === 'compact'
                  ? "border-[#800020] bg-[#800020]/5 text-[#800020] font-bold ring-1 ring-[#800020]/20"
                  : "border-slate-200 hover:border-slate-300 text-slate-700"
              )}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-bold">Compact</span>
                {preferences.tableDensity === 'compact' && <Check size={14} className="text-[#800020]" />}
              </div>
              <p className="text-[10px] text-slate-500">Dense padding (6px), fits 50% more records on screen.</p>
            </button>
          </div>
        </div>

        {/* Date Display Format */}
        <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-2xs space-y-3">
          <div className="flex items-center gap-2 text-slate-800 font-bold text-xs">
            <Calendar size={16} className="text-[#800020]" />
            <span>Date Display Format</span>
          </div>
          <p className="text-[11px] text-slate-500 leading-relaxed">
            Select the standard formatting applied across all pass issue dates, expiries, and audit logs.
          </p>
          <div className="space-y-2 pt-1">
            {[
              { id: 'DD/MM/YYYY', label: 'Day / Month / Year (31/12/2026)', desc: 'UK & International Standard' },
              { id: 'YYYY-MM-DD', label: 'ISO Standard (2026-12-31)', desc: 'Standard database ISO format' },
              { id: 'DD MMM YYYY', label: 'Verbal Format (31 Dec 2026)', desc: 'Unambiguous spelled-out month' }
            ].map(opt => (
              <label
                key={opt.id}
                onClick={() => setPreferences({ ...preferences, dateFormat: opt.id as any })}
                className={cn(
                  "flex items-center justify-between p-2.5 rounded-lg border cursor-pointer transition-all",
                  preferences.dateFormat === opt.id
                    ? "border-[#800020] bg-[#800020]/5 text-slate-900 ring-1 ring-[#800020]/20"
                    : "border-slate-200 hover:border-slate-300 text-slate-700"
                )}
              >
                <div>
                  <span className="text-xs font-bold block leading-tight">{opt.label}</span>
                  <span className="text-[10px] text-slate-400">{opt.desc}</span>
                </div>
                <input
                  type="radio"
                  name="dateFormat"
                  checked={preferences.dateFormat === opt.id}
                  onChange={() => {}}
                  className="accent-[#800020]"
                />
              </label>
            ))}
          </div>
        </div>

        {/* Default Landing Page */}
        <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-2xs space-y-3">
          <div className="flex items-center gap-2 text-slate-800 font-bold text-xs">
            <Monitor size={16} className="text-[#800020]" />
            <span>Default Landing Screen</span>
          </div>
          <p className="text-[11px] text-slate-500 leading-relaxed">
            The initial view displayed when you sign in to AccessOne.
          </p>
          <select
            value={preferences.defaultLandingPage || '/'}
            onChange={e => setPreferences({ ...preferences, defaultLandingPage: e.target.value })}
            className="w-full px-3 py-2.5 rounded-lg border border-slate-200 font-semibold text-xs focus:border-[#800020] outline-none bg-white"
          >
            <option value="/">Dashboard Overview (Default)</option>
            <option value="/applications">Pass Applications Management</option>
            <option value="/status-management">Application Status Management</option>
            <option value="/employees">Personnel & Employee Directory</option>
            <option value="/matrix">Access Matrix</option>
            <option value="/resources">Locations & Categories</option>
          </select>
        </div>

        {/* Pagination Default */}
        <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-2xs space-y-3">
          <div className="flex items-center gap-2 text-slate-800 font-bold text-xs">
            <LayoutGrid size={16} className="text-[#800020]" />
            <span>Default Rows Per Page</span>
          </div>
          <p className="text-[11px] text-slate-500 leading-relaxed">
            Number of records rendered per page in application tables and rosters.
          </p>
          <div className="grid grid-cols-4 gap-2 pt-1">
            {[10, 25, 50, 100].map(cnt => (
              <button
                key={cnt}
                type="button"
                onClick={() => setPreferences({ ...preferences, itemsPerPage: cnt })}
                className={cn(
                  "py-2 rounded-lg border text-center text-xs font-bold transition-all cursor-pointer",
                  preferences.itemsPerPage === cnt
                    ? "border-[#800020] bg-[#800020] text-white shadow-xs"
                    : "border-slate-200 hover:border-slate-300 text-slate-700 bg-slate-50/50"
                )}
              >
                {cnt}
              </button>
            ))}
          </div>
        </div>

        {/* Expiry Warning Window */}
        <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-2xs space-y-3">
          <div className="flex items-center gap-2 text-slate-800 font-bold text-xs">
            <Clock size={16} className="text-[#800020]" />
            <span>Pass Expiration Warning Days</span>
          </div>
          <p className="text-[11px] text-slate-500 leading-relaxed">
            Highlight passes in amber when they are within this threshold of expiration.
          </p>
          <div className="grid grid-cols-4 gap-2 pt-1">
            {[7, 15, 30, 60].map(days => (
              <button
                key={days}
                type="button"
                onClick={() => setPreferences({ ...preferences, expiryWarningDays: days })}
                className={cn(
                  "py-2 rounded-lg border text-center text-xs font-bold transition-all cursor-pointer",
                  preferences.expiryWarningDays === days
                    ? "border-[#800020] bg-[#800020] text-white shadow-xs"
                    : "border-slate-200 hover:border-slate-300 text-slate-700 bg-slate-50/50"
                )}
              >
                {days}d
              </button>
            ))}
          </div>
        </div>

        {/* Recently expired passes on the Access Matrix */}
        <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-2xs space-y-3">
          <div className="flex items-center gap-2 text-slate-800 font-bold text-xs">
            <Clock size={16} className="text-[#800020]" />
            <span>Show Expired Passes in Access Matrix</span>
          </div>
          <p className="text-[11px] text-slate-500 leading-relaxed">
            Keep passes that expired within this many days visible in the matrix (in red), as a reminder to re-apply. They disappear once a renewal replaces them.
          </p>
          <div className="grid grid-cols-6 gap-2 pt-1">
            {[0, 30, 60, 90, 180, 365].map(days => (
              <button
                key={days}
                type="button"
                onClick={() => setPreferences({ ...preferences, matrixExpiredDays: days })}
                className={cn(
                  "py-2 rounded-lg border text-center text-xs font-bold transition-all cursor-pointer",
                  (preferences.matrixExpiredDays ?? 30) === days
                    ? "border-[#800020] bg-[#800020] text-white shadow-xs"
                    : "border-slate-200 hover:border-slate-300 text-slate-700 bg-slate-50/50"
                )}
              >
                {days === 0 ? 'Off' : `${days}d`}
              </button>
            ))}
          </div>
        </div>

        {/* Audio Alerts & Badge Styling */}
        <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-2xs space-y-3">
          <div className="flex items-center gap-2 text-slate-800 font-bold text-xs">
            <Bell size={16} className="text-[#800020]" />
            <span>Audio Cues & Status Badges</span>
          </div>
          <p className="text-[11px] text-slate-500 leading-relaxed">
            Configure sound feedback on actions and status badge appearance.
          </p>
          <div className="space-y-2 pt-1">
            <div className="flex items-center justify-between p-2 rounded-lg border border-slate-100 bg-slate-50/50">
              <span className="text-xs font-semibold text-slate-800 flex items-center gap-2">
                {preferences.enableSound ? <Volume2 size={15} className="text-emerald-600" /> : <VolumeX size={15} className="text-slate-400" />}
                Status Change Sound Effect
              </span>
              <button
                type="button"
                onClick={() => setPreferences({ ...preferences, enableSound: !preferences.enableSound })}
                className={cn(
                  "w-11 h-6 rounded-full transition-colors relative cursor-pointer p-0.5",
                  preferences.enableSound ? "bg-[#800020]" : "bg-slate-300"
                )}
              >
                <div className={cn(
                  "w-5 h-5 rounded-full bg-white transition-transform shadow-xs",
                  preferences.enableSound ? "translate-x-5" : "translate-x-0"
                )} />
              </button>
            </div>

            <div className="flex items-center justify-between p-2 rounded-lg border border-slate-100 bg-slate-50/50">
              <span className="text-xs font-semibold text-slate-800">Badge Display Style</span>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => setPreferences({ ...preferences, badgeStyle: 'bold' })}
                  className={cn(
                    "px-2.5 py-1 rounded text-[10px] font-bold uppercase transition-all cursor-pointer",
                    preferences.badgeStyle === 'bold' ? "bg-slate-900 text-white" : "bg-slate-200 text-slate-600"
                  )}
                >
                  Bold
                </button>
                <button
                  type="button"
                  onClick={() => setPreferences({ ...preferences, badgeStyle: 'minimal' })}
                  className={cn(
                    "px-2.5 py-1 rounded text-[10px] font-bold uppercase transition-all cursor-pointer",
                    preferences.badgeStyle === 'minimal' ? "bg-slate-900 text-white" : "bg-slate-200 text-slate-600"
                  )}
                >
                  Minimal
                </button>
              </div>
            </div>
          </div>
        </div>

      </div>

      {/* Live Preview Card */}
      <div className="p-4 rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white shadow-2xs space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles size={15} className="text-[#800020]" />
            <span className="text-xs font-bold text-slate-800">Live View Preview</span>
          </div>
          <span className="text-[10px] text-slate-400 font-medium">Shows active formatting according to current settings</span>
        </div>

        <div className={cn(
          "rounded-lg border border-slate-200 bg-white overflow-hidden transition-all",
          preferences.tableDensity === 'compact' ? "text-[11px]" : "text-xs"
        )}>
          <div className="bg-slate-50 border-b border-slate-200 px-3 py-2 flex justify-between font-bold text-slate-600 text-[10px] uppercase">
            <span>Pass Reference</span>
            <span>Expiry Date ({preferences.dateFormat})</span>
            <span>Badge Style ({preferences.badgeStyle})</span>
          </div>
          <div className={cn(
            "flex justify-between items-center px-3 border-b border-slate-100",
            preferences.tableDensity === 'compact' ? "py-1.5" : "py-3"
          )}>
            <span className="font-semibold text-slate-900">PASS-2026-089</span>
            <span className="text-slate-600">
              {preferences.dateFormat === 'DD/MM/YYYY' ? '15/10/2026' : preferences.dateFormat === 'YYYY-MM-DD' ? '2026-10-15' : '15 Oct 2026'}
            </span>
            <span className={cn(
              "px-2 py-0.5 rounded text-[10px] font-bold uppercase",
              preferences.badgeStyle === 'bold' 
                ? "bg-emerald-600 text-white shadow-2xs" 
                : "bg-emerald-50 text-emerald-700 border border-emerald-200"
            )}>
              Active Pass
            </span>
          </div>
        </div>
      </div>

      <div className="flex justify-end pt-2">
        <button
          type="button"
          onClick={() => handleSave()}
          disabled={isSaving}
          className="px-6 py-2.5 rounded-xl text-xs font-bold bg-[#800020] text-white hover:bg-[#66001a] transition-all shadow-xs flex items-center gap-2 cursor-pointer disabled:opacity-50"
        >
          <Save size={14} />
          {isSaving ? 'Applying Settings...' : 'Save & Apply View Options'}
        </button>
      </div>

    </div>
  );
}
