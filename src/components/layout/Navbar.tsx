import React, { useState, useRef, useEffect } from 'react';
import { 
  ChevronRight, 
  ChevronDown, 
  User, 
  Sliders, 
  Building2, 
  UserCog, 
  Radio, 
  FileText, 
  LogOut, 
  ShieldCheck, 
  ExternalLink,
  Bell
} from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { UserProfile, BrandingSettings, Employee, isPowerAdmin } from '../../types';
import { SearchInput } from '../common/SearchInput';
import { cn, apiFetch } from '../../lib/utils';

interface NavbarProps {
  user: UserProfile;
  company: BrandingSettings | null;
  globalSearch: string;
  setGlobalSearch: (s: string) => void;
  employees: Employee[];
  handleLogout?: () => void;
}

export function Navbar({ 
  user, 
  company, 
  globalSearch, 
  setGlobalSearch, 
  employees,
  handleLogout 
}: NavbarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [isNotifOpen, setIsNotifOpen] = useState(false);
  const unreadCount = notifications.filter((n: any) => !n.isRead).length;

  useEffect(() => {
    if (!user) return;
    const fetchNotifications = async () => {
      try {
        const res = await apiFetch('/api/notifications');
        const data = await res.json();
        if (Array.isArray(data)) setNotifications(data);
      } catch (e) {
        console.error('Failed to load notifications', e);
      }
    };
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 15000);
    return () => clearInterval(interval);
  }, [user]);

  useEffect(() => {
    function handleClickOutsideNotif(event: MouseEvent) {
      if (notifRef.current && !notifRef.current.contains(event.target as Node)) {
        setIsNotifOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutsideNotif);
    return () => document.removeEventListener('mousedown', handleClickOutsideNotif);
  }, []);

  const handleMarkAllRead = async () => {
    try {
      await apiFetch('/api/notifications/mark-all-read', { method: 'PATCH' });
      setNotifications((prev: any[]) => prev.map((n) => ({ ...n, isRead: true })));
    } catch (e) {
      console.error('Failed to mark all notifications read', e);
    }
  };

  const handleNotificationClick = async (notif: any) => {
    if (!notif.isRead) {
      try {
        await apiFetch(`/api/notifications/${notif.id}/read`, { method: 'PATCH' });
        setNotifications((prev: any[]) => prev.map((n) => n.id === notif.id ? { ...n, isRead: true } : n));
      } catch (e) {
        console.error('Failed to mark notification read', e);
      }
    }
  };
  
  const isAdmin = user.role === 'admin' || user.role === 'power_admin';

  // Close dropdown on click outside or Escape
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  // Close menu on route change
  useEffect(() => {
    setIsMenuOpen(false);
  }, [location.pathname, location.search]);
  
  const getBreadcrumbs = () => {
    const path = location.pathname;
    const searchParams = new URLSearchParams(location.search);
    const tab = searchParams.get('tab');
    const crumbs: { label: string; to: string }[] = [];
    
    // Always start with Dashboard as root
    crumbs.push({ label: 'Dashboard', to: '/' });

    if (path === '/settings') {
      if (tab === 'users') {
        crumbs.push({ label: 'Administration', to: '/settings?tab=users' });
        crumbs.push({ label: 'User Accounts', to: '/settings?tab=users' });
      } else if (tab === 'user-reports') {
        crumbs.push({ label: 'Administration', to: '/settings?tab=user-reports' });
        crumbs.push({ label: 'Live Presence & Reports', to: '/settings?tab=user-reports' });
      } else if (tab === 'company') {
        crumbs.push({ label: 'Organization', to: '/settings?tab=company' });
        crumbs.push({ label: 'Branding', to: '/settings?tab=company' });
      } else if (tab === 'structure') {
        crumbs.push({ label: 'Organization', to: '/settings?tab=structure' });
        crumbs.push({ label: 'Company Structure', to: '/settings?tab=structure' });
      } else if (tab === 'view-options') {
        crumbs.push({ label: 'Preferences', to: '/settings?tab=view-options' });
        crumbs.push({ label: 'Display Options', to: '/settings?tab=view-options' });
      } else {
        crumbs.push({ label: 'Preferences', to: '/settings?tab=profile' });
        crumbs.push({ label: 'My Profile', to: '/settings?tab=profile' });
      }
      return crumbs;
    }

    if (path === '/resources') {
      if (tab === 'categories') {
        crumbs.push({ label: 'Resources', to: '/resources?tab=locations' });
        crumbs.push({ label: 'Categories', to: '/resources?tab=categories' });
      } else if (tab === 'codes') {
        crumbs.push({ label: 'Resources', to: '/resources?tab=locations' });
        crumbs.push({ label: 'Access Codes', to: '/resources?tab=codes' });
      } else {
        crumbs.push({ label: 'Resources', to: '/resources?tab=locations' });
        crumbs.push({ label: 'Locations & Gates', to: '/resources?tab=locations' });
      }
      return crumbs;
    }

    if (path === '/audit') {
      crumbs.push({ label: 'Administration', to: '/settings?tab=users' });
      crumbs.push({ label: 'Audit Logs', to: '/audit' });
      return crumbs;
    }
    
    if (path !== '/') {
      const segments = path.split('/').filter(Boolean);
      segments.forEach((segment, index) => {
        const to = `/${segments.slice(0, index + 1).join('/')}`;
        let label = segment.charAt(0).toUpperCase() + segment.slice(1);
        
        if (segment === 'employees' && segments[index + 1]) {
          const emp = employees.find(e => e.id === segments[index + 1]);
          if (emp) label = 'Employees';
        } else if (segments[index - 1] === 'employees') {
          const emp = employees.find(e => e.id === segment);
          if (emp) label = emp.name;
        } else if (segment === 'status-management') {
          label = 'Status Management';
        } else if (segment === 'matrix') {
          label = 'Access Matrix';
        } else if (segment === 'applications') {
          label = 'Applications';
        }
        
        crumbs.push({ label, to });
      });
    }
    
    return crumbs;
  };

  const breadcrumbs = getBreadcrumbs();

  const getSearchPlaceholder = () => {
    const path = location.pathname;
    if (path === '/') return 'Search dashboard (passes, applications)...';
    if (path.startsWith('/employees/')) return 'Search personnel directory...';
    if (path === '/employees') return 'Search personnel by name, QID, ID, title...';
    if (path.startsWith('/applications/')) return 'Search roster personnel by name, QID...';
    if (path === '/applications') return 'Search pass applications by ID, requester...';
    if (path === '/status-management') return 'Search passes by ID, personnel, location...';
    if (path === '/matrix') return 'Search access matrix by personnel, location...';
    if (path === '/resources') return 'Search locations, categories, access codes...';
    if (path === '/audit' || path === '/audit-logs') return 'Search audit trail by user, action, entity...';
    if (path.startsWith('/settings')) return 'Search users, roles & system settings...';
    return 'Global search across AccessOne...';
  };

  return (
    <header className="h-11 bg-white border-b border-slate-200/90 flex items-center justify-between px-3.5 sticky top-0 z-30 shadow-2xs">
      {/* Left: Breadcrumbs */}
      <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 min-w-[140px] overflow-x-auto py-1">
        {breadcrumbs.map((crumb, idx) => {
          const isLast = idx === breadcrumbs.length - 1;
          const isRootOverview = crumb.label === 'Dashboard' && location.pathname === '/';
          
          return (
            <div key={`${crumb.to}-${crumb.label}-${idx}`} className="flex items-center gap-1.5 shrink-0">
              {idx > 0 && <ChevronRight size={11} className="text-slate-300" />}
              {isLast ? (
                <span className="text-[10px] font-bold text-slate-900 uppercase tracking-wider">
                  {isRootOverview ? 'Overview' : crumb.label}
                </span>
              ) : (
                <Link 
                  to={crumb.to}
                  className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider hover:text-[#800020] transition-colors"
                >
                  {crumb.label}
                </Link>
              )}
            </div>
          );
        })}
      </nav>

      {/* Middle: Global Search */}
      <div className="flex-1 max-w-md px-3">
        <SearchInput 
          id="header-global-search"
          value={globalSearch} 
          onSearch={setGlobalSearch} 
          onChange={setGlobalSearch}
          placeholder={getSearchPlaceholder()} 
          shortcutHint="Alt+F"
        />
      </div>

      {/* Right: Company Logo & Top Bar User Navigation Menu */}
      <div className="flex items-center gap-2.5 min-w-[180px] justify-end">
        {company?.companyLogoUrl && (
          <div className="hidden lg:flex items-center gap-1.5 pl-2 pr-3 border-l border-slate-100">
            <img src={company.companyLogoUrl} alt="Company" className="h-4 object-contain" referrerPolicy="no-referrer" />
            <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wider truncate max-w-[90px]">{company.companyName}</span>
          </div>
        )}
        
        {/* Notifications Bell */}
        <div className="relative" ref={notifRef}>
          <button
            type="button"
            onClick={() => setIsNotifOpen(!isNotifOpen)}
            className="relative flex items-center justify-center w-9 h-9 rounded-xl hover:bg-slate-100/70 transition-colors"
            aria-label="Notifications"
          >
            <Bell size={18} className="text-slate-500" />
            {unreadCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center h-4 min-w-[16px] px-1 rounded-full bg-[#800020] text-white text-[9px] font-bold">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>
          {isNotifOpen && (
            <div className="absolute right-0 mt-2 w-80 max-h-96 overflow-y-auto bg-white rounded-xl border border-slate-200 shadow-xl z-50">
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
                <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">Notifications</span>
                {unreadCount > 0 && (
                  <button onClick={handleMarkAllRead} className="text-[11px] font-bold text-[#800020] hover:underline">
                    Mark all read
                  </button>
                )}
              </div>
              {notifications.length === 0 ? (
                <div className="px-4 py-8 text-center text-xs text-slate-400">No notifications yet</div>
              ) : (
                notifications.map((notif: any) => (
                  <button
                    key={notif.id}
                    onClick={() => handleNotificationClick(notif)}
                    className={cn(
                      "w-full text-left px-4 py-3 border-b border-slate-50 hover:bg-slate-50 transition-colors",
                      !notif.isRead && "bg-[#800020]/5"
                    )}
                  >
                    <div className="flex items-start gap-2">
                      {!notif.isRead && <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-[#800020] shrink-0" />}
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] font-bold text-slate-800 truncate">{notif.title}</p>
                        {notif.message && <p className="text-[11px] text-slate-500 mt-0.5 line-clamp-2">{notif.message}</p>}
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        {/* User Profile Navigation Dropdown */}
        <div className="relative" ref={menuRef}>
          <button 
            type="button"
            id="top-nav-user-menu-btn"
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            className={cn(
              "flex items-center gap-2 p-1 rounded-lg transition-all group cursor-pointer select-none",
              isMenuOpen ? "bg-slate-100 ring-1 ring-slate-200" : "hover:bg-slate-100/70"
            )}
            aria-expanded={isMenuOpen}
            aria-haspopup="true"
          >
            <div className="text-right hidden sm:block">
              <p className="text-[11px] font-bold text-slate-900 group-hover:text-[#800020] transition-colors leading-tight">
                {user.displayName || user.email?.split('@')[0]}
              </p>
              <p className="text-[8px] font-bold text-slate-400 uppercase tracking-widest leading-none mt-0.5">
                {user.role === 'admin' ? 'Super Admin' : user.role}
              </p>
            </div>

            <div className="relative">
              <img 
                src={user.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.displayName || '')}&background=800020&color=fff`} 
                className="w-7 h-7 rounded-full border border-slate-200 shadow-2xs object-cover" 
                alt="User Avatar" 
              />
              <div className="absolute -bottom-0.5 -right-0.5 w-2 h-2 bg-emerald-500 border-2 border-white rounded-full" />
            </div>

            <ChevronDown 
              size={12} 
              className={cn("text-slate-400 transition-transform duration-150", isMenuOpen && "rotate-180 text-slate-700")} 
            />
          </button>

          {/* Top Bar Dropdown Menu */}
          {isMenuOpen && (
            <div className="absolute right-0 top-full mt-1.5 w-60 bg-white rounded-xl border border-slate-200 shadow-xl py-1.5 z-50 animate-in fade-in zoom-in-95 duration-100 divide-y divide-slate-100">
              {/* Profile Card Header */}
              <div className="px-3.5 py-2.5 bg-slate-50/70">
                <p className="text-xs font-bold text-slate-900 truncate">{user.displayName || 'System User'}</p>
                <p className="text-[11px] text-slate-500 font-medium truncate mt-0.5">{user.email}</p>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-[9px] font-extrabold uppercase px-2 py-0.5 rounded bg-[#800020]/10 text-[#800020] border border-[#800020]/20">
                    {user.role === 'admin' ? 'Organization Admin' : user.role}
                  </span>
                  <span className="text-[9px] text-emerald-600 font-bold flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    Online
                  </span>
                </div>
              </div>

              {/* Navigation Links */}
              <div className="py-1">
                <Link
                  to="/settings?tab=profile"
                  className="flex items-center gap-2.5 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 hover:text-[#800020] transition-colors"
                >
                  <User size={13} className="text-slate-400" />
                  <span>My Profile</span>
                </Link>

                <Link
                  to="/settings?tab=view-options"
                  className="flex items-center gap-2.5 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 hover:text-[#800020] transition-colors"
                >
                  <Sliders size={13} className="text-slate-400" />
                  <span>Display & Appearance</span>
                </Link>
              </div>

              {/* Admin Shortcuts */}
              {isAdmin && (
                <div className="py-1">
                  <div className="px-3 pt-1 pb-0.5 text-[9px] font-bold text-slate-400 uppercase tracking-wider">
                    Organization Admin
                  </div>

                  {isPowerAdmin(user) && (
                    <Link
                      to="/settings?tab=company"
                      className="flex items-center gap-2.5 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 hover:text-[#800020] transition-colors"
                    >
                      <Building2 size={13} className="text-slate-400" />
                      <span>Application Branding</span>
                    </Link>
                  )}

                  <Link
                    to="/settings?tab=users"
                    className="flex items-center gap-2.5 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 hover:text-[#800020] transition-colors"
                  >
                    <UserCog size={13} className="text-slate-400" />
                    <span>User Accounts & Roles</span>
                  </Link>

                  <Link
                    to="/settings?tab=user-reports"
                    className="flex items-center gap-2.5 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 hover:text-[#800020] transition-colors"
                  >
                    <Radio size={13} className="text-slate-400" />
                    <span>Live Presence & Reports</span>
                  </Link>

                  <Link
                    to="/audit"
                    className="flex items-center gap-2.5 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 hover:text-[#800020] transition-colors"
                  >
                    <FileText size={13} className="text-slate-400" />
                    <span>Audit Trail Logs</span>
                  </Link>
                </div>
              )}

              {/* Sign Out Action */}
              {handleLogout && (
                <div className="py-1">
                  <button
                    type="button"
                    onClick={() => {
                      setIsMenuOpen(false);
                      handleLogout();
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-1.5 text-xs font-bold text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer text-left"
                  >
                    <LogOut size={13} />
                    <span>Sign Out</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}


