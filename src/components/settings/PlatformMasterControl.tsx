import React, { useState, useEffect } from 'react';
import { 
  ShieldCheck, 
  Crown, 
  Sparkles, 
  Building2, 
  Download, 
  Trash2, 
  RefreshCw, 
  Database, 
  Layers, 
  UserPlus, 
  Key, 
  CheckCircle2, 
  AlertTriangle, 
  ExternalLink,
  Lock,
  ArrowRight,
  FileSpreadsheet,
  Palette,
  Server,
  Globe,
  Radio,
  Copy,
  Check,
  Zap,
  Calendar,
  Clock,
  Shield,
  Search,
  Filter,
  Users,
  CreditCard,
  FileText,
  Mail,
  Phone,
  Edit,
  XCircle,
  PlusCircle,
  ChevronRight,
  Info,
  ShieldAlert
} from 'lucide-react';
import { apiFetch, cn, generateTempPassword } from '../../lib/utils';
import { 
  BrandingSettings, 
  OrganizationTenant, 
  PlatformSaaSDashboard, 
  SaaSLicensePlan, 
  ClientWelcomePackage,
  LicenseProvisionPayload 
} from '../../types';
import { PowerAdminTab } from '../layout/PowerAdminSidebar';
import { GlobalMasterPortCatalog } from './GlobalMasterPortCatalog';
import { MaintenanceBroadcastAdmin } from './MaintenanceBroadcastAdmin';
import { TenantStatusModal } from './TenantStatusModal';
import { DataIntegrityPanel } from './DataIntegrityPanel';

interface PlatformMasterControlProps {
  currentCompany: BrandingSettings | null;
  activeTab?: PowerAdminTab;
  onTabChange?: (tab: PowerAdminTab) => void;
  hideTopTabs?: boolean;
  onCompaniesLoaded?: (companies: OrganizationTenant[]) => void;
  onSuccess: () => void;
  showToast: (message: string, type?: 'success' | 'error') => void;
  showConfirm: (title: string, message: string, onConfirm: () => void) => void;
}

