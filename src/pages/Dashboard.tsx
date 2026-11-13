import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { Users, ShieldCheck, Clock, FileText, Printer } from 'lucide-react';
import { StatCard } from '../components/common/StatCard';
import { cn, formatDate, apiFetch } from '../lib/utils';
import { onDataChanged } from '../lib/realtime';
import { Location, Category, BrandingSettings, UserProfile } from '../types';
import { getApplicationBadgeProps } from '../utils/passStatus';
import { PrintExportModal } from '../components/common/PrintExportModal';

interface DashboardProps {
  locations: Location[];
  categories: Category[];
  company: BrandingSettings | null;
  globalSearch: string;
  allUsers?: UserProfile[];
}

interface DashboardApp {
  id: string;
  authorityAppNumber: string | null;
  locationId: string | null;
  status: string;
  type: string;
  requesterId: string | null;
  createdAt: string | null;
  locationName: string | null;
  requesterName: string | null;
  employeeCount: number;
}

interface DashboardSummary {
  employeeCount: number;
  totalPassCount: number;
  activePassCount: number;
  activeApplicationCount: number;
  activeApplications: DashboardApp[];
  recentApplications: DashboardApp[];
  expiring48hCount: number;
  expiring48h: { id: string; employeeId: string; passNumber: string | null; expiryDate: string; employeeName: string | null; locationName: string | null }[];
  expiringSoonCount: number;
  expiringByLocation: [string, number][];
  expiringByCategory: [string, number][];
  activeByLocation: Record<string, number>;
}

const EMPTY: DashboardSummary = {
  employeeCount: 0, totalPassCount: 0, activePassCount: 0, activeApplicationCount: 0,
  activeApplications: [], recentApplications: [], expiring48hCount: 0, expiring48h: [],
  expiringSoonCount: 0, expiringByLocation: [], expiringByCategory: [], activeByLocation: {},
};

// Lists whose changes alter the dashboard
const DASHBOARD_RESOURCES = ['employees', 'passes', 'passApplications', 'locations', 'categories'];

