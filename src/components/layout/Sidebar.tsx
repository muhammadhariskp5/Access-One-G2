import React from 'react';
import { 
  LayoutDashboard, 
  FileText, 
  ShieldCheck, 
  ShieldAlert, 
  Users, 
  Database, 
  User, 
  LogOut,
  UserCog,
  Radio,
  Sliders,
  Layers,
  Building2,
  MapPin,
  Tag,
  Key,
  Crown,
  Sparkles,
  Zap,
  Bell
} from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { cn } from '../../lib/utils';
import { useNotifications } from '../../context/NotificationContext';
import { UserProfile, BrandingSettings, isPowerAdmin } from '../../types';

interface SidebarProps {
  user: UserProfile;
  company: BrandingSettings | null;
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

function SidebarItem({ 
  icon, 
  label, 
  to, 
  active,
  badge
}: { 
  icon: React.ReactNode, 
  label: string, 
  to: string, 
  active: boolean,
  badge?: React.ReactNode
}) {
  return (
    <Link 
      to={to}
      className={cn(
        "w-full flex items-center justify-between px-2.5 py-1.5 rounded-md font-semibold text-[11px] transition-all group",
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
    </Link>
  );
}

export function Sidebar({ user, company, handleLogout }: SidebarProps) {
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  const currentTab = searchParams.get('tab');
  const { unreadCount } = useNotifications();
  
  const powerAdmin = isPowerAdmin(user);
  const isAdmin = user.role === 'admin' || powerAdmin;

  const isSettingsActive = location.pathname.startsWith('/settings');
  const isResourcesActive = location.pathname.startsWith('/resources');

  // Settings / Admin active states
  const isProfileActive = isSettingsActive && (!currentTab || currentTab === 'profile');
  const isViewOptionsActive = isSettingsActive && currentTab === 'view-options';
  const isCompanyActive = isSettingsActive && currentTab === 'company';
  const isStructureActive = isSettingsActive && currentTab === 'structure';
  const isUsersAdminActive = isSettingsActive && currentTab === 'users';
  const isUserReportsActive = isSettingsActive && currentTab === 'user-reports';

  // Resources active states
  const isLocationsActive = isResourcesActive && (!currentTab || currentTab === 'locations');
  const isCategoriesActive = isResourcesActive && currentTab === 'categories';
  const isCodesActive = isResourcesActive && currentTab === 'codes';

  return (
    <aside className="w-52 bg-white border-r border-slate-200 flex flex-col fixed h-full z-40 shadow-2xs select-none">
      {/* Brand Header */}
      <div className="p-3 border-b border-slate-100">
        <div className="flex items-center gap-2 px-1">
          <div className="w-7 h-7 bg-[#800020] rounded-md flex items-center justify-center shadow-xs overflow-hidden shrink-0">
            {company?.appLogoUrl ? (
              <img src={company.appLogoUrl} alt="App Logo" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
            ) : (
              <ShieldCheck className="text-white" size={17} />
            )}
          </div>
          <div className="min-w-0">
            <h1 className="font-extrabold text-slate-900 tracking-tight leading-none text-xs truncate">
              {company?.appName || 'AccessOne'}
            </h1>
            <span className="text-[7px] font-bold text-slate-400 uppercase tracking-widest block mt-0.5 truncate">
              {company?.poweredBy || 'by Techsandgadgets.com'}
            </span>
          </div>
        </div>

        {/* Global Power Admin Root Banner */}
        {powerAdmin && (
          <div className="mt-2.5 px-2 py-1 bg-[#800020]/5 rounded-md text-[#800020] flex items-center justify-between shadow-2xs border border-[#800020]/15">
            <div className="flex items-center gap-1.5 min-w-0">
              <Crown size={11} className="text-[#800020] shrink-0" />
              <span className="text-[9px] font-black uppercase tracking-wider text-[#800020] truncate">POWER ADMIN</span>
            </div>
            <span className="text-[8px] font-mono text-[#800020] font-bold shrink-0">ROOT</span>
          </div>
        )}
      </div>

      {/* Nav Scroll Container */}
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
        
        {/* Section 1: Main Operations Menu */}
        <div>
          <SidebarSectionHeader title="Operations" />
          <nav className="space-y-0.5 mt-0.5">
            <SidebarItem 
              icon={<LayoutDashboard />} 
              label="Dashboard" 
              to="/" 
              active={location.pathname === '/'} 
            />
            {user.role !== 'viewer' && (
              <>
                <SidebarItem 
                  icon={<ShieldCheck />} 
                  label="Applications" 
                  to="/applications" 
                  active={location.pathname.startsWith('/applications')} 
                />
                <SidebarItem 
                  icon={<ShieldAlert />} 
                  label="Status Management" 
                  to="/status-management" 
                  active={location.pathname === '/status-management'} 
                />
              </>
            )}
            <SidebarItem 
              icon={<ShieldAlert />} 
              label="Access Matrix" 
              to="/matrix" 
              active={location.pathname === '/matrix'} 
            />
            <SidebarItem 
              icon={<Users />} 
              label="Employees" 
              to="/employees" 
              active={location.pathname.startsWith('/employees')} 
            />
            <SidebarItem 
              icon={<Bell />} 
              label="Notifications" 
              to="/notifications" 
              active={location.pathname === '/notifications'} 
              badge={unreadCount > 0 ? (
                <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-[#800020] text-white leading-none">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              ) : undefined}
            />
          </nav>
        </div>

        <div className="h-px bg-slate-100 my-1 mx-2" />

        {/* Section 2: Resources & Assets */}
        <div>
          <SidebarSectionHeader title="Resources" />
          <nav className="space-y-0.5 mt-0.5">
            <SidebarItem 
              icon={<MapPin />} 
              label="Locations & Gates" 
              to="/resources?tab=locations" 
              active={isLocationsActive} 
            />
            <SidebarItem 
              icon={<Tag />} 
              label="Categories" 
              to="/resources?tab=categories" 
              active={isCategoriesActive} 
            />
            <SidebarItem 
              icon={<Key />} 
              label="Access Codes" 
              to="/resources?tab=codes" 
              active={isCodesActive} 
            />
          </nav>
        </div>

        <div className="h-px bg-slate-100 my-1 mx-2" />

        {/* Section 3: Preferences */}
        <div>
          <SidebarSectionHeader title="Preferences" />
          <nav className="space-y-0.5 mt-0.5">
            <SidebarItem 
              icon={<User />} 
              label="My Profile" 
              to="/settings?tab=profile" 
              active={isProfileActive} 
            />
            <SidebarItem 
              icon={<Sliders />} 
              label="Display Options" 
              to="/settings?tab=view-options" 
              active={isViewOptionsActive} 
            />
          </nav>
        </div>

        {/* Section 4: Organization (Client Super Admin & Power Admin) */}
        {isAdmin && (
          <>
            <div className="h-px bg-slate-100 my-1 mx-2" />
            <div>
              <SidebarSectionHeader title="Organization" />
              <nav className="space-y-0.5 mt-0.5">
                {powerAdmin && (
                  <SidebarItem 
                    icon={<Building2 />} 
                    label="Application Branding" 
                    to="/settings?tab=company" 
                    active={isCompanyActive} 
                  />
                )}
                <SidebarItem 
                  icon={<Layers />} 
                  label="Company Structure" 
                  to="/settings?tab=structure" 
                  active={isStructureActive} 
                />
              </nav>
            </div>
          </>
        )}

        {/* Section 5: Administration (Client Super Admin & Power Admin) */}
        {isAdmin && (
          <>
            <div className="h-px bg-slate-100 my-1 mx-2" />
            <div>
              <SidebarSectionHeader title="Administration" />
              <nav className="space-y-0.5 mt-0.5">
                <SidebarItem 
                  icon={<UserCog />} 
                  label="User Accounts" 
                  to="/settings?tab=users" 
                  active={isUsersAdminActive} 
                />
                <SidebarItem 
                  icon={<Radio />} 
                  label="Live Reports" 
                  to="/settings?tab=user-reports" 
                  active={isUserReportsActive}
                  badge={<span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />}
                />
                <SidebarItem 
                  icon={<FileText />} 
                  label="Audit Logs" 
                  to="/audit" 
                  active={location.pathname === '/audit'} 
                />
              </nav>
            </div>
          </>
        )}

      </div>

      {/* Footer / Sign Out Only */}
      <div className="p-2 border-t border-slate-100 bg-slate-50/50">
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