export function PlatformMasterControl({
  currentCompany,
  activeTab: propActiveTab,
  onTabChange,
  hideTopTabs = false,
  onCompaniesLoaded,
  onSuccess,
  showToast,
  showConfirm
}: PlatformMasterControlProps) {
  const [internalActiveTab, setInternalActiveTab] = useState<PowerAdminTab>('companies');
  const activeTab = propActiveTab || internalActiveTab;
  const setActiveTab = (tab: PowerAdminTab) => {
    setInternalActiveTab(tab);
    onTabChange?.(tab);
  };

  const [dashboard, setDashboard] = useState<PlatformSaaSDashboard | null>(null);
  const [companies, setCompanies] = useState<OrganizationTenant[]>([]);
  const [plans, setPlans] = useState<SaaSLicensePlan[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'active' | 'suspended' | 'trial'>('ALL');

  // Welcome Package Modal State
  const [selectedWelcomePackage, setSelectedWelcomePackage] = useState<ClientWelcomePackage | null>(null);
  const [isPackageModalOpen, setIsPackageModalOpen] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedFullPackage, setCopiedFullPackage] = useState(false);

  // License Renewal/Edit Modal State
  const [editingCompany, setEditingCompany] = useState<OrganizationTenant | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);

  // Admin Password Reset Modal State
  const [resetPasswordCompany, setResetPasswordCompany] = useState<OrganizationTenant | null>(null);
  const [newPasswordValue, setNewPasswordValue] = useState(() => generateTempPassword());
  const [isResetPasswordModalOpen, setIsResetPasswordModalOpen] = useState(false);
  const [resettingPassword, setResettingPassword] = useState(false);
  // Tenant Status Modal State
  const [statusModalCompany, setStatusModalCompany] = useState<OrganizationTenant | null>(null);
  const [isStatusModalOpen, setIsStatusModalOpen] = useState(false);

  const [editForm, setEditForm] = useState({
    name: '',
    code: '',
    licenseTier: 'Enterprise Edition',
    licenseExpiry: '',
    renewYears: 0,
    maxUsers: 25,
    maxEmployees: 2500,
    maxPasses: 5000,
    allowedDomains: '',
    status: 'active',
    statusReason: '',
    contactPhone: '',
    notes: ''
  });

  // New Company Provisioning Form
  const [provisioning, setProvisioning] = useState(false);
  const [provisionForm, setProvisionForm] = useState<LicenseProvisionPayload>({
    companyName: '',
    orgCode: '',
    primaryAdminEmail: '',
    primaryAdminName: 'Lead Super Admin',
    initialAdminPassword: generateTempPassword(),
    licenseTier: 'Enterprise Edition',
    licenseDurationYears: 1,
    maxUsers: 50,
    maxEmployees: 2500,
    maxPasses: 5000,
    allowedDomains: '',
    contactPhone: '',
    address: 'Doha, Qatar',
    primaryColor: '#800020',
    notes: 'Standard Corporate Enterprise License'
  });

  const fetchAllData = async () => {
    setLoading(true);
    try {
      const [dashRes, compRes, plansRes] = await Promise.all([
        apiFetch('/api/platform/dashboard').then(r => r.ok ? r.json() : null).catch(() => null),
        apiFetch('/api/platform/companies').then(r => r.ok ? r.json() : []).catch(() => []),
        apiFetch('/api/platform/plans').then(r => r.ok ? r.json() : []).catch(() => [])
      ]);

      if (dashRes) setDashboard(dashRes);
      if (Array.isArray(compRes)) {
        setCompanies(compRes);
        onCompaniesLoaded?.(compRes);
      }
      if (Array.isArray(plansRes)) setPlans(plansRes);
    } catch (err) {
      console.error('Failed to load platform SaaS data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAllData();
  }, []);

  // Handle Organization Code Auto-suggest
  const handleCompanyNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    const suggestedCode = val.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8).toUpperCase();
    setProvisionForm(prev => ({
      ...prev,
      companyName: val,
      orgCode: prev.orgCode === '' || prev.orgCode.startsWith(suggestedCode.slice(0, 3)) ? suggestedCode : prev.orgCode
    }));
  };

  // Handle Provisioning Submit
  const handleProvisionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!provisionForm.companyName.trim()) {
      showToast('Please enter the client company name', 'error');
      return;
    }
    if (!provisionForm.primaryAdminEmail.trim() || !provisionForm.primaryAdminEmail.includes('@')) {
      showToast('Please provide a valid primary administrator email', 'error');
      return;
    }

    setProvisioning(true);
    try {
      const payload = {
        ...provisionForm,
        primaryAdminPassword: provisionForm.initialAdminPassword || (provisionForm as any).primaryAdminPassword,
        initialAdminPassword: provisionForm.initialAdminPassword
      };
      const res = await apiFetch('/api/platform/companies/license', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to license company');
      }

      const result = await res.json();
      showToast(result.message || 'Company successfully licensed and provisioned!', 'success');
      
      // Open Welcome Package Modal
      if (result.welcomePackage) {
        setSelectedWelcomePackage(result.welcomePackage);
        setIsPackageModalOpen(true);
      }

      // Reset form & reload
      setProvisionForm({
        companyName: '',
        orgCode: '',
        primaryAdminEmail: '',
        primaryAdminName: 'Lead Super Admin',
        initialAdminPassword: generateTempPassword(),
        licenseTier: 'Enterprise Edition',
        licenseDurationYears: 1,
        maxUsers: 50,
        maxPasses: 5000,
        contactPhone: '',
        address: 'Doha, Qatar',
        primaryColor: '#800020',
        notes: ''
      });

      fetchAllData();
      setActiveTab('companies');
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setProvisioning(false);
    }
  };

  // Open Edit/Renew Modal
  const handleOpenEdit = (comp: OrganizationTenant) => {
    setEditingCompany(comp);
    setEditForm({
      name: comp.name || '',
      code: comp.code || '',
      licenseTier: comp.licenseTier || 'Enterprise Edition',
      licenseExpiry: comp.licenseExpiry ? comp.licenseExpiry.split('T')[0] : '',
      renewYears: 0,
      maxUsers: comp.maxUsers || 25,
      maxEmployees: comp.maxEmployees || 2500,
      maxPasses: comp.maxPasses || 5000,
      allowedDomains: comp.allowedDomains || '',
      status: comp.status || 'active',
      statusReason: comp.statusReason || '',
      contactPhone: comp.contactPhone || '',
      notes: comp.notes || ''
    });
    setIsEditModalOpen(true);
  };

  // Submit Edit/Renew
  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCompany) return;

    try {
      const res = await apiFetch(`/api/platform/companies/${editingCompany.id}/license`, {
        method: 'PUT',
        body: JSON.stringify(editForm)
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to update license');
      }

      const result = await res.json();
      showToast(result.message || 'License updated successfully', 'success');
      setIsEditModalOpen(false);
      setEditingCompany(null);
      fetchAllData();
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  // View Welcome Package
  const handleViewPackage = async (comp: OrganizationTenant) => {
    try {
      const res = await apiFetch(`/api/platform/companies/${comp.id}/package`);
      if (!res.ok) throw new Error('Failed to retrieve package');
      const pkg = await res.json();
      setSelectedWelcomePackage(pkg);
      setIsPackageModalOpen(true);
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  // Delete / De-provision Company
  const handleDeleteCompany = (comp: OrganizationTenant) => {
    showConfirm(
      `De-provision ${comp.name}`,
      `Are you sure you want to de-provision "${comp.name}"? This removes their license profile from the SaaS directory.`,
      async () => {
        try {
          const res = await apiFetch(`/api/platform/companies/${comp.id}`, {
            method: 'DELETE'
          });
          if (!res.ok) {
            const data = await res.json();
            throw new Error(data.error || 'Failed to delete company');
          }
          showToast(`Company ${comp.name} de-provisioned successfully`, 'success');
          fetchAllData();
        } catch (err: any) {
          showToast(err.message, 'error');
        }
      }
    );
  };

  // Activate / Switch Active Operating Organization Instance
  const handleActivateCompany = (comp: OrganizationTenant) => {
    showConfirm(
      `Set ${comp.name} as Active Instance`,
      `Are you sure you want to switch the portal's active operating instance to "${comp.name}" (${comp.code})? The application branding, login identity, title, and theme will update to this organization.`,
      async () => {
        try {
          const res = await apiFetch(`/api/platform/companies/${comp.id}/activate`, {
            method: 'POST'
          });
          if (!res.ok) {
            const data = await res.json();
            throw new Error(data.error || 'Failed to activate company');
          }
          const result = await res.json();
          showToast(result.message || `Active instance switched to ${comp.name}`, 'success');
          await fetchAllData();
          setTimeout(() => {
            window.location.reload();
          }, 800);
        } catch (err: any) {
          showToast(err.message, 'error');
        }
      }
    );
  };

  // Open Reset Admin Password Modal
  const handleOpenResetPassword = (comp: OrganizationTenant) => {
    setResetPasswordCompany(comp);
    setNewPasswordValue(generateTempPassword());
    setIsResetPasswordModalOpen(true);
  };

  // Submit Password Reset
  const handleResetPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetPasswordCompany) return;
    setResettingPassword(true);
    try {
      const res = await apiFetch(`/api/platform/companies/${resetPasswordCompany.id}/reset-password`, {
        method: 'POST',
        body: JSON.stringify({ newPassword: newPasswordValue })
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to reset password');
      }
      const data = await res.json();
      showToast(data.message || 'Password successfully updated!', 'success');
      setIsResetPasswordModalOpen(false);
      setResetPasswordCompany(null);
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setResettingPassword(false);
    }
  };

  // Export Full Platform Database Snapshot
  const handleDownloadSnapshot = async () => {
    try {
      showToast('Preparing platform database snapshot...', 'success');
      const res = await apiFetch('/api/platform/snapshot-export');
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to export platform snapshot');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `platform_snapshot_${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast('Platform snapshot downloaded successfully', 'success');
    } catch (err: any) {
      showToast(err.message || 'Snapshot download failed', 'error');
    }
  };

  // Filtered Companies
  const filteredCompanies = companies.filter(c => {
    const matchesSearch = 
      !searchTerm ||
      c.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.code?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.primaryAdminEmail?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.licenseTier?.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesStatus = statusFilter === 'ALL' || c.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="space-y-5">
      {/* Top Action & Summary Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-[#800020]/10 flex items-center justify-center text-[#800020] shrink-0">
            <Crown size={16} />
          </div>
          <p className="text-xs text-slate-600">
            <strong className="text-slate-900 font-semibold">Vendor Master Root:</strong> Manage multi-tenant organization provisioning, license quotas, and global database backups.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
          <button
            onClick={fetchAllData}
            disabled={loading}
            className="px-3 py-1.5 rounded-lg bg-white hover:bg-slate-50 text-slate-700 hover:text-slate-900 text-xs font-semibold flex items-center gap-1.5 transition-colors border border-slate-200 shadow-2xs cursor-pointer"
          >
            <RefreshCw size={13} className={cn(loading && "animate-spin text-[#800020]")} />
            <span>Refresh Metrics</span>
          </button>
          <button
            onClick={handleDownloadSnapshot}
            className="px-3 py-1.5 rounded-lg bg-[#800020] hover:bg-[#600018] text-white text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer shadow-2xs"
          >
            <Download size={13} />
            <span>Global DB Backup (.json)</span>
          </button>
        </div>
      </div>

      {/* 2. Top Executive Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-2xs">
          <div className="flex items-center justify-between text-slate-500 mb-1">
            <span className="text-xs font-bold uppercase tracking-wider">Licensed Companies</span>
            <Building2 size={16} className="text-[#800020]" />
          </div>
          <div className="text-2xl font-black text-slate-900">
            {dashboard?.totalLicensedCompanies || companies.length}
          </div>
          <div className="text-[11px] font-semibold text-emerald-600 mt-1 flex items-center gap-1">
            <CheckCircle2 size={12} />
            <span>{dashboard?.activeSubscriptions || companies.filter(c => c.status === 'active').length} Active Subscriptions</span>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-2xs">
          <div className="flex items-center justify-between text-slate-500 mb-1">
            <span className="text-xs font-bold uppercase tracking-wider">Total Managed Seats</span>
            <Users size={16} className="text-slate-700" />
          </div>
          <div className="text-2xl font-black text-slate-900">
            {dashboard?.totalManagedSeats || companies.reduce((acc, c) => acc + (c.maxUsers || 25), 0)}
          </div>
          <div className="text-[11px] font-medium text-slate-500 mt-1">
            Enterprise Client Allocations
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-2xs">
          <div className="flex items-center justify-between text-slate-500 mb-1">
            <span className="text-xs font-bold uppercase tracking-wider">Tier Distribution</span>
            <CreditCard size={16} className="text-[#800020]" />
          </div>
          <div className="flex items-center gap-1.5 mt-2 flex-wrap">
            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#800020]/10 text-[#800020] border border-[#800020]/20">
              Enterprise ({dashboard?.tierDistribution.enterprise || 0})
            </span>
            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-800 border border-slate-200">
              Pro ({dashboard?.tierDistribution.professional || 0})
            </span>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-2xs">
          <div className="flex items-center justify-between text-slate-500 mb-1">
            <span className="text-xs font-bold uppercase tracking-wider">Database & Platform</span>
            <Server size={16} className="text-emerald-600" />
          </div>
          <div className="text-sm font-bold text-slate-800 flex items-center gap-1.5 mt-1">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>Oracle Cloud Connected</span>
          </div>
          <div className="text-[11px] font-mono text-slate-500 mt-1">
            v4.5.2 · Latency ~12ms
          </div>
        </div>
      </div>

      {/* 3. Sub-Navigation Tabs (Shown only when top tabs not hidden by sidebar) */}
      {!hideTopTabs && (
        <div className="border-b border-slate-200 flex items-center gap-2 overflow-x-auto pb-1">
          <button
            onClick={() => setActiveTab('companies')}
            className={cn(
              "px-4 py-2 text-xs font-bold rounded-lg transition-all flex items-center gap-2 cursor-pointer",
              activeTab === 'companies'
                ? "bg-[#800020] text-white shadow-2xs"
                : "text-slate-600 hover:bg-slate-100"
            )}
          >
            <Building2 size={14} />
            <span>Licensed Companies ({companies.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('license-new')}
            className={cn(
              "px-4 py-2 text-xs font-bold rounded-lg transition-all flex items-center gap-2 cursor-pointer",
              activeTab === 'license-new'
                ? "bg-[#800020] text-white shadow-2xs"
                : "text-slate-600 hover:bg-slate-100"
            )}
          >
            <PlusCircle size={14} />
            <span>License New Company</span>
          </button>

          <button
            onClick={() => setActiveTab('plans')}
            className={cn(
              "px-4 py-2 text-xs font-bold rounded-lg transition-all flex items-center gap-2 cursor-pointer",
              activeTab === 'plans'
                ? "bg-[#800020] text-white shadow-2xs"
                : "text-slate-600 hover:bg-slate-100"
            )}
          >
            <CreditCard size={14} />
            <span>SaaS Subscription Plans</span>
          </button>

          <button
            onClick={() => setActiveTab('health')}
            className={cn(
              "px-4 py-2 text-xs font-bold rounded-lg transition-all flex items-center gap-2 cursor-pointer",
              activeTab === 'health'
                ? "bg-[#800020] text-white shadow-2xs"
                : "text-slate-600 hover:bg-slate-100"
            )}
          >
            <Server size={14} />
            <span>Platform Health & Global Backup</span>
          </button>

          <button
            onClick={() => setActiveTab('global-ports')}
            className={cn(
              "px-4 py-2 text-xs font-bold rounded-lg transition-all flex items-center gap-2 cursor-pointer",
              activeTab === 'global-ports'
                ? "bg-[#800020] text-white shadow-2xs"
                : "text-slate-600 hover:bg-slate-100"
            )}
          >
            <Globe size={14} />
            <span>Master Port Catalog</span>
          </button>

          <button
            onClick={() => setActiveTab('broadcast')}
            className={cn(
              "px-4 py-2 text-xs font-bold rounded-lg transition-all flex items-center gap-2 cursor-pointer",
              activeTab === 'broadcast'
                ? "bg-[#800020] text-white shadow-2xs"
                : "text-slate-600 hover:bg-slate-100"
            )}
          >
            <Radio size={14} />
            <span>Maintenance Broadcast</span>
          </button>
        </div>
      )}

      {/* 4. Tab Content */}

      {/* TAB 1: Licensed Companies Portfolio */}
      {activeTab === 'companies' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-3 rounded-xl border border-slate-200">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-2.5 text-slate-400" size={14} />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search by company name, code, tier, admin..."
                className="w-full pl-9 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold focus:bg-white focus:border-[#800020] outline-none"
              />
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-500">Status:</span>
              <select
                value={statusFilter}
                onChange={(e: any) => setStatusFilter(e.target.value)}
                className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold text-slate-700 outline-none"
              >
                <option value="ALL">All Statuses</option>
                <option value="active">Active Subscriptions</option>
                <option value="suspended">Suspended</option>
                <option value="trial">Trial</option>
              </select>

              <button
                onClick={() => setActiveTab('license-new')}
                className="px-3 py-1.5 bg-[#800020] hover:bg-[#600018] text-white text-xs font-bold rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
              >
                <PlusCircle size={13} />
                <span>Add Company</span>
              </button>
            </div>
          </div>

          {/* Companies Table */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-500 font-bold uppercase tracking-wider text-[10px]">
                    <th className="py-3 px-4">Company / Organization</th>
                    <th className="py-3 px-4">Subscription Tier</th>
                    <th className="py-3 px-4">License Status & Expiry</th>
                    <th className="py-3 px-4">Primary Super Admin</th>
                    <th className="py-3 px-4">Quotas</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredCompanies.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-slate-400">
                        <Building2 size={28} className="mx-auto mb-2 opacity-40 text-slate-400" />
                        <p className="font-semibold text-xs">No licensed companies found matching criteria.</p>
                      </td>
                    </tr>
                  ) : (
                    filteredCompanies.map((comp) => {
                      const isExpired = comp.licenseExpiry && new Date(comp.licenseExpiry) < new Date();
                      return (
                        <tr key={comp.id} className="hover:bg-slate-50/60 transition-colors">
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2.5">
                              <div 
                                className="w-8 h-8 rounded-lg flex items-center justify-center font-black text-white text-xs shadow-2xs shrink-0"
                                style={{ backgroundColor: comp.primaryColor || '#800020' }}
                              >
                                {comp.name?.charAt(0).toUpperCase() || 'C'}
                              </div>
                              <div>
                                <div className="font-bold text-slate-900 flex items-center gap-1.5">
                                  <span>{comp.name}</span>
                                  {comp.isCurrent && (
                                    <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-slate-100 text-slate-700 border border-slate-200">
                                      Active Instance
                                    </span>
                                  )}
                                </div>
                                <div className="text-[11px] font-mono text-slate-400">
                                  Code: <span className="text-slate-600 font-semibold">{comp.code || 'N/A'}</span>
                                </div>
                              </div>
                            </div>
                          </td>

                          <td className="py-3 px-4">
                            <span className={cn(
                              "px-2.5 py-1 rounded-md font-bold text-[11px] inline-block border",
                              comp.licenseTier?.includes('Enterprise')
                                ? "bg-[#800020]/10 text-[#800020] border-[#800020]/20"
                                : comp.licenseTier?.includes('Government')
                                ? "bg-purple-50 text-purple-900 border-purple-200"
                                : comp.licenseTier?.includes('Pro')
                                ? "bg-blue-50 text-blue-900 border-blue-200"
                                : "bg-slate-100 text-slate-800 border-slate-200"
                            )}>
                              {comp.licenseTier || 'Enterprise Edition'}
                            </span>
                          </td>

                          <td className="py-3 px-4">
                            <div className="space-y-0.5">
                              <div className="flex items-center gap-1.5">
                                <span className={cn(
                                  "w-2 h-2 rounded-full shrink-0",
                                  comp.status === 'suspended' 
                                    ? "bg-rose-500" 
                                    : comp.status === 'read_only'
                                    ? "bg-blue-500"
                                    : comp.status === 'terminated'
                                    ? "bg-slate-700"
                                    : (isExpired ? "bg-amber-500" : "bg-emerald-500")
                                )} />
                                <span className={cn(
                                  "font-bold uppercase text-[10px]",
                                  comp.status === 'suspended' ? "text-rose-700" :
                                  comp.status === 'read_only' ? "text-blue-700" :
                                  comp.status === 'terminated' ? "text-slate-600" : "text-emerald-700"
                                )}>
                                  {comp.status === 'read_only' ? 'Read-Only' : (comp.status || 'Active')}
                                </span>
                              </div>
                              <div className="text-[10px] text-slate-500 font-medium">
                                {comp.licenseExpiry ? `Expires: ${comp.licenseExpiry.split('T')[0]}` : 'Lifetime Subscription'}
                              </div>
                              {comp.statusReason && (
                                <div className="text-[10px] text-slate-400 italic line-clamp-1" title={comp.statusReason}>
                                  "{comp.statusReason}"
                                </div>
                              )}
                            </div>
                          </td>

                          <td className="py-3 px-4">
                            <div className="space-y-0.5">
                              <div className="font-semibold text-slate-800 flex items-center gap-1">
                                <Mail size={11} className="text-slate-400" />
                                <span>{comp.primaryAdminEmail || comp.contactEmail || 'admin@client.com'}</span>
                              </div>
                              {comp.contactPhone && (
                                <div className="text-[10px] text-slate-500 flex items-center gap-1">
                                  <Phone size={10} className="text-slate-400" />
                                  <span>{comp.contactPhone}</span>
                                </div>
                              )}
                            </div>
                          </td>

                          <td className="py-3 px-4">
                            <div className="text-[11px] font-semibold text-slate-700 space-y-0.5">
                              <div>{comp.maxUsers || 25} Seats · {comp.maxEmployees || 2500} Emps</div>
                              <div className="text-slate-400 text-[10px]">{comp.maxPasses || 5000} Passes</div>
                              {comp.allowedDomains ? (
                                <div className="text-[9px] font-mono text-[#800020] bg-rose-50 px-1 py-0.2 rounded inline-block" title={`Restricted to: ${comp.allowedDomains}`}>
                                  Domain: {comp.allowedDomains}
                                </div>
                              ) : (
                                <div className="text-[10px] text-slate-400">Any domain</div>
                              )}
                            </div>
                          </td>

                          <td className="py-3 px-4 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              {/* Activate as Current Instance Button (if not already current) */}
                              {!comp.isCurrent && (
                                <button
                                  onClick={() => handleActivateCompany(comp)}
                                  className="px-2 py-1 bg-emerald-50 hover:bg-emerald-600 hover:text-white text-emerald-700 border border-emerald-200 rounded-lg font-bold text-[10px] flex items-center gap-1 transition-all cursor-pointer shadow-2xs"
                                  title="Activate this organization as the operating portal instance"
                                >
                                  <CheckCircle2 size={11} />
                                  <span>Activate</span>
                                </button>
                              )}

                              {/* View Welcome / Credentials Package */}
                              <button
                                onClick={() => handleViewPackage(comp)}
                                className="px-2.5 py-1.5 bg-slate-100 hover:bg-[#800020] hover:text-white text-slate-700 rounded-lg font-bold text-xs flex items-center gap-1 transition-all cursor-pointer shadow-2xs"
                                title="View Delivery Credentials & License Package"
                              >
                                <FileText size={12} />
                                <span>Package</span>
                              </button>

                              {/* Status & Access Engine Button */}
                              <button
                                onClick={() => {
                                  setStatusModalCompany(comp);
                                  setIsStatusModalOpen(true);
                                }}
                                className="p-1.5 text-slate-600 hover:text-[#800020] hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                                title="Change Status / Suspend Organization"
                              >
                                <ShieldAlert size={14} />
                              </button>

                              {/* Reset Super Admin Password */}
                              <button
                                onClick={() => handleOpenResetPassword(comp)}
                                className="p-1.5 text-amber-600 hover:bg-amber-50 rounded-lg transition-colors cursor-pointer"
                                title="Reset or Set Super Admin Password"
                              >
                                <Key size={14} />
                              </button>

                              {/* Manage & Renew License */}
                              <button
                                onClick={() => handleOpenEdit(comp)}
                                className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer"
                                title="Renew or Edit License"
                              >
                                <Edit size={14} />
                              </button>

                              {/* Delete Organization (except default active profile) */}
                              {!comp.isCurrent && (
                                <button
                                  onClick={() => handleDeleteCompany(comp)}
                                  className="p-1.5 text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                                  title="De-provision Company"
                                >
                                  <Trash2 size={14} />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: License New Company (Provisioning) */}
      {activeTab === 'license-new' && (
        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-2xs max-w-4xl space-y-6">
          <div>
            <div className="flex items-center gap-2">
              <Building2 className="text-[#800020]" size={20} />
              <h2 className="text-base font-black text-slate-900">
                License & Provision New Client Company
              </h2>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Issue a corporate license, allocate enterprise user seats, and generate the client delivery credentials package.
            </p>
          </div>

          <form onSubmit={handleProvisionSubmit} className="space-y-6">
            {/* Step 1: Company Profile */}
            <div className="space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <span className="w-4 h-4 rounded-full bg-slate-200 text-slate-700 text-[10px] font-black flex items-center justify-center">1</span>
                <span>Client Organization Profile</span>
              </h3>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700">Company Legal Name *</label>
                  <input
                    type="text"
                    required
                    value={provisionForm.companyName}
                    onChange={handleCompanyNameChange}
                    placeholder="e.g. Al-Mana Engineering & Contracting"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold focus:bg-white focus:border-[#800020] outline-none"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700">Unique Organization Code (Max 8 Chars) *</label>
                  <input
                    type="text"
                    required
                    maxLength={8}
                    value={provisionForm.orgCode}
                    onChange={(e) => setProvisionForm({ ...provisionForm, orgCode: e.target.value.toUpperCase() })}
                    placeholder="e.g. ALMANA"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono font-bold focus:bg-white focus:border-[#800020] outline-none"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700">Headquarters Address</label>
                  <input
                    type="text"
                    value={provisionForm.address || ''}
                    onChange={(e) => setProvisionForm({ ...provisionForm, address: e.target.value })}
                    placeholder="Doha, Qatar"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold focus:bg-white focus:border-[#800020] outline-none"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700">Client Contact Phone</label>
                  <input
                    type="text"
                    value={provisionForm.contactPhone || ''}
                    onChange={(e) => setProvisionForm({ ...provisionForm, contactPhone: e.target.value })}
                    placeholder="+974 4400 0000"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold focus:bg-white focus:border-[#800020] outline-none"
                  />
                </div>
              </div>
            </div>

            {/* Step 2: Primary Client Super Admin */}
            <div className="space-y-3 pt-3 border-t border-slate-100">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <span className="w-4 h-4 rounded-full bg-slate-200 text-slate-700 text-[10px] font-black flex items-center justify-center">2</span>
                <span>Client Super Administrator Credentials</span>
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700">Admin Email Address *</label>
                  <input
                    type="email"
                    required
                    value={provisionForm.primaryAdminEmail}
                    onChange={(e) => setProvisionForm({ ...provisionForm, primaryAdminEmail: e.target.value })}
                    placeholder="admin@almana.com"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold focus:bg-white focus:border-[#800020] outline-none"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700">Admin Full Name</label>
                  <input
                    type="text"
                    value={provisionForm.primaryAdminName || ''}
                    onChange={(e) => setProvisionForm({ ...provisionForm, primaryAdminName: e.target.value })}
                    placeholder="Lead Security Administrator"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold focus:bg-white focus:border-[#800020] outline-none"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700">Initial Setup Password *</label>
                  <input
                    type="text"
                    required
                    value={provisionForm.initialAdminPassword}
                    onChange={(e) => setProvisionForm({ ...provisionForm, initialAdminPassword: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono font-semibold focus:bg-white focus:border-[#800020] outline-none"
                  />
                </div>
              </div>
            </div>

            {/* Step 3: Subscription Tier & Quotas */}
            <div className="space-y-3 pt-3 border-t border-slate-100">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <span className="w-4 h-4 rounded-full bg-slate-200 text-slate-700 text-[10px] font-black flex items-center justify-center">3</span>
                <span>Commercial SaaS Tier & Subscription Period</span>
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                {[
                  { id: 'Starter Edition', name: 'Starter', price: '$1,800/yr', users: 5, passes: 500, color: 'border-slate-300' },
                  { id: 'Professional Edition', name: 'Professional', price: '$4,500/yr', users: 25, passes: 2500, color: 'border-blue-300' },
                  { id: 'Enterprise Edition', name: 'Enterprise', price: '$9,800/yr', users: 50, passes: 10000, recommended: true, color: 'border-[#800020]' },
                  { id: 'Government Edition', name: 'Government', price: '$18,500/yr', users: 200, passes: 50000, color: 'border-purple-400' }
                ].map(tier => {
                  const isSelected = provisionForm.licenseTier === tier.id;
                  return (
                    <div
                      key={tier.id}
                      onClick={() => setProvisionForm({
                        ...provisionForm,
                        licenseTier: tier.id,
                        maxUsers: tier.users,
                        maxPasses: tier.passes
                      })}
                      className={cn(
                        "p-3 rounded-xl border-2 cursor-pointer transition-all flex flex-col justify-between relative",
                        isSelected 
                          ? "border-[#800020] bg-rose-50/40 shadow-xs" 
                          : "border-slate-200 bg-white hover:border-slate-300"
                      )}
                    >
                      {tier.recommended && (
                        <span className="absolute -top-2.5 right-2 px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-wider bg-[#800020] text-white shadow-2xs">
                          Popular
                        </span>
                      )}
                      <div>
                        <div className="font-black text-slate-900 text-xs">{tier.name}</div>
                        <div className="text-[11px] font-bold text-slate-500 mt-0.5">{tier.price}</div>
                      </div>
                      <div className="mt-2 text-[10px] font-semibold text-slate-600 space-y-0.5">
                        <div>{tier.users} Admin/User Seats</div>
                        <div>{tier.passes.toLocaleString()} Gate Passes</div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-3">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700">Subscription Duration</label>
                  <select
                    value={provisionForm.licenseDurationYears}
                    onChange={(e) => setProvisionForm({ ...provisionForm, licenseDurationYears: Number(e.target.value) })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold focus:bg-white focus:border-[#800020] outline-none"
                  >
                    <option value={1}>1 Year (Annual Subscription)</option>
                    <option value={2}>2 Years (Bi-Annual)</option>
                    <option value={3}>3 Years (Long-Term Corporate)</option>
                    <option value={5}>5 Years (Multi-Year Contract)</option>
                    <option value={99}>Lifetime Commercial License</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700">User Seats Limit</label>
                  <input
                    type="number"
                    value={provisionForm.maxUsers}
                    onChange={(e) => setProvisionForm({ ...provisionForm, maxUsers: Number(e.target.value) })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold focus:bg-white focus:border-[#800020] outline-none"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700">Max Employee Roster</label>
                  <input
                    type="number"
                    value={provisionForm.maxEmployees || 2500}
                    onChange={(e) => setProvisionForm({ ...provisionForm, maxEmployees: Number(e.target.value) })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold focus:bg-white focus:border-[#800020] outline-none"
                    placeholder="e.g. 2500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700">Gate Pass Quota</label>
                  <input
                    type="number"
                    value={provisionForm.maxPasses}
                    onChange={(e) => setProvisionForm({ ...provisionForm, maxPasses: Number(e.target.value) })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold focus:bg-white focus:border-[#800020] outline-none"
                  />
                </div>

                <div className="space-y-1 sm:col-span-3">
                  <label className="text-xs font-bold text-slate-700">Corporate Domain Whitelist (Optional)</label>
                  <input
                    type="text"
                    value={provisionForm.allowedDomains || ''}
                    onChange={(e) => setProvisionForm({ ...provisionForm, allowedDomains: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold focus:bg-white focus:border-[#800020] outline-none"
                    placeholder="e.g. @company.com, @subsidiary.com (Comma-separated; empty allows any domain)"
                  />
                  <p className="text-[10px] text-slate-400">
                    Restricts personnel added to this tenant to specific official corporate email domains.
                  </p>
                </div>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setActiveTab('companies')}
                className="px-4 py-2 rounded-lg text-xs font-bold text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
              >
                Cancel
              </button>

              <button
                type="submit"
                disabled={provisioning}
                className="px-5 py-2.5 bg-[#800020] hover:bg-[#600018] text-white text-xs font-bold rounded-lg flex items-center gap-2 transition-all cursor-pointer shadow-xs"
              >
                {provisioning ? (
                  <>
                    <RefreshCw size={14} className="animate-spin" />
                    <span>Provisioning Company Workspace...</span>
                  </>
                ) : (
                  <>
                    <Crown size={14} className="text-amber-400" />
                    <span>Issue License & Provision Company</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* TAB 3: SaaS Subscription Plans */}
      {activeTab === 'plans' && (
        <div className="space-y-6">
          <div>
            <h2 className="text-base font-black text-slate-900">Commercial SaaS Plans & Pricing Tiers</h2>
            <p className="text-xs text-slate-500 mt-0.5">Standard licensing packages available for enterprise clients.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {plans.map((plan) => {
              const displayUsers = plan.maxUsers ?? plan.defaultMaxUsers ?? 'Unlimited';
              const rawPasses = plan.maxPasses ?? plan.defaultMaxPasses;
              const formattedPasses = typeof rawPasses === 'number' 
                ? rawPasses.toLocaleString() 
                : (typeof plan.defaultMaxPasses === 'number' 
                    ? plan.defaultMaxPasses.toLocaleString() 
                    : (rawPasses || 'Unlimited'));
              const priceDisplay = plan.price || plan.pricePerYear || 'Custom';
              const billingPeriodDisplay = plan.billingPeriod || (plan.pricePerYear?.includes('/ yr') ? '/ year' : '');

              return (
                <div 
                  key={plan.id}
                  className={cn(
                    "bg-white rounded-xl border p-5 flex flex-col justify-between shadow-2xs relative",
                    plan.recommended ? "border-[#800020] ring-1 ring-[#800020]" : "border-slate-200"
                  )}
                >
                  {plan.recommended && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-2.5 py-0.5 bg-[#800020] text-white text-[9px] font-black uppercase tracking-wider rounded-full shadow-xs">
                      Recommended Edition
                    </div>
                  )}
                  <div>
                    <div className="font-black text-slate-900 text-sm">{plan.name}</div>
                    <div className="mt-2 flex items-baseline gap-1">
                      <span className="text-2xl font-black text-slate-900">{priceDisplay}</span>
                      {billingPeriodDisplay && (
                        <span className="text-xs text-slate-500 font-semibold">{billingPeriodDisplay}</span>
                      )}
                    </div>

                    <div className="mt-4 pt-3 border-t border-slate-100 space-y-1.5 text-xs text-slate-600 font-medium">
                      <div className="flex items-center gap-2">
                        <Users size={13} className="text-slate-400" />
                        <span>{displayUsers} Enterprise User Seats</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <ShieldCheck size={13} className="text-slate-400" />
                        <span>{formattedPasses} Gate Passes / yr</span>
                      </div>
                    </div>

                    <div className="mt-4 space-y-2">
                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Features Included:</div>
                      {plan.features.map((feat, idx) => (
                        <div key={idx} className="flex items-start gap-2 text-xs text-slate-700">
                          <Check size={13} className="text-emerald-600 shrink-0 mt-0.5" />
                          <span>{feat}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="mt-6 pt-4 border-t border-slate-100">
                    <button
                      onClick={() => {
                        setProvisionForm(prev => ({
                          ...prev,
                          licenseTier: plan.name,
                          maxUsers: typeof plan.maxUsers === 'number' ? plan.maxUsers : (typeof plan.defaultMaxUsers === 'number' ? plan.defaultMaxUsers : 50),
                          maxPasses: typeof plan.maxPasses === 'number' ? plan.maxPasses : (typeof plan.defaultMaxPasses === 'number' ? plan.defaultMaxPasses : 10000)
                        }));
                        setActiveTab('license-new');
                      }}
                      className={cn(
                        "w-full py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer",
                        plan.recommended 
                          ? "bg-[#800020] text-white hover:bg-[#600018]" 
                          : "bg-slate-100 text-slate-800 hover:bg-slate-200"
                      )}
                    >
                      <span>License Client on this Plan</span>
                      <ArrowRight size={13} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 4: Platform Health & Global Backup */}
      {activeTab === 'health' && (
        <div className="space-y-5 max-w-4xl">
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-2xs space-y-4">
            <div>
              <h2 className="text-base font-black text-slate-900">Platform Health & Oracle Database Telemetry</h2>
              <p className="text-xs text-slate-500 mt-0.5">Diagnostic information for global SaaS multi-tenant infrastructure.</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-1">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Engine Runtime</span>
                <p className="font-bold text-slate-800">Node.js TypeScript Server + Vite SPA</p>
                <p className="text-slate-500 font-mono text-[11px]">Version: v4.5.2 SaaS Enterprise Engine</p>
              </div>

              <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-1">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Database Status</span>
                <p className="font-bold text-emerald-600 flex items-center gap-1.5">
                  <CheckCircle2 size={13} />
                  <span>Oracle Autonomous Cloud Online</span>
                </p>
                <p className="text-slate-500 font-mono text-[11px]">Migrations: 100% Up to Date</p>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
              <div>
                <h4 className="text-xs font-bold text-slate-800">Full Global Database Snapshot Backup</h4>
                <p className="text-[11px] text-slate-500">Download a complete single JSON archive containing all organizations, passes, users, and audit logs.</p>
              </div>

              <button
                onClick={handleDownloadSnapshot}
                className="px-4 py-2 bg-[#800020] hover:bg-[#600018] text-white rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer shadow-2xs"
              >
                <Download size={13} />
                <span>Export Platform Snapshot (.json)</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Data integrity: dangling references, case repair, database-enforced links */}
      {activeTab === 'integrity' && (
        <DataIntegrityPanel showToast={showToast} showConfirm={showConfirm} />
      )}

      {/* TAB 5: Master Port Catalog */}
      {activeTab === 'global-ports' && (
        <GlobalMasterPortCatalog showToast={showToast} showConfirm={showConfirm} />
      )}

      {/* TAB 6: System Maintenance Broadcast */}
      {activeTab === 'broadcast' && (
        <MaintenanceBroadcastAdmin showToast={showToast} onSuccess={fetchAllData} />
      )}

      {/* MODAL 1: Client Welcome Package & Delivery Credentials */}
      {isPackageModalOpen && selectedWelcomePackage && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 max-w-2xl w-full shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="bg-white text-slate-900 p-5 flex items-center justify-between border-b border-slate-200">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-[#800020]/10 border border-[#800020]/20 flex items-center justify-center text-[#800020] shadow-2xs">
                  <Crown size={17} />
                </div>
                <div>
                  <h3 className="font-black text-sm text-slate-900">Client Onboarding & Delivery Package</h3>
                  <p className="text-[11px] text-slate-500">Official AccessOne Enterprise License Certificate</p>
                </div>
              </div>
              <button
                onClick={() => setIsPackageModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 p-1.5 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-5 max-h-[80vh] overflow-y-auto">
              <div className="bg-[#800020]/5 border border-[#800020]/20 rounded-xl p-4 flex items-start gap-3">
                <CheckCircle2 className="text-[#800020] shrink-0 mt-0.5" size={18} />
                <div className="text-xs">
                  <h4 className="font-bold text-slate-900">Workspace Ready for Client Handover</h4>
                  <p className="text-slate-600 mt-0.5">
                    Copy and provide these credentials and license key to <strong>{selectedWelcomePackage.companyName}</strong>.
                  </p>
                </div>
              </div>

              {/* Package Details Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                  <span className="text-[10px] font-bold text-slate-400 uppercase">Licensed Company</span>
                  <div className="font-black text-slate-900 text-sm mt-0.5">{selectedWelcomePackage.companyName}</div>
                  <div className="text-[10px] text-slate-500 font-mono">Code: {selectedWelcomePackage.orgCode}</div>
                </div>

                <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                  <span className="text-[10px] font-bold text-slate-400 uppercase">Subscription Tier</span>
                  <div className="font-bold text-[#800020] mt-0.5">{selectedWelcomePackage.licenseTier}</div>
                  <div className="text-[10px] text-slate-500">Expiry: {selectedWelcomePackage.licenseExpiry ? selectedWelcomePackage.licenseExpiry.split('T')[0] : 'Lifetime'}</div>
                </div>

                <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 sm:col-span-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-slate-400 uppercase">Commercial License Key</span>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(selectedWelcomePackage.licenseKey);
                        setCopiedKey(true);
                        setTimeout(() => setCopiedKey(false), 2000);
                      }}
                      className="text-[11px] font-bold text-[#800020] hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      {copiedKey ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />}
                      <span>{copiedKey ? 'Copied Key!' : 'Copy Key'}</span>
                    </button>
                  </div>
                  <div className="font-mono font-bold text-slate-900 text-xs bg-white px-2.5 py-1.5 rounded border border-slate-200 mt-1 select-all">
                    {selectedWelcomePackage.licenseKey}
                  </div>
                </div>

                <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 sm:col-span-2">
                  <span className="text-[10px] font-bold text-slate-400 uppercase">Client Super Admin Credentials</span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-1">
                    <div className="bg-white p-2 rounded border border-slate-200">
                      <span className="text-[10px] text-slate-400 block font-semibold">Login Email:</span>
                      <span className="font-mono font-bold text-slate-800 text-xs">{selectedWelcomePackage.primaryAdminEmail}</span>
                    </div>
                    <div className="bg-white p-2 rounded border border-slate-200">
                      <span className="text-[10px] text-slate-400 block font-semibold">Default Password:</span>
                      <span className="font-mono font-bold text-slate-800 text-xs">{selectedWelcomePackage.primaryAdminPassword}</span>
                    </div>
                  </div>
                </div>

                <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                  <span className="text-[10px] font-bold text-slate-400 uppercase">Allocated User Seats</span>
                  <div className="font-bold text-slate-800 mt-0.5">{selectedWelcomePackage.seatQuota}</div>
                </div>

                <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                  <span className="text-[10px] font-bold text-slate-400 uppercase">Allocated Pass Quota</span>
                  <div className="font-bold text-slate-800 mt-0.5">{selectedWelcomePackage.passQuota}</div>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setIsPackageModalOpen(false)}
                className="px-4 py-2 rounded-lg text-xs font-bold text-slate-600 hover:bg-slate-200 transition-colors cursor-pointer"
              >
                Close
              </button>

              <button
                type="button"
                onClick={() => {
                  const deliveryText = `=====================================================
ACCESSONE ENTERPRISE - CLIENT DELIVERY & LICENSE PACKAGE
=====================================================
Company Name: ${selectedWelcomePackage.companyName}
Organization Code: ${selectedWelcomePackage.orgCode}
Subscription Tier: ${selectedWelcomePackage.licenseTier}
License Key: ${selectedWelcomePackage.licenseKey}
Subscription Expiry: ${selectedWelcomePackage.licenseExpiry || 'Commercial Lifetime'}

--- SUPER ADMIN ACCESS CREDENTIALS ---
Portal URL: ${window.location.origin}
Login Email: ${selectedWelcomePackage.primaryAdminEmail}
Initial Password: ${selectedWelcomePackage.primaryAdminPassword}

--- QUOTAS & SLA ---
Allocated Seats: ${selectedWelcomePackage.seatQuota}
Pass Limit: ${selectedWelcomePackage.passQuota}
Issued By: ${selectedWelcomePackage.vendor || '-'}
Support: ${selectedWelcomePackage.supportContact || '-'}
=====================================================`;
                  navigator.clipboard.writeText(deliveryText);
                  setCopiedFullPackage(true);
                  setTimeout(() => setCopiedFullPackage(false), 2000);
                  showToast('Complete Client Delivery Package copied to clipboard!', 'success');
                }}
                className="px-4 py-2 bg-[#800020] hover:bg-[#600018] text-white rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
              >
                {copiedFullPackage ? <Check size={13} /> : <Copy size={13} />}
                <span>{copiedFullPackage ? 'Package Copied!' : 'Copy Full Delivery Package'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: Edit & Renew License */}
      {isEditModalOpen && editingCompany && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 max-w-lg w-full shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="bg-white text-slate-900 p-4 flex items-center justify-between border-b border-slate-200">
              <div>
                <h3 className="font-bold text-sm text-slate-900">Manage & Renew License</h3>
                <p className="text-[11px] text-slate-500">{editingCompany.name}</p>
              </div>
              <button
                onClick={() => setIsEditModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 p-1.5 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleEditSubmit} className="p-5 space-y-4 text-xs">
              <div className="space-y-1">
                <label className="font-bold text-slate-700">Subscription Tier</label>
                <select
                  value={editForm.licenseTier}
                  onChange={(e) => setEditForm({ ...editForm, licenseTier: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg font-semibold"
                >
                  <option value="Starter Edition">Starter Edition (5 Seats)</option>
                  <option value="Professional Edition">Professional Edition (25 Seats)</option>
                  <option value="Enterprise Edition">Enterprise Edition (50 Seats)</option>
                  <option value="Government Edition">Government Edition (200 Seats)</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-700">Subscription Status</label>
                <select
                  value={editForm.status}
                  onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg font-semibold"
                >
                  <option value="active">Active (Normal Operational Access)</option>
                  <option value="read_only">Read-Only (Lock Creation & Edits)</option>
                  <option value="suspended">Suspended (Block Logins & Access)</option>
                  <option value="terminated">Terminated (Decommissioned)</option>
                  <option value="trial">Trial Period</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-700">Status Change Note / Audit Reason</label>
                <input
                  type="text"
                  value={editForm.statusReason}
                  onChange={(e) => setEditForm({ ...editForm, statusReason: e.target.value })}
                  placeholder="e.g. Pending contract renewal, invoice overdue..."
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg font-semibold"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">Extend / Renew</label>
                  <select
                    value={editForm.renewYears}
                    onChange={(e) => setEditForm({ ...editForm, renewYears: Number(e.target.value) })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg font-semibold"
                  >
                    <option value={0}>No Extension</option>
                    <option value={1}>+1 Year Renewal</option>
                    <option value={2}>+2 Years Renewal</option>
                    <option value={3}>+3 Years Renewal</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="font-bold text-slate-700">Explicit Expiry Date</label>
                  <input
                    type="date"
                    value={editForm.licenseExpiry}
                    onChange={(e) => setEditForm({ ...editForm, licenseExpiry: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg font-semibold"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">User Seats Limit</label>
                  <input
                    type="number"
                    value={editForm.maxUsers}
                    onChange={(e) => setEditForm({ ...editForm, maxUsers: Number(e.target.value) })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg font-semibold"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-bold text-slate-700">Gate Pass Quota</label>
                  <input
                    type="number"
                    value={editForm.maxPasses}
                    onChange={(e) => setEditForm({ ...editForm, maxPasses: Number(e.target.value) })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg font-semibold"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-bold text-slate-700">Max Employee Roster</label>
                  <input
                    type="number"
                    value={editForm.maxEmployees}
                    onChange={(e) => setEditForm({ ...editForm, maxEmployees: Number(e.target.value) })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg font-semibold"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-bold text-slate-700">Corporate Domain Whitelist</label>
                  <input
                    type="text"
                    value={editForm.allowedDomains}
                    onChange={(e) => setEditForm({ ...editForm, allowedDomains: e.target.value })}
                    placeholder="e.g. @company.com"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg font-semibold"
                  />
                </div>
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setIsEditModalOpen(false)}
                  className="px-4 py-2 rounded-lg text-slate-600 hover:bg-slate-100 font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-[#800020] text-white rounded-lg font-bold hover:bg-[#600018]"
                >
                  Save License Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: Reset Super Admin Password */}
      {isResetPasswordModalOpen && resetPasswordCompany && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 max-w-md w-full shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="bg-white text-slate-900 p-4 flex items-center justify-between border-b border-slate-200">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-amber-50 text-amber-700 flex items-center justify-center">
                  <Key size={14} />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-slate-900">Reset Super Admin Password</h3>
                  <p className="text-[11px] text-slate-500">{resetPasswordCompany.name} ({resetPasswordCompany.code})</p>
                </div>
              </div>
              <button
                onClick={() => setIsResetPasswordModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 p-1.5 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleResetPasswordSubmit} className="p-5 space-y-4 text-xs">
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-1">
                <div className="text-[11px] font-bold text-slate-700">Administrator Account:</div>
                <div className="text-xs font-mono text-slate-900 font-semibold">{resetPasswordCompany.primaryAdminEmail || resetPasswordCompany.contactEmail}</div>
                <div className="text-[10px] text-slate-500">Target Role: Super Admin / Organization Administrator</div>
              </div>

              <div className="space-y-1.5">
                <label className="font-bold text-slate-700">New Password *</label>
                <input
                  type="text"
                  required
                  value={newPasswordValue}
                  onChange={(e) => setNewPasswordValue(e.target.value)}
                  placeholder="Enter new password (min 8 characters)"
                  className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg font-mono font-medium focus:outline-hidden focus:ring-2 focus:ring-[#800020]/20 focus:border-[#800020]"
                />
                <p className="text-[10px] text-slate-400">A random password is pre-filled; share it securely with the admin.</p>
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setIsResetPasswordModalOpen(false)}
                  className="px-4 py-2 rounded-lg text-slate-600 hover:bg-slate-100 font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={resettingPassword}
                  className="px-4 py-2 bg-[#800020] text-white rounded-lg font-bold hover:bg-[#600018] flex items-center gap-1.5 disabled:opacity-50"
                >
                  {resettingPassword ? (
                    <>
                      <RefreshCw size={13} className="animate-spin" />
                      <span>Updating...</span>
                    </>
                  ) : (
                    <>
                      <Key size={13} />
                      <span>Update Password</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 4: Tenant Status & Suspension Engine */}
      {isStatusModalOpen && statusModalCompany && (
        <TenantStatusModal
          company={statusModalCompany}
          isOpen={isStatusModalOpen}
          onClose={() => {
            setIsStatusModalOpen(false);
            setStatusModalCompany(null);
          }}
          onSuccess={() => {
            setIsStatusModalOpen(false);
            setStatusModalCompany(null);
            fetchAllData();
          }}
          showToast={showToast}
        />
      )}
    </div>
  );
}