export function Dashboard({
  locations,
  categories,
  company,
  globalSearch,
  allUsers = []
}: DashboardProps) {
  const navigate = useNavigate();
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);

  // Counts, short lists and per-location totals are worked out by the server (/api/dashboard),
  // so this page needs none of the full lists.
  const [summary, setSummary] = useState<DashboardSummary>(EMPTY);
  const seq = useRef(0);
  const searchRef = useRef(globalSearch);
  searchRef.current = globalSearch;
  const load = useCallback(async () => {
    const mySeq = ++seq.current;
    try {
      const q = searchRef.current.trim();
      const res = await apiFetch(`/api/dashboard${q ? `?q=${encodeURIComponent(q)}` : ''}`);
      if (!res.ok) return;
      const data = await res.json();
      if (mySeq === seq.current) setSummary({ ...EMPTY, ...data });
    } catch { /* keep the last summary */ }
  }, []);
  useEffect(() => {
    const t = setTimeout(load, globalSearch ? 250 : 0);
    return () => clearTimeout(t);
  }, [globalSearch, load]);
  useEffect(() => onDataChanged(resources => {
    if (resources.some(r => DASHBOARD_RESOURCES.includes(r))) load();
  }), [load]);

  const requesterOf = (app: DashboardApp) => {
    const mappedUser = allUsers.find(u => u.id === app.requesterId || u.email === app.requesterId);
    return mappedUser?.displayName || mappedUser?.email || app.requesterName || app.requesterId || 'User';
  };
  const activeAtLocation = (locId: string) => summary.activeByLocation[locId] || 0;

  return (
    <motion.div 
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-3 flex-1 flex flex-col w-full min-h-[calc(100vh-80px)]"
    >
      {/* Page Content Header */}
      <div className="flex justify-between items-center bg-white p-2.5 px-3.5 rounded-lg border border-slate-200/90 shadow-2xs">
        <div className="flex items-center gap-2.5">
          <div className="w-1.5 h-1.5 rounded-full bg-[#800020]"></div>
          <h1 className="text-xs font-extrabold text-slate-900 uppercase tracking-wider">Executive Security Dashboard</h1>
          <span className="px-2 py-0.5 bg-rose-50 text-[#800020] rounded text-[9px] font-bold uppercase border border-rose-100">
            Real-Time Analytics
          </span>
        </div>
        <button 
          onClick={() => setIsPrintModalOpen(true)}
          className="px-2.5 py-1 bg-white border border-slate-200 text-[#800020] hover:bg-rose-50/70 hover:border-rose-200 rounded-md font-bold text-[10px] uppercase tracking-wider transition-all flex items-center gap-1.5 shadow-2xs cursor-pointer"
          title="Print or Export Executive Security Briefing to PDF"
        >
          <Printer size={12} />
          <span>Print / Export PDF</span>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-2.5">
        <StatCard 
          icon={<Users className="text-blue-600" />} 
          label="Total Employees" 
          value={summary.employeeCount} 
          color="bg-blue-50"
          onClick={() => navigate('/employees')}
        />
        <StatCard 
          icon={<ShieldCheck className="text-emerald-600" />} 
          label="Active Passes" 
          value={summary.activePassCount} 
          color="bg-emerald-50"
          onClick={() => navigate('/status-management')}
        />
        <StatCard 
          icon={<Clock className="text-amber-600" />} 
          label="Active Applications" 
          value={summary.activeApplicationCount} 
          color="bg-amber-50"
          onClick={() => navigate('/applications')}
        />
        <StatCard 
          icon={<Clock className="text-[#800020]" />} 
          label="Expiring (48h)" 
          value={summary.expiring48hCount} 
          color="bg-rose-100/50"
          onClick={() => navigate('/status-management')}
        />
        <StatCard 
          icon={<Clock className="text-rose-600" />} 
          label="Expiring Soon" 
          value={summary.expiringSoonCount} 
          color="bg-rose-50"
          onClick={() => navigate('/status-management')}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5 mb-2">
        <div className="bg-white rounded-lg border border-slate-200/90 p-3 shadow-2xs border-l-3 border-l-rose-500">
          <h3 className="font-bold text-xs mb-3 flex items-center gap-2 text-slate-900 uppercase tracking-wider">
            <Clock size={14} className="text-rose-600" />
            Expirations (Next 48h)
          </h3>
          <div className="space-y-1.5 max-h-[260px] overflow-y-auto pr-1 custom-scrollbar">
            {summary.expiring48h.map(pass => {
              return (
                <div 
                  key={pass.id} 
                  onClick={() => navigate('/status-management')}
                  className="flex items-center justify-between p-2 rounded-md bg-slate-50/80 border border-slate-200/70 hover:bg-rose-50/40 hover:border-rose-200 transition-all cursor-pointer"
                >
                  <div className="flex items-center gap-2.5">
                    <div className="w-6 h-6 rounded bg-rose-50 flex items-center justify-center text-rose-600 font-bold text-xs shrink-0">
                      !
                    </div>
                    <div>
                      <p className="font-bold text-xs text-slate-900 leading-tight">{pass.employeeName}</p>
                      <p className="text-[10px] text-slate-500 font-medium">{pass.locationName} • {pass.passNumber || '—'}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] font-bold text-rose-600 uppercase">Exp. {formatDate(pass.expiryDate)}</p>
                  </div>
                </div>
              );
            })}
            {summary.expiring48h.length === 0 && (
              <p className="text-center py-6 text-slate-400 text-xs">No personnel expiring in the next 48 hours.</p>
            )}
          </div>
        </div>

        <div className="bg-white rounded-lg border border-slate-200/90 p-3 shadow-2xs border-l-3 border-l-amber-500">
          <h3 className="font-bold text-xs mb-3 flex items-center gap-2 text-slate-900 uppercase tracking-wider">
            <FileText size={14} className="text-amber-600" />
            Active Applications
          </h3>
          <div className="space-y-1.5 max-h-[260px] overflow-y-auto pr-1 custom-scrollbar">
            {summary.activeApplications.map(req => {
              const requester = requesterOf(req);
              const badge = getApplicationBadgeProps(req.status);
              return (
                <div 
                  key={req.id} 
                  onClick={() => navigate(`/applications/${req.id}`)}
                  className="flex items-center justify-between p-2 rounded-md bg-slate-50/80 border border-slate-200/70 hover:bg-amber-50/40 hover:border-amber-200 transition-all cursor-pointer"
                >
                  <div className="flex items-center gap-2.5">
                    <div className="w-6 h-6 rounded bg-amber-50 flex items-center justify-center text-amber-600 font-bold text-xs shrink-0">
                      <FileText size={13} />
                    </div>
                    <div>
                      <p className="font-bold text-xs text-slate-900 leading-tight">
                        #{req.id.toUpperCase()}
                        {req.authorityAppNumber ? ` (${req.authorityAppNumber})` : ''}
                      </p>
                      <p className="text-[10px] text-slate-500 font-medium">{req.locationName || '—'} • {req.employeeCount} Members</p>
                    </div>
                  </div>
                  <div className="text-right flex flex-col items-end">
                    <span className={cn("px-2 py-0.5 rounded text-[9px] font-bold uppercase border", badge.bg)}>
                      {badge.label}
                    </span>
                    <p className="text-[9px] text-slate-400 mt-0.5">By {requester}</p>
                  </div>
                </div>
              );
            })}
            {summary.activeApplications.length === 0 && (
              <p className="text-center py-6 text-slate-400 text-xs">No active applications found.</p>
            )}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-slate-200/90 p-3 shadow-2xs">
        <h3 className="font-bold text-xs mb-2.5 text-slate-900 uppercase tracking-wider">Recent Activity</h3>
        <div className="space-y-1.5">
          {summary.recentApplications.map((app) => {
            const requester = requesterOf(app);
            const badge = getApplicationBadgeProps(app.status);
            return (
              <div 
                key={app.id} 
                onClick={() => navigate(`/applications/${app.id}`)}
                className="flex items-center justify-between p-2 rounded-md border border-slate-200/60 bg-slate-50/50 hover:bg-white transition-all cursor-pointer"
              >
                <div className="flex items-center gap-2.5">
                  <div className="w-6 h-6 rounded bg-slate-100 flex items-center justify-center text-slate-700 font-bold text-xs shrink-0">
                    <FileText size={13} />
                  </div>
                  <div>
                    <p className="font-bold text-xs text-slate-900 leading-tight">
                      Application #{app.id.toUpperCase()}
                      {app.authorityAppNumber ? ` (${app.authorityAppNumber})` : ''}
                    </p>
                    <p className="text-[10px] text-slate-500 font-medium">
                      {app.locationName || '—'} • {app.employeeCount} Personnel • {app.type === 'main' ? 'Main Pass' : 'Supplementary Pass'}
                    </p>
                  </div>
                </div>
                <div className="text-right flex flex-col items-end">
                  <span className={cn("px-2 py-0.5 rounded text-[9px] font-bold uppercase border", badge.bg)}>
                    {badge.label}
                  </span>
                  <p className="text-[9px] text-slate-400 mt-0.5">By {requester}</p>
                </div>
              </div>
            );
          })}
          {summary.recentApplications.length === 0 && (
            <div className="text-center py-6 text-slate-400">
              <FileText className="mx-auto mb-1 opacity-20" size={24} />
              <p className="text-xs">No recent application activity found.</p>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
        <div className="bg-white rounded-lg border border-slate-200/90 p-3 shadow-2xs">
          <h3 className="font-bold text-xs mb-2.5 flex items-center gap-2 text-slate-900 uppercase tracking-wider">
            <Clock size={14} className="text-[#800020]" />
            Expiry by Location
          </h3>
          <div className="space-y-1.5">
            {summary.expiringByLocation.map(([name, count]) => (
              <div key={name} className="flex items-center justify-between p-2 rounded-md bg-slate-50/80 border border-slate-200/70">
                <span className="text-xs font-semibold text-slate-700">{name}</span>
                <span className="px-2 py-0.5 bg-rose-50 text-rose-600 rounded text-[9px] font-bold">
                  {count} Passes
                </span>
              </div>
            ))}
            {summary.expiringByLocation.length === 0 && (
              <p className="text-center py-3 text-slate-400 text-xs">No passes expiring soon.</p>
            )}
          </div>
        </div>

        <div className="bg-white rounded-lg border border-slate-200/90 p-3 shadow-2xs">
          <h3 className="font-bold text-xs mb-2.5 flex items-center gap-2 text-slate-900 uppercase tracking-wider">
            <Clock size={14} className="text-[#800020]" />
            Expiry by Category
          </h3>
          <div className="space-y-1.5">
            {summary.expiringByCategory.map(([name, count]) => (
              <div key={name} className="flex items-center justify-between p-2 rounded-md bg-slate-50/80 border border-slate-200/70">
                <span className="text-xs font-semibold text-slate-700">{name}</span>
                <span className="px-2 py-0.5 bg-rose-50 text-rose-600 rounded text-[9px] font-bold">
                  {count} Passes
                </span>
              </div>
            ))}
            {summary.expiringByCategory.length === 0 && (
              <p className="text-center py-3 text-slate-400 text-xs">No passes expiring soon.</p>
            )}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-slate-200/90 p-3 shadow-2xs">
        <h3 className="font-bold text-xs mb-3 text-slate-900 uppercase tracking-wider">Location Distribution</h3>
        <div className="space-y-3">
          {locations.map(loc => {
            const count = activeAtLocation(loc.id);
            const percentage = summary.totalPassCount > 0 ? (count / summary.totalPassCount) * 100 : 0;
            return (
              <div key={loc.id} className="space-y-1">
                <div className="flex justify-between text-[11px]">
                  <span className="font-semibold text-slate-700">{loc.name}</span>
                  <span className="text-slate-900 font-bold">{count}</span>
                </div>
                <div className="h-1 bg-slate-100 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-[#800020] rounded-full" 
                    style={{ width: `${percentage}%` }} 
                  />
                </div>
              </div>
            );
          })}
          {locations.length === 0 && <p className="text-center text-slate-400 py-3 text-xs">No locations configured.</p>}
        </div>
      </div>

      {/* Page Specific Executive Briefing Print Modal */}
      <PrintExportModal
        isOpen={isPrintModalOpen}
        onClose={() => setIsPrintModalOpen(false)}
        title="Print Executive Briefing / Export PDF"
        documentTitle={`Executive Security Briefing - ${new Date().toLocaleDateString()}`}
      >
        <div className="space-y-4">
          <div className="flex justify-between items-center border-b border-[#E5E7EB] pb-3">
            <div>
              <h2 className="text-base font-black text-[#800020] uppercase tracking-tight">Executive Security & Pass Analytics</h2>
              <p className="text-[10px] text-[#6B7280] font-bold">Summary Briefing Generated {new Date().toLocaleDateString()}</p>
            </div>
            <span className="px-2.5 py-1 bg-rose-50 text-[#800020] rounded-lg text-[9px] font-extrabold uppercase border border-rose-200">
              Confidential
            </span>
          </div>

          <div className="grid grid-cols-4 gap-2 text-center">
            <div className="p-3 bg-[#F9FAFB] rounded-xl border border-[#E5E7EB]">
              <p className="text-[8px] font-bold text-[#9CA3AF] uppercase">Registered Personnel</p>
              <p className="text-lg font-black text-[#1A1A1A] mt-0.5">{summary.employeeCount}</p>
            </div>
            <div className="p-3 bg-emerald-50/50 rounded-xl border border-emerald-200">
              <p className="text-[8px] font-bold text-emerald-800 uppercase">Active Passes</p>
              <p className="text-lg font-black text-emerald-900 mt-0.5">{summary.activePassCount}</p>
            </div>
            <div className="p-3 bg-amber-50/50 rounded-xl border border-amber-200">
              <p className="text-[8px] font-bold text-amber-800 uppercase">Active Requests</p>
              <p className="text-lg font-black text-amber-900 mt-0.5">{summary.activeApplicationCount}</p>
            </div>
            <div className="p-3 bg-rose-50/50 rounded-xl border border-rose-200">
              <p className="text-[8px] font-bold text-rose-800 uppercase">Expiring (48h)</p>
              <p className="text-lg font-black text-rose-900 mt-0.5">{summary.expiring48hCount}</p>
            </div>
          </div>

          <div className="pt-2">
            <h3 className="text-xs font-black text-[#1A1A1A] uppercase tracking-wider mb-2">Location Security Breakdown</h3>
            <div className="grid grid-cols-2 gap-2 text-[10px]">
              {locations.map(loc => {
                const count = activeAtLocation(loc.id);
                return (
                  <div key={loc.id} className="p-2 bg-gray-50 rounded-lg border border-gray-200 flex justify-between items-center">
                    <span className="font-bold text-[#374151]">{loc.name}</span>
                    <span className="font-extrabold text-[#800020]">{count} Active Passes</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </PrintExportModal>
    </motion.div>
  );
}
