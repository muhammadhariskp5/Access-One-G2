import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, MapPin, Tag, Key, Edit2, Trash2, ChevronRight, Search, Briefcase } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { Category, Location, AccessCode, UserProfile, Division, Department, Project } from '../types';
import { apiFetch, cn, formatDate } from '../lib/utils';
import { Modal } from '../components/common/Modal';
import { CategoryForm } from '../components/resources/CategoryForm';
import { LocationForm } from '../components/resources/LocationForm';
import { AccessCodeForm } from '../components/resources/AccessCodeForm';

interface ResourcesProps {
  categories: Category[];
  locations: Location[];
  accessCodes: AccessCode[];
  divisions: Division[];
  departments: Department[];
  projects: Project[];
  currentUser: UserProfile | null;
  onSuccess: () => void | Promise<void>;
  globalSearch: string;
  showToast: (msg: string, type?: 'success' | 'error') => void;
  showConfirm: (title: string, message: string, onConfirm: () => void) => void;
}

export function Resources({ 
  categories, 
  locations, 
  accessCodes, 
  divisions,
  departments,
  projects,
  currentUser, 
  onSuccess, 
  globalSearch,
  showToast,
  showConfirm
}: ResourcesProps) {
  const location = useLocation();
  const [activeTab, setActiveTab] = useState<'locations' | 'categories' | 'codes'>('locations');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<any>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedLocation, setSelectedLocation] = useState<string | null>(null);

  useEffect(() => {
    try {
      const param = new URLSearchParams(location.search).get('tab');
      if (param && ['locations', 'categories', 'codes'].includes(param)) {
        setActiveTab(param as any);
      }
    } catch (e) { /* ignore */ }
  }, [location.search]);

  const handleTabChange = (tab: 'locations' | 'categories' | 'codes') => {
    setActiveTab(tab);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('tab', tab);
      window.history.replaceState({}, '', url.toString());
    } catch (e) { /* ignore */ }
  };

  const filterByName = (list: any[]) => list.filter(item => 
    item.name?.toLowerCase().includes(globalSearch.toLowerCase())
  );

  const filteredCategories = filterByName(categories);

  const filteredLocations = locations.filter(l => {
    const matchesSearch = l.name?.toLowerCase().includes(globalSearch.toLowerCase()) || 
                         l.code?.toLowerCase().includes(globalSearch.toLowerCase());
    const matchesCategory = !selectedCategory || l.categoryId === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const filteredCodes = accessCodes.filter(ac => {
    const matchesSearch = ac.areaCode?.toLowerCase().includes(globalSearch.toLowerCase()) || 
                         ac.accessArea?.toLowerCase().includes(globalSearch.toLowerCase());
    const matchesLocation = !selectedLocation || ac.locationId === selectedLocation;
    return matchesSearch && matchesLocation;
  });

  const pluralEndpoint = (t: string) => t === 'category' ? 'categories' : `${t}s`;
  const handleDelete = (type: string, id: string) => {
    const displayName = type.charAt(0).toUpperCase() + type.slice(1);
    showConfirm(
      `Delete ${displayName}`,
      `Are you sure you want to delete this ${type}? This action cannot be undone.`,
      async () => {
        try {
          const res = await apiFetch(`/api/${pluralEndpoint(type)}/${id}`, { method: 'DELETE' });
          if (res.ok) {
            showToast(`${displayName} deleted successfully`);
            await onSuccess();
          }
        } catch (err: any) {
          showToast(err.message, 'error');
        }
      }
    );
  };

  const ResourceTable = ({ items, type }: { items: any[], type: string }) => (
    <div className="overflow-x-auto">
      <table className="w-full text-left">
        <thead className="bg-[#F9FAFB] border-b border-[#E5E7EB]">
          <tr>
            <th className="px-4 py-2.5 text-[9px] font-bold text-[#6B7280] uppercase tracking-widest">{type} Name</th>
            {type === 'Project' && <th className="px-4 py-2.5 text-[9px] font-bold text-[#6B7280] uppercase tracking-widest">End Date</th>}
            <th className="px-4 py-2.5 text-[9px] font-bold text-[#6B7280] uppercase tracking-widest text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#F3F4F6]">
          {items.map(item => (
            <tr key={item.id} className="hover:bg-[#F9FAFB] transition-colors group">
              <td className="px-4 py-3 text-xs font-bold text-[#1A1A1A]">{item.name}</td>
              {type === 'Project' && (
                <td className="px-4 py-3 text-xs font-medium text-[#4B5563]">
                  {formatDate(item.endDate)}
                </td>
              )}
              <td className="px-4 py-3 text-right">
                <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button 
                    onClick={() => { setEditingItem(item); setIsModalOpen(true); }}
                    className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                  >
                    <Edit2 size={12} />
                  </button>
                  {currentUser?.role === 'admin' && (
                    <button 
                      onClick={() => handleDelete(type.toLowerCase(), item.id)}
                      className="p-1.5 text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
          {items.length === 0 && (
            <tr>
              <td colSpan={2} className="px-4 py-8 text-center text-xs text-[#9CA3AF] italic">
                No {type.toLowerCase()}s found matching your search.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="space-y-3 flex-1 flex flex-col w-full min-h-[calc(100vh-96px)]">
      <div className="flex flex-wrap justify-between items-center bg-white p-1.5 rounded-xl border border-slate-200/80 shadow-2xs gap-2">
        <div className="flex flex-wrap gap-1 bg-slate-100/80 p-0.5 rounded-lg border border-slate-200/60">
          {[
            { id: 'locations', label: 'Locations & Gates', count: locations.length, icon: MapPin },
            { id: 'categories', label: 'Categories', count: categories.length, icon: Tag },
            { id: 'codes', label: 'Access Area Codes', count: accessCodes.length, icon: Key },
          ].map(tab => (
            <button 
              key={tab.id}
              onClick={() => handleTabChange(tab.id as any)}
              className={cn(
                "px-2.5 py-1 rounded-md text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer",
                activeTab === tab.id 
                  ? "bg-white text-slate-900 shadow-2xs font-bold" 
                  : "text-slate-500 hover:text-slate-900"
              )}
            >
              <tab.icon size={13} className={activeTab === tab.id ? "text-[#800020]" : "text-slate-400"} />
              <span>{tab.label}</span>
              <span className={cn(
                "ml-1 px-1.5 py-0.2 rounded text-[10px] font-bold",
                activeTab === tab.id ? "bg-slate-100 text-slate-700" : "bg-slate-200/60 text-slate-500"
              )}>
                {tab.count}
              </span>
            </button>
          ))}
        </div>

        {currentUser?.role !== 'viewer' && (
          <button 
            onClick={() => { setEditingItem(null); setIsModalOpen(true); }}
            className="px-3 py-1.5 bg-[#800020] text-white rounded-lg font-bold text-xs hover:bg-[#600018] transition-all flex items-center gap-1.5 shadow-2xs cursor-pointer"
          >
            <Plus size={13} />
            <span>Add {activeTab === 'locations' ? 'Location' : activeTab === 'categories' ? 'Category' : 'Access Code'}</span>
          </button>
        )}
      </div>

      <div className="bg-white rounded-xl border border-slate-200/80 shadow-2xs overflow-hidden flex-1 flex flex-col min-h-[calc(100vh-180px)]">
        {activeTab === 'locations' && (
          // ... (existing code for locations)
          <div className="divide-y divide-[#F3F4F6]">
            <div className="p-4 bg-[#F9FAFB] flex flex-wrap gap-2">
              <button 
                onClick={() => setSelectedCategory(null)}
                className={cn(
                  "px-3 py-1 rounded-full text-[9px] font-bold uppercase tracking-wider transition-all",
                  !selectedCategory ? "bg-[#800020] text-white" : "bg-white text-[#6B7280] border border-[#E5E7EB] hover:bg-[#F3F4F6]"
                )}
              >
                All Categories
              </button>
              {categories.map(cat => (
                <button 
                  key={cat.id}
                  onClick={() => setSelectedCategory(cat.id)}
                  className={cn(
                    "px-3 py-1 rounded-full text-[9px] font-bold uppercase tracking-wider transition-all",
                    selectedCategory === cat.id ? "bg-[#800020] text-white" : "bg-white text-[#6B7280] border border-[#E5E7EB] hover:bg-[#F3F4F6]"
                  )}
                >
                  {cat.name}
                </button>
              ))}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-[#F9FAFB] border-b border-[#E5E7EB]">
                  <tr>
                    <th className="px-4 py-2.5 text-[9px] font-bold text-[#6B7280] uppercase tracking-widest">Code</th>
                    <th className="px-4 py-2.5 text-[9px] font-bold text-[#6B7280] uppercase tracking-widest">Location Name</th>
                    <th className="px-4 py-2.5 text-[9px] font-bold text-[#6B7280] uppercase tracking-widest">Category</th>
                    <th className="px-4 py-2.5 text-[9px] font-bold text-[#6B7280] uppercase tracking-widest">Status</th>
                    <th className="px-4 py-2.5 text-[9px] font-bold text-[#6B7280] uppercase tracking-widest text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F3F4F6]">
                  {filteredLocations.map(loc => {
                    const cat = categories.find(c => c.id === loc.categoryId);
                    return (
                      <tr key={loc.id} className="hover:bg-[#F9FAFB] transition-colors group">
                        <td className="px-4 py-3 text-[10px] font-bold text-[#800020]">{loc.code}</td>
                        <td className="px-4 py-3">
                          <p className="text-xs font-bold text-[#1A1A1A]">{loc.name}</p>
                          {loc.description && <p className="text-[9px] text-[#6B7280] truncate max-w-xs">{loc.description}</p>}
                        </td>
                        <td className="px-4 py-3">
                          <span className="px-2 py-0.5 bg-blue-50 text-blue-600 rounded text-[9px] font-bold uppercase">
                            {cat?.name || 'Uncategorized'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={cn(
                            "px-2 py-0.5 rounded text-[9px] font-bold uppercase",
                            loc.status === 'inactive' ? "bg-rose-50 text-rose-600" : "bg-emerald-50 text-emerald-600"
                          )}>
                            {loc.status || 'active'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button 
                              onClick={() => { setEditingItem(loc); setIsModalOpen(true); }}
                              className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                            >
                              <Edit2 size={12} />
                            </button>
                            {currentUser?.role === 'admin' && (
                              <button 
                                onClick={() => handleDelete('location', loc.id)}
                                className="p-1.5 text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                              >
                                <Trash2 size={12} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'categories' && (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-[#F9FAFB] border-b border-[#E5E7EB]">
                <tr>
                  <th className="px-4 py-2.5 text-[9px] font-bold text-[#6B7280] uppercase tracking-widest">Category Name</th>
                  <th className="px-4 py-2.5 text-[9px] font-bold text-[#6B7280] uppercase tracking-widest">Linked Locations</th>
                  <th className="px-4 py-2.5 text-[9px] font-bold text-[#6B7280] uppercase tracking-widest text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F3F4F6]">
                {filteredCategories.map(cat => {
                  const linkedCount = locations.filter(l => l.categoryId === cat.id).length;
                  return (
                    <tr key={cat.id} className="hover:bg-[#F9FAFB] transition-colors group">
                      <td className="px-4 py-3 text-xs font-bold text-[#1A1A1A]">{cat.name}</td>
                      <td className="px-4 py-3">
                        <span className="text-[10px] font-medium text-[#6B7280]">{linkedCount} Locations</span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button 
                            onClick={() => { setEditingItem(cat); setIsModalOpen(true); }}
                            className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                          >
                            <Edit2 size={12} />
                          </button>
                          {currentUser?.role === 'admin' && (
                            <button 
                              onClick={() => handleDelete('category', cat.id)}
                              className="p-1.5 text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                            >
                              <Trash2 size={12} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === 'codes' && (
          <div className="divide-y divide-[#F3F4F6]">
            <div className="p-4 bg-[#F9FAFB] flex flex-wrap gap-2">
              <button 
                onClick={() => setSelectedLocation(null)}
                className={cn(
                  "px-3 py-1 rounded-full text-[9px] font-bold uppercase tracking-wider transition-all",
                  !selectedLocation ? "bg-[#800020] text-white" : "bg-white text-[#6B7280] border border-[#E5E7EB] hover:bg-[#F3F4F6]"
                )}
              >
                All Locations
              </button>
              {locations.map(loc => (
                <button 
                  key={loc.id}
                  onClick={() => setSelectedLocation(loc.id)}
                  className={cn(
                    "px-3 py-1 rounded-full text-[9px] font-bold uppercase tracking-wider transition-all",
                    selectedLocation === loc.id ? "bg-[#800020] text-white" : "bg-white text-[#6B7280] border border-[#E5E7EB] hover:bg-[#F3F4F6]"
                  )}
                >
                  {loc.name}
                </button>
              ))}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-[#F9FAFB] border-b border-[#E5E7EB]">
                  <tr>
                    <th className="px-4 py-2.5 text-[9px] font-bold text-[#6B7280] uppercase tracking-widest">Code</th>
                    <th className="px-4 py-2.5 text-[9px] font-bold text-[#6B7280] uppercase tracking-widest">Access Area</th>
                    <th className="px-4 py-2.5 text-[9px] font-bold text-[#6B7280] uppercase tracking-widest">Location</th>
                    <th className="px-4 py-2.5 text-[9px] font-bold text-[#6B7280] uppercase tracking-widest text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F3F4F6]">
                  {filteredCodes.map(code => {
                    const loc = locations.find(l => l.id === code.locationId);
                    return (
                      <tr key={code.id} className="hover:bg-[#F9FAFB] transition-colors group">
                        <td className="px-4 py-3 text-[10px] font-bold text-[#800020]">{code.areaCode}</td>
                        <td className="px-4 py-3">
                          <p className="text-xs font-bold text-[#1A1A1A]">{code.accessArea}</p>
                          {code.description && <p className="text-[9px] text-[#6B7280] truncate max-w-xs">{code.description}</p>}
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-[10px] font-medium text-[#4B5563]">{loc?.name || 'Unknown'}</span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button 
                              onClick={() => { setEditingItem(code); setIsModalOpen(true); }}
                              className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                            >
                              <Edit2 size={12} />
                            </button>
                            {currentUser?.role === 'admin' && (
                              <button 
                                onClick={() => handleDelete('accessCode', code.id)}
                                className="p-1.5 text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                              >
                                <Trash2 size={12} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <Modal 
        isOpen={isModalOpen} 
        onClose={() => { setIsModalOpen(false); setEditingItem(null); }} 
        title={`${editingItem ? 'Edit' : 'Add New'} ${activeTab.charAt(0).toUpperCase() + activeTab.slice(1, -1)}`}
      >
        {activeTab === 'categories' && (
          <CategoryForm 
            category={editingItem} 
            onClose={() => setIsModalOpen(false)} 
            onSuccess={onSuccess} 
          />
        )}
        {activeTab === 'locations' && (
          <LocationForm 
            location={editingItem} 
            categories={categories} 
            onClose={() => setIsModalOpen(false)} 
            onSuccess={onSuccess} 
          />
        )}
        {activeTab === 'codes' && (
          <AccessCodeForm 
            accessCode={editingItem} 
            locations={locations} 
            categories={categories} 
            onClose={() => setIsModalOpen(false)} 
            onSuccess={onSuccess} 
          />
        )}
      </Modal>
    </div>
  );
}
