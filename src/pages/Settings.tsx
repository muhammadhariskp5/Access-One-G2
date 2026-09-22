import React, { useState, useEffect, useMemo } from 'react';
import { motion } from 'motion/react';
import { 
  User, 
  Building2, 
  Shield, 
  Settings2, 
  Trash2, 
  Edit2, 
  CheckCircle2, 
  XCircle, 
  Key, 
  Layers, 
  Briefcase, 
  Folder, 
  Sliders, 
  Eye, 
  UserPlus, 
  Filter, 
  Mail, 
  Phone,
  ArrowUpDown,
  UserCheck
} from 'lucide-react';
import { UserProfile, BrandingSettings, Division, Project, Department, isPowerAdmin } from '../types';
import { apiFetch, cn } from '../lib/utils';
import { ProfileForm } from '../components/settings/ProfileForm';
import { StructureManager } from '../components/settings/StructureManager';
import { UserSettingsModal } from '../components/settings/UserSettingsModal';
import { UserCreateModal } from '../components/settings/UserCreateModal';
import { ViewOptionsSettings } from '../components/settings/ViewOptionsSettings';
import { SuperAdminUserReports } from '../components/settings/SuperAdminUserReports';
import { Radio } from 'lucide-react';

interface SettingsProps {
  currentUser: UserProfile | null;
  allUsers: UserProfile[];
  company: BrandingSettings | null;
  divisions: Division[];
  projects: Project[];
  departments: Department[];
  onSuccess: () => void;
  globalSearch?: string;
  showToast: (msg: string, type?: 'success' | 'error') => void;
  showConfirm: (title: string, message: string, onConfirm: () => void) => void;
}

