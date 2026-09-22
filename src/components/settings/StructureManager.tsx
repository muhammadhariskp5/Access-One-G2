import React, { useState } from 'react';
import { Plus, Trash2, Edit2, CheckCircle2, XCircle } from 'lucide-react';
import { motion } from 'motion/react';
import { apiFetch, cn, parseToYMD } from '../../lib/utils';

interface Item {
  id: string;
  name: string;
  status: 'active' | 'inactive';
  endDate?: string;
  contractNumber?: string;
  clientCompany?: string;
  clientApprovers?: string;
}

interface StructureManagerProps {
  title: string;
  items: Item[];
  endpoint: string;
  onSuccess: () => void;
  showToast: (msg: string, type?: 'success' | 'error') => void;
  showConfirm: (title: string, message: string, onConfirm: () => void) => void;
}

export function StructureManager({ 
  title, 
  items, 
  endpoint, 
  onSuccess, 
  showToast,
  showConfirm 
}: StructureManagerProps) {
  const [newItemName, setNewItemName] = useState('');
  const [newItemEndDate, setNewItemEndDate] = useState('');
  const [newItemContractNumber, setNewItemContractNumber] = useState('');
  const [newItemClientCompany, setNewItemClientCompany] = useState('');
  const [newItemClientApprovers, setNewItemClientApprovers] = useState('');
  const [isAdding, setIsAdding] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [editingEndDate, setEditingEndDate] = useState('');
  const [editingContractNumber, setEditingContractNumber] = useState('');
  const [editingClientCompany, setEditingClientCompany] = useState('');
  const [editingClientApprovers, setEditingClientApprovers] = useState('');

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newItemName.trim()) return;
    
    try {
      const body: any = { name: newItemName.trim() };
      if (title === 'Project') {
        if (newItemEndDate) body.endDate = newItemEndDate;
        if (newItemContractNumber) body.contractNumber = newItemContractNumber.trim();
        if (newItemClientCompany) body.clientCompany = newItemClientCompany.trim();
        if (newItemClientApprovers) body.clientApprovers = newItemClientApprovers.trim();
      }

      const res = await apiFetch(endpoint, {
        method: 'POST',
        body: JSON.stringify(body)
      });
      if (res.ok) {
        showToast(`${title} added successfully`);
        setNewItemName('');
        setNewItemEndDate('');
        setNewItemContractNumber('');
        setNewItemClientCompany('');
        setNewItemClientApprovers('');
        setIsAdding(false);
        onSuccess();
      }
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  const startEditing = (item: Item) => {
    setEditingId(item.id);
    setEditingName(item.name);
    setEditingEndDate(parseToYMD(item.endDate) || '');
    setEditingContractNumber(item.contractNumber || '');
    setEditingClientCompany(item.clientCompany || '');
    setEditingClientApprovers(item.clientApprovers || '');
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditingName('');
    setEditingEndDate('');
    setEditingContractNumber('');
    setEditingClientCompany('');
    setEditingClientApprovers('');
  };

  const handleUpdate = async (id: string) => {
    if (!editingName.trim()) return;

    try {
      const body: any = { name: editingName.trim() };
      if (title === 'Project') {
        body.endDate = editingEndDate || null;
        body.contractNumber = editingContractNumber.trim() || null;
        body.clientCompany = editingClientCompany.trim() || null;
        body.clientApprovers = editingClientApprovers.trim() || null;
      }

      const res = await apiFetch(`${endpoint}/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body)
      });

      if (res.ok) {
        showToast(`${title} updated successfully`);
        cancelEditing();
        onSuccess();
      }
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  const handleDelete = (id: string, name: string) => {
    showConfirm(
      `Delete ${title}`,
      `Are you sure you want to delete "${name}"?`,
      async () => {
        try {
          const res = await apiFetch(`${endpoint}/${id}`, { method: 'DELETE' });
          if (res.ok) {
            showToast(`${title} deleted successfully`);
            onSuccess();
          }
        } catch (err: any) {
          const errorMsg = err.message || '';
          if (errorMsg.includes('Personnel are still assigned') || errorMsg.includes('assigned') || errorMsg.includes('connected')) {
            showConfirm(
              `Force Deactivate ${title}`,
              `${errorMsg}\n\nDo you want to force deactivate "${name}" anyway?`,
              async () => {
                try {
                  const forceRes = await apiFetch(`${endpoint}/${id}?force=true`, { method: 'DELETE' });
                  if (forceRes.ok) {
                    showToast(`${title} deactivated successfully`);
                    onSuccess();
                  }
                } catch (forceErr: any) {
                  showToast(forceErr.message, 'error');
                }
              }
            );
          } else {
            showToast(err.message, 'error');
          }
        }
      }
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center pb-1 border-b border-gray-100">
        <h3 className="text-xs font-bold text-[#111827] uppercase tracking-wider">{title}s</h3>
        <button 
          onClick={() => setIsAdding(!isAdding)}
          className="p-1 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-md transition-all cursor-pointer flex items-center gap-1 text-[11px] font-medium px-2"
          title={`Add ${title}`}
        >
          <Plus size={13} className={cn("transition-transform", isAdding && "rotate-45")} />
          <span>Add</span>
        </button>
      </div>

      {isAdding && (
        <motion.form 
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          onSubmit={handleAdd} 
          className="space-y-2 bg-gray-50/80 p-2.5 rounded-lg border border-[#E5E7EB]"
        >
          <input 
            type="text" 
            value={newItemName}
            onChange={e => setNewItemName(e.target.value)}
            placeholder={`Enter ${title.toLowerCase()} name...`}
            className="w-full px-2.5 py-1.5 rounded-md border border-[#E5E7EB] bg-white outline-none focus:border-[#800020] text-xs font-medium"
            autoFocus
          />
          {title === 'Project' && (
            <>
              <div className="space-y-0.5">
                <label className="text-[9px] font-semibold text-gray-500 uppercase ml-0.5">Contract Number</label>
                <input 
                  type="text" 
                  value={newItemContractNumber}
                  onChange={e => setNewItemContractNumber(e.target.value)}
                  placeholder="e.g. CNT-2026-001"
                  className="w-full px-2.5 py-1.5 rounded-md border border-[#E5E7EB] bg-white outline-none focus:border-[#800020] text-xs font-medium"
                />
              </div>
              <div className="space-y-0.5">
                <label className="text-[9px] font-semibold text-gray-500 uppercase ml-0.5">Client Company</label>
                <input 
                  type="text" 
                  value={newItemClientCompany}
                  onChange={e => setNewItemClientCompany(e.target.value)}
                  placeholder="Client company name..."
                  className="w-full px-2.5 py-1.5 rounded-md border border-[#E5E7EB] bg-white outline-none focus:border-[#800020] text-xs font-medium"
                />
              </div>
              <div className="space-y-0.5">
                <label className="text-[9px] font-semibold text-gray-500 uppercase ml-0.5">Client Approver List</label>
                <textarea 
                  rows={2}
                  value={newItemClientApprovers}
                  onChange={e => setNewItemClientApprovers(e.target.value)}
                  placeholder="Enter client approver names / positions (one per line)..."
                  className="w-full px-2.5 py-1.5 rounded-md border border-[#E5E7EB] bg-white outline-none focus:border-[#800020] text-xs font-medium custom-scrollbar"
                />
              </div>
              <div className="space-y-0.5">
                <label className="text-[9px] font-semibold text-gray-500 uppercase ml-0.5">End Date (Optional)</label>
                <input 
                  type="date" 
                  value={newItemEndDate}
                  onChange={e => setNewItemEndDate(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-md border border-[#E5E7EB] bg-white outline-none focus:border-[#800020] text-xs font-medium"
                />
              </div>
            </>
          )}
          <div className="flex justify-end gap-1.5 pt-1">
            <button 
              type="button" 
              onClick={() => setIsAdding(false)}
              className="px-2 py-1 bg-white border border-gray-200 rounded text-[10px] font-medium text-gray-600 hover:bg-gray-50 cursor-pointer"
            >
              Cancel
            </button>
            <button 
              type="submit"
              className="px-3 py-1 bg-[#800020] text-white rounded text-[10px] font-semibold hover:bg-[#600018] transition-all cursor-pointer"
            >
              Save {title}
            </button>
          </div>
        </motion.form>
      )}

      <div className="space-y-1">
        {items.map((item, idx) => {
          const isEditingThis = editingId === item.id;

          if (isEditingThis) {
            return (
              <div key={`struct-edit-${title}-${item.id || item.name || 'item'}-${idx}`} className="p-2 rounded-lg border border-[#800020]/40 bg-rose-50/30 space-y-2">
                <input 
                  type="text" 
                  value={editingName} 
                  onChange={e => setEditingName(e.target.value)}
                  className="w-full px-2 py-1 rounded border border-gray-300 bg-white text-xs font-medium outline-none focus:border-[#800020]"
                  placeholder={`${title} name`}
                  autoFocus
                />
                {title === 'Project' && (
                  <>
                    <div className="space-y-0.5">
                      <label className="text-[9px] font-semibold text-gray-500 uppercase">Contract Number</label>
                      <input 
                        type="text" 
                        value={editingContractNumber} 
                        onChange={e => setEditingContractNumber(e.target.value)}
                        className="w-full px-2 py-1 rounded border border-gray-300 bg-white text-xs font-medium outline-none focus:border-[#800020]"
                        placeholder="Contract Number"
                      />
                    </div>
                    <div className="space-y-0.5">
                      <label className="text-[9px] font-semibold text-gray-500 uppercase">Client Company</label>
                      <input 
                        type="text" 
                        value={editingClientCompany} 
                        onChange={e => setEditingClientCompany(e.target.value)}
                        className="w-full px-2 py-1 rounded border border-gray-300 bg-white text-xs font-medium outline-none focus:border-[#800020]"
                        placeholder="Client Company"
                      />
                    </div>
                    <div className="space-y-0.5">
                      <label className="text-[9px] font-semibold text-gray-500 uppercase">Client Approver List</label>
                      <textarea 
                        rows={2}
                        value={editingClientApprovers} 
                        onChange={e => setEditingClientApprovers(e.target.value)}
                        className="w-full px-2 py-1 rounded border border-gray-300 bg-white text-xs font-medium outline-none focus:border-[#800020] custom-scrollbar"
                        placeholder="Client Approvers (one per line)"
                      />
                    </div>
                    <div className="space-y-0.5">
                      <label className="text-[9px] font-semibold text-gray-500 uppercase">End Date</label>
                      <input 
                        type="date" 
                        value={parseToYMD(editingEndDate) || ''} 
                        onChange={e => setEditingEndDate(e.target.value)}
                        className="w-full px-2 py-1 rounded border border-gray-300 bg-white text-xs font-medium outline-none focus:border-[#800020]"
                      />
                    </div>
                  </>
                )}
                <div className="flex items-center justify-end gap-1 pt-0.5">
                  <button 
                    type="button" 
                    onClick={cancelEditing}
                    className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors cursor-pointer"
                    title="Cancel"
                  >
                    <XCircle size={14} />
                  </button>
                  <button 
                    type="button" 
                    onClick={() => handleUpdate(item.id)}
                    className="p-1 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 rounded transition-colors cursor-pointer flex items-center gap-1 text-[10px] font-semibold"
                    title="Save Changes"
                  >
                    <CheckCircle2 size={14} />
                    <span>Save</span>
                  </button>
                </div>
              </div>
            );
          }

          return (
            <div key={`struct-item-${title}-${item.id || item.name || 'item'}-${idx}`} className="flex items-center justify-between p-2 rounded-lg border border-gray-100 hover:border-gray-200 hover:bg-gray-50/70 transition-colors group">
              <div className="min-w-0 pr-2">
                <p className="text-xs font-semibold text-gray-800 truncate">{item.name}</p>
                {item.contractNumber && (
                  <p className="text-[10px] text-gray-500 font-medium">Contract: {item.contractNumber}</p>
                )}
                {item.clientCompany && (
                  <p className="text-[10px] text-gray-500">Client: {item.clientCompany}</p>
                )}
                {item.endDate && (
                  <p className="text-[9px] text-gray-400 mt-0.5">Ends: {new Date(item.endDate).toLocaleDateString()}</p>
                )}
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                <button 
                  onClick={() => startEditing(item)}
                  className="p-1 text-gray-400 hover:text-[#800020] hover:bg-rose-50 rounded transition-colors cursor-pointer"
                  title={`Edit ${title}`}
                >
                  <Edit2 size={13} />
                </button>
                <button 
                  onClick={() => handleDelete(item.id, item.name)}
                  className="p-1 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors cursor-pointer"
                  title={`Delete ${title}`}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          );
        })}
        {items.length === 0 && !isAdding && (
          <p className="text-center py-3 text-[10px] text-gray-400 italic">No {title.toLowerCase()}s configured.</p>
        )}
      </div>
    </div>
  );
}
