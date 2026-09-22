import React, { useState } from 'react';
import { UserProfile } from '../../types';
import { apiFetch } from '../../lib/utils';
import { User, Mail, Shield, Key, Eye, EyeOff, Save } from 'lucide-react';

interface ProfileFormProps {
  user: UserProfile;
  onSuccess: () => void;
  showToast: (msg: string, type?: 'success' | 'error') => void;
}

export function ProfileForm({ user, onSuccess, showToast }: ProfileFormProps) {
  const [data, setData] = useState({
    displayName: user.displayName || '',
    photoURL: user.photoURL || '',
    password: '',
    confirmPassword: ''
  });
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (data.password) {
      if (data.password.length < 6) {
        showToast("Password must be at least 6 characters long", 'error');
        return;
      }
      if (data.password !== data.confirmPassword) {
        showToast("Passwords do not match", 'error');
        return;
      }
    }

    setIsSubmitting(true);
    try {
      const res = await apiFetch(`/api/users/${user.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          displayName: data.displayName.trim(),
          photoURL: data.photoURL.trim(),
          ...(data.password ? { password: data.password.trim() } : {})
        })
      });
      
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to update profile');
      }

      showToast("Profile and security settings updated successfully", "success");
      const updatedUser = { ...user, displayName: data.displayName, photoURL: data.photoURL };
      localStorage.setItem('user', JSON.stringify(updatedUser));
      setData(prev => ({ ...prev, password: '', confirmPassword: '' }));
      onSuccess();
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-2xl">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-[#6B7280] uppercase tracking-wider">Display Name</label>
            <div className="relative">
              <User className="absolute left-4 top-1/2 -translate-y-1/2 text-[#9CA3AF]" size={18} />
              <input 
                type="text" 
                value={data.displayName} 
                onChange={e => setData({...data, displayName: e.target.value})} 
                className="w-full pl-12 pr-4 py-2.5 rounded-xl border border-[#E5E7EB] outline-none focus:border-[#800020] font-medium text-xs bg-white" 
                placeholder="Your full name"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-[#6B7280] uppercase tracking-wider">Email Address</label>
            <div className="relative">
              <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-[#9CA3AF]" size={18} />
              <input 
                disabled 
                type="email" 
                value={user.email} 
                className="w-full pl-12 pr-4 py-2.5 rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] text-[#6B7280] font-medium text-xs cursor-not-allowed" 
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-[#6B7280] uppercase tracking-wider">User Role</label>
            <div className="relative">
              <Shield className="absolute left-4 top-1/2 -translate-y-1/2 text-[#9CA3AF]" size={18} />
              <input 
                disabled 
                type="text" 
                value={user.role.toUpperCase()} 
                className="w-full pl-12 pr-4 py-2.5 rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] text-[#6B7280] font-bold text-[10px] uppercase tracking-widest cursor-not-allowed" 
              />
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-[#6B7280] uppercase tracking-wider">New Password</label>
            <div className="relative">
              <Key className="absolute left-4 top-1/2 -translate-y-1/2 text-[#9CA3AF]" size={18} />
              <input 
                type={showPassword ? "text" : "password"}
                value={data.password} 
                onChange={e => setData({...data, password: e.target.value})} 
                className="w-full pl-12 pr-10 py-2.5 rounded-xl border border-[#E5E7EB] outline-none focus:border-[#800020] font-medium text-xs bg-white font-mono" 
                placeholder="Leave blank to keep current (min 6 chars)"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-[#6B7280] uppercase tracking-wider">Confirm New Password</label>
            <div className="relative">
              <Key className="absolute left-4 top-1/2 -translate-y-1/2 text-[#9CA3AF]" size={18} />
              <input 
                type={showConfirmPassword ? "text" : "password"}
                value={data.confirmPassword} 
                onChange={e => setData({...data, confirmPassword: e.target.value})} 
                className="w-full pl-12 pr-10 py-2.5 rounded-xl border border-[#E5E7EB] outline-none focus:border-[#800020] font-medium text-xs bg-white font-mono" 
                placeholder="Confirm your new password"
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                tabIndex={-1}
              >
                {showConfirmPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-[#6B7280] uppercase tracking-wider">Photo URL</label>
            <input 
              type="text" 
              value={data.photoURL} 
              onChange={e => setData({...data, photoURL: e.target.value})} 
              className="w-full px-4 py-2.5 rounded-xl border border-[#E5E7EB] outline-none focus:border-[#800020] font-medium text-xs bg-white" 
              placeholder="https://example.com/photo.jpg"
            />
          </div>
        </div>
      </div>

      <div className="flex justify-end pt-4">
        <button 
          type="submit" 
          disabled={isSubmitting}
          className="px-6 py-2.5 bg-[#800020] text-white rounded-xl text-xs font-bold hover:bg-[#600018] transition-all shadow-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
        >
          <Save size={14} />
          {isSubmitting ? "Saving..." : "Save Changes"}
        </button>
      </div>
    </form>
  );
}
