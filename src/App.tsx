import React, { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { 
  ShieldCheck, 
  Eye, 
  EyeOff,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Employee, 
  Location, 
  Category,
  AccessCode, 
  Pass, 
  UserProfile, 
  UserRole,
  BrandingSettings,
  PassApplication,
  Division,
  Project,
  Department,
  isPowerAdmin
} from './types';
import { apiFetch, cn } from './lib/utils';
import { startRealtime, stopRealtime, onDataChanged, isRealtimeConnected, onServerVersion } from './lib/realtime';

// --- Components ---
import { Modal } from './components/common/Modal';
import { Toast } from './components/common/Toast';
import { ConfirmModal } from './components/common/ConfirmModal';
import { Sidebar } from './components/layout/Sidebar';
import { Navbar } from './components/layout/Navbar';

// --- Pages ---
import { MaintenanceBanner } from './components/layout/MaintenanceBanner';
// Pages load on first visit (route-level code splitting) instead of all up front.
const Dashboard = lazy(() => import('./pages/Dashboard').then(m => ({ default: m.Dashboard })));
const Employees = lazy(() => import('./pages/Employees').then(m => ({ default: m.Employees })));
const Resources = lazy(() => import('./pages/Resources').then(m => ({ default: m.Resources })));
const AccessMatrix = lazy(() => import('./pages/AccessMatrix').then(m => ({ default: m.AccessMatrix })));
const Settings = lazy(() => import('./pages/Settings').then(m => ({ default: m.Settings })));
const Passes = lazy(() => import('./pages/Passes').then(m => ({ default: m.Passes })));
const AuditLogs = lazy(() => import('./pages/AuditLogs').then(m => ({ default: m.AuditLogs })));
const EmployeeDetail = lazy(() => import('./pages/EmployeeDetail').then(m => ({ default: m.EmployeeDetail })));
const ApplicationDetail = lazy(() => import('./pages/ApplicationDetail').then(m => ({ default: m.ApplicationDetail })));
const SaaSAdminPortal = lazy(() => import('./pages/SaaSAdminPortal').then(m => ({ default: m.SaaSAdminPortal })));

const ALL_RESOURCES = ['employees', 'passes', 'passApplications', 'locations', 'categories', 'accessCodes', 'company', 'users', 'divisions', 'projects', 'departments'];

// Apply a delta to a list: changed rows replace their old version in place, new rows go first,
// removed (deleted / replaced) rows drop out. Unchanged lists keep their identity (no re-render).
function mergeDelta<T extends { id: string }>(prev: T[], items: T[], removed: string[]): T[] {
  if (items.length === 0 && removed.length === 0) return prev;
  const gone = new Set(removed);
  const changed = new Map(items.map(i => [i.id, i]));
  const kept = prev.filter(x => !gone.has(x.id)).map(x => {
    const next = changed.get(x.id);
    if (!next) return x;
    changed.delete(x.id);
    return next;
  });
  return [...changed.values(), ...kept];
}
const NotificationsPage = lazy(() => import('./pages/Notifications').then(m => ({ default: m.NotificationsPage })));
import { NotificationProvider } from './context/NotificationContext';
import { InAppNotificationToast } from './components/notifications/InAppNotificationToast';

// --- Forms ---
import { ResetPasswordForm } from './components/settings/ResetPasswordForm';
import { EmployeeForm } from './components/employees/EmployeeForm';
import { LocationForm } from './components/resources/LocationForm';
import { AccessCodeForm } from './components/resources/AccessCodeForm';

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const [user, setUser] = useState<UserProfile | null>(() => {
    try {
      const saved = localStorage.getItem('user');
      return saved ? JSON.parse(saved) : null;
    } catch (e) {
      console.error('Corrupted user session data, clearing.', e);
      localStorage.removeItem('user');
      return null;
    }
  });
  const [company, setCompany] = useState<BrandingSettings | null>(null);
  const [globalSearch, setGlobalSearch] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  
  // Data State
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [applications, setApplications] = useState<PassApplication[]>([]);
  const [passes, setPasses] = useState<Pass[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [accessCodes, setAccessCodes] = useState<AccessCode[]>([]);
  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);

  // Modal States
  const [isPassModalOpen, setIsPassModalOpen] = useState(false);
  const [isEmployeeModalOpen, setIsEmployeeModalOpen] = useState(false);
  const [isLocationModalOpen, setIsLocationModalOpen] = useState(false);
  const [isCodeModalOpen, setIsCodeModalOpen] = useState(false);
  const [locationModalMode, setLocationModalMode] = useState<'manual' | 'import'>('manual');
  const [codeModalMode, setCodeModalMode] = useState<'manual' | 'import'>('manual');
  const [selectedLocationForCode, setSelectedLocationForCode] = useState<string | null>(null);
  const [selectedPass, setSelectedPass] = useState<Pass | null>(null);
  const [passModalType, setPassModalType] = useState<'issue' | 'application'>('issue');
  
  // Toast State
  const [toast, setToast] = useState<{ 
    message: string, 
    type: 'success' | 'error',
    onRetry?: () => void,
    reason?: string
  } | null>(null);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isFetching, setIsFetching] = useState(false);

  // Requirement 10: Session Security - Auto logout after 30 minutes of inactivity
  useEffect(() => {
    if (!user) return;

    let timeoutId: NodeJS.Timeout;

    const resetTimer = () => {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        handleLogout();
        setToast({ message: "Session expired due to inactivity", type: 'error' });
      }, 30 * 60 * 1000); // 30 minutes
    };

    const events = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart'];
    events.forEach(event => window.addEventListener(event, resetTimer));
    
    resetTimer(); // Initial start

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      events.forEach(event => window.removeEventListener(event, resetTimer));
    };
  }, [user]);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });

  const showConfirm = (title: string, message: string, onConfirm: () => void) => {
    setConfirmModal({ isOpen: true, title, message, onConfirm });
  };

  const showToast = (message: string, type: 'success' | 'error' = 'success', onRetry?: () => void, reason?: string) => {
    setToast({ message, type, onRetry, reason });
    if (type === 'success' && !onRetry) {
      setTimeout(() => setToast(null), 3500);
    }
  };
  
  // Auth Form State
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authName, setAuthName] = useState('');
  const [authError, setAuthError] = useState('');
  const [nameAvailable, setNameAvailable] = useState<boolean | null>(null);
  const [emailAvailable, setEmailAvailable] = useState<boolean | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [isResetModalOpen, setIsResetModalOpen] = useState(false);

  const [dbStatus, setDbStatus] = useState<'checking' | 'connected' | 'error'>('checking');
  const [dbErrorMessage, setDbErrorMessage] = useState('');

  const checkDbStatus = async () => {
    try {
      const res = await apiFetch('/api/health');
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const data = await res.json();
      if (data.dbConnected) {
        setDbStatus('connected');
      } else {
        setDbStatus('error');
        setDbErrorMessage(data.error || 'Database connection failed');
      }
    } catch (err: any) {
      setDbStatus('error');
      setDbErrorMessage(err.message || 'Failed to connect to server');
    }
  };

  useEffect(() => {
    checkDbStatus();
    // Preload system settings for global branding and maintenance broadcast banner
    apiFetch('/api/settings/company')
      .then(res => res.ok ? res.json() : null)
      .then(comp => {
        if (comp && typeof comp === 'object' && !Array.isArray(comp)) {
          setCompany(comp);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (company) {
      document.title = company.appName || 'AccessOne';
      if (company.appLogoUrl) {
        const link = document.querySelector("link[rel~='icon']") as HTMLLinkElement;
        if (link) {
          link.href = company.appLogoUrl;
        }
      }
    }
  }, [company]);

  // --- Data Fetching ---
  const hadDataErrorRef = useRef(false);
  const fetchSeqRef = useRef(0);
  const syncCursorsRef = useRef<Record<string, string | null>>({ employees: null, passes: null, passApplications: null });
  const activeAbortControllerRef = useRef<AbortController | null>(null);

  const safeFetch = async (url: string, fallback: any, signal?: AbortSignal): Promise<{ value: any; ok: boolean; cursor?: string | null; status?: number }> => {
    try {
      const r = await apiFetch(url, signal ? { signal } : {});
      if (r.ok) return { value: await r.json(), ok: true, cursor: r.headers.get('X-Sync-Cursor'), status: r.status };
      return { value: fallback, ok: false, status: r.status };
    } catch (e: any) {
      if (e?.name === 'AbortError') throw e;
      return { value: fallback, ok: false };
    }
  };

  const fetchData = async () => {
    if (!user) return;
    
    // Abort any ongoing in-flight HTTP requests from previous fetches
    if (activeAbortControllerRef.current) {
      activeAbortControllerRef.current.abort();
    }
    const abortController = new AbortController();
    activeAbortControllerRef.current = abortController;

    const mySeq = ++fetchSeqRef.current;
    setIsFetching(true);
    try {
      const results = await Promise.all([
        safeFetch('/api/employees', [], abortController.signal),
        safeFetch('/api/passes', [], abortController.signal),
        safeFetch('/api/passApplications', [], abortController.signal),
        safeFetch('/api/locations', [], abortController.signal),
        safeFetch('/api/categories', [], abortController.signal),
        safeFetch('/api/accessCodes', [], abortController.signal),
        safeFetch('/api/settings/company', null, abortController.signal),
        safeFetch('/api/users', [], abortController.signal),
        safeFetch('/api/divisions', [], abortController.signal),
        safeFetch('/api/projects', [], abortController.signal),
        safeFetch('/api/departments', [], abortController.signal)
      ]);
      const [emps, pss, reqs, locs, cats, grps, comp, usrs, divs, projs, depts] = results.map(r => r.value);
      const hadError = results.some(r => !r.ok);

      if (mySeq !== fetchSeqRef.current || abortController.signal.aborted) return; // a newer fetch has started or this was aborted

      // Where to resume from on the next (delta) refresh of the big lists
      syncCursorsRef.current = {
        employees: results[0].ok ? results[0].cursor || null : null,
        passes: results[1].ok ? results[1].cursor || null : null,
        passApplications: results[2].ok ? results[2].cursor || null : null,
      };

      setEmployees(Array.isArray(emps) ? emps : []);
      setPasses(Array.isArray(pss) ? pss : []);
      setApplications(Array.isArray(reqs) ? reqs : []);
      setLocations(Array.isArray(locs) ? locs : []);
      setCategories(Array.isArray(cats) ? cats : []);
      setAccessCodes(Array.isArray(grps) ? grps : []);
      setCompany(comp && typeof comp === 'object' && !Array.isArray(comp) ? comp : null);
      setAllUsers(Array.isArray(usrs) ? usrs : []);
      setDivisions(Array.isArray(divs) ? divs : []);
      setProjects(Array.isArray(projs) ? projs : []);
      setDepartments(Array.isArray(depts) ? depts : []);

      if (hadError) {
        if (!hadDataErrorRef.current) {
          showToast('Some data failed to load. Showing the latest available information.', 'error');
        }
        hadDataErrorRef.current = true;
      } else {
        hadDataErrorRef.current = false;
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        // Fetch was intentionally aborted; do not show error or update UI
        return;
      }
      console.error("Failed to fetch data:", err);
      if (!hadDataErrorRef.current) {
        showToast('Failed to load data. Please check your connection.', 'error');
      }
      hadDataErrorRef.current = true;
    } finally {
      if (mySeq === fetchSeqRef.current) {
        setIsLoading(false);
        setIsFetching(false);
      }
    }
  };

  // New-version notice: the server announces its deployed build; if this tab runs an older one,
  // offer a reload (not automatic, so nobody loses a half-filled form).
  const [newVersionAvailable, setNewVersionAvailable] = useState(false);
  useEffect(() => onServerVersion(version => {
    if (version && version !== __APP_VERSION__) setNewVersionAvailable(true);
  }), []);

  // Latest fetchData for long-lived listeners below (avoids stale closures)
  const fetchDataRef = useRef(fetchData);
  fetchDataRef.current = fetchData;

  // Refetch only the named lists (used by the realtime change feed and after saves). The big
  // lists (employees, passes, applications) are refreshed as deltas: only rows changed since the
  // last fetch are downloaded and merged in. If the server can't do that, the whole list is fetched.
  const fetchResources = async (resources: string[]) => {
    if (!user) return;
    const deltaSetters: Record<string, React.Dispatch<React.SetStateAction<any[]>>> = {
      employees: setEmployees as any,
      passes: setPasses as any,
      passApplications: setApplications as any,
    };
    const endpoints: Record<string, [string, any, (v: any) => void]> = {
      employees: ['/api/employees', [], v => setEmployees(Array.isArray(v) ? v : [])],
      passes: ['/api/passes', [], v => setPasses(Array.isArray(v) ? v : [])],
      passApplications: ['/api/passApplications', [], v => setApplications(Array.isArray(v) ? v : [])],
      locations: ['/api/locations', [], v => setLocations(Array.isArray(v) ? v : [])],
      categories: ['/api/categories', [], v => setCategories(Array.isArray(v) ? v : [])],
      accessCodes: ['/api/accessCodes', [], v => setAccessCodes(Array.isArray(v) ? v : [])],
      company: ['/api/settings/company', null, v => { if (v && typeof v === 'object' && !Array.isArray(v)) setCompany(v); }],
      users: ['/api/users', [], v => setAllUsers(Array.isArray(v) ? v : [])],
      divisions: ['/api/divisions', [], v => setDivisions(Array.isArray(v) ? v : [])],
      projects: ['/api/projects', [], v => setProjects(Array.isArray(v) ? v : [])],
      departments: ['/api/departments', [], v => setDepartments(Array.isArray(v) ? v : [])],
    };
    await Promise.all(resources.filter(r => endpoints[r]).map(async r => {
      const [url, fallback, apply] = endpoints[r];
      const cursor = syncCursorsRef.current[r];
      if (deltaSetters[r] && cursor) {
        const delta = await safeFetch(`${url}?since=${encodeURIComponent(cursor)}`, null);
        const body = delta.value;
        if (delta.ok && body && Array.isArray(body.items) && Array.isArray(body.removed)) {
          syncCursorsRef.current[r] = body.cursor || cursor;
          deltaSetters[r](prev => mergeDelta(prev, body.items, body.removed));
          return;
        }
        syncCursorsRef.current[r] = null; // fall back to a full download below
      }
      const result = await safeFetch(url, fallback);
      if (result.ok) {
        apply(result.value);
        if (deltaSetters[r]) syncCursorsRef.current[r] = result.cursor || null;
      }
    }));
  };

  // Every list, big ones as deltas: after a save, and as the fallback when live updates are down
  const refreshAll = () => fetchResources(ALL_RESOURCES);
  const refreshAllRef = useRef(refreshAll);
  refreshAllRef.current = refreshAll;
  const fetchResourcesRef = useRef(fetchResources);
  fetchResourcesRef.current = fetchResources;

  // Data freshness: push, not polling.
  // The server announces which lists changed (src/lib/realtime.ts); we refetch only those, batched.
  // While the tab is hidden, changes are remembered and fetched when it becomes visible again.
  // Only if the live connection is down do we fall back to a slow full refresh.
  useEffect(() => {
    if (!user) {
      clearUserDataState();
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    fetchDataRef.current();
    startRealtime();

    const pending = new Set<string>();
    let flushTimer: ReturnType<typeof setTimeout> | null = null;

    const flush = () => {
      flushTimer = null;
      if (document.visibilityState !== 'visible' || pending.size === 0) return;
      const list = Array.from(pending);
      pending.clear();
      if (list.includes('*')) refreshAllRef.current();
      else fetchResourcesRef.current(list);
    };

    const offChange = onDataChanged(resources => {
      resources.forEach(r => pending.add(r));
      if (!flushTimer) flushTimer = setTimeout(flush, 300); // collapse bursts of writes into one fetch
    });

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        if (!isRealtimeConnected()) pending.add('*');
        flush();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    const FALLBACK_MS = 120000;
    const fallback = setInterval(() => {
      if (!isRealtimeConnected() && document.visibilityState === 'visible') refreshAllRef.current();
    }, FALLBACK_MS);

    return () => {
      offChange();
      stopRealtime();
      if (flushTimer) clearTimeout(flushTimer);
      clearInterval(fallback);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [user?.id]);

  // Presence Tracking & Heartbeat
  useEffect(() => {
    if (!user) return;

    const sendHeartbeat = async () => {
      try {
        await apiFetch('/api/presence/heartbeat', {
          method: 'POST',
          body: JSON.stringify({
            userId: user.id,
            email: user.email,
            displayName: user.displayName || user.name || user.email,
            userName: user.userName || user.displayName || user.name || user.email,
            role: user.role,
            organizationId: user.organizationId || null,
            department: user.department,
            jobTitle: user.jobTitle,
            currentPage: location.pathname
          })
        });
      } catch (err) {
        // Silent catch for presence heartbeat
      }
    };

    // Send immediate heartbeat on route change / user load
    sendHeartbeat();

    // Regular 25s heartbeat when tab is active
    const heartbeatInterval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        sendHeartbeat();
      }
    }, 25000);

    const handlePresenceVisibility = () => {
      if (document.visibilityState === 'visible') {
        sendHeartbeat();
      }
    };

    const handleBeforeUnload = () => {
      try {
        const payload = JSON.stringify({ userId: user.id });
        if (navigator.sendBeacon) {
          navigator.sendBeacon('/api/presence/logout', new Blob([payload], { type: 'application/json' }));
        }
      } catch (e) {}
    };

    document.addEventListener('visibilitychange', handlePresenceVisibility);
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      clearInterval(heartbeatInterval);
      document.removeEventListener('visibilitychange', handlePresenceVisibility);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [user, location.pathname]);

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only trigger if Alt is pressed and not in an input/textarea (unless it's Alt+F for search)
      const isInput = ['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName);
      
      if (e.altKey) {
        switch (e.key.toLowerCase()) {
          case 'd':
            e.preventDefault();
            navigate('/');
            break;
          case 'a':
            e.preventDefault();
            navigate('/applications');
            break;
          case 'm':
            e.preventDefault();
            navigate('/matrix');
            break;
          case 'e':
            e.preventDefault();
            navigate('/employees');
            break;
          case 'l':
            e.preventDefault();
            navigate('/resources');
            break;
          case 's':
            e.preventDefault();
            navigate('/settings');
            break;
          case 'u':
            if (user?.role === 'admin') {
              e.preventDefault();
              navigate('/audit');
            }
            break;
          case 'f':
            e.preventDefault();
            const searchInput = (document.getElementById('header-global-search') || document.querySelector('input[type="text"][placeholder*="Search"]')) as HTMLInputElement;
            if (searchInput) {
              searchInput.focus();
              searchInput.select();
            }
            break;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [navigate, user]);

  const clearUserDataState = () => {
    syncCursorsRef.current = { employees: null, passes: null, passApplications: null };
    // Invalidate and cancel any ongoing asynchronous network fetches
    fetchSeqRef.current++;
    if (activeAbortControllerRef.current) {
      activeAbortControllerRef.current.abort();
      activeAbortControllerRef.current = null;
    }
    setEmployees([]);
    setPasses([]);
    setApplications([]);
    setLocations([]);
    setCategories([]);
    setAccessCodes([]);
    setCompany(null);
    setAllUsers([]);
    setDivisions([]);
    setProjects([]);
    setDepartments([]);
    setGlobalSearch('');
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    const trimmedEmail = authEmail.trim().toLowerCase();
    const endpoint = authMode === 'login' ? '/api/auth/login' : '/api/auth/register';
    const body = authMode === 'login' 
      ? { email: trimmedEmail, password: authPassword }
      : { email: trimmedEmail, password: authPassword, displayName: authName };

    try {
      const res = await apiFetch(endpoint, {
        method: 'POST',
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Authentication failed');
      
      if (authMode === 'register') {
        setAuthMode('login');
        setAuthError('Registration successful! Please wait for admin approval.');
        return;
      }
      
      // Wipe stale data from previous sessions before mounting new user session
      clearUserDataState();
      setIsLoading(true);
      setUser(data);
      localStorage.setItem('user', JSON.stringify(data));
      navigate('/');
    } catch (err: any) {
      setAuthError(err.message);
    }
  };

  const handleLogout = () => {
    if (user?.id) {
      apiFetch('/api/presence/logout', {
        method: 'POST',
        body: JSON.stringify({ userId: user.id })
      }).catch(() => {});
    }
    // Clears the httpOnly session cookie (the browser cannot remove it itself)
    apiFetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    clearUserDataState();
    setUser(null);
    localStorage.removeItem('user');
    try {
      sessionStorage.clear();
      delete (window as any).__accessOneSessionExpiredRedirect;
    } catch (e) {
      // Ignore if sessionStorage is restricted in iframe
    }
    navigate('/');
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F8F9FA]">
        <motion.div 
          animate={{ rotate: 360 }} 
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
          className="w-12 h-12 border-4 border-[#800020]/20 border-t-[#800020] rounded-full"
        />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col justify-center items-center bg-[#F8F9FA] p-6 relative">
        <MaintenanceBanner company={company} className="fixed top-0 left-0 right-0" />
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white p-12 rounded-[40px] shadow-2xl border border-[#E5E7EB] max-w-md w-full"
        >
          <div className="w-20 h-20 bg-[#800020]/10 rounded-3xl flex items-center justify-center mx-auto mb-4 overflow-hidden">
            {company?.appLogoUrl ? (
              <img src={company.appLogoUrl} alt="App Logo" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
            ) : (
              <ShieldCheck size={40} className="text-[#800020]" />
            )}
          </div>
          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold text-[#1A1A1A] tracking-tight leading-none">
              {company?.appName || 'AccessOne'}
            </h1>
            <p className="text-[10px] font-bold text-[#6B7280] uppercase tracking-widest mt-1">
              {company?.poweredBy || 'by Techsandgadgets.com'}
            </p>
          </div>
          <h1 className="text-3xl font-bold text-[#1A1A1A] mb-2 tracking-tight text-center">
            {authMode === 'login' ? 'Welcome Back' : 'Create Account'}
          </h1>
          
          <form onSubmit={handleAuth} className="space-y-4">
            {authMode === 'register' && (
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-[#6B7280] uppercase tracking-wider">Full Name</label>
                <input 
                  required 
                  type="text" 
                  value={authName}
                  onChange={e => setAuthName(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-[#E5E7EB] focus:border-[#800020] outline-none font-medium text-sm transition-all" 
                  placeholder="John Doe"
                />
              </div>
            )}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-[#6B7280] uppercase tracking-wider">Email Address</label>
              <input 
                required 
                type="email" 
                value={authEmail}
                onChange={e => setAuthEmail(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-[#E5E7EB] focus:border-[#800020] outline-none font-medium text-sm transition-all" 
                placeholder="name@company.com"
              />
            </div>
            <div className="space-y-1.5 relative">
              <label className="text-[10px] font-bold text-[#6B7280] uppercase tracking-wider">Password</label>
              <div className="relative">
                <input 
                  required 
                  type={showPassword ? "text" : "password"} 
                  value={authPassword}
                  onChange={e => setAuthPassword(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-[#E5E7EB] outline-none focus:border-[#800020] font-medium text-sm pr-10" 
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#6B7280]"
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>
            
            {authError && (
              <p className="text-xs text-red-600 font-bold bg-red-50 p-3 rounded-xl border border-red-100">
                {authError}
              </p>
            )}

            <button 
              type="submit"
              className="w-full bg-[#1A1A1A] text-white py-4 rounded-2xl font-bold hover:bg-black transition-all shadow-lg shadow-black/10"
            >
              {authMode === 'login' ? 'Sign In' : 'Create Account'}
            </button>
          </form>

          <div className="mt-8 text-center space-y-4">
            <button 
              onClick={() => {
                setAuthMode(authMode === 'login' ? 'register' : 'login');
                setAuthError('');
              }}
              className="text-sm font-bold text-[#800020] hover:underline block w-full"
            >
              {authMode === 'login' ? "Don't have an account? Register" : "Already have an account? Sign In"}
            </button>
            {authMode === 'login' && (
              <button 
                onClick={() => setIsResetModalOpen(true)}
                className="text-xs font-bold text-[#6B7280] hover:text-[#800020]"
              >
                Forgot Password?
              </button>
            )}
          </div>
        </motion.div>

        <Modal isOpen={isResetModalOpen} onClose={() => setIsResetModalOpen(false)} title="Reset Password">
          <ResetPasswordForm onClose={() => setIsResetModalOpen(false)} showToast={showToast} />
        </Modal>
      </div>
    );
  }

  // Dedicated SaaS Master Control Portal (Completely standalone page for Power Admin / Vendor Root)
  if (isPowerAdmin(user)) {
    return (
      <div key={`power-admin-${user.id}`} className="min-h-screen bg-[#F8F9FA] text-slate-900 flex flex-col font-sans">
        <MaintenanceBanner company={company} />
        <SaaSAdminPortal
          user={user}
          company={company}
          handleLogout={handleLogout}
          showToast={showToast}
          showConfirm={showConfirm}
        />

        <ConfirmModal 
          isOpen={confirmModal.isOpen}
          onClose={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
          title={confirmModal.title}
          message={confirmModal.message}
          onConfirm={confirmModal.onConfirm}
        />

        {toast && (
          <Toast 
            message={toast.message} 
            type={toast.type} 
            reason={toast.reason}
            onClose={() => setToast(null)} 
            onRetry={toast.onRetry}
          />
        )}
      </div>
    );
  }

  return (
    <NotificationProvider currentUser={user}>
      <div key={`tenant-user-${user.id}-${user.organizationId || 'global'}`} className="min-h-screen bg-[#F8F9FA] flex flex-col">
        <InAppNotificationToast />
        <MaintenanceBanner company={company} />
      <div className="flex-1 flex">
        {/* Connectivity Alert */}
      {!isOnline && (
        <div className="fixed top-0 left-0 right-0 z-[100] bg-[#800020] text-white py-1 px-4 text-[10px] font-bold text-center animate-in slide-in-from-top duration-300">
          You are currently offline. Some features may be unavailable.
        </div>
      )}

      {/* Progress Bar */}
      {isFetching && (
        <div className="fixed top-0 left-0 right-0 z-[101] h-0.5 bg-transparent overflow-hidden">
          <div className="h-full bg-[#800020] animate-progress-bar origin-left"></div>
        </div>
      )}

      <Sidebar user={user} company={company} handleLogout={handleLogout} />

      <div className="flex-1 ml-52 flex flex-col min-h-screen bg-slate-50/70">
        <Navbar 
          user={user} 
          company={company} 
          globalSearch={globalSearch} 
          setGlobalSearch={setGlobalSearch} 
          employees={employees} 
          handleLogout={handleLogout}
        />

        <div className="p-4 flex-1 flex flex-col min-h-[calc(100vh-64px)]">
          <AnimatePresence mode="wait">
            <div className="flex-1 flex flex-col w-full min-h-[calc(100vh-96px)]">
              <Suspense fallback={<div className="flex-1 flex items-center justify-center text-xs text-[#6B7280]">Loading…</div>}>
              <Routes>
              <Route path="/" element={
                <Dashboard 
                  employees={employees} 
                  passes={passes} 
                  applications={applications}
                  locations={locations} 
                  categories={categories}
                  company={company}
                  globalSearch={globalSearch}
                  allUsers={allUsers}
                />
              } />
              <Route path="/applications" element={
                user?.role !== 'viewer' ? (
                  <Passes 
                    view="applications"
                    passes={passes}
                    applications={applications}
                    employees={employees}
                    locations={locations}
                    categories={categories}
                    accessCodes={accessCodes}
                    projects={projects}
                    divisions={divisions}
                    departments={departments}
                    allUsers={allUsers}
                    currentUser={user}
                    onSuccess={refreshAll}
                    globalSearch={globalSearch}
                    showToast={showToast}
                    showConfirm={showConfirm}
                  />
                ) : (
                  <Navigate to="/" replace />
                )
              } />
              <Route path="/applications/:id" element={
                user?.role !== 'viewer' ? (
                  <ApplicationDetail 
                    applications={applications}
                    passes={passes}
                    employees={employees}
                    locations={locations}
                    categories={categories}
                    accessCodes={accessCodes}
                    projects={projects}
                    divisions={divisions}
                    departments={departments}
                    allUsers={allUsers}
                    currentUser={user}
                    onSuccess={refreshAll}
                    globalSearch={globalSearch}
                    showToast={showToast}
                    showConfirm={showConfirm}
                  />
                ) : (
                  <Navigate to="/" replace />
                )
              } />
              <Route path="/status-management" element={
                user?.role !== 'viewer' ? (
                  <Passes 
                    view="status-management"
                    passes={passes}
                    applications={applications}
                    employees={employees}
                    locations={locations}
                    categories={categories}
                    accessCodes={accessCodes}
                    projects={projects}
                    divisions={divisions}
                    departments={departments}
                    allUsers={allUsers}
                    currentUser={user}
                    onSuccess={refreshAll}
                    globalSearch={globalSearch}
                    showToast={showToast}
                    showConfirm={showConfirm}
                  />
                ) : (
                  <Navigate to="/" replace />
                )
              } />
              <Route path="/matrix" element={
                <AccessMatrix 
                  currentUser={user}
                  showToast={showToast}
                  employees={employees}
                  passes={passes}
                  locations={locations}
                  categories={categories}
                  accessCodes={accessCodes}
                  globalSearch={globalSearch}
                />
              } />
              <Route path="/employees" element={
                <Employees 
                  employees={employees} 
                  passes={passes}
                  applications={applications}
                  divisions={divisions}
                  departments={departments}
                  projects={projects}
                  onSuccess={refreshAll}
                  globalSearch={globalSearch}
                  currentUser={user}
                  showToast={showToast}
                  showConfirm={showConfirm}
                />
              } />
              <Route path="/employees/:id" element={
                <EmployeeDetail
                  employees={employees}
                  applications={applications}
                  passes={passes}
                  locations={locations}
                  accessCodes={accessCodes}
                  divisions={divisions}
                  departments={departments}
                  projects={projects}
                  currentUser={user}
                  onSuccess={refreshAll}
                  showToast={showToast}
                  showConfirm={showConfirm}
                />
              } />
              <Route path="/resources" element={
                <Resources 
                  locations={locations} 
                  categories={categories}
                  accessCodes={accessCodes}
                  divisions={divisions}
                  departments={departments}
                  projects={projects}
                  globalSearch={globalSearch}
                  currentUser={user}
                  onSuccess={refreshAll}
                  showToast={showToast}
                  showConfirm={showConfirm}
                />
              } />
              <Route path="/settings" element={
                <Settings 
                  company={company}
                  allUsers={allUsers}
                  currentUser={user}
                  divisions={divisions}
                  projects={projects}
                  departments={departments}
                  onSuccess={refreshAll}
                  globalSearch={globalSearch}
                  showToast={showToast}
                  showConfirm={showConfirm}
                />
              } />
              <Route path="/audit" element={
                user.role === 'admin' ? (
                  <AuditLogs 
                    globalSearch={globalSearch}
                    allUsers={allUsers}
                    currentUser={user}
                    divisions={divisions}
                    projects={projects}
                    departments={departments}
                    onSuccess={refreshAll}
                    showToast={showToast}
                    showConfirm={showConfirm}
                  />
                ) : (
                  <Navigate to="/" replace />
                )
              } />
              <Route path="/notifications" element={<NotificationsPage currentUser={user} />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
              </Suspense>
          </div>
        </AnimatePresence>
      </div>
      </div>
      </div>

      {/* Global Modals */}
      <Modal isOpen={isEmployeeModalOpen} onClose={() => setIsEmployeeModalOpen(false)} title="Add New Employee">
        <EmployeeForm 
          employees={employees} 
          divisions={divisions}
          departments={departments}
          projects={projects}
          onClose={() => setIsEmployeeModalOpen(false)} 
          onSuccess={refreshAll} 
        />
      </Modal>

      <Modal isOpen={isLocationModalOpen} onClose={() => setIsLocationModalOpen(false)} title={locationModalMode === 'import' ? "Import Locations" : "Add Location"}>
        <LocationForm 
          mode={locationModalMode}
          categories={categories} 
          onClose={() => setIsLocationModalOpen(false)} 
          onSuccess={refreshAll} 
          showToast={showToast}
        />
      </Modal>

      <Modal isOpen={isCodeModalOpen} onClose={() => setIsCodeModalOpen(false)} title={codeModalMode === 'import' ? "Import Access Codes" : "Add Access Code"}>
        <AccessCodeForm 
          mode={codeModalMode}
          locationId={selectedLocationForCode || ''} 
          locations={locations}
          categories={categories}
          onClose={() => setIsCodeModalOpen(false)} 
          onSuccess={refreshAll} 
          showToast={showToast}
        />
      </Modal>

      <ConfirmModal 
        isOpen={confirmModal.isOpen}
        onClose={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
        title={confirmModal.title}
        message={confirmModal.message}
        onConfirm={confirmModal.onConfirm}
      />

      {toast && (
        <Toast 
          message={toast.message} 
          type={toast.type} 
          reason={toast.reason}
          onClose={() => setToast(null)} 
          onRetry={toast.onRetry}
        />
      )}

      {newVersionAvailable && (
        <div role="status" className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[100] max-w-[calc(100%-2rem)] flex items-center gap-3 rounded-xl bg-[#1A1A1A] text-white px-4 py-3 shadow-lg text-xs">
          <span>A new version of AccessOne is available.</span>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-lg bg-[#800020] hover:bg-[#66001a] px-3 py-1.5 font-semibold cursor-pointer"
          >
            Reload
          </button>
          <button type="button" onClick={() => setNewVersionAvailable(false)} className="text-white/60 hover:text-white cursor-pointer" aria-label="Dismiss">
            Later
          </button>
        </div>
      )}
    </div>
    </NotificationProvider>
  );
}