export function Settings({ 
  currentUser, 
  allUsers, 
  company, 
  divisions,
  projects,
  departments,
  onSuccess, 
  globalSearch = '',
  showToast,
  showConfirm
}: SettingsProps) {
  // Check URL query param for default tab (e.g. /settings?tab=users or /settings?tab=user-reports)
  const initialTab = () => {
    try {
      const param = new URLSearchParams(window.location.search).get('tab');
      if (param && ['profile', 'view-options', 'company', 'users', 'structure', 'user-reports'].includes(param)) {
        return param as any;
      }
    } catch (e) { /* ignore */ }
    return 'profile';
  };

  const [activeTab, setActiveTab] = useState<'profile' | 'view-options' | 'company' | 'users' | 'structure' | 'user-reports'>(initialTab);
  const [selectedUserForModal, setSelectedUserForModal] = useState<UserProfile | null>(null);
  const [isUserSettingsOpen, setIsUserSettingsOpen] = useState(false);
  const [isCreateUserOpen, setIsCreateUserOpen] = useState(false);

  // Synchronize activeTab whenever URL query params change (e.g. clicking sidebar links or browser back/forward)
  useEffect(() => {
    try {
      const param = new URLSearchParams(window.location.search).get('tab');
      if (param && ['profile', 'view-options', 'company', 'users', 'structure', 'user-reports'].includes(param)) {
        setActiveTab(param as any);
      } else if (!param) {
        setActiveTab('profile');
      }
    } catch (e) { /* ignore */ }
  }, [window.location.search]);

  // User list filters
  const [userSearch, setUserSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');

  const [companyForm, setCompanyForm] = useState<BrandingSettings>(() => ({
    appName: company?.appName || 'PASS MANAGEMENT SYSTEM',
    companyName: company?.companyName || 'HABARI ENGINEERING',
    poweredBy: company?.poweredBy || 'HABARI ENGINEERING'
  }));

  useEffect(() => {
    if (company) {
      setCompanyForm({
        appName: company.appName || 'PASS MANAGEMENT SYSTEM',
        companyName: company.companyName || 'HABARI ENGINEERING',
        poweredBy: company.poweredBy || 'HABARI ENGINEERING'
      });
    }
  }, [company]);

  const handleCompanySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await apiFetch('/api/settings/company', {
        method: 'POST',
        body: JSON.stringify(companyForm)
      });
      if (res.ok) {
        showToast("Company settings updated successfully", "success");
        onSuccess();
      }
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  const handleUpdateUserStatus = async (userId: string, status: string) => {
    try {
      const res = await apiFetch(`/api/users/${userId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status })
      });
      if (res.ok) {
        showToast(`User status updated to ${status}`, "success");
        onSuccess();
      }
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  const handleUpdateUserRole = async (userId: string, role: string) => {
    try {
      const res = await apiFetch(`/api/users/${userId}`, {
        method: 'PATCH',
        body: JSON.stringify({ role })
      });
      if (res.ok) {
        showToast(`User role updated to ${role}`, "success");
        onSuccess();
      }
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  const handleDeleteUser = async (userId: string) => {
    const targetUser = allUsers.find(u => u.id === userId);
    if (targetUser && (targetUser.role === 'power_admin' || targetUser.email?.toLowerCase() === 'm.techsandgadgets@gmail.com')) {
      showToast("The Master Platform Administrator account is root-protected and cannot be deleted.", "error");
      return;
    }

    try {
      // Perform pre-deletion system check
      const checkRes = await apiFetch(`/api/users/${userId}/deletion-check`);
      const checkData = await checkRes.json();
      
      if (!checkData.canDelete) {
        showToast(checkData.reasons?.[0] || "Cannot delete user due to system constraints", "error");
        return;
      }

      const userName = targetUser?.displayName || targetUser?.email || userId;
      const mappingInfo = `Department: ${targetUser?.department || 'Unassigned'} • Role: ${targetUser?.role || 'User'} • Active Requests: ${checkData.pendingCount}`;

      showConfirm(
        "Delete User Account",
        `Are you sure you want to permanently delete user "${userName}"?\n\nSystem Mappings: ${mappingInfo}\n\nThis action will erase the database record and cannot be undone.`,
        async () => {
          try {
            const res = await apiFetch(`/api/users/${userId}`, { method: 'DELETE' });
            if (res.ok) {
              showToast("User deleted successfully", "success");
              onSuccess();
            }
          } catch (err: any) {
            showToast(err.message, 'error');
          }
        }
      );
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  const handleResetPassword = (userId: string) => {
    showConfirm(
      "Reset Password",
      "Are you sure you want to reset this user's password to the default 'password123'?",
      async () => {
        try {
          const res = await apiFetch(`/api/users/${userId}/reset-password`, { method: 'POST' });
          if (res.ok) {
            showToast("Password reset successfully", "success");
          }
        } catch (err: any) {
          showToast(err.message, 'error');
        }
      }
    );
  };

  // Filter users - exclude global platform power admin from organization roster
  const orgUsers = useMemo(() => {
    return allUsers.filter(u => u.role !== 'power_admin' && u.email?.toLowerCase() !== 'm.techsandgadgets@gmail.com');
  }, [allUsers]);

  const pendingUsers = useMemo(() => {
    return orgUsers.filter(u => u.status === 'pending');
  }, [orgUsers]);

  const filteredUsers = useMemo(() => {
    const q = (globalSearch || userSearch || '').toLowerCase().trim();
    return orgUsers.filter(u => {
      const matchesSearch = 
        !q ||
        u.displayName?.toLowerCase().includes(q) ||
        u.email?.toLowerCase().includes(q) ||
        u.jobTitle?.toLowerCase().includes(q) ||
        u.department?.toLowerCase().includes(q);
      
      const matchesRole = roleFilter === 'ALL' || u.role === roleFilter;
      const matchesStatus = statusFilter === 'ALL' || (u.status || 'active') === statusFilter;

      return matchesSearch && matchesRole && matchesStatus;
    });
  }, [orgUsers, userSearch, globalSearch, roleFilter, statusFilter]);

  const openUserSettings = (user: UserProfile) => {
    setSelectedUserForModal(user);
    setIsUserSettingsOpen(true);
  };

  const handleTabChange = (tab: 'profile' | 'view-options' | 'company' | 'users' | 'structure' | 'user-reports') => {
    setActiveTab(tab);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('tab', tab);
      window.history.replaceState({}, '', url.toString());
    } catch (e) { /* ignore */ }
  };

  return (
    <div className="space-y-3 flex-1 flex flex-col w-full min-h-[calc(100vh-96px)]">
      <div className="bg-white rounded-xl border border-[#E5E7EB] p-4 sm:p-5 shadow-2xs flex-1 flex flex-col min-h-[calc(100vh-120px)]">
        
        {/* Profile Tab */}
        {activeTab === 'profile' && currentUser && (
          <div className="space-y-4 max-w-4xl">
            <div>
              <h2 className="text-base font-bold text-[#111827]">Profile Settings</h2>
              <p className="text-xs text-gray-500 mt-0.5">Manage your personal account details, credentials, and organizational assignments.</p>
            </div>
            
            <div className="border border-slate-100 rounded-xl p-5 bg-slate-50/40">
              <ProfileForm 
                user={currentUser} 
                onSuccess={onSuccess} 
                showToast={showToast} 
              />
            </div>
          </div>
        )}

        {/* View Options Tab */}
        {activeTab === 'view-options' && (
          <ViewOptionsSettings
            currentUser={currentUser}
            onSuccess={onSuccess}
            showToast={showToast}
          />
        )}

        {/* Company Branding Tab */}
        {activeTab === 'company' && (
          isPowerAdmin(currentUser) ? (
            <div className="space-y-4 max-w-xl">
              <div>
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-amber-50 border border-amber-200 rounded-md text-[10px] font-bold text-amber-800 uppercase tracking-wider mb-2">
                  <Shield size={12} />
                  Platform Master / Power Admin Controlled
                </div>
                <h2 className="text-base font-bold text-[#111827]">Branding & Application Identity</h2>
                <p className="text-xs text-gray-500 mt-0.5">Customize global application title, software branding, and footer attribution across the entire platform.</p>
              </div>
              <form onSubmit={handleCompanySubmit} className="space-y-3">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-[#6B7280] uppercase tracking-wider">Application Name</label>
                  <input 
                    type="text" 
                    value={companyForm.appName || ''}
                    onChange={(e) => setCompanyForm({ ...companyForm, appName: e.target.value })}
                    className="w-full px-3 py-2 bg-white border border-[#E5E7EB] rounded-lg text-xs font-semibold focus:border-[#800020] outline-none"
                    placeholder="PASS MANAGEMENT SYSTEM"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-[#6B7280] uppercase tracking-wider">Company Name</label>
                  <input 
                    type="text" 
                    value={companyForm.companyName || ''}
                    onChange={(e) => setCompanyForm({ ...companyForm, companyName: e.target.value })}
                    className="w-full px-3 py-2 bg-white border border-[#E5E7EB] rounded-lg text-xs font-semibold focus:border-[#800020] outline-none"
                    placeholder="HABARI ENGINEERING"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-[#6B7280] uppercase tracking-wider">Footer / Powered By</label>
                  <input 
                    type="text" 
                    value={companyForm.poweredBy || ''}
                    onChange={(e) => setCompanyForm({ ...companyForm, poweredBy: e.target.value })}
                    className="w-full px-3 py-2 bg-white border border-[#E5E7EB] rounded-lg text-xs font-semibold focus:border-[#800020] outline-none"
                    placeholder="HABARI ENGINEERING"
                  />
                </div>
                <div className="pt-2">
                  <button 
                    type="submit"
                    className="px-4 py-2 bg-[#800020] text-white rounded-lg text-xs font-bold hover:bg-[#600018] transition-colors cursor-pointer shadow-xs"
                  >
                    Save Branding Settings
                  </button>
                </div>
              </form>
            </div>
          ) : (
            <div className="max-w-xl bg-slate-50 border border-slate-200 rounded-xl p-6 text-center space-y-3">
              <div className="w-12 h-12 rounded-full bg-amber-50 border border-amber-200 flex items-center justify-center mx-auto text-amber-700">
                <Shield size={24} />
              </div>
              <h3 className="text-sm font-bold text-slate-800">Global Application Identity Setting</h3>
              <p className="text-xs text-slate-500 leading-relaxed">
                Branding & Application Identity governs the entire software instance (including global application title, software branding, and platform vendor attributions) and is managed exclusively by the <strong>Platform Master / Power Administrator</strong>.
              </p>
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => handleTabChange('structure')}
                  className="px-4 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-semibold text-xs rounded-lg shadow-2xs"
                >
                  Go to Company Structure
                </button>
              </div>
            </div>
          )
        )}

        {/* Company Structure Tab */}
        {activeTab === 'structure' && (
          <div className="space-y-5">
            <div>
              <h2 className="text-base font-bold text-[#111827]">Company Structure</h2>
              <p className="text-xs text-gray-500 mt-0.5">Manage organizational units like divisions, projects, and departments with edit and delete controls.</p>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <StructureManager 
                title="Division" 
                items={divisions} 
                endpoint="/api/divisions" 
                onSuccess={onSuccess} 
                showToast={showToast}
                showConfirm={showConfirm}
              />
              <StructureManager 
                title="Project" 
                items={projects} 
                endpoint="/api/projects" 
                onSuccess={onSuccess} 
                showToast={showToast}
                showConfirm={showConfirm}
              />
              <StructureManager 
                title="Department" 
                items={departments} 
                endpoint="/api/departments" 
                onSuccess={onSuccess}  
                showToast={showToast}
                showConfirm={showConfirm}
              />
            </div>
          </div>
        )}

        {/* User Management Tab */}
        {activeTab === 'users' && (
          <div className="space-y-4">
            {/* Pending Approvals Alert Banner */}
            {currentUser?.role === 'admin' && pendingUsers.length > 0 && (
              <div className="bg-amber-50/80 border border-amber-200 rounded-xl p-3 px-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-2xs">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
                    <UserCheck size={16} />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-amber-900">
                      {pendingUsers.length} {pendingUsers.length === 1 ? 'User Account Pending Approval' : 'User Accounts Pending Approval'}
                    </p>
                    <p className="text-[11px] text-amber-700">
                      User accounts requiring administrator review and activation before they can log in.
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setStatusFilter('pending')}
                    className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-bold transition-all shadow-2xs cursor-pointer"
                  >
                    View Pending ({pendingUsers.length})
                  </button>
                </div>
              </div>
            )}

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-[#1A1A1A]">User Accounts & Settings Management</h2>
                <p className="text-xs text-[#6B7280] mt-0.5">Manage users, view profiles, assign RBAC permissions, and review audit history.</p>
              </div>
              <button
                type="button"
                onClick={() => setIsCreateUserOpen(true)}
                className="px-3.5 py-2 bg-[#800020] text-white rounded-xl text-xs font-bold hover:bg-[#66001a] transition-all shadow-xs flex items-center gap-1.5 cursor-pointer self-start sm:self-auto"
              >
                <UserPlus size={14} />
                <span>Add New User</span>
              </button>
            </div>

            {/* Filter Toolbar */}
            <div className="flex flex-wrap items-center gap-2.5 p-2 bg-slate-50/80 rounded-xl border border-slate-200">
              <div className="flex items-center gap-2">
                <select
                  value={roleFilter}
                  onChange={e => setRoleFilter(e.target.value)}
                  className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-medium outline-none focus:border-[#800020]"
                >
                  <option value="ALL">All Roles</option>
                  <option value="admin">Admin</option>
                  <option value="approver">Approver</option>
                  <option value="applier">Applier</option>
                  <option value="requester">Requester</option>
                  <option value="viewer">Viewer</option>
                </select>

                <select
                  value={statusFilter}
                  onChange={e => setStatusFilter(e.target.value)}
                  className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-medium outline-none focus:border-[#800020]"
                >
                  <option value="ALL">All Statuses</option>
                  <option value="active">Active</option>
                  <option value="pending">Pending</option>
                  <option value="inactive">Inactive</option>
                </select>

                <span className="text-[11px] font-semibold text-slate-500 px-1">
                  {filteredUsers.length} {filteredUsers.length === 1 ? 'user' : 'users'}
                </span>
              </div>
            </div>

            {/* Users Table */}
            <div className="border border-[#E5E7EB] rounded-xl overflow-hidden shadow-2xs">
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-[#F9FAFB] border-b border-[#E5E7EB]">
                    <tr>
                      <th className="px-4 py-2.5 text-[9px] font-bold text-[#6B7280] uppercase tracking-widest">User Profile</th>
                      <th className="px-4 py-2.5 text-[9px] font-bold text-[#6B7280] uppercase tracking-widest">Role (RBAC)</th>
                      <th className="px-4 py-2.5 text-[9px] font-bold text-[#6B7280] uppercase tracking-widest">Dept / Project</th>
                      <th className="px-4 py-2.5 text-[9px] font-bold text-[#6B7280] uppercase tracking-widest">Status</th>
                      <th className="px-4 py-2.5 text-[9px] font-bold text-[#6B7280] uppercase tracking-widest text-right">View & Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F3F4F6]">
                    {filteredUsers.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-12 text-center text-xs text-slate-400">
                          No users match the search and filter criteria.
                        </td>
                      </tr>
                    ) : (
                      filteredUsers.map((user, idx) => (
                        <tr key={`user-row-${user.id || user.email || 'usr'}-${idx}`} className="hover:bg-[#F9FAFB] transition-colors group">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-3">
                              <div className="w-9 h-9 rounded-full bg-[#800020]/10 border border-[#800020]/20 flex items-center justify-center text-[#800020] font-bold text-xs">
                                {user.displayName?.charAt(0) || user.email.charAt(0).toUpperCase()}
                              </div>
                              <div>
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => openUserSettings(user)}
                                    className="text-xs font-bold text-[#1A1A1A] hover:text-[#800020] text-left transition-colors cursor-pointer"
                                  >
                                    {user.displayName || 'No Name'}
                                  </button>
                                  {user.id === currentUser?.id && (
                                    <span className="px-1.5 py-0.2 rounded text-[8px] font-bold uppercase bg-slate-100 text-slate-600">
                                      You
                                    </span>
                                  )}
                                </div>
                                <p className="text-[10px] text-[#6B7280] flex items-center gap-1.5">
                                  <span>{user.email}</span>
                                  {user.jobTitle && (
                                    <>
                                      <span>•</span>
                                      <span className="italic">{user.jobTitle}</span>
                                    </>
                                  )}
                                </p>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <select 
                              value={user.role}
                              onChange={(e) => handleUpdateUserRole(user.id, e.target.value)}
                              className="px-2 py-1 bg-white border border-[#E5E7EB] rounded-lg text-[10px] font-bold outline-none focus:ring-1 focus:ring-[#800020]"
                              disabled={user.id === currentUser?.id}
                            >
                              <option value="admin">Admin</option>
                              <option value="approver">Approver</option>
                              <option value="applier">Applier</option>
                              <option value="requester">Requester</option>
                              <option value="viewer">Viewer</option>
                            </select>
                          </td>
                          <td className="px-4 py-3">
                            <p className="text-xs text-slate-800 font-medium">
                              {user.department || 'General'}
                            </p>
                            <p className="text-[10px] text-slate-400">
                              {user.project || 'All Sites'}
                            </p>
                          </td>
                          <td className="px-4 py-3">
                            <span className={cn(
                              "px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider inline-block",
                              user.status === 'active' ? "bg-emerald-50 text-emerald-600 border border-emerald-100" :
                              user.status === 'pending' ? "bg-amber-50 text-amber-600 border border-amber-100" :
                              "bg-rose-50 text-rose-600 border border-rose-100"
                            )}>
                              {user.status || 'active'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              {/* Quick Approve button for pending users */}
                              {user.status === 'pending' && user.id !== currentUser?.id && (
                                <button
                                  type="button"
                                  onClick={() => handleUpdateUserStatus(user.id, 'active')}
                                  className="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold flex items-center gap-1 transition-all shadow-2xs cursor-pointer"
                                  title="Approve & Activate User Account"
                                >
                                  <CheckCircle2 size={13} />
                                  <span>Approve</span>
                                </button>
                              )}

                              {/* View user settings button */}
                              <button 
                                type="button"
                                onClick={() => openUserSettings(user)}
                                className="px-2.5 py-1.5 rounded-lg border border-slate-200 hover:border-[#800020] bg-white text-slate-700 hover:text-[#800020] text-xs font-semibold flex items-center gap-1.5 transition-all shadow-2xs cursor-pointer"
                                title="View User Settings & Details"
                              >
                                <Eye size={13} />
                                <span>Settings View</span>
                              </button>

                              {user.id !== currentUser?.id && !(user.role === 'power_admin' || user.email?.toLowerCase() === 'm.techsandgadgets@gmail.com') && (
                                <>
                                  <button 
                                    onClick={() => handleUpdateUserStatus(user.id, user.status === 'active' ? 'inactive' : 'active')}
                                    className={cn(
                                      "p-1.5 rounded-lg transition-colors cursor-pointer",
                                      user.status === 'active' ? "text-rose-600 hover:bg-rose-50" : "text-emerald-600 hover:bg-emerald-50"
                                    )}
                                    title={user.status === 'active' ? "Deactivate" : "Activate"}
                                  >
                                    {user.status === 'active' ? <XCircle size={15} /> : <CheckCircle2 size={15} />}
                                  </button>
                                  <button 
                                    onClick={() => handleResetPassword(user.id)}
                                    className="p-1.5 text-amber-600 hover:bg-amber-50 rounded-lg transition-colors cursor-pointer"
                                    title="Reset Password"
                                  >
                                    <Key size={15} />
                                  </button>
                                  <button 
                                    onClick={() => handleDeleteUser(user.id)}
                                    className="p-1.5 text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                                    title="Delete User"
                                  >
                                    <Trash2 size={15} />
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Super Admin User Reports & Online Presence Tab */}
        {activeTab === 'user-reports' && (currentUser?.role === 'admin' || isPowerAdmin(currentUser)) && (
          <SuperAdminUserReports
            currentUser={currentUser}
            allUsers={allUsers}
            divisions={divisions}
            projects={projects}
            departments={departments}
            onSuccess={onSuccess}
            showToast={showToast}
            showConfirm={showConfirm}
          />
        )}
      </div>

      {/* User Settings & Details Modal */}
      <UserSettingsModal
        isOpen={isUserSettingsOpen}
        onClose={() => {
          setIsUserSettingsOpen(false);
          setSelectedUserForModal(null);
        }}
        user={selectedUserForModal}
        currentUser={currentUser}
        divisions={divisions}
        projects={projects}
        departments={departments}
        onSuccess={onSuccess}
        showToast={showToast}
        showConfirm={showConfirm}
      />

      {/* Add New User Modal */}
      <UserCreateModal
        isOpen={isCreateUserOpen}
        onClose={() => setIsCreateUserOpen(false)}
        divisions={divisions}
        projects={projects}
        departments={departments}
        onSuccess={onSuccess}
        showToast={showToast}
      />
    </div>
  );
}
