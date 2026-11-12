import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { History, Clock, ArrowRight } from 'lucide-react';
import { 
  Pass, PassApplication, Employee, Location, Category, AccessCode, Project, 
  UserProfile, Division, Department, AppAction 
} from '../types';
import { apiFetch, cn } from '../lib/utils';
import { Modal } from '../components/common/Modal';
import { PassSubmissionForm } from '../components/passes/PassSubmissionForm';
import { PassApplicationsView } from '../components/passes/PassApplicationsView';
import { PassStatusManagementView } from '../components/passes/PassStatusManagementView';

export interface PassesProps {
  passes: Pass[];
  applications?: PassApplication[];
  employees: Employee[];
  locations: Location[];
  categories: Category[];
  accessCodes: AccessCode[];
  projects: Project[];
  divisions?: Division[];
  departments?: Department[];
  allUsers?: UserProfile[];
  currentUser: UserProfile | null;
  onSuccess: () => void;
  globalSearch: string;
  showToast: (msg: string, type?: 'success' | 'error') => void;
  showConfirm: (title: string, message: string, onConfirm: () => void) => void;
  view?: 'applications' | 'status-management';
}

export function Passes({
  passes,
  applications = [],
  employees,
  locations,
  categories,
  accessCodes,
  projects,
  divisions = [],
  departments = [],
  currentUser,
  onSuccess,
  globalSearch,
  showToast,
  showConfirm,
  view = 'applications'
}: PassesProps) {
  const [isNewPassModalOpen, setIsNewPassModalOpen] = useState(false);
  const [passModalData, setPassModalData] = useState<any>(null);
  const [isNewApplicationModalOpen, setIsNewApplicationModalOpen] = useState(false);
  const [applicationModalData, setApplicationModalData] = useState<any>(null);
  const [recentActions, setRecentActions] = useState<AppAction[]>([]);
  const [showReplay, setShowReplay] = useState(false);

  const handleRevertPassStatus = async (passId: string) => {
    try {
      const res = await apiFetch(`/api/passes/${passId}/revert-status`, { method: 'PATCH' });
      if (res.ok) {
        showToast("Pass status reverted to active", 'success');
        logAction({
          type: 'status_reverted',
          title: 'Pass Status Reverted',
          details: `Pass ID: ${passId?.toUpperCase() || 'UNKNOWN'}`
        });
        onSuccess();
      }
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  const logAction = (action: Omit<AppAction, 'id' | 'timestamp'>) => {
    const newAction: AppAction = {
      ...action,
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString()
    };
    setRecentActions(prev => [newAction, ...prev].slice(0, 5));
  };

  return (
    <div className="space-y-6">
      <div className={cn(
        "grid grid-cols-1 gap-6 transition-all duration-300",
        showReplay ? "xl:grid-cols-[1fr_300px]" : "xl:grid-cols-1"
      )}>
        <div className="space-y-6">
          {view === 'applications' ? (
            <PassApplicationsView 
              passes={passes}
              applications={applications}
              employees={employees}
              locations={locations}
              categories={categories}
              accessCodes={accessCodes}
              projects={projects}
              currentUser={currentUser}
              onSuccess={onSuccess}
              globalSearch={globalSearch}
              onNewPass={(data) => { setPassModalData(data); setIsNewPassModalOpen(true); }}
              onNewApplication={(data) => { setApplicationModalData(data); setIsNewApplicationModalOpen(true); }}
              showToast={showToast}
              showConfirm={showConfirm}
              logAction={logAction}
              showReplay={showReplay}
              setShowReplay={setShowReplay}
            />
          ) : (
            <PassStatusManagementView 
              passes={passes}
              applications={applications}
              employees={employees}
              locations={locations}
              categories={categories}
              accessCodes={accessCodes}
              currentUser={currentUser}
              onSuccess={onSuccess}
              globalSearch={globalSearch}
              showToast={showToast}
              showConfirm={showConfirm}
              logAction={logAction}
              onRevertStatus={handleRevertPassStatus}
            />
          )}
        </div>

        {/* Action Replay / Recent Activity Sidebar */}
        <div className="space-y-4">
          <div className="flex items-center justify-between bg-white p-3 rounded-xl border border-[#E5E7EB] shadow-sm">
            <div className="flex items-center gap-2">
              <History size={16} className="text-[#800020]" />
              <p className="text-[11px] font-semibold text-[#111827] uppercase tracking-wider">Activity Log</p>
            </div>
            <button 
              onClick={() => setShowReplay(!showReplay)}
              className="px-2 py-1 bg-gray-100 rounded text-[9px] font-semibold text-[#6B7280] hover:text-[#800020] uppercase tracking-wider transition-colors"
            >
              {showReplay ? 'Hide' : 'Show'}
            </button>
          </div>

          <AnimatePresence>
            {showReplay && (
              <motion.div 
                initial={{ opacity: 0, x: 20, width: 0 }}
                animate={{ opacity: 1, x: 0, width: 'auto' }}
                exit={{ opacity: 0, x: 20, width: 0 }}
                className="space-y-3 overflow-hidden"
              >
                {recentActions.length > 0 ? (
                  recentActions.map(action => (
                    <div key={action.id} className="p-3 bg-white rounded-xl border border-[#E5E7EB] shadow-sm hover:border-[#800020]/20 transition-all group">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <div className={cn(
                            "w-1.5 h-1.5 rounded-full",
                            action.type.includes('approved') ? "bg-emerald-500" :
                            action.type.includes('rejected') ? "bg-rose-500" :
                            action.type.includes('deleted') ? "bg-rose-500" :
                            "bg-blue-500"
                          )} />
                          <p className="text-[11px] font-semibold text-[#1F2937]">{action.title}</p>
                        </div>
                        <p className="text-[10px] text-[#9CA3AF] font-medium">{new Date(action.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                      </div>
                      <p className="text-[10px] text-[#6B7280] mt-1 line-clamp-1">{action.details}</p>
                      {action.data?.id && (
                        <button 
                          onClick={() => {
                            showToast(`Action detail: ${action.title}`, 'success');
                          }}
                          className="mt-2 flex items-center gap-1 text-[10px] font-semibold text-[#800020] opacity-0 group-hover:opacity-100 transition-opacity uppercase tracking-wider"
                        >
                          <ArrowRight size={10} /> View details
                        </button>
                      )}
                    </div>
                  ))
                ) : (
                  <div className="p-8 text-center bg-gray-50 rounded-xl border border-dashed border-[#E5E7EB]">
                    <Clock size={20} className="mx-auto mb-2 text-[#9CA3AF]" />
                    <p className="text-[11px] font-semibold text-[#9CA3AF] uppercase tracking-wider">No recent activity</p>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <Modal 
        isOpen={isNewPassModalOpen} 
        onClose={() => { setIsNewPassModalOpen(false); setPassModalData(null); }} 
        title={passModalData?.applicationId ? "Issue Passes from Application" : (passModalData?.isDirect ? "Direct Entry Pass" : "New Pass Application")}
        size="6xl"
      >
        <PassSubmissionForm 
          employees={employees}
          locations={locations}
          categories={categories}
          accessCodes={accessCodes}
          projects={projects}
          divisions={divisions}
          departments={departments}
          passes={passes}
          applications={applications}
          onSuccess={onSuccess}
          onClose={() => { setIsNewPassModalOpen(false); setPassModalData(null); }}
          currentUser={currentUser}
          initialData={passModalData}
          logAction={logAction}
          showToast={showToast}
        />
      </Modal>

      <Modal 
        isOpen={isNewApplicationModalOpen} 
        onClose={() => { setIsNewApplicationModalOpen(false); setApplicationModalData(null); }} 
        title="New Pass Application"
        size="6xl"
      >
        <PassSubmissionForm 
          employees={employees}
          locations={locations}
          categories={categories}
          accessCodes={accessCodes}
          projects={projects}
          divisions={divisions}
          departments={departments}
          passes={passes}
          applications={applications}
          currentUser={currentUser}
          onSuccess={onSuccess}
          onClose={() => { setIsNewApplicationModalOpen(false); setApplicationModalData(null); }}
          initialData={applicationModalData}
          logAction={logAction}
          showToast={showToast}
        />
      </Modal>
    </div>
  );
}
