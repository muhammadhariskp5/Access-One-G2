import React, { useState, useEffect } from 'react';
import { 
  X, 
  User, 
  Shield, 
  Clock, 
  Key, 
  CheckCircle2, 
  XCircle, 
  Trash2, 
  Edit3, 
  Save, 
  Mail, 
  Phone, 
  Briefcase, 
  Building2, 
  Calendar,
  AlertCircle,
  ExternalLink,
  ShieldCheck,
  Check,
  Minus,
  Eye,
  EyeOff,
  UserCheck,
  Lock
} from 'lucide-react';
import { UserProfile, AuditLog, Division, Project, Department } from '../../types';
import { apiFetch, cn, formatDateTime } from '../../lib/utils';

interface UserSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: UserProfile | null;
  currentUser: UserProfile | null;
  divisions?: Division[];
  projects?: Project[];
  departments?: Department[];
  onSuccess: () => void;
  showToast: (msg: string, type?: 'success' | 'error') => void;
  showConfirm: (title: string, message: string, onConfirm: () => void) => void;
}

export function UserSettingsModal({
  isOpen,
  onClose,
  user,
  currentUser,
  divisions = [],
  projects = [],
  departments = [],
  onSuccess,
  showToast,
  showConfirm
}: UserSettingsModalProps) {
  const [activeTab, setActiveTab] = useState<'profile' | 'permissions' | 'activity' | 'security'>('profile');
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [userLogs, setUserLogs] = useState<AuditLog[]>([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);

  // Custom password state
  const [customPassword, setCustomPassword] = useState('');
  const [showCustomPassword, setShowCustomPassword] = useState(false);
  const [isSettingPassword, setIsSettingPassword] = useState(false);

  // Edit form state
  const [formData, setFormData] = useState({
    displayName: '',
    role: 'requester',
    phone: '',
    jobTitle: '',
    department: '',
    division: '',
    project: '',
    status: 'active'
  });

  useEffect(() => {
    if (user) {
      setFormData({
        displayName: user.displayName || '',
        role: user.role || 'requester',
        phone: user.phone || '',
        jobTitle: user.jobTitle || '',
        department: user.department || '',
        division: user.division || '',
        project: user.project || '',
        status: user.status || 'active'
      });
      setIsEditing(false);
      setCustomPassword('');
      fetchUserLogs(user.id);
    }
  }, [user]);

  const fetchUserLogs = async (userId: string) => {
    setIsLoadingLogs(true);
    try {
      const res = await apiFetch(`/api/auditLogs?userId=${encodeURIComponent(userId)}&limit=50`);
      if (res.ok) {
        const data = await res.json();
        setUserLogs(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error('Failed to fetch user audit logs:', err);
    } finally {
      setIsLoadingLogs(false);
    }
  };

  if (!isOpen || !user) return null;

  const isAdmin = currentUser?.role === 'admin';
  const isSelf = currentUser?.id === user.id;

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      const endpoint = isSelf ? '/api/users/profile' : `/api/users/${user.id}`;
      const res = await apiFetch(endpoint, {
        method: 'PATCH',
        body: JSON.stringify(formData)
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to update user profile');
      }
      showToast('User settings saved successfully', 'success');
      setIsEditing(false);
      onSuccess();
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleApproveUser = async () => {
    try {
      const res = await apiFetch(`/api/users/${user.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'active' })
      });
      if (res.ok) {
        showToast(`User ${user.displayName || user.email} approved and activated!`, 'success');
        onSuccess();
      } else {
        const err = await res.json();
        showToast(err.error || 'Failed to approve user', 'error');
      }
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  const handleToggleStatus = async () => {
    const newStatus = user.status === 'active' ? 'inactive' : 'active';
    try {
      const res = await apiFetch(`/api/users/${user.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: newStatus })
      });
      if (res.ok) {
        showToast(`User status set to ${newStatus}`, 'success');
        onSuccess();
      }
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  const handleResetPassword = () => {
    showConfirm(
      'Reset User Password',
      `Reset password for ${user.displayName || user.email}? A random temporary password will be generated and shown once.`,
      async () => {
        try {
          const res = await apiFetch(`/api/users/${user.id}/reset-password`, { method: 'POST' });
          if (res.ok) {
            const data = await res.json();
            if (data.temporaryPassword) {
              try { await navigator.clipboard.writeText(data.temporaryPassword); } catch { /* clipboard unavailable */ }
              window.alert(`Temporary password (copied to clipboard):

${data.temporaryPassword}

Share it securely; it will not be shown again.`);
            }
            showToast('Password reset successfully', 'success');
          }
        } catch (err: any) {
          showToast(err.message, 'error');
        }
      }
    );
  };

  const handleSetCustomPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customPassword.trim()) {
      showToast('Please enter a new password', 'error');
      return;
    }
    if (customPassword.length < 8) {
      showToast('Password must be at least 8 characters long', 'error');
      return;
    }

    setIsSettingPassword(true);
    try {
      const res = await apiFetch(`/api/users/${user.id}/reset-password`, {
        method: 'POST',
        body: JSON.stringify({ newPassword: customPassword.trim() })
      });
      if (res.ok) {
        showToast(`New password set successfully for ${user.displayName || user.email}`, 'success');
        setCustomPassword('');
      } else {
        const err = await res.json();
        throw new Error(err.error || 'Failed to update password');
      }
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setIsSettingPassword(false);
    }
  };

  const isTargetPowerAdmin = user.role === 'power_admin';

  const handleDeleteUser = async () => {
    if (isTargetPowerAdmin) {
      showToast("The Master Platform Administrator account is protected and cannot be deleted.", "error");
      return;
    }
    try {
      const checkRes = await apiFetch(`/api/users/${user.id}/deletion-check`);
      const checkData = await checkRes.json();
      if (!checkData.canDelete) {
        showToast(checkData.reasons?.[0] || "Cannot delete user due to system constraints", "error");
        return;
      }

      const mappingDesc = `Department: ${user.department || 'Unassigned'} • Role: ${user.role} • Active Linked Requests: ${checkData.pendingCount}`;
      showConfirm(
        'Delete User Account',
        `Are you sure you want to permanently delete user "${user.displayName || user.email}"?\n\nSystem Mappings: ${mappingDesc}.\n\nThis action cannot be undone.`,
        async () => {
          try {
            const res = await apiFetch(`/api/users/${user.id}`, { method: 'DELETE' });
            if (res.ok) {
              showToast('User deleted successfully', 'success');
              onClose();
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

  // RBAC Matrix definitions
  const rolePermissions: Record<string, { [key: string]: boolean }> = {
    admin: {
      'Full Administrative Privileges': true,
      'Submit & Edit Pass Applications': true,
      'Review & Approve Applications': true,
      'Issue & Print Passes': true,
      'Access Personnel Roster & Add Employees': true,
      'Configure Access Matrix & Locations': true,
      'User Management & Role Assignment': true,
      'View & Export Audit Logs': true,
      'Branding & System Configuration': true
    },
    approver: {
      'Full Administrative Privileges': false,
      'Submit & Edit Pass Applications': true,
      'Review & Approve Applications': true,
      'Issue & Print Passes': true,
      'Access Personnel Roster & Add Employees': true,
      'Configure Access Matrix & Locations': false,
      'User Management & Role Assignment': false,
      'View & Export Audit Logs': false,
      'Branding & System Configuration': false
    },
    applier: {
      'Full Administrative Privileges': false,
      'Submit & Edit Pass Applications': true,
      'Review & Approve Applications': false,
      'Issue & Print Passes': true,
      'Access Personnel Roster & Add Employees': true,
      'Configure Access Matrix & Locations': false,
      'User Management & Role Assignment': false,
      'View & Export Audit Logs': false,
      'Branding & System Configuration': false
    },
    requester: {
      'Full Administrative Privileges': false,
      'Submit & Edit Pass Applications': true,
      'Review & Approve Applications': false,
      'Issue & Print Passes': false,
      'Access Personnel Roster & Add Employees': true,
      'Configure Access Matrix & Locations': false,
      'User Management & Role Assignment': false,
      'View & Export Audit Logs': false,
      'Branding & System Configuration': false
    },
    viewer: {
      'Full Administrative Privileges': false,
      'Submit & Edit Pass Applications': false,
      'Review & Approve Applications': false,
      'Issue & Print Passes': false,
      'Access Personnel Roster & Add Employees': false,
      'Configure Access Matrix & Locations': false,
      'User Management & Role Assignment': false,
      'View & Export Audit Logs': false,
      'Branding & System Configuration': false
    }
  };

  const currentRolePerms = rolePermissions[user.role] || rolePermissions.requester;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-100 bg-slate-50/50 flex items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="relative">
              <div className="w-14 h-14 rounded-2xl bg-[#800020]/10 border border-[#800020]/20 flex items-center justify-center text-[#800020] font-extrabold text-xl shadow-xs">
                {user.displayName?.charAt(0) || user.email.charAt(0).toUpperCase()}
              </div>
              <div className={cn(
                "absolute -bottom-1 -right-1 w-4 h-4 rounded-full border-2 border-white flex items-center justify-center shadow-xs",
                user.status === 'active' ? "bg-emerald-500" : user.status === 'pending' ? "bg-amber-500" : "bg-rose-500"
              )} />
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h3 className="text-lg font-bold text-slate-900 leading-tight">
                  {user.displayName || 'Unnamed User'}
                </h3>
                <span className={cn(
                  "px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider",
                  user.role === 'admin' ? "bg-purple-100 text-purple-700" :
                  user.role === 'approver' ? "bg-blue-100 text-blue-700" :
                  user.role === 'applier' ? "bg-teal-100 text-teal-700" :
                  user.role === 'requester' ? "bg-amber-100 text-amber-700" :
                  "bg-slate-100 text-slate-700"
                )}>
                  {user.role}
                </span>
                <span className={cn(
                  "px-2 py-0.5 rounded-full text-[10px] font-semibold capitalize",
                  user.status === 'active' ? "bg-emerald-50 text-emerald-700 border border-emerald-200" :
                  user.status === 'pending' ? "bg-amber-50 text-amber-700 border border-amber-200" :
                  "bg-rose-50 text-rose-700 border border-rose-200"
                )}>
                  {user.status || 'active'}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-1 flex items-center gap-2">
                <span>{user.email}</span>
                {user.jobTitle && (
                  <>
                    <span>•</span>
                    <span>{user.jobTitle}</span>
                  </>
                )}
                {user.department && (
                  <>
                    <span>•</span>
                    <span>{user.department}</span>
                  </>
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {isAdmin && !isSelf && user.status === 'pending' && (
              <button
                onClick={handleApproveUser}
                className="px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
                title="Approve and activate user account"
              >
                <UserCheck size={14} />
                <span>Approve Account</span>
              </button>
            )}
            {isAdmin && !isSelf && user.status !== 'pending' && (
              <button
                onClick={handleToggleStatus}
                className={cn(
                  "px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer",
                  user.status === 'active' 
                    ? "bg-rose-50 text-rose-700 hover:bg-rose-100" 
                    : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                )}
                title={user.status === 'active' ? "Deactivate Account" : "Activate Account"}
              >
                {user.status === 'active' ? <XCircle size={14} /> : <CheckCircle2 size={14} />}
                <span>{user.status === 'active' ? 'Deactivate' : 'Activate'}</span>
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Pending Approval Banner */}
        {user.status === 'pending' && (
          <div className="px-6 py-2.5 bg-amber-50 border-b border-amber-200 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <AlertCircle size={15} className="text-amber-600 shrink-0" />
              <p className="text-xs text-amber-800 font-medium">
                This account registered and is <strong>awaiting administrator approval</strong> before they can sign in.
              </p>
            </div>
            {isAdmin && (
              <button
                onClick={handleApproveUser}
                className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition-all shadow-2xs flex items-center gap-1.5 cursor-pointer shrink-0"
              >
                <CheckCircle2 size={13} />
                <span>Approve & Activate</span>
              </button>
            )}
          </div>
        )}

        {/* Navigation Tabs */}
        <div className="px-6 border-b border-slate-200 bg-white flex gap-6">
          <button
            onClick={() => setActiveTab('profile')}
            className={cn(
              "py-3 text-xs font-bold transition-all border-b-2 flex items-center gap-2 cursor-pointer",
              activeTab === 'profile'
                ? "border-[#800020] text-[#800020]"
                : "border-transparent text-slate-500 hover:text-slate-900"
            )}
          >
            <User size={15} />
            User Settings & Profile
          </button>
          <button
            onClick={() => setActiveTab('permissions')}
            className={cn(
              "py-3 text-xs font-bold transition-all border-b-2 flex items-center gap-2 cursor-pointer",
              activeTab === 'permissions'
                ? "border-[#800020] text-[#800020]"
                : "border-transparent text-slate-500 hover:text-slate-900"
            )}
          >
            <Shield size={15} />
            Role & Permissions (RBAC)
          </button>
          <button
            onClick={() => setActiveTab('activity')}
            className={cn(
              "py-3 text-xs font-bold transition-all border-b-2 flex items-center gap-2 cursor-pointer",
              activeTab === 'activity'
                ? "border-[#800020] text-[#800020]"
                : "border-transparent text-slate-500 hover:text-slate-900"
            )}
          >
            <Clock size={15} />
            User Audit Trail ({userLogs.length})
          </button>
          {isAdmin && (
            <button
              onClick={() => setActiveTab('security')}
              className={cn(
                "py-3 text-xs font-bold transition-all border-b-2 flex items-center gap-2 cursor-pointer",
                activeTab === 'security'
                  ? "border-[#800020] text-[#800020]"
                  : "border-transparent text-slate-500 hover:text-slate-900"
              )}
            >
              <Key size={15} />
              Account Security
            </button>
          )}
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {activeTab === 'profile' && (
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-bold text-slate-900">Organizational & Contact Details</h4>
                  <p className="text-xs text-slate-500">View and update user assignment and identification records.</p>
                </div>
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => setIsEditing(!isEditing)}
                    className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-1.5 cursor-pointer"
                  >
                    <Edit3 size={13} />
                    {isEditing ? 'Cancel Editing' : 'Edit Details'}
                  </button>
                )}
              </div>

              {isEditing ? (
                <form onSubmit={handleSaveProfile} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Full Name</label>
                      <input
                        type="text"
                        value={formData.displayName}
                        onChange={e => setFormData({ ...formData, displayName: e.target.value })}
                        className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 focus:border-[#800020] outline-none"
                        placeholder="John Doe"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">System Role</label>
                      <select
                        value={formData.role}
                        onChange={e => setFormData({ ...formData, role: e.target.value })}
                        disabled={!isAdmin || isSelf}
                        className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 focus:border-[#800020] outline-none bg-white"
                      >
                        <option value="admin">Administrator</option>
                        <option value="approver">Approver</option>
                        <option value="applier">Applier</option>
                        <option value="requester">Requester</option>
                        <option value="viewer">Viewer (Read-only)</option>
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Phone / Mobile</label>
                      <input
                        type="text"
                        value={formData.phone}
                        onChange={e => setFormData({ ...formData, phone: e.target.value })}
                        className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 focus:border-[#800020] outline-none"
                        placeholder="+974 5555 1234"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Job Title</label>
                      <input
                        type="text"
                        value={formData.jobTitle}
                        onChange={e => setFormData({ ...formData, jobTitle: e.target.value })}
                        className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 focus:border-[#800020] outline-none"
                        placeholder="Security Officer"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Department</label>
                      <select
                        value={formData.department}
                        onChange={e => setFormData({ ...formData, department: e.target.value })}
                        className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 focus:border-[#800020] outline-none bg-white"
                      >
                        <option value="">Select Department...</option>
                        {departments.map((d, idx) => (
                          <option key={`usr-dept-${d.id || d.name || 'dept'}-${idx}`} value={d.name}>{d.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Division</label>
                      <select
                        value={formData.division}
                        onChange={e => setFormData({ ...formData, division: e.target.value })}
                        className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 focus:border-[#800020] outline-none bg-white"
                      >
                        <option value="">Select Division...</option>
                        {divisions.map((d, idx) => (
                          <option key={`usr-div-${d.id || d.name || 'div'}-${idx}`} value={d.name}>{d.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Assigned Project</label>
                      <select
                        value={formData.project}
                        onChange={e => setFormData({ ...formData, project: e.target.value })}
                        className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 focus:border-[#800020] outline-none bg-white"
                      >
                        <option value="">Select Project...</option>
                        {projects.map((p, idx) => (
                          <option key={`usr-proj-${p.id || p.name || 'proj'}-${idx}`} value={p.name}>{p.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Account Status</label>
                      <select
                        value={formData.status}
                        onChange={e => setFormData({ ...formData, status: e.target.value })}
                        disabled={!isAdmin || isSelf}
                        className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 focus:border-[#800020] outline-none bg-white"
                      >
                        <option value="active">Active</option>
                        <option value="pending">Pending Approval</option>
                        <option value="inactive">Inactive</option>
                      </select>
                    </div>
                  </div>

                  <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                    <button
                      type="button"
                      onClick={() => setIsEditing(false)}
                      className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={isSaving}
                      className="px-5 py-2 rounded-lg text-xs font-semibold bg-[#800020] text-white hover:bg-[#66001a] transition-all shadow-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      <Save size={13} />
                      {isSaving ? 'Saving Changes...' : 'Save Settings'}
                    </button>
                  </div>
                </form>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-100 space-y-1">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                      <Mail size={12} /> Email Address
                    </span>
                    <p className="text-xs font-semibold text-slate-900">{user.email}</p>
                  </div>

                  <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-100 space-y-1">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                      <Phone size={12} /> Contact Number
                    </span>
                    <p className="text-xs font-semibold text-slate-900">{user.phone || 'Not specified'}</p>
                  </div>

                  <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-100 space-y-1">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                      <Briefcase size={12} /> Job Title / Designation
                    </span>
                    <p className="text-xs font-semibold text-slate-900">{user.jobTitle || 'Not assigned'}</p>
                  </div>

                  <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-100 space-y-1">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                      <Building2 size={12} /> Department
                    </span>
                    <p className="text-xs font-semibold text-slate-900">{user.department || 'Unassigned'}</p>
                  </div>

                  <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-100 space-y-1">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Division</span>
                    <p className="text-xs font-semibold text-slate-900">{user.division || 'General'}</p>
                  </div>

                  <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-100 space-y-1">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Assigned Project Scope</span>
                    <p className="text-xs font-semibold text-slate-900">{user.project || 'All Sites / Enterprise-wide'}</p>
                  </div>

                  <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-100 space-y-1">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                      <Calendar size={12} /> Account Created
                    </span>
                    <p className="text-xs font-semibold text-slate-900">
                      {user.createdAt ? formatDateTime(user.createdAt) : 'Initial provisioned account'}
                    </p>
                  </div>

                  <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-100 space-y-1">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Internal User ID</span>
                    <p className="text-xs font-mono text-slate-600 truncate">{user.id}</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'permissions' && (
            <div className="space-y-4">
              <div>
                <h4 className="text-sm font-bold text-slate-900">Role-Based Access Control (RBAC) Matrix</h4>
                <p className="text-xs text-slate-500">
                  Capabilities and access entitlements granted by the <span className="font-bold text-[#800020] uppercase">{user.role}</span> role.
                </p>
              </div>

              <div className="border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="px-4 py-2.5 font-bold text-slate-600 uppercase text-[10px] tracking-wider">Feature / Capability</th>
                      <th className="px-4 py-2.5 font-bold text-slate-600 uppercase text-[10px] tracking-wider text-right">Access Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {Object.entries(currentRolePerms).map(([perm, allowed], idx) => (
                      <tr key={`perm-${perm}-${idx}`} className="hover:bg-slate-50/50">
                        <td className="px-4 py-2.5 font-medium text-slate-800">{perm}</td>
                        <td className="px-4 py-2.5 text-right">
                          {allowed ? (
                            <span className="inline-flex items-center gap-1 text-emerald-600 font-bold text-[11px] bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-100">
                              <Check size={12} /> Granted
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-slate-400 font-medium text-[11px] bg-slate-50 px-2 py-0.5 rounded-md">
                              <Minus size={12} /> Restricted
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'activity' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-bold text-slate-900">User Audit Trail</h4>
                  <p className="text-xs text-slate-500">Historical record of actions performed by this user account.</p>
                </div>
                <span className="text-[10px] font-bold text-slate-400 uppercase bg-slate-100 px-2.5 py-1 rounded-full">
                  {userLogs.length} events logged
                </span>
              </div>

              {isLoadingLogs ? (
                <div className="py-12 text-center text-slate-400 text-xs">
                  Loading user audit records...
                </div>
              ) : userLogs.length === 0 ? (
                <div className="py-12 text-center text-slate-400 text-xs bg-slate-50 rounded-xl border border-dashed border-slate-200">
                  No audit trail recorded for this user yet.
                </div>
              ) : (
                <div className="border border-slate-200 rounded-xl overflow-hidden shadow-2xs max-h-[350px] overflow-y-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 border-b border-slate-200 sticky top-0">
                      <tr>
                        <th className="px-3.5 py-2 font-bold text-slate-600 uppercase text-[9px]">Timestamp</th>
                        <th className="px-3.5 py-2 font-bold text-slate-600 uppercase text-[9px]">Action</th>
                        <th className="px-3.5 py-2 font-bold text-slate-600 uppercase text-[9px]">Entity</th>
                        <th className="px-3.5 py-2 font-bold text-slate-600 uppercase text-[9px]">Details</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {userLogs.map((log, idx) => (
                        <tr key={`usr-log-${log.id || 'log'}-${idx}`} className="hover:bg-slate-50/50">
                          <td className="px-3.5 py-2 text-[10px] text-slate-500 whitespace-nowrap">
                            {formatDateTime(log.timestamp)}
                          </td>
                          <td className="px-3.5 py-2">
                            <span className={cn(
                              "px-1.5 py-0.5 rounded text-[9px] font-bold uppercase",
                              log.action === 'CREATE' ? "bg-emerald-50 text-emerald-600" :
                              log.action === 'DELETE' ? "bg-rose-50 text-rose-600" :
                              log.action === 'STATUS_CHANGE' ? "bg-blue-50 text-blue-600" :
                              "bg-slate-100 text-slate-600"
                            )}>
                              {log.action}
                            </span>
                          </td>
                          <td className="px-3.5 py-2 text-[10px] font-bold uppercase text-slate-600">
                            {log.entityType}
                          </td>
                          <td className="px-3.5 py-2 text-[11px] text-slate-700 max-w-xs truncate" title={log.details}>
                            {log.details}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {activeTab === 'security' && isAdmin && (
            <div className="space-y-4">
              <div>
                <h4 className="text-sm font-bold text-slate-900">Security & Account Operations</h4>
                <p className="text-xs text-slate-500">Perform administrative security actions on this user account.</p>
              </div>

              <div className="space-y-4">
                {/* Custom Password Update */}
                <form onSubmit={handleSetCustomPassword} className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 space-y-3">
                  <div>
                    <h5 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                      <Key size={13} className="text-[#800020]" />
                      Set Custom Password
                    </h5>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Directly set a new secure password for this user.
                    </p>
                  </div>
                  
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                    <div className="relative flex-1">
                      <input
                        type={showCustomPassword ? "text" : "password"}
                        value={customPassword}
                        onChange={e => setCustomPassword(e.target.value)}
                        placeholder="Enter new password (min. 6 characters)"
                        className="w-full pl-3 pr-8 py-2 text-xs rounded-lg border border-slate-200 focus:border-[#800020] outline-none bg-white font-mono"
                      />
                      <button
                        type="button"
                        onClick={() => setShowCustomPassword(!showCustomPassword)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                        tabIndex={-1}
                      >
                        {showCustomPassword ? <EyeOff size={13} /> : <Eye size={13} />}
                      </button>
                    </div>
                    <button
                      type="submit"
                      disabled={isSettingPassword || !customPassword.trim()}
                      className="px-4 py-2 bg-[#800020] hover:bg-[#66001a] text-white rounded-lg text-xs font-bold transition-all shadow-xs flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      <Lock size={13} />
                      {isSettingPassword ? 'Setting...' : 'Set Password'}
                    </button>
                  </div>
                </form>

                {/* Quick Reset to Default */}
                <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 flex items-center justify-between">
                  <div>
                    <h5 className="text-xs font-bold text-slate-900">Reset User Password to Default</h5>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Generates a random temporary password and shows it once.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleResetPassword}
                    className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs shrink-0"
                  >
                    <Key size={13} />
                    Reset to Default
                  </button>
                </div>

                {!isSelf && !isTargetPowerAdmin && (
                  <div className="p-4 rounded-xl border border-rose-100 bg-rose-50/30 flex items-center justify-between">
                    <div>
                      <h5 className="text-xs font-bold text-rose-900">Delete User Account</h5>
                      <p className="text-[11px] text-rose-600/80 mt-0.5">
                        Permanently removes this user from the system database. This action is audited.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleDeleteUser}
                      className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs shrink-0"
                    >
                      <Trash2 size={13} />
                      Delete Account
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-slate-100 bg-slate-50/50 flex justify-between items-center text-xs text-slate-500">
          <span>User: <strong className="text-slate-800">{user.email}</strong></span>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-900 text-white rounded-xl text-xs font-semibold hover:bg-black transition-all cursor-pointer shadow-xs"
          >
            Close
          </button>
        </div>

      </div>
    </div>
  );
}
