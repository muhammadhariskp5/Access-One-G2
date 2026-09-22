import React, { useState } from 'react';
import { apiFetch } from '../../lib/utils';
import { Lock, Mail, Eye, EyeOff, KeyRound } from 'lucide-react';

interface ResetPasswordFormProps {
  onClose: () => void;
  showToast: (msg: string, type?: 'success' | 'error') => void;
}

export function ResetPasswordForm({ onClose, showToast }: ResetPasswordFormProps) {
  const [step, setStep] = useState<'request' | 'confirm'>('request');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleRequestCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!email.trim()) {
      setError('Please enter your email address.');
      return;
    }
    setIsSubmitting(true);
    try {
      const res = await apiFetch('/api/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to send reset code');
      showToast(data.message || 'If an account exists for that email, a reset code has been sent.', 'success');
      setStep('confirm');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!code.trim() || !newPassword.trim()) {
      setError('Please fill out all required fields.');
      return;
    }
    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters long.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await apiFetch('/api/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim(), token: code.trim(), newPassword: newPassword.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to reset password');
      showToast('Password reset successfully! Please log in with your new password.', 'success');
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (step === 'request') {
    return (
      <form onSubmit={handleRequestCode} className="space-y-4">
        <p className="text-sm text-[#666]">Enter your account email address and we'll send you a password reset code.</p>
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold text-[#687588] uppercase tracking-wider flex items-center gap-1">
            <Mail size={13} /> Email Address
          </label>
          <input
            required
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-3.5 py-2.5 rounded-xl border border-[#E5E7EB] outline-none focus:border-[#000000] font-medium text-sm bg-white"
            placeholder="name@company.com"
          />
        </div>
        {error && <p className="text-xs text-red-600 font-bold bg-red-50 p-3 rounded-xl border border-red-100">{error}</p>}
        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full bg-[#141414] text-white py-4 rounded-2xl font-bold hover:bg-black transition-all shadow-lg shadow-black/10 disabled:opacity-50"
        >
          {isSubmitting ? 'Sending...' : 'Send Reset Code'}
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={handleResetPassword} className="space-y-4">
      <p className="text-sm text-[#666]">Enter the reset code we sent to <strong>{email}</strong>, along with your new password.</p>
      <div className="space-y-1.5">
        <label className="text-[10px] font-bold text-[#687588] uppercase tracking-wider flex items-center gap-1">
          <KeyRound size={13} /> Reset Code
        </label>
        <input
          required
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className="w-full px-3.5 py-2.5 rounded-xl border border-[#E5E7EB] outline-none focus:border-[#000000] font-medium text-sm bg-white tracking-widest"
          placeholder="Enter code from email"
        />
      </div>
      <div className="space-y-1.5">
        <label className="text-[10px] font-bold text-[#687588] uppercase tracking-wider flex items-center gap-1">
          <Lock size={13} /> New Password
        </label>
        <div className="relative">
          <input
            required
            type={showNewPassword ? 'text' : 'password'}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="w-full px-3.5 py-2.5 rounded-xl border border-[#E5E7EB] outline-none focus:border-[#000000] font-medium text-sm bg-white pr-10"
            placeholder="At least 6 characters"
          />
          <button type="button" onClick={() => setShowNewPassword(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#999]">
            {showNewPassword ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
      </div>
      <div className="space-y-1.5">
        <label className="text-[10px] font-bold text-[#687588] uppercase tracking-wider flex items-center gap-1">
          <Lock size={13} /> Confirm New Password
        </label>
        <div className="relative">
          <input
            required
            type={showConfirmPassword ? 'text' : 'password'}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="w-full px-3.5 py-2.5 rounded-xl border border-[#E5E7EB] outline-none focus:border-[#000000] font-medium text-sm bg-white pr-10"
            placeholder="Re-enter new password"
          />
          <button type="button" onClick={() => setShowConfirmPassword(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#999]">
            {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
      </div>
      {error && <p className="text-xs text-red-600 font-bold bg-red-50 p-3 rounded-xl border border-red-100">{error}</p>}
      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full bg-[#141414] text-white py-4 rounded-2xl font-bold hover:bg-black transition-all shadow-lg shadow-black/10 disabled:opacity-50"
      >
        {isSubmitting ? 'Resetting...' : 'Reset Password'}
      </button>
      <button
        type="button"
        onClick={() => setStep('request')}
        className="w-full text-center text-xs font-bold text-[#687588] hover:underline"
      >
        Didn't get a code? Try again
      </button>
    </form>
  );
}
