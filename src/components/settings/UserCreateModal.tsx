import React, { useState } from 'react';
import { X, UserPlus, Mail, Lock, User, Shield, Briefcase, Building2, Phone, Eye, EyeOff, CheckCircle2 } from 'lucide-react';
import { UserRole, Division, Project, Department } from '../../types';
import { apiFetch } from '../../lib/utils';

interface UserCreateModalProps {
  isOpen: boolean;
  onClose: () => void;
  divisions?: Division[];
  projects?: Project[];
  departments?: Department[];
  onSuccess: () => void;
  showToast: (msg: string, type?: 'success' | 'error') => void;
}

export function UserCreateModal({
  isOpen,
  onClose,
  divisions = [],
  projects = [],
  departments = [],
  onSuccess,
  showToast
}: UserCreateModalProps) {
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('password123');
  const [showPassword, setShowPassword] = useState(false);
  const [role, setRole] = useState<UserRole>('requester');
  const [status, setStatus] = useState<'active' | 'pending'>('active');
  const [jobTitle, setJobTitle] = useState('');
  const [department, setDepartment] = useState('');
  const [division, setDivision] = useState('');
  const [project, setProject] = useState('');
  const [phone, setPhone] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) {
      showToast('Email and initial password are required', 'error');
      return;
    }

    if (password.length < 6) {
      showToast('Password must be at least 6 characters long', 'error');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await apiFetch('/api/users', {
        method: 'POST',
        body: JSON.stringify({
          email: email.trim(),
          displayName: displayName.trim() || email.split('@')[0],
          password: password.trim(),
          role,
          status,
          jobTitle: jobTitle.trim(),
          department,
          division,
          project,
          phone: phone.trim()
        })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to create user account');
      }

      showToast(`User account created successfully for ${email}`, 'success');
      onSuccess();
      onClose();
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-[#800020]/10 text-[#800020] flex items-center justify-center">
              <UserPlus size={16} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900 leading-none">Add New User</h3>
              <p className="text-[11px] text-slate-500 mt-1">Create user credentials and configure role permissions.</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                <User size={11} /> Full Name
              </label>
              <input
                type="text"
                required
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                placeholder="e.g. John Doe"
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 focus:border-[#800020] outline-none"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                <Mail size={11} /> Email Address
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="name@company.com"
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 focus:border-[#800020] outline-none"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                <Lock size={11} /> Initial Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  required
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Minimum 6 characters"
                  className="w-full pl-3 pr-8 py-2 text-xs rounded-lg border border-slate-200 focus:border-[#800020] outline-none font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff size={13} /> : <Eye size={13} />}
                </button>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                <Shield size={11} /> System Role
              </label>
              <select
                value={role}
                onChange={e => setRole(e.target.value as UserRole)}
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 focus:border-[#800020] outline-none bg-white font-semibold"
              >
                <option value="requester">Requester (Submit Passes)</option>
                <option value="approver">Approver (Review & Approve)</option>
                <option value="applier">Applier (Pass Handover / Print)</option>
                <option value="admin">Administrator (Full Access)</option>
                <option value="viewer">Viewer (Read Only)</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                <CheckCircle2 size={11} /> Initial Account Status
              </label>
              <select
                value={status}
                onChange={e => setStatus(e.target.value as 'active' | 'pending')}
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 focus:border-[#800020] outline-none bg-white font-semibold text-slate-700"
              >
                <option value="active">Active (Immediate Login)</option>
                <option value="pending">Pending Approval</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                <Phone size={11} /> Contact Phone
              </label>
              <input
                type="text"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                placeholder="+974 5555 0000"
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 focus:border-[#800020] outline-none"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                <Briefcase size={11} /> Job Title
              </label>
              <input
                type="text"
                value={jobTitle}
                onChange={e => setJobTitle(e.target.value)}
                placeholder="e.g. Lead Engineer"
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 focus:border-[#800020] outline-none"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                <Building2 size={11} /> Department
              </label>
              <select
                value={department}
                onChange={e => setDepartment(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 focus:border-[#800020] outline-none bg-white"
              >
                <option value="">Select Department...</option>
                {departments.map((d, idx) => (
                  <option key={`create-dept-${d.id || d.name || 'dept'}-${idx}`} value={d.name}>{d.name}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Assigned Project</label>
              <select
                value={project}
                onChange={e => setProject(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 focus:border-[#800020] outline-none bg-white"
              >
                <option value="">Select Project Scope...</option>
                {projects.map((p, idx) => (
                  <option key={`create-proj-${p.id || p.name || 'proj'}-${idx}`} value={p.name}>{p.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2 rounded-lg text-xs font-semibold bg-[#800020] text-white hover:bg-[#66001a] transition-all shadow-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <UserPlus size={14} />
              {isSubmitting ? 'Creating...' : 'Create Account'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
