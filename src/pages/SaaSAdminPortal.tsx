import React, { useState } from 'react';
import { 
  Building2,
  PlusCircle,
  CreditCard,
  Server,
  RefreshCw, 
  ChevronRight,
  Download
} from 'lucide-react';
import { 
  UserProfile,
  BrandingSettings
} from '../types';
import { PlatformMasterControl } from '../components/settings/PlatformMasterControl';
import { PowerAdminSidebar, PowerAdminTab } from '../components/layout/PowerAdminSidebar';
import { cn } from '../lib/utils';

interface SaaSAdminPortalProps {
  user: UserProfile;
  company: BrandingSettings | null;
  handleLogout: () => void;
  showToast: (message: string, type?: 'success' | 'error') => void;
  showConfirm: (title: string, message: string, onConfirm: () => void) => void;
}

export function SaaSAdminPortal({
  user,
  company,
  handleLogout,
  showToast,
  showConfirm
}: SaaSAdminPortalProps) {
  const [activeTab, setActiveTab] = useState<PowerAdminTab>('companies');
  const [companiesCount, setCompaniesCount] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const handleRefresh = () => {
    setIsRefreshing(true);
    setRefreshTrigger(prev => prev + 1);
    showToast("Refreshing platform metrics...", "success");
    setTimeout(() => setIsRefreshing(false), 800);
  };

  const handleDownloadSnapshot = async () => {
    try {
      const res = await fetch('/api/platform/backup/download');
      if (!res.ok) throw new Error('Backup failed');
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `accessone-platform-backup-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      showToast('Global database snapshot downloaded successfully', 'success');
    } catch {
      showToast('Failed to download database backup snapshot', 'error');
    }
  };

  const getTabTitle = (tab: PowerAdminTab) => {
    switch (tab) {
      case 'companies': return 'Licensed Organizations';
      case 'license-new': return 'License New Company';
      case 'plans': return 'Subscription Plans';
      case 'health': return 'Platform & DB Health';
      case 'global-ports': return 'Master Port Catalog (Global Ports & Gates)';
      case 'broadcast': return 'System Maintenance Banner Broadcast';
      default: return 'Platform Control';
    }
  };

  return (
    <div className="min-h-screen bg-[#F8F9FA] flex">
      {/* Side Menu matching the normal organizational user screen */}
      <PowerAdminSidebar
        user={user}
        company={company}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        companiesCount={companiesCount}
        onDownloadBackup={handleDownloadSnapshot}
        onRefresh={handleRefresh}
        isRefreshing={isRefreshing}
        handleLogout={handleLogout}
      />

      {/* Main Content Area */}
      <div className="flex-1 ml-52 flex flex-col min-h-screen bg-slate-50/70">
        {/* Top Navbar matching normal organizational Navbar */}
        <header className="h-13 bg-white border-b border-slate-200 sticky top-0 z-30 px-6 flex items-center justify-between shadow-2xs">
          {/* Breadcrumb path */}
          <div className="flex items-center gap-2 text-xs">
            <span className="font-bold text-slate-400">Platform Control</span>
            <ChevronRight size={13} className="text-slate-300" />
            <span className="font-bold text-[#800020]">
              {getTabTitle(activeTab)}
            </span>
          </div>

          {/* Right controls */}
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-2 px-2.5 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full text-[10px] font-bold">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span>Oracle Autonomous DB Online</span>
            </div>

            {activeTab !== 'license-new' && (
              <button
                onClick={() => setActiveTab('license-new')}
                className="px-3 py-1.5 bg-[#800020] hover:bg-[#600018] text-white text-xs font-bold rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer shadow-2xs"
              >
                <PlusCircle size={13} />
                <span>License Company</span>
              </button>
            )}

            <button
              onClick={handleRefresh}
              className="p-1.5 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors border border-slate-200 cursor-pointer"
              title="Refresh Platform State"
            >
              <RefreshCw size={14} className={cn(isRefreshing && "animate-spin text-[#800020]")} />
            </button>

            {/* User badge */}
            <div className="flex items-center gap-2 pl-2 border-l border-slate-200">
              <div className="w-6 h-6 rounded-full bg-[#800020] flex items-center justify-center text-[10px] font-extrabold text-white shrink-0">
                {user.displayName ? user.displayName.charAt(0).toUpperCase() : 'M'}
              </div>
              <div className="text-left hidden md:block">
                <div className="text-[11px] font-bold text-slate-800 leading-tight">
                  {user.displayName || 'Muhammad Haris'}
                </div>
                <div className="text-[9px] font-semibold text-[#800020] leading-tight">
                  Vendor Master Root
                </div>
              </div>
            </div>
          </div>
        </header>

        {/* Content Container */}
        <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8">
          <div key={refreshTrigger}>
            <PlatformMasterControl
              currentCompany={company}
              activeTab={activeTab}
              onTabChange={setActiveTab}
              hideTopTabs={true}
              onCompaniesLoaded={(comps) => setCompaniesCount(comps.length)}
              onSuccess={() => setRefreshTrigger(prev => prev + 1)}
              showToast={showToast}
              showConfirm={showConfirm}
            />
          </div>
        </main>
      </div>
    </div>
  );
}
