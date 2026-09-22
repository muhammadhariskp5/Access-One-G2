import React from 'react';
import { 
  Building2, 
  PlusCircle, 
  CreditCard, 
  Server, 
  Download, 
  RefreshCw, 
  Crown, 
  ShieldCheck, 
  LogOut,
  CheckCircle2,
  Database,
  Radio,
  Layers
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { UserProfile, BrandingSettings } from '../../types';

export type PowerAdminTab = 'companies' | 'license-new' | 'plans' | 'health' | 'global-ports' | 'broadcast';

interface PowerAdminSidebarProps {
  user: UserProfile;
  company: BrandingSettings | null;
  activeTab: PowerAdminTab;
  setActiveTab: (tab: PowerAdminTab) => void;
  companiesCount: number;
  onDownloadBackup: () => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  handleLogout: () => void;
}

function SidebarSectionHeader({ title }: { title: string }) {
  return (
    <div className="pt-3 pb-1 px-2.5">
      <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest leading-none">
        {title}
      </p>
    </div>
  );
}

function SidebarNavItem({ 
  icon, 
  label, 
  active,
  onClick,
  badge
}: { 
  icon: React.ReactNode, 
  label: string, 
  active: boolean,
  onClick: () => void,
  badge?: React.ReactNode
}) {
  return (
    <button 
      type="button"
      onClick={onClick}
      className={cn(
        "w-full flex items-center justify-between px-2.5 py-1.5 rounded-md font-semibold text-[11px] transition-all group cursor-pointer text-left",
        active 
          ? "bg-[#800020]/10 text-[#800020] font-bold shadow-2xs" 
          : "text-slate-600 hover:bg-slate-100/80 hover:text-slate-900"
      )}
    >
      <div className="flex items-center gap-2 min-w-0">
        {React.cloneElement(icon as React.ReactElement, { 
          size: 14,
          className: active ? "text-[#800020] shrink-0" : "text-slate-500 group-hover:text-slate-700 shrink-0"
        })}
        <span className="truncate">{label}</span>
      </div>
      {badge && <div className="shrink-0">{badge}</div>}
    </button>
  );
}

export function PowerAdminSidebar({
  user,
  company,
  activeTab,
  setActiveTab,
  companiesCount,
  onDownloadBackup,
  onRefresh,
  isRefreshing,
  handleLogout
}: PowerAdminSidebarProps) {
  return (
    <aside className="w-52 bg-white border-r border-slate-200 flex flex-col fixed h-full z-40 shadow-2xs select-none">
      {/* Brand Header */}
      <div className="p-3 border-b border-slate-100">
        <div className="flex items-center gap-2 px-1">
          <div className="w-7 h-7 bg-[#800020] rounded-md flex items-center justify-center shadow-xs overflow-hidden shrink-0">
            {company?.appLogoUrl ? (
              <img src={company.appLogoUrl} alt="Logo" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
            ) : (
              <ShieldCheck className="text-white" size={17} />
            )}
          </div>
          <div className="min-w-0">
            <h1 className="font-extrabold text-slate-900 tracking-tight leading-none text-xs truncate">
              {company?.appName || 'AccessOne'}
            </h1>
            <span className="text-[7px] font-bold text-slate-400 uppercase tracking-widest block mt-0.5 truncate">
              POWER ADMIN PORTAL
            </span>
          </div>
        </div>

        {/* Platform Master Role Badge */}
        <div className="mt-2.5 px-2 py-1 bg-[#800020]/5 rounded-md text-[#800020] flex items-center justify-between shadow-2xs border border-[#800020]/15">
          <div className="flex items-center gap-1.5 min-w-0">
            <Crown size={11} className="text-[#800020] shrink-0" />
            <span className="text-[9px] font-black uppercase tracking-wider text-[#800020] truncate">VENDOR MASTER</span>
          </div>
          <span className="text-[8px] font-mono text-[#800020] font-bold shrink-0">ROOT</span>
        </div>
      </div>

      {/* Nav Scroll Container */}
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
        {/* Section 1: Platform Control */}
        <div>
          <SidebarSectionHeader title="Platform Control" />
          <nav className="space-y-0.5 mt-0.5">
            <SidebarNavItem 
              icon={<Building2 />} 
              label="Licensed Companies" 
              active={activeTab === 'companies'}
              onClick={() => setActiveTab('companies')}
              badge={
                <span className="px-1.5 py-0.2 rounded-full text-[9px] font-bold bg-[#800020]/10 text-[#800020]">
                  {companiesCount}
                </span>
              }
            />
            <SidebarNavItem 
              icon={<PlusCircle />} 
              label="License Company" 
              active={activeTab === 'license-new'}
              onClick={() => setActiveTab('license-new')}
            />
            <SidebarNavItem 
              icon={<CreditCard />} 
              label="Subscription Plans" 
              active={activeTab === 'plans'}
              onClick={() => setActiveTab('plans')}
            />
            <SidebarNavItem 
              icon={<Server />} 
              label="Platform & DB Health" 
              active={activeTab === 'health'}
              onClick={() => setActiveTab('health')}
            />
            <SidebarNavItem 
              icon={<Layers />} 
              label="Master Port Catalog" 
              active={activeTab === 'global-ports'}
              onClick={() => setActiveTab('global-ports')}
            />
            <SidebarNavItem 
              icon={<Radio />} 
              label="Maintenance Broadcast" 
              active={activeTab === 'broadcast'}
              onClick={() => setActiveTab('broadcast')}
            />
          </nav>
        </div>

        <div className="h-px bg-slate-100 my-2 mx-2" />

        {/* Section 2: Global Operations */}
        <div>
          <SidebarSectionHeader title="Global Operations" />
          <nav className="space-y-0.5 mt-0.5">
            <SidebarNavItem 
              icon={<Download />} 
              label="Download DB Backup" 
              active={false}
              onClick={onDownloadBackup}
              badge={
                <span className="text-[8px] font-mono font-bold text-slate-400 bg-slate-100 px-1 py-0.2 rounded">
                  .JSON
                </span>
              }
            />
            <SidebarNavItem 
              icon={<RefreshCw className={cn(isRefreshing && "animate-spin text-[#800020]")} />} 
              label="Refresh Metrics" 
              active={false}
              onClick={onRefresh}
            />
          </nav>
        </div>

        <div className="h-px bg-slate-100 my-2 mx-2" />

        {/* Section 3: Oracle Status Card */}
        <div className="p-2 bg-slate-50 rounded-lg border border-slate-200/80 mx-1 my-1">
          <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-700 mb-0.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
            <span className="truncate">Oracle Autonomous DB</span>
          </div>
          <p className="text-[9px] text-slate-500 font-medium">Multi-tenant Cloud Online</p>
        </div>
      </div>

      {/* Footer / User Profile & Logout */}
      <div className="p-2 border-t border-slate-100 bg-slate-50/50">
        <div className="px-2 py-1.5 mb-1 flex items-center gap-2">
          <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-extrabold text-white shrink-0 bg-[#800020]">
            {user.displayName ? user.displayName.charAt(0).toUpperCase() : 'M'}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold text-slate-800 truncate leading-tight">
              {user.displayName || 'Muhammad Haris'}
            </p>
            <p className="text-[9px] font-semibold text-slate-400 truncate capitalize leading-tight mt-0.5">
              Power Admin (Root)
            </p>
          </div>
        </div>

        <button 
          onClick={handleLogout}
          className="w-full flex items-center gap-2 text-slate-500 hover:text-[#800020] hover:bg-rose-50/60 rounded-md transition-colors font-semibold text-[11px] px-2.5 py-1.5 cursor-pointer"
        >
          <LogOut size={14} />
          <span>Sign Out</span>
        </button>
      </div>
    </aside>
  );
}
