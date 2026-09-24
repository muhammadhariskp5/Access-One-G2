import React, { useState } from 'react';
import { Category } from '../../types';
import { apiFetch } from '../../lib/utils';

interface CategoryFormProps {
  category?: Category;
  onClose: () => void;
  onSuccess: () => void | Promise<void>;
}

export function CategoryForm({ category, onClose, onSuccess }: CategoryFormProps) {
  const [name, setName] = useState(category?.name || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      if (category) {
        await apiFetch(`/api/categories/${category.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ name })
        });
      } else {
        await apiFetch('/api/categories', {
          method: 'POST',
          body: JSON.stringify({ name })
        });
      }
      await onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to save category');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl font-medium">
          {error}
        </div>
      )}
      <div className="space-y-1.5">
        <label className="text-[10px] font-bold text-[#6B7280] uppercase tracking-wider">Category Name *</label>
        <input 
          required 
          type="text" 
          value={name} 
          onChange={e => setName(e.target.value)} 
          className="w-full px-4 py-3 rounded-xl border border-[#E5E7EB] outline-none focus:border-[#800020] font-medium text-sm" 
          placeholder="e.g. Main Buildings"
        />
      </div>
      <button 
        type="submit" 
        disabled={loading}
        className="w-full py-4 bg-[#1A1A1A] text-white rounded-2xl font-bold mt-4 hover:bg-[#333333] transition-all disabled:opacity-50"
      >
        {loading ? 'Saving...' : (category ? 'Update Category' : 'Create Category')}
      </button>
    </form>
  );
}
