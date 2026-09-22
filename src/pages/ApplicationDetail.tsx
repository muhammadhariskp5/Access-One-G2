import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { 
  ArrowLeft, FileText, Users, MapPin, ShieldCheck, Clock, CheckCircle2, 
  XCircle, AlertCircle, Printer, Edit2, Edit3, Trash2, ExternalLink, Calendar, 
  Search, Filter, Check, Layers, Send, MessageSquare, RefreshCw, 
  UserCheck, History, Award, ChevronRight, User, Shield, Info, Download,
  UserPlus, Plus, Save, X, UserMinus, FileSpreadsheet, ClipboardCheck, Ban, ArrowRightCircle,
  Building2, Briefcase, Key, Hash, Tag
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { 
  PassApplication, Pass, Employee, Location, Category, AccessCode, 
  Project, Division, Department, UserProfile, ApplicationHistory, PassStatus
} from '../types';
import { apiFetch, cn, formatDate, parseToYMD } from '../lib/utils';
import { 
  calculateApplicationStats, computeApplicationRollupStatus, 
  getApplicationBadgeProps, resolvePersonnelStatus, getSkippedWorkflowStages,
  isWorkflowStageRollback
} from '../utils/passStatus';
import { Modal } from '../components/common/Modal';
import { PrintExportModal } from '../components/common/PrintExportModal';
import { PassDetails } from '../components/passes/PassDetails';
import { WorkflowStageStepper } from '../components/passes/WorkflowStageStepper';
import { StageSkipConfirmModal } from '../components/passes/StageSkipConfirmModal';
import { PassSubmissionForm } from '../components/passes/PassSubmissionForm';

interface ApplicationDetailProps {
  applications: PassApplication[];
  passes: Pass[];
  employees: Employee[];
  locations: Location[];
  categories: Category[];
  accessCodes: AccessCode[];
  projects: Project[];
  divisions: Division[];
  departments: Department[];
  currentUser: UserProfile | null;
  onSuccess: () => void;
  globalSearch?: string;
  showToast: (msg: string, type?: 'success' | 'error') => void;
  showConfirm: (title: string, message: string, onConfirm: () => void) => void;
  allUsers?: UserProfile[];
}

export function ApplicationDetail({
  applications,
  passes,
  employees,
  locations,
  categories,
  accessCodes,
  projects,
  divisions,
  departments,
  currentUser,
  onSuccess,
  globalSearch = '',
  showToast,
  showConfirm,
  allUsers = []
}: ApplicationDetailProps) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const locationRoute = useLocation();

  const [auditHistory, setAuditHistory] = useState<ApplicationHistory[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  
  // UI States
  const [activeTab, setActiveTab] = useState<'roster' | 'passes' | 'info' | 'history'>('roster');
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selectedEmpIds, setSelectedEmpIds] = useState<string[]>([]);
  
  // Modal states
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);
  const [isAppStatusModalOpen, setIsAppStatusModalOpen] = useState(false);
  const [isMemberStatusModalOpen, setIsMemberStatusModalOpen] = useState(false);
  const [isEditAppModalOpen, setIsEditAppModalOpen] = useState(false);
  const [isAddPersonnelModalOpen, setIsAddPersonnelModalOpen] = useState(false);
  const [isIssuePassModalOpen, setIsIssuePassModalOpen] = useState(false);
  const [issuePassModalData, setIssuePassModalData] = useState<any>(null);
  const [inspectingPass, setInspectingPass] = useState<Pass | null>(null);

  // Edit App Form State
  const [editAuthNum, setEditAuthNum] = useState('');
  const [editLocationId, setEditLocationId] = useState('');
  const [editType, setEditType] = useState('main');
  const [editParentPassId, setEditParentPassId] = useState('');
  const [editAccessCodes, setEditAccessCodes] = useState<string[]>([]);
  const [editContractNumber, setEditContractNumber] = useState('');
  const [editContractName, setEditContractName] = useState('');
  const [editClientCompany, setEditClientCompany] = useState('');
  const [editClientApprovers, setEditClientApprovers] = useState('');
  const [editStartDate, setEditStartDate] = useState('');
  const [editEndDate, setEditEndDate] = useState('');
  const [editRemarks, setEditRemarks] = useState('');
  const [editStatus, setEditStatus] = useState<string>('pending');
  const [editEmployeeIds, setEditEmployeeIds] = useState<string[]>([]);
  const [editIndExpiries, setEditIndExpiries] = useState<Record<string, string>>({});
  const [editIndStartDates, setEditIndStartDates] = useState<Record<string, string>>({});
  const [editPersonnelSearch, setEditPersonnelSearch] = useState<string>('');

  // Add Personnel Form State
  const [addPersonnelSearch, setAddPersonnelSearch] = useState('');
  const [selectedNewEmpIds, setSelectedNewEmpIds] = useState<string[]>([]);
  
  // Form / Action states
  const [targetAppStatus, setTargetAppStatus] = useState<string>('');
  const [appRemarks, setAppRemarks] = useState<string>('');
  const [targetMemberStatus, setTargetMemberStatus] = useState<string>('collected');
  const [memberRemarks, setMemberRemarks] = useState<string>('');
  const [receiverParty, setReceiverParty] = useState<string>('');
  const [isSubmittingAction, setIsSubmittingAction] = useState(false);
  const [stageSkipConfirmModal, setStageSkipConfirmModal] = useState<{
    currentStatus: string;
    targetStatus: string;
    entityName: string;
    onConfirm: () => Promise<void>;
  } | null>(null);

  // Match current application from URL parameter
  const application = useMemo(() => {
    if (!id) return null;
    const cleanId = id.trim().toLowerCase();
    return applications.find(a => 
      a.id?.trim().toLowerCase() === cleanId || 
      a.authorityAppNumber?.trim().toLowerCase() === cleanId
    ) || null;
  }, [applications, id]);

  // Find associated passes for this application
  const appPasses = useMemo(() => {
    if (!application?.id) return [];
    const cleanAppId = application.id.trim().toUpperCase();
    return passes.filter(p => {
      const pReqId = (p.requestId || p.applicationId || '').trim().toUpperCase();
      const pAuthId = (p.authorityAppNumber || '').trim().toUpperCase();
      return pReqId === cleanAppId || (pAuthId && pAuthId === cleanAppId);
    });
  }, [passes, application]);

  // Location and Category details
  const location = useMemo(() => {
    if (!application?.locationId) return null;
    return locations.find(l => l.id === application.locationId) || null;
  }, [locations, application]);

  const category = useMemo(() => {
    if (!location?.categoryId) return null;
    return categories.find(c => c.id === location.categoryId) || null;
  }, [categories, location]);

  // Helper to resolve an access code object
  const getAccessCodeInfo = useCallback((codeStr: string, locId?: string) => {
    const targetLocId = locId || location?.id;
    return accessCodes.find(ac => 
      (ac.locationId === targetLocId || !ac.locationId) && 
      (ac.areaCode === codeStr || ac.id === codeStr || ac.accessArea === codeStr)
    ) || accessCodes.find(ac => ac.areaCode === codeStr || ac.id === codeStr);
  }, [accessCodes, location]);

  // Combine all member employee IDs
  const allPersonnelIds = useMemo(() => {
    if (!application) return [];
    const set = new Set<string>([
      ...(application.employeeIds || []),
      ...appPasses.map(p => p.employeeId).filter(Boolean)
    ]);
    return Array.from(set);
  }, [application, appPasses]);

  // Combined personnel dataset with pass and status resolution
  const personnelData = useMemo(() => {
    return allPersonnelIds.map(empId => {
      const emp = employees.find(e => 
        e.id === empId || e.employeeId === empId || e.qatarId === empId || e.qidVisaNumber === empId
      );
      const pass = appPasses.find(p => 
        p.employeeId === empId || (emp && (p.employeeId === emp.id || p.employeeId === emp.employeeId))
      );
      const rawStatus = application?.employeeStatuses?.[empId] || application?.status || 'pending';
      const resolvedStatus = resolvePersonnelStatus(rawStatus, pass?.status, application?.status);

      return {
        id: empId,
        employee: emp,
        displayName: emp?.name || (typeof empId === 'string' && empId.startsWith('REF-') ? empId.replace('REF-', '') : `Personnel (${empId})`),
        code: emp?.employeeId || empId,
        qid: emp?.qatarId || emp?.qidVisaNumber || '—',
        jobTitle: emp?.jobTitle || 'Personnel',
        department: emp?.department || '—',
        pass,
        rawStatus,
        status: resolvedStatus.statusKey,
        statusLabel: resolvedStatus.label
      };
    });
  }, [allPersonnelIds, employees, appPasses, application]);

  // Filtered personnel
  const filteredPersonnel = useMemo(() => {
    return personnelData.filter(item => {
      const term = (globalSearch || searchTerm || '').trim().toLowerCase();
      const matchesSearch = term === '' || 
        item.displayName.toLowerCase().includes(term) ||
        item.code.toLowerCase().includes(term) ||
        item.qid.toLowerCase().includes(term) ||
        item.jobTitle.toLowerCase().includes(term) ||
        item.department.toLowerCase().includes(term);
      
      if (!matchesSearch) return false;
      if (statusFilter === 'all') return true;

      const s = (item.status || '').toLowerCase();
      const rawS = (item.rawStatus || '').toLowerCase();
      const passS = (item.pass?.status || '').toLowerCase();
      const filter = statusFilter.toLowerCase();

      if (filter === 'collected' || filter === 'active') {
        return s === 'active' || s === 'collected' || rawS === 'collected' || rawS === 'completed' || rawS === 'active' || passS === 'active' || passS === 'collected';
      }

      if (filter === 'issued') {
        return s === 'issued' || rawS === 'issued' || passS === 'issued';
      }

      if (filter === 'accepted' || filter === 'approved') {
        return s === 'accepted' || s === 'approved' || rawS === 'accepted' || rawS === 'approved' || passS === 'accepted' || passS === 'approved';
      }

      if (filter === 'processing') {
        return s === 'processing' || s === 'forwarded' || rawS === 'processing' || rawS === 'forwarded' || passS === 'processing';
      }

      if (filter === 'pending') {
        return s === 'pending' || rawS === 'pending' || passS === 'pending';
      }

      if (filter === 'rejected') {
        return s === 'rejected' || rawS === 'rejected' || passS === 'rejected';
      }

      if (filter === 'cancelled' || filter === 'revoked') {
        return s === 'cancelled' || s === 'revoked' || s === 'expired' || rawS === 'cancelled' || rawS === 'revoked' || rawS === 'expired' || passS === 'cancelled' || passS === 'revoked' || passS === 'expired';
      }

      return s === filter || rawS === filter;
    });
  }, [personnelData, searchTerm, globalSearch, statusFilter]);

  // Compute application stats
  const stats = useMemo(() => {
    return calculateApplicationStats(
      allPersonnelIds,
      application?.employeeStatuses || {},
      appPasses,
      application?.status
    );
  }, [allPersonnelIds, application, appPasses]);

  const computedAppStatus = useMemo(() => {
    if (!application) return 'pending';
    return computeApplicationRollupStatus(application.status, stats);
  }, [application, stats]);

  const currentWorkflowStatus = useMemo(() => {
    return (computedAppStatus || application?.status || 'pending').toLowerCase();
  }, [computedAppStatus, application?.status]);

  const isAppStage1 = useMemo(() => {
    return ['pending', 'under_review', 'review', 'clarification'].includes(currentWorkflowStatus);
  }, [currentWorkflowStatus]);

  const isAppStage2 = useMemo(() => {
    return ['processing', 'under_processing', 'forwarded'].includes(currentWorkflowStatus);
  }, [currentWorkflowStatus]);

  const isAppStage3 = useMemo(() => {
    return ['accepted', 'approved'].includes(currentWorkflowStatus);
  }, [currentWorkflowStatus]);

  const isAppStage4 = useMemo(() => {
    return ['issued', 'partially_issued', 'ready_for_collection', 'collected', 'completed', 'active'].includes(currentWorkflowStatus);
  }, [currentWorkflowStatus]);

  const badgeProps = useMemo(() => {
    return getApplicationBadgeProps(computedAppStatus, allPersonnelIds.length);
  }, [computedAppStatus, allPersonnelIds]);

  // Helper to find active Main Pass for an employee in a given location or category
  const findActiveMainPassForEmp = useCallback((empId: string, locId?: string, catId?: string, currentAppId?: string) => {
    const activeCurrentId = currentAppId || application?.id;
    const empObj = employees.find(e => e.id === empId || e.employeeId === empId || e.qatarId === empId);
    const possibleEmpIds = new Set([
      empId,
      empObj?.id,
      empObj?.employeeId,
      empObj?.qatarId
    ].filter(Boolean) as string[]);

    const targetCatId = catId || (locId ? locations.find(l => l.id === locId)?.categoryId : undefined) || category?.id || (application as any)?.categoryId;

    const currentIdentifiers = new Set<string>();
    const addId = (v?: any) => {
      if (v) currentIdentifiers.add(String(v).trim().toLowerCase());
    };
    addId(activeCurrentId);
    addId(application?.id);
    addId(application?.authorityAppNumber);

    return passes.find(p => {
      if (!possibleEmpIds.has(p.employeeId)) return false;
      const pReqId = (p.requestId || p.applicationId || '').trim().toLowerCase();
      const pAuth = (p.authorityAppNumber || '').trim().toLowerCase();
      if ((pReqId && currentIdentifiers.has(pReqId)) || (pAuth && currentIdentifiers.has(pAuth))) return false;
      if (p.type !== 'main') return false;
      if (p.status === 'expired' || p.status === 'revoked' || p.status === 'cancelled' || p.status === 'replaced' || p.status === 'rejected') return false;
      const passLoc = locations.find(l => l.id === p.locationId);
      const passCatId = (p as any).categoryId || passLoc?.categoryId;
      if (targetCatId && passCatId) {
        return passCatId === targetCatId;
      }
      if (locId && p.locationId === locId) return true;
      return false;
    });
  }, [employees, passes, locations, category, application]);

  const findActiveMainAppForEmp = useCallback((empId: string, locId?: string, catId?: string, currentAppId?: string) => {
    const activeCurrentId = currentAppId || application?.id;
    const empObj = employees.find(e => e.id === empId || e.employeeId === empId || e.qatarId === empId);
    const possibleEmpIds = new Set([
      empId,
      empObj?.id,
      empObj?.employeeId,
      empObj?.qatarId
    ].filter(Boolean) as string[]);

    const targetCatId = catId || (locId ? locations.find(l => l.id === locId)?.categoryId : undefined) || category?.id || (application as any)?.categoryId;

    const currentIdentifiers = new Set<string>();
    const addId = (v?: any) => {
      if (v) currentIdentifiers.add(String(v).trim().toLowerCase());
    };
    addId(activeCurrentId);
    addId(application?.id);
    addId(application?.authorityAppNumber);

    return applications.find(a => {
      const aId = String(a.id || '').trim().toLowerCase();
      const aAuth = String(a.authorityAppNumber || '').trim().toLowerCase();
      if ((aId && currentIdentifiers.has(aId)) || (aAuth && currentIdentifiers.has(aAuth))) return false;
      if (a.type !== 'main') return false;
      if (a.status === 'rejected' || a.status === 'cancelled' || a.status === 'archived') return false;

      const appEmpIds = a.employeeIds || [];
      const matchedEmpId = appEmpIds.find(id => possibleEmpIds.has(id));
      if (!matchedEmpId) return false;

      if (a.employeeStatuses?.[matchedEmpId] === 'rejected' || a.employeeStatuses?.[matchedEmpId] === 'cancelled') return false;

      const appLoc = locations.find(l => l.id === a.locationId);
      const appCatId = (a as any).categoryId || appLoc?.categoryId;
      if (targetCatId && appCatId) {
        return appCatId === targetCatId;
      }
      if (locId && a.locationId === locId) return true;
      return false;
    });
  }, [employees, applications, locations, category, application]);

  // Fetch Audit History
  const fetchHistory = useCallback(async () => {
    if (!application?.id) return;
    setIsLoadingHistory(true);
    try {
      const res = await apiFetch(`/api/passApplications/${application.id}/history`);
      if (res.ok) {
        const data = await res.json();
        setAuditHistory(data);
      }
    } catch (err) {
      console.error("Failed to load audit log:", err);
    } finally {
      setIsLoadingHistory(false);
    }
  }, [application?.id]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  // Action: Select All / Deselect All
  const handleToggleSelectAll = () => {
    if (selectedEmpIds.length === filteredPersonnel.length) {
      setSelectedEmpIds([]);
    } else {
      setSelectedEmpIds(filteredPersonnel.map(p => p.id));
    }
  };

  const handleToggleSelectEmp = (empId: string) => {
    setSelectedEmpIds(prev => 
      prev.includes(empId) ? prev.filter(id => id !== empId) : [...prev, empId]
    );
  };

  // Action: Update Application Status
  const executeAppStatusUpdate = async (statusToSet: string, remarksToSet: string) => {
    if (!application) return;
    setIsSubmittingAction(true);
    try {
      const res = await apiFetch(`/api/passApplications/${application.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: statusToSet,
          remarks: remarksToSet,
          approverId: currentUser?.id
        })
      });

      if (res.ok) {
        showToast(`Application status updated to ${statusToSet}`);
        setIsAppStatusModalOpen(false);
        setAppRemarks('');
        setStageSkipConfirmModal(null);
        await onSuccess();
        fetchHistory();
      } else {
        const err = await res.json();
        showToast(err.error || 'Failed to update application status', 'error');
      }
    } catch (err: any) {
      showToast(err.message || 'Error updating status', 'error');
    } finally {
      setIsSubmittingAction(false);
    }
  };

  const handleUpdateAppStatus = async () => {
    if (!targetAppStatus || !application) return;

    // Check if moving backward / rolling back
    if (isWorkflowStageRollback(application.status, targetAppStatus) && !appRemarks.trim()) {
      showToast("Mandatory Audit Requirement: Please provide a reason/remark for reverting the workflow stage.", "error");
      return;
    }

    const skipped = getSkippedWorkflowStages(application.status, targetAppStatus);
    if (skipped.length > 0) {
      setStageSkipConfirmModal({
        currentStatus: application.status,
        targetStatus: targetAppStatus,
        entityName: `Application #${application.authorityAppNumber || application.id}`,
        onConfirm: async () => {
          await executeAppStatusUpdate(targetAppStatus, appRemarks);
        }
      });
      return;
    }
    await executeAppStatusUpdate(targetAppStatus, appRemarks);
  };

  // Action: Update Member Status (Batch or Single)
  const executeBatchMemberStatus = async (statusToSet: string, receiverToSet: string, remarksToSet?: string) => {
    if (!application) return;
    setIsSubmittingAction(true);
    try {
      const res = await apiFetch(`/api/passApplications/${application.id}/employeeStatus`, {
        method: 'PATCH',
        body: JSON.stringify({
          employeeIds: selectedEmpIds,
          status: statusToSet,
          remarks: remarksToSet,
          handoverBy: receiverToSet || currentUser?.name || 'Administrator'
        })
      });

      if (res.ok) {
        showToast(`Updated ${selectedEmpIds.length} personnel to status "${statusToSet}"`);
        setIsMemberStatusModalOpen(false);
        setSelectedEmpIds([]);
        setReceiverParty('');
        setMemberRemarks('');
        setStageSkipConfirmModal(null);
        await onSuccess();
        fetchHistory();
      } else {
        const err = await res.json();
        showToast(err.error || 'Failed to update member status', 'error');
      }
    } catch (err: any) {
      showToast(err.message || 'Error updating member status', 'error');
    } finally {
      setIsSubmittingAction(false);
    }
  };

  const handleBatchMemberStatus = async () => {
    if (selectedEmpIds.length === 0 || !application) return;
    if (targetMemberStatus === 'collected') {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const prematureEmpId = selectedEmpIds.find(empId => {
        const passForEmp = appPasses.find(p => p.employeeId === empId);
        const rawStart = (application.individualStartDates as any)?.[empId] || (application as any).startDate || passForEmp?.startDate;
        if (!rawStart) return false;
        const sTime = new Date(rawStart).getTime();
        return sTime > today.getTime() + (7 * 24 * 60 * 60 * 1000);
      });

      if (prematureEmpId) {
        const rawStart = (application.individualStartDates as any)?.[prematureEmpId] || (application as any).startDate;
        const sDate = parseToYMD(rawStart);
        const oneWeekBefore = new Date(new Date(rawStart).getTime() - (7 * 24 * 60 * 60 * 1000)).toISOString().split('T')[0];
        showToast(`Early Renewal Pass cannot be collected yet. Passes can only be collected within 1 week of start date (${formatDate(sDate)}), available starting ${formatDate(oneWeekBefore)}.`, 'error');
        return;
      }
    }

    const firstEmpCurrentStatus = application.employeeStatuses?.[selectedEmpIds[0]] || application.status || 'pending';

    // Check if moving backward / rolling back
    if (isWorkflowStageRollback(firstEmpCurrentStatus, targetMemberStatus) && !memberRemarks.trim()) {
      showToast("Mandatory Audit Requirement: Please provide a reason/remark for reverting applicant status.", "error");
      return;
    }

    const skipped = getSkippedWorkflowStages(firstEmpCurrentStatus, targetMemberStatus);
    if (skipped.length > 0) {
      setStageSkipConfirmModal({
        currentStatus: firstEmpCurrentStatus,
        targetStatus: targetMemberStatus,
        entityName: `${selectedEmpIds.length} Personnel Member(s)`,
        onConfirm: async () => {
          await executeBatchMemberStatus(targetMemberStatus, receiverParty, memberRemarks);
        }
      });
      return;
    }
    await executeBatchMemberStatus(targetMemberStatus, receiverParty, memberRemarks);
  };

  // Action: Un-archive Application
  const handleUnarchiveApp = () => {
    if (!application) return;
    showConfirm(
      "Un-archive Application",
      `Are you sure you want to un-archive Application #${application.authorityAppNumber || application.id}? It will be restored and become editable again.`,
      async () => {
        setIsSubmittingAction(true);
        try {
          const res = await apiFetch(`/api/passApplications/${application.id}/status`, {
            method: 'PATCH',
            body: JSON.stringify({
              status: 'completed',
              remarks: 'Restored from archive by Administrator',
              approverId: currentUser?.id
            })
          });

          if (res.ok) {
            showToast("Application successfully restored from archive");
            await onSuccess();
            fetchHistory();
          } else {
            showToast("Failed to un-archive application", "error");
          }
        } catch (err: any) {
          showToast(err.message || "Error restoring application", "error");
        } finally {
          setIsSubmittingAction(false);
        }
      }
    );
  };

  // Action: Delete Application
  const handleDeleteApp = () => {
    showConfirm(
      "Delete Application",
      `Are you sure you want to permanently delete application ${application?.id}? This action cannot be undone.`,
      async () => {
        if (!application) return;
        try {
          const res = await apiFetch(`/api/passApplications/${application.id}`, {
            method: 'DELETE'
          });
          if (res.ok) {
            showToast("Application deleted successfully");
            onSuccess();
            navigate('/applications');
          } else {
            showToast("Failed to delete application", "error");
          }
        } catch (err) {
          showToast("Error deleting application", "error");
        }
      }
    );
  };

  // Available employees for adding to this application
  const availableEmployeesToAdd = useMemo(() => {
    if (!application) return [];
    const existingSet = new Set(allPersonnelIds);
    return employees.filter(e => {
      if (existingSet.has(e.id) || existingSet.has(e.employeeId)) return false;
      if (!addPersonnelSearch.trim()) return true;
      const term = addPersonnelSearch.trim().toLowerCase();
      return (
        e.name?.toLowerCase().includes(term) ||
        e.employeeId?.toLowerCase().includes(term) ||
        e.jobTitle?.toLowerCase().includes(term) ||
        e.department?.toLowerCase().includes(term) ||
        e.qatarId?.toLowerCase().includes(term)
      );
    });
  }, [employees, allPersonnelIds, application, addPersonnelSearch]);

  const handleQuickApproveSingleMember = async (empId: string, empName: string) => {
    if (!application) return;
    setIsSubmittingAction(true);
    try {
      const res = await apiFetch(`/api/passApplications/${application.id}/employeeStatus`, {
        method: 'PATCH',
        body: JSON.stringify({
          employeeIds: [empId],
          status: 'processing',
          remarks: 'Approved — Moved to Stage 2: Under Processing'
        })
      });

      if (res.ok) {
        showToast(`Pass approved for ${empName} (Stage 2: Under Processing)`);
        await onSuccess();
        fetchHistory();
      } else {
        const err = await res.json();
        showToast(err.error || 'Failed to approve pass', 'error');
      }
    } catch (err: any) {
      showToast(err.message || 'Error approving pass', 'error');
    } finally {
      setIsSubmittingAction(false);
    }
  };

  const handleQuickAcceptSingleMember = async (empId: string, empName: string) => {
    if (!application) return;
    setIsSubmittingAction(true);
    try {
      const res = await apiFetch(`/api/passApplications/${application.id}/employeeStatus`, {
        method: 'PATCH',
        body: JSON.stringify({
          employeeIds: [empId],
          status: 'accepted',
          remarks: 'Accepted for Processing — Moved to Stage 3: Accepted for Processing',
          handoverBy: currentUser?.name || 'Administrator'
        })
      });

      if (res.ok) {
        showToast(`Pass accepted for processing for ${empName} (Stage 3: Accepted for Processing)`);
        await onSuccess();
        fetchHistory();
      } else {
        const err = await res.json();
        showToast(err.error || 'Failed to accept pass', 'error');
      }
    } catch (err: any) {
      showToast(err.message || 'Error accepting pass', 'error');
    } finally {
      setIsSubmittingAction(false);
    }
  };

  const handleQuickCollectSingleMember = async (empId: string, empName: string) => {
    if (!application) return;
    setIsSubmittingAction(true);
    try {
      const res = await apiFetch(`/api/passApplications/${application.id}/employeeStatus`, {
        method: 'PATCH',
        body: JSON.stringify({
          employeeIds: [empId],
          status: 'collected',
          handoverBy: currentUser?.name || 'Security Counter'
        })
      });

      if (res.ok) {
        showToast(`Pass collected for ${empName}`);
        await onSuccess();
        fetchHistory();
      } else {
        const err = await res.json();
        showToast(err.error || 'Failed to mark pass as collected', 'error');
      }
    } catch (err: any) {
      showToast(err.message || 'Error marking pass collected', 'error');
    } finally {
      setIsSubmittingAction(false);
    }
  };

  const handleQuickRejectSingleMember = async (empId: string, empName: string) => {
    if (!application) return;
    showConfirm(
      "Reject Personnel Pass",
      `Are you sure you want to reject the pass application for ${empName}?`,
      async () => {
        setIsSubmittingAction(true);
        try {
          const res = await apiFetch(`/api/passApplications/${application.id}/employeeStatus`, {
            method: 'PATCH',
            body: JSON.stringify({
              employeeIds: [empId],
              status: 'rejected',
              remarks: 'Rejected by Security / Administrator'
            })
          });

          if (res.ok) {
            showToast(`Pass application rejected for ${empName}`);
            await onSuccess();
            fetchHistory();
          } else {
            const err = await res.json();
            showToast(err.error || 'Failed to reject pass', 'error');
          }
        } catch (err: any) {
          showToast(err.message || 'Error rejecting pass', 'error');
        } finally {
          setIsSubmittingAction(false);
        }
      }
    );
  };

  const handleQuickReopenSingleMember = async (empId: string, empName: string) => {
    if (!application) return;
    setIsSubmittingAction(true);
    try {
      const targetSt = (application.status === 'accepted' || application.status === 'issued') ? 'accepted' : (application.status === 'processing' ? 'processing' : 'pending');
      const res = await apiFetch(`/api/passApplications/${application.id}/employeeStatus`, {
        method: 'PATCH',
        body: JSON.stringify({
          employeeIds: [empId],
          status: targetSt,
          remarks: `Re-opened applicant: reset to ${targetSt}`,
          handoverBy: currentUser?.name || 'Administrator'
        })
      });

      if (res.ok) {
        showToast(`Re-opened applicant ${empName} (${targetSt})`);
        await onSuccess();
        fetchHistory();
      } else {
        const err = await res.json();
        showToast(err.error || 'Failed to re-open applicant', 'error');
      }
    } catch (err: any) {
      showToast(err.message || 'Error re-opening applicant', 'error');
    } finally {
      setIsSubmittingAction(false);
    }
  };

  const handleQuickCollectAllPasses = async () => {
    if (!application) return;
    setIsSubmittingAction(true);
    try {
      const res = await apiFetch(`/api/passApplications/${application.id}/employeeStatus`, {
        method: 'PATCH',
        body: JSON.stringify({
          employeeIds: allPersonnelIds,
          status: 'collected',
          handoverBy: currentUser?.name || 'Security Counter'
        })
      });

      if (res.ok) {
        showToast(`All passes marked as Collected for #${application.authorityAppNumber || application.id}`);
        await onSuccess();
        fetchHistory();
      } else {
        const err = await res.json();
        showToast(err.error || 'Failed to mark all passes as collected', 'error');
      }
    } catch (err: any) {
      showToast(err.message || 'Error collecting passes', 'error');
    } finally {
      setIsSubmittingAction(false);
    }
  };

  const handleOpenIssueAllPasses = useCallback(async () => {
    if (!application) return;
    const curStatus = (computedAppStatus || application.status || '').toLowerCase();
    if (['processing', 'under_processing', 'forwarded'].includes(curStatus)) {
      try {
        await apiFetch(`/api/passApplications/${application.id}/status`, {
          method: 'PATCH',
          body: JSON.stringify({
            status: 'accepted',
            approverId: currentUser?.id,
            remarks: 'Application accepted for pass issuance (Stage 3)'
          })
        });
        await onSuccess();
      } catch (e) {
        console.error(e);
      }
    }
    const unissuedEmpIds = allPersonnelIds.filter(id => !appPasses.some(p => p.employeeId === id));
    setIssuePassModalData({
      id: application.id,
      applicationId: application.id,
      status: application.status,
      employeeIds: unissuedEmpIds.length > 0 ? unissuedEmpIds : allPersonnelIds,
      locationId: application.locationId,
      accessCodes: application.accessCodes,
      type: application.type || 'main',
      parentPassId: application.parentPassId,
      startDate: application.startDate,
      expiryDate: application.endDate || application.expiryDate,
      individualStartDates: application.individualStartDates,
      individualExpiries: application.individualExpiries,
      authorityAppNumber: application.authorityAppNumber,
      remarks: application.remarks,
      projectId: application.projectId,
      contractNumber: application.contractNumber,
      contractName: application.contractName,
      clientCompany: application.clientCompany,
      clientApprovers: application.clientApprovers
    });
    setIsIssuePassModalOpen(true);
  }, [application, allPersonnelIds, appPasses, computedAppStatus, currentUser, onSuccess]);

  const handleOpenIssuePassForMember = useCallback(async (empId: string) => {
    if (!application) return;
    const empStatus = ((application.employeeStatuses as any)?.[empId] || application.status || '').toLowerCase();
    if (['processing', 'under_processing', 'forwarded'].includes(empStatus)) {
      try {
        await apiFetch(`/api/passApplications/${application.id}/employeeStatus`, {
          method: 'PATCH',
          body: JSON.stringify({
            employeeIds: [empId],
            status: 'accepted',
            remarks: 'Accepted for Pass Issuance'
          })
        });
        await onSuccess();
      } catch (e) {
        console.error(e);
      }
    }
    setIssuePassModalData({
      id: application.id,
      applicationId: application.id,
      status: application.status,
      employeeIds: [empId],
      locationId: application.locationId,
      accessCodes: application.accessCodes,
      type: application.type || 'main',
      parentPassId: application.parentPassId,
      startDate: (application.individualStartDates as any)?.[empId] || application.startDate,
      expiryDate: (application.individualExpiries as any)?.[empId] || application.endDate || application.expiryDate,
      individualStartDates: application.individualStartDates,
      individualExpiries: application.individualExpiries,
      authorityAppNumber: application.authorityAppNumber,
      remarks: application.remarks,
      projectId: application.projectId,
      contractNumber: application.contractNumber,
      contractName: application.contractName,
      clientCompany: application.clientCompany,
      clientApprovers: application.clientApprovers
    });
    setIsIssuePassModalOpen(true);
  }, [application, onSuccess]);

  const handleOpenEditApp = useCallback(() => {
    if (!application) return;
    setEditAuthNum(application.authorityAppNumber || '');
    setEditLocationId(application.locationId || '');
    setEditType(application.type || 'main');
    setEditParentPassId(application.parentPassId || '');
    setEditAccessCodes(application.accessCodes || []);
    setEditContractNumber(application.contractNumber || '');
    setEditContractName(application.contractName || '');
    setEditClientCompany(application.clientCompany || '');
    setEditClientApprovers(application.clientApprovers || '');

    const appPassesList = passes.filter(p => (p.requestId || p.applicationId || '').trim().toUpperCase() === application.id.trim().toUpperCase());
    const firstPassStart = appPassesList[0]?.startDate;
    const firstPassEnd = appPassesList[0]?.expiryDate;

    const indExp = (application as any).individualExpiries || {};
    const indStart = (application as any).individualStartDates || {};

    const indExpValues = Object.values(indExp).map(v => parseToYMD(v as string)).filter(Boolean) as string[];
    const maxIndExp = indExpValues.length > 0 ? indExpValues.sort().reverse()[0] : '';

    const startVal = parseToYMD(application.startDate) || parseToYMD(firstPassStart) || parseToYMD(new Date().toISOString());
    const endVal = parseToYMD(application.endDate || application.expiryDate) || parseToYMD(firstPassEnd) || maxIndExp;

    setEditStartDate(startVal);
    setEditEndDate(endVal);
    setEditRemarks(application.remarks || '');
    setEditStatus(application.status || 'pending');

    const empIds = application.employeeIds || [];
    setEditEmployeeIds(empIds);

    const initialIndExp: Record<string, string> = {};
    const initialIndStart: Record<string, string> = {};

    empIds.forEach(empId => {
      const passForEmp = appPassesList.find(p => p.employeeId === empId);
      initialIndExp[empId] = parseToYMD(indExp[empId]) || parseToYMD(passForEmp?.expiryDate) || endVal;
      initialIndStart[empId] = parseToYMD(indStart[empId]) || parseToYMD(passForEmp?.startDate) || startVal;
    });

    setEditIndExpiries(initialIndExp);
    setEditIndStartDates(initialIndStart);
    setEditPersonnelSearch('');
    setIsEditAppModalOpen(true);
  }, [application, passes]);

  useEffect(() => {
    const searchParams = new URLSearchParams(locationRoute.search);
    if (searchParams.get('edit') === 'true' && application) {
      handleOpenEditApp();
      navigate(locationRoute.pathname, { replace: true });
    }
  }, [locationRoute.search, application, handleOpenEditApp, locationRoute.pathname, navigate]);

  const handleSaveEditApp = async () => {
    if (!application) return;
    setIsSubmittingAction(true);
    try {
      const targetCatId = locations.find(l => l.id === editLocationId)?.categoryId || category?.id || (application as any)?.categoryId;
      const firstEmpId = editEmployeeIds[0];
      const autoParent = firstEmpId ? (findActiveMainPassForEmp(firstEmpId, editLocationId, targetCatId) || findActiveMainAppForEmp(firstEmpId, editLocationId, targetCatId, application.id)) : null;
      const resolvedParentPassId = editType === 'supplementary' ? (editParentPassId || autoParent?.id || null) : null;

      const expValues = Object.values(editIndExpiries).map(v => parseToYMD(v as string)).filter(Boolean) as string[];
      const computedEndDate = editEndDate || (expValues.length > 0 ? expValues.sort().reverse()[0] : '');

      const res = await apiFetch(`/api/passApplications/${application.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          authorityAppNumber: editAuthNum || null,
          locationId: editLocationId,
          type: editType,
          parentPassId: resolvedParentPassId,
          accessCodes: editAccessCodes,
          contractNumber: editContractNumber || null,
          contractName: editContractName || null,
          clientCompany: editClientCompany || null,
          clientApprovers: editClientApprovers || null,
          startDate: editStartDate,
          endDate: computedEndDate,
          expiryDate: computedEndDate,
          employeeIds: editEmployeeIds,
          individualStartDates: editIndStartDates,
          individualExpiries: editIndExpiries,
          status: editStatus,
          remarks: editRemarks
        })
      });

      if (res.ok) {
        showToast("Application details updated successfully");
        setIsEditAppModalOpen(false);
        await onSuccess();
        fetchHistory();
      } else {
        const err = await res.json();
        showToast(err.error || "Failed to update application", "error");
      }
    } catch (err: any) {
      showToast(err.message || "Error updating application", "error");
    } finally {
      setIsSubmittingAction(false);
    }
  };

  const handleAddPersonnelSubmit = async () => {
    if (!application || selectedNewEmpIds.length === 0) return;
    setIsSubmittingAction(true);
    try {
      const currentEmpIds = application.employeeIds || [];
      const updatedEmpIds = Array.from(new Set([...currentEmpIds, ...selectedNewEmpIds]));
      const updatedStatuses = { ...(application.employeeStatuses || {}) };
      selectedNewEmpIds.forEach(empId => {
        updatedStatuses[empId] = application.status === 'completed' ? 'collected' : 'pending';
      });

      const res = await apiFetch(`/api/passApplications/${application.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          employeeIds: updatedEmpIds,
          employeeStatuses: updatedStatuses
        })
      });

      if (res.ok) {
        showToast(`Successfully added ${selectedNewEmpIds.length} personnel to application`);
        setIsAddPersonnelModalOpen(false);
        setSelectedNewEmpIds([]);
        setAddPersonnelSearch('');
        await onSuccess();
        fetchHistory();
      } else {
        const err = await res.json();
        showToast(err.error || "Failed to add personnel", "error");
      }
    } catch (err: any) {
      showToast(err.message || "Error adding personnel", "error");
    } finally {
      setIsSubmittingAction(false);
    }
  };

  const handleRemovePersonnel = (empId: string, empName: string) => {
    if (!application) return;
    showConfirm(
      "Remove Personnel",
      `Are you sure you want to remove ${empName} from this application?`,
      async () => {
        try {
          const updatedEmpIds = (application.employeeIds || []).filter(id => id !== empId);
          const updatedStatuses = { ...(application.employeeStatuses || {}) };
          delete updatedStatuses[empId];

          const res = await apiFetch(`/api/passApplications/${application.id}`, {
            method: 'PATCH',
            body: JSON.stringify({
              employeeIds: updatedEmpIds,
              employeeStatuses: updatedStatuses
            })
          });

          if (res.ok) {
            showToast(`Removed ${empName} from application`);
            await onSuccess();
            fetchHistory();
          } else {
            showToast("Failed to remove personnel", "error");
          }
        } catch (err) {
          showToast("Error removing personnel", "error");
        }
      }
    );
  };

  const handleExportApplicationExcel = () => {
    if (!application) return;

    try {
      const wb = XLSX.utils.book_new();

      // 1. Primary Sheet: Complete "Pass Application Report" (Header + Summary Stats + Full Applicants Table)
      const primarySheetRows: any[][] = [
        ["PASS APPLICATION SUMMARY & REPORT", ""],
        ["Generated At", new Date().toLocaleString()],
        ["", ""],
        ["Application Reference", `#${application.id.toUpperCase()}`],
        ["Authority Application No", application.authorityAppNumber || "—"],
        ["Application Status", application.status.toUpperCase()],
        ["Workflow Stage Status", (computedAppStatus || application.status).toUpperCase()],
        ["Pass Type", (application.type || "main").toUpperCase()],
        ["Location", location ? `${location.name} (${location.code})` : "—"],
        ["Category", category ? category.name : "General"],
        ["Contract Number", application.contractNumber || "—"],
        ["Contract Title", application.contractTitle || "—"],
        ["Client Approvers", application.clientApprovers || "—"],
        ["Access Zones", (application.accessCodes || []).join(", ") || "—"],
        ["Submission Date", formatDate(application.createdAt)],
        ["", ""],
        ["STATUS BREAKDOWN", ""],
        ["Total Applicants", allPersonnelIds.length],
        ["Collected / Active Passes", stats.collectedCount ?? stats.active ?? 0],
        ["Accepted / In Processing", (stats.processingCount ?? 0) + (stats.acceptedCount ?? 0)],
        ["Pending Review", stats.pendingCount ?? 0],
        ["Rejected", stats.rejectedCount ?? 0],
        ["Cancelled", stats.cancelledCount ?? 0],
        ["", ""],
        ["APPLICANT PERSONNEL ROSTER & PASS DETAILS", ""],
        [
          "S/N",
          "Personnel Name",
          "Qatar ID / Visa No",
          "Employee Code",
          "Department",
          "Job Title",
          "Nationality",
          "Assigned Pass #",
          "Pass Valid From",
          "Pass Valid To",
          "Member Status",
          "Card Serial No"
        ]
      ];

      personnelData.forEach((p, index) => {
        const indExp = (application.individualExpiries as any)?.[p.id];
        const indStart = (application.individualStartDates as any)?.[p.id];
        const pExp = p.pass?.expiryDate || indExp || application.endDate;
        const pStart = p.pass?.startDate || indStart || application.startDate;

        primarySheetRows.push([
          (index + 1).toString(),
          p.displayName || "—",
          p.qid || "—",
          p.code || "—",
          p.department || "—",
          p.jobTitle || "—",
          p.employee?.nationality || "—",
          p.pass?.passNumber ? `#${p.pass.passNumber}` : (p.pass?.id ? `#${p.pass.id.toUpperCase()}` : "Pending Issue"),
          formatDate(pStart),
          formatDate(pExp),
          (p.statusLabel || p.status || "Pending").toUpperCase(),
          p.pass?.cardNumber || "—"
        ]);
      });

      const primaryWs = XLSX.utils.aoa_to_sheet(primarySheetRows);
      primaryWs['!cols'] = [
        { wch: 6 },
        { wch: 28 },
        { wch: 20 },
        { wch: 16 },
        { wch: 20 },
        { wch: 22 },
        { wch: 16 },
        { wch: 18 },
        { wch: 16 },
        { wch: 16 },
        { wch: 18 },
        { wch: 18 }
      ];
      XLSX.utils.book_append_sheet(wb, primaryWs, "Application & Applicants");

      // 2. Sheet 2: Dedicated Clean Table "Applicants Roster" (Perfect for data sorting & filtering)
      const rosterHeaders = [
        "S/N",
        "Personnel Name",
        "Qatar ID / Visa No",
        "Employee Code",
        "Department",
        "Job Title",
        "Nationality",
        "Assigned Pass #",
        "Pass Valid From",
        "Pass Valid To",
        "Member Status",
        "Card Serial No"
      ];

      const rosterRows = personnelData.map((p, index) => {
        const indExp = (application.individualExpiries as any)?.[p.id];
        const indStart = (application.individualStartDates as any)?.[p.id];
        const pExp = p.pass?.expiryDate || indExp || application.endDate;
        const pStart = p.pass?.startDate || indStart || application.startDate;

        return [
          (index + 1).toString(),
          p.displayName || "—",
          p.qid || "—",
          p.code || "—",
          p.department || "—",
          p.jobTitle || "—",
          p.employee?.nationality || "—",
          p.pass?.passNumber ? `#${p.pass.passNumber}` : (p.pass?.id ? `#${p.pass.id.toUpperCase()}` : "Pending Issue"),
          formatDate(pStart),
          formatDate(pExp),
          (p.statusLabel || p.status || "Pending").toUpperCase(),
          p.pass?.cardNumber || "—"
        ];
      });

      const rosterWs = XLSX.utils.aoa_to_sheet([rosterHeaders, ...rosterRows]);
      rosterWs['!cols'] = [
        { wch: 6 },
        { wch: 28 },
        { wch: 20 },
        { wch: 16 },
        { wch: 20 },
        { wch: 22 },
        { wch: 16 },
        { wch: 18 },
        { wch: 16 },
        { wch: 16 },
        { wch: 18 },
        { wch: 18 }
      ];
      XLSX.utils.book_append_sheet(wb, rosterWs, "Applicants Roster");

      // 3. Sheet 3: Audit Trail Log (if available)
      if (auditHistory.length > 0) {
        const auditHeaders = ["S/N", "Timestamp", "Action", "Performed By", "Remarks"];
        const auditRows = auditHistory.map((a, idx) => [
          (idx + 1).toString(),
          formatDate(a.timestamp),
          (a.action || "").replace(/_/g, " ").toUpperCase(),
          a.userName || a.userId || "System",
          a.remarks || "—"
        ]);
        const auditWs = XLSX.utils.aoa_to_sheet([auditHeaders, ...auditRows]);
        auditWs['!cols'] = [{ wch: 6 }, { wch: 20 }, { wch: 25 }, { wch: 20 }, { wch: 45 }];
        XLSX.utils.book_append_sheet(wb, auditWs, "Audit Trail");
      }

      const filename = `Application_${application.authorityAppNumber || application.id}_Report.xlsx`;
      XLSX.writeFile(wb, filename);
      showToast(`Exported complete application & applicant details to ${filename}`, 'success');
    } catch (err: any) {
      console.error("Failed to export Excel:", err);
      showToast("Error generating Excel export", "error");
    }
  };

  if (!application) {
    return (
      <div className="p-12 text-center bg-white rounded-3xl border border-[#E5E7EB]">
        <p className="text-[#9CA3AF] text-sm italic">Pass Application not found.</p>
        <button 
          onClick={() => navigate('/applications')}
          className="mt-4 text-[#800020] font-bold text-sm hover:underline flex items-center justify-center gap-2 mx-auto cursor-pointer"
        >
          <ArrowLeft size={16} />
          Back to Applications List
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-16">
      {/* Top Header & Breadcrumb */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <button 
            onClick={() => navigate('/applications')}
            className="inline-flex items-center gap-2 text-xs font-bold text-[#800020] hover:text-[#600018] transition-colors mb-2 cursor-pointer"
          >
            <ArrowLeft size={16} />
            Back to Applications Directory
          </button>
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="text-xl font-bold text-[#1A1A1A] tracking-tight">
              Application #{application.authorityAppNumber || application.id}
            </h1>
            <span className={cn("px-2.5 py-0.5 rounded-full text-[11px] font-medium uppercase tracking-wider", badgeProps.badgeClass)}>
              {badgeProps.text}
            </span>
            {location && (
              <span className="px-2.5 py-0.5 bg-[#800020]/10 text-[#800020] border border-[#800020]/20 rounded-full text-[11px] font-bold flex items-center gap-1.5">
                <MapPin size={11} className="text-[#800020]" />
                <span>{location.name}</span>
                {location.code && (
                  <span className="font-mono bg-[#800020] text-white px-1.5 py-0.2 rounded text-[9px] font-extrabold">
                    {location.code}
                  </span>
                )}
              </span>
            )}
            {category && (
              <span className="px-2.5 py-0.5 bg-blue-50 text-blue-700 border border-blue-200/60 rounded-full text-[11px] font-medium">
                {category.name}
              </span>
            )}
            <span className="px-2.5 py-0.5 bg-gray-100 text-gray-600 rounded-full text-[11px] font-medium uppercase">
              {application.type || 'Main'} Pass
            </span>
          </div>
        </div>

        {/* Action Button Group */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <button 
            onClick={() => setIsPrintModalOpen(true)}
            className="h-8 px-2.5 bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 hover:text-[#800020] rounded-lg font-semibold text-xs flex items-center gap-1.5 transition-all cursor-pointer shadow-2xs whitespace-nowrap"
            title="Open Print & Export center (Excel, PDF, Print, HTML)"
          >
            <Printer size={13} className="text-[#800020] shrink-0" />
            <span>Print & Export</span>
          </button>

          {application.status === 'archived' ? (
            currentUser?.role === 'admin' && (
              <button 
                onClick={handleUnarchiveApp}
                disabled={isSubmittingAction}
                className="h-8 px-2.5 bg-slate-900 hover:bg-black text-white rounded-lg font-semibold text-xs flex items-center gap-1.5 transition-all cursor-pointer shadow-2xs whitespace-nowrap"
              >
                <RefreshCw size={13} className="shrink-0" />
                <span>Un-archive / Restore</span>
              </button>
            )
          ) : (
            <>
              {/* Stage 1 Action: Change to Stage 2 (Under Processing) */}
              {currentUser?.role === 'admin' && isAppStage1 && (
                <>
                  <button 
                    onClick={async () => {
                      await executeAppStatusUpdate('processing', 'Change from Stage 1 (Under Review) to Stage 2 (Under Processing)');
                    }}
                    disabled={isSubmittingAction}
                    className="h-8 px-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer shadow-2xs whitespace-nowrap"
                    title="Change workflow stage to Stage 2: Under Processing"
                  >
                    <ArrowRightCircle size={13} className="shrink-0" />
                    <span>Change to Stage 2 (Under Processing)</span>
                  </button>
                  <button 
                    onClick={async () => {
                      showConfirm(
                        "Reject Application",
                        `Are you sure you want to reject application #${application.authorityAppNumber || application.id}?`,
                        async () => {
                          await executeAppStatusUpdate('rejected', 'Rejected at Stage 1: Under Review');
                        }
                      );
                    }}
                    disabled={isSubmittingAction}
                    className="h-8 px-2.5 bg-rose-50 hover:bg-rose-600 hover:text-white border border-rose-200 text-rose-700 rounded-lg font-semibold text-xs flex items-center gap-1.5 transition-all cursor-pointer shadow-2xs whitespace-nowrap"
                    title="Reject Application"
                  >
                    <Ban size={13} className="shrink-0" />
                    <span>Reject</span>
                  </button>
                </>
              )}

              {/* Stage 2 Action: Change to Stage 3 (Accepted for Processing) & Issue Passes (Next Process) */}
              {currentUser?.role === 'admin' && isAppStage2 && (
                <>
                  <button 
                    onClick={async () => {
                      await executeAppStatusUpdate('accepted', 'Change from Stage 2 (Under Processing) to Stage 3 (Accepted for Processing)');
                    }}
                    disabled={isSubmittingAction}
                    className="h-8 px-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer shadow-2xs whitespace-nowrap"
                    title="Change workflow stage to Stage 3: Accepted for Processing"
                  >
                    <ArrowRightCircle size={13} className="shrink-0" />
                    <span>Change to Stage 3 (Accepted for Processing)</span>
                  </button>
                  <button 
                    onClick={handleOpenIssueAllPasses}
                    disabled={isSubmittingAction}
                    className="h-8 px-2.5 bg-[#800020] hover:bg-[#600018] text-white rounded-lg font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer shadow-2xs whitespace-nowrap"
                    title="Proceed directly to Pass Issuance (Next Process) in one click without doing it two times"
                  >
                    <Plus size={13} className="shrink-0" />
                    <span>Issue Passes (Next Process)</span>
                  </button>
                  <button 
                    onClick={async () => {
                      showConfirm(
                        "Reject Application",
                        `Are you sure you want to reject application #${application.authorityAppNumber || application.id}?`,
                        async () => {
                          await executeAppStatusUpdate('rejected', 'Rejected at Stage 2: Under Processing');
                        }
                      );
                    }}
                    disabled={isSubmittingAction}
                    className="h-8 px-2.5 bg-rose-50 hover:bg-rose-600 hover:text-white border border-rose-200 text-rose-700 rounded-lg font-semibold text-xs flex items-center gap-1.5 transition-all cursor-pointer shadow-2xs whitespace-nowrap"
                    title="Reject Application"
                  >
                    <Ban size={13} className="shrink-0" />
                    <span>Reject</span>
                  </button>
                </>
              )}

              {/* Stage 3 Action: Issue All Passes (if passes not yet created for all personnel) */}
              {currentUser?.role === 'admin' && isAppStage3 && appPasses.length < allPersonnelIds.length && (
                <button 
                  onClick={handleOpenIssueAllPasses}
                  disabled={isSubmittingAction}
                  className="h-8 px-2.5 bg-[#800020] hover:bg-[#600018] text-white rounded-lg font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer shadow-2xs whitespace-nowrap"
                  title="Open batch issuance form for all unissued personnel (Stage 4)"
                >
                  <Plus size={13} className="shrink-0" />
                  <span>Issue All Passes (Stage 4)</span>
                </button>
              )}

              {/* Stage 4 Action: Mark All Collected (When passes are issued and collected at counter) */}
              {currentUser?.role === 'admin' && (isAppStage4 || (appPasses.length > 0 && !stats.allDone)) && (
                <button 
                  onClick={handleQuickCollectAllPasses}
                  disabled={isSubmittingAction}
                  className="h-8 px-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer shadow-2xs whitespace-nowrap"
                  title="Mark all issued application passes as collected at the security counter (Stage 4: Pass Issuance & Collection)"
                >
                  <ClipboardCheck size={13} className="shrink-0" />
                  <span>Mark All Collected</span>
                </button>
              )}

              {/* Re-open Application Action (When Application is Rejected or Cancelled) */}
              {currentUser?.role === 'admin' && (application.status === 'rejected' || application.status === 'cancelled') && (
                <button 
                  onClick={() => {
                    showConfirm(
                      "Re-open Application",
                      `Are you sure you want to re-open application #${application.authorityAppNumber || application.id}? This will reset the application to Stage 1: Under Review.`,
                      async () => {
                        await executeAppStatusUpdate('pending', 'Re-opened application: reset to Stage 1: Under Review');
                      }
                    );
                  }}
                  disabled={isSubmittingAction}
                  className="h-8 px-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold text-xs flex items-center gap-1.5 transition-all cursor-pointer shadow-2xs whitespace-nowrap"
                  title="Re-open this application to Under Review"
                >
                  <RefreshCw size={13} className="shrink-0" />
                  <span>Re-open Application</span>
                </button>
              )}

              {currentUser?.role !== 'viewer' && (
                <button 
                  onClick={handleOpenEditApp}
                  className="h-8 px-2.5 bg-amber-50 text-amber-900 border border-amber-300 hover:bg-amber-100 rounded-lg font-semibold text-xs flex items-center gap-1.5 transition-all cursor-pointer shadow-2xs whitespace-nowrap"
                >
                  <Edit2 size={13} className="shrink-0" />
                  <span>Edit</span>
                </button>
              )}

              {currentUser?.role !== 'viewer' && application.status !== 'completed' && (
                <button 
                  onClick={() => setIsAddPersonnelModalOpen(true)}
                  className="h-8 px-2.5 bg-emerald-50 text-emerald-800 border border-emerald-300 hover:bg-emerald-100 rounded-lg font-semibold text-xs flex items-center gap-1.5 transition-all cursor-pointer shadow-2xs whitespace-nowrap"
                >
                  <UserPlus size={13} className="shrink-0" />
                  <span>Add Personnel</span>
                </button>
              )}

              {currentUser?.role !== 'viewer' && (
                <button 
                  onClick={() => {
                    setTargetAppStatus(application.status);
                    setIsAppStatusModalOpen(true);
                  }}
                  className="h-8 px-2.5 bg-[#800020] text-white hover:bg-[#600018] rounded-lg font-semibold text-xs flex items-center gap-1.5 transition-all cursor-pointer shadow-2xs whitespace-nowrap"
                >
                  <RefreshCw size={13} className="shrink-0" />
                  <span>Update Status</span>
                </button>
              )}
            </>
          )}

          {currentUser?.role === 'admin' && (
            <button 
              onClick={handleDeleteApp}
              className="h-8 w-8 flex items-center justify-center bg-rose-50 text-rose-600 hover:bg-rose-100 rounded-lg border border-rose-200 transition-all cursor-pointer shrink-0"
              title="Delete Application"
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>

      {/* Archived Banner Notice */}
      {application.status === 'archived' && (
        <div className="bg-slate-100 border border-slate-300 rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-slate-800 shadow-2xs">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-slate-200 rounded-xl text-slate-700">
              <Shield size={20} />
            </div>
            <div>
              <p className="text-xs font-bold text-slate-900">Application Archived (Read-Only Mode)</p>
              <p className="text-[11px] text-slate-600">This application has been archived. Edits, member status updates, and additions are locked.</p>
            </div>
          </div>
          {currentUser?.role === 'admin' && (
            <button
              onClick={handleUnarchiveApp}
              disabled={isSubmittingAction}
              className="px-3.5 py-1.5 bg-slate-900 hover:bg-black text-white rounded-xl text-xs font-bold transition-all shadow-sm whitespace-nowrap cursor-pointer flex items-center gap-1.5"
            >
              <RefreshCw size={12} />
              Un-archive Application
            </button>
          )}
        </div>
      )}

      {/* 4-Stage Sequential Workflow Stepper with Direct Action Controls */}
      <WorkflowStageStepper 
        currentStatus={computedAppStatus || application.status} 
        stats={stats}
        canChangeStage={currentUser?.role === 'admin' && application.status !== 'archived'}
        isSubmitting={isSubmittingAction}
        onChangeStage={async (targetStatus, description) => {
          await executeAppStatusUpdate(targetStatus, description);
        }}
        onOpenIssuePasses={handleOpenIssueAllPasses}
        onMarkAllCollected={handleQuickCollectAllPasses}
      />

      {/* Main Overview Grid - Minimalist Single Card */}
      <div className="bg-white rounded-2xl border border-gray-200/80 p-5 shadow-2xs">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 divide-y md:divide-y-0 md:divide-x divide-gray-100">
          {/* Stat 1: Location & Site Code */}
          <div className="space-y-1.5 md:pr-4">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1">
              <MapPin size={11} className="text-[#800020]" />
              Authorized Site & Code
            </p>
            <h3 className="text-sm font-bold text-gray-900">{location?.name || 'Unassigned Location'}</h3>
            <div className="flex items-center gap-1.5 flex-wrap text-xs text-gray-500">
              {location?.code && (
                <span className="px-1.5 py-0.5 bg-[#800020]/10 text-[#800020] rounded font-mono font-bold text-[10px] border border-[#800020]/20">
                  {location.code}
                </span>
              )}
              <span>•</span>
              <span className="font-semibold text-gray-700">{category?.name || 'General'}</span>
            </div>
          </div>

          {/* Stat 2: Contract & Governance */}
          <div className="space-y-1.5 pt-4 md:pt-0 md:px-4">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1">
              <Briefcase size={11} className="text-[#800020]" />
              Contract & Client
            </p>
            <h3 className="text-sm font-bold text-gray-900 font-mono">
              {application.contractNumber || 'Direct Authority App'}
            </h3>
            <p className="text-xs text-gray-500 truncate" title={application.contractName || application.clientCompany || ''}>
              {application.contractName || application.clientCompany || 'No contract registered'}
            </p>
          </div>

          {/* Stat 3: Personnel Members */}
          <div className="space-y-1.5 pt-4 md:pt-0 md:px-4">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1">
              <Users size={11} className="text-[#800020]" />
              Members Breakdown
            </p>
            <div className="flex items-baseline gap-2">
              <span className="text-xl font-bold text-gray-900">{allPersonnelIds.length}</span>
              <span className="text-xs text-gray-500">Personnel</span>
            </div>
            <div className="flex items-center gap-2 text-[11px]">
              <span className="text-emerald-700 font-bold">{stats.activeCollectedCount ?? stats.collected ?? 0} Collected</span>
              <span className="text-gray-300">•</span>
              <span className="text-amber-600 font-bold">{stats.pendingCount ?? stats.pending ?? 0} Pending</span>
            </div>
          </div>

          {/* Stat 4: Access Codes & Zones */}
          <div className="space-y-1.5 pt-4 md:pt-0 md:pl-4">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1">
              <Key size={11} className="text-[#800020]" />
              Access Codes & Zones
            </p>
            <h3 className="text-sm font-bold text-gray-900">
              {application.accessCodes?.length || 0} Authorized Zones
            </h3>
            <div className="flex items-center gap-1.5 flex-wrap">
              {application.accessCodes && application.accessCodes.length > 0 ? (
                application.accessCodes.map(code => {
                  const ac = getAccessCodeInfo(code, location?.id);
                  return (
                    <span 
                      key={code} 
                      className="px-2 py-0.5 bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-200/80 rounded text-[10px] font-bold transition-colors cursor-default"
                      title={ac?.accessArea ? `${ac.areaCode}: ${ac.accessArea}` : code}
                    >
                      {ac?.areaCode || code}
                    </span>
                  );
                })
              ) : (
                <span className="text-[11px] text-gray-400 italic">General Site Access</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Tabs Bar - Sleek Segmented Control */}
      <div className="bg-gray-100/70 p-1 rounded-xl border border-gray-200/50 flex items-center gap-1">
        <button 
          onClick={() => setActiveTab('roster')}
          className={cn(
            "flex-1 py-2 px-3 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-2 cursor-pointer",
            activeTab === 'roster' ? "bg-white text-gray-900 shadow-2xs font-semibold" : "text-gray-600 hover:text-gray-900"
          )}
        >
          <Users size={15} />
          Personnel Roster ({allPersonnelIds.length})
        </button>
        <button 
          onClick={() => setActiveTab('passes')}
          className={cn(
            "flex-1 py-2 px-3 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-2 cursor-pointer",
            activeTab === 'passes' ? "bg-white text-gray-900 shadow-2xs font-semibold" : "text-gray-600 hover:text-gray-900"
          )}
        >
          <Award size={15} />
          Pass Badges ({appPasses.length})
        </button>
        <button 
          onClick={() => setActiveTab('info')}
          className={cn(
            "flex-1 py-2 px-3 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-2 cursor-pointer",
            activeTab === 'info' ? "bg-white text-gray-900 shadow-2xs font-semibold" : "text-gray-600 hover:text-gray-900"
          )}
        >
          <Info size={15} />
          Details & Remarks
        </button>
        <button 
          onClick={() => setActiveTab('history')}
          className={cn(
            "flex-1 py-2 px-3 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-2 cursor-pointer",
            activeTab === 'history' ? "bg-white text-gray-900 shadow-2xs font-semibold" : "text-gray-600 hover:text-gray-900"
          )}
        >
          <History size={15} />
          Audit Trail ({auditHistory.length})
        </button>
      </div>

      {/* TAB CONTENT 1: PERSONNEL ROSTER */}
      {activeTab === 'roster' && (
        <div className="bg-white rounded-2xl border border-gray-200/80 shadow-2xs p-5 space-y-4">
          {/* Controls Bar: Status Filters, Batch Actions */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div className="flex items-center gap-3 flex-1">
              {/* Filter Pills */}
              <div className="flex items-center gap-1 overflow-x-auto custom-scrollbar">
                {[
                  { key: 'all', label: 'All' },
                  { key: 'pending', label: 'Under Review' },
                  { key: 'processing', label: 'Under Processing' },
                  { key: 'accepted', label: 'Accepted for Processing' },
                  { key: 'issued', label: 'Pass Issued' },
                  { key: 'collected', label: 'Collected / Active' },
                  { key: 'rejected', label: 'Rejected' },
                  { key: 'cancelled', label: 'Cancelled' }
                ].map(st => (
                  <button
                    key={st.key}
                    onClick={() => setStatusFilter(st.key)}
                    className={cn(
                      "px-2.5 py-1 rounded-lg text-[11px] font-medium capitalize transition-all cursor-pointer whitespace-nowrap",
                      statusFilter === st.key 
                        ? "bg-gray-900 text-white" 
                        : "bg-gray-100/80 text-gray-600 hover:bg-gray-200/60"
                    )}
                  >
                    {st.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Batch Action Trigger */}
            {selectedEmpIds.length > 0 && currentUser?.role !== 'viewer' && application.status !== 'archived' && (
              <div className="flex items-center gap-2 bg-rose-50 border border-rose-200/60 px-2.5 py-1 rounded-lg">
                <span className="text-xs font-semibold text-[#800020]">
                  {selectedEmpIds.length} Selected
                </span>
                <button 
                  onClick={() => setIsMemberStatusModalOpen(true)}
                  className="px-2.5 py-1 bg-[#800020] text-white rounded-md text-xs font-medium hover:bg-[#600018] transition-all flex items-center gap-1 cursor-pointer"
                >
                  <UserCheck size={13} />
                  Update Status
                </button>
              </div>
            )}
          </div>

          {/* Table of Personnel */}
          <div className="overflow-x-auto rounded-2xl border border-gray-100">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-gray-50/80 border-b border-gray-200/80 text-[10px] font-bold text-[#9CA3AF] uppercase tracking-wider">
                  <th className="p-3.5 w-10 text-center">
                    <input 
                      type="checkbox"
                      checked={filteredPersonnel.length > 0 && selectedEmpIds.length === filteredPersonnel.length}
                      onChange={handleToggleSelectAll}
                      disabled={application.status === 'archived'}
                      className="rounded border-gray-300 text-[#800020] focus:ring-[#800020] disabled:opacity-40"
                    />
                  </th>
                  <th className="p-3.5">Personnel Name & Profile</th>
                  <th className="p-3.5">Employee Code / QID</th>
                  <th className="p-3.5">Department / Title</th>
                  <th className="p-3.5">Location & Site Code</th>
                  <th className="p-3.5">Access Codes & Areas</th>
                  <th className="p-3.5">Assigned Pass #</th>
                  <th className="p-3.5">Pass Validity Period</th>
                  <th className="p-3.5">Member Status</th>
                  {currentUser?.role !== 'viewer' && application.status !== 'archived' && <th className="p-3.5 text-right">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredPersonnel.length === 0 ? (
                  <tr>
                    <td colSpan={currentUser?.role === 'viewer' || application.status === 'archived' ? 9 : 10} className="p-8 text-center text-gray-400 italic">
                      No personnel match the current search or filter.
                    </td>
                  </tr>
                ) : (
                  filteredPersonnel.map(item => {
                    const isSelected = selectedEmpIds.includes(item.id);
                    return (
                      <tr key={item.id} className={cn("hover:bg-gray-50/60 transition-colors", isSelected && "bg-rose-50/30")}>
                        <td className="p-3.5 text-center">
                          <input 
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => handleToggleSelectEmp(item.id)}
                            disabled={application.status === 'archived'}
                            className="rounded border-gray-300 text-[#800020] focus:ring-[#800020] disabled:opacity-40"
                          />
                        </td>

                        {/* Name Column */}
                        <td className="p-3.5">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-[#800020]/10 text-[#800020] flex items-center justify-center font-bold text-xs">
                              {item.displayName.charAt(0)}
                            </div>
                            <div>
                              {item.employee?.id ? (
                                <Link 
                                  to={`/employees/${item.employee.id}`} 
                                  className="font-bold text-[#1A1A1A] hover:text-[#800020] transition-colors flex items-center gap-1 group"
                                >
                                  {item.displayName}
                                  <ExternalLink size={12} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                                </Link>
                              ) : (
                                <span className="font-bold text-[#1A1A1A]">{item.displayName}</span>
                              )}
                              <span className="text-[10px] text-gray-400 block">{item.employee?.employeeType || 'Member'}</span>
                            </div>
                          </div>
                        </td>

                        {/* Code Column */}
                        <td className="p-3.5 font-medium text-gray-700">
                          <div>ID: <strong>{item.code}</strong></div>
                          <div className="text-[10px] text-gray-400">QID: {item.qid}</div>
                        </td>

                        {/* Title Column */}
                        <td className="p-3.5 font-medium text-gray-700">
                          <div>{item.jobTitle}</div>
                          <div className="text-[10px] text-gray-400">{item.department}</div>
                        </td>

                        {/* Location & Site Code Column */}
                        <td className="p-3.5">
                          {(() => {
                            const rowLocId = item.pass?.locationId || application.locationId;
                            const rowLoc = locations.find(l => l.id === rowLocId) || location;
                            const rowCat = categories.find(c => c.id === rowLoc?.categoryId) || category;
                            return (
                              <div className="space-y-0.5 min-w-[120px]">
                                <div className="font-bold text-gray-900 flex items-center gap-1.5">
                                  <MapPin size={12} className="text-[#800020] shrink-0" />
                                  <span className="truncate">{rowLoc?.name || 'Unassigned'}</span>
                                </div>
                                <div className="flex items-center gap-1 flex-wrap text-[10px]">
                                  {rowLoc?.code && (
                                    <span className="font-mono bg-[#800020]/10 text-[#800020] px-1.5 py-0.2 rounded font-bold border border-[#800020]/20">
                                      {rowLoc.code}
                                    </span>
                                  )}
                                  {rowCat?.name && (
                                    <span className="text-gray-400 truncate max-w-[100px]">{rowCat.name}</span>
                                  )}
                                </div>
                              </div>
                            );
                          })()}
                        </td>

                        {/* Access Codes & Areas Column */}
                        <td className="p-3.5">
                          {(() => {
                            const rowCodes = (item.pass?.accessCodes && item.pass.accessCodes.length > 0)
                              ? item.pass.accessCodes
                              : (application.accessCodes || []);
                            return (
                              <div className="min-w-[130px] space-y-1">
                                <div className="flex items-center gap-1 flex-wrap">
                                  {rowCodes.length > 0 ? (
                                    rowCodes.map(codeStr => {
                                      const acObj = getAccessCodeInfo(codeStr, item.pass?.locationId || location?.id);
                                      return (
                                        <span 
                                          key={codeStr}
                                          className="px-1.5 py-0.5 bg-slate-100 text-slate-800 border border-slate-200 rounded text-[10px] font-bold inline-flex items-center gap-1"
                                          title={acObj?.accessArea ? `${acObj.areaCode}: ${acObj.accessArea}` : codeStr}
                                        >
                                          <span className="text-[#800020] font-mono">#</span>
                                          <span>{acObj?.areaCode || codeStr}</span>
                                        </span>
                                      );
                                    })
                                  ) : (
                                    <span className="text-[10px] text-gray-400 italic">General Site Access</span>
                                  )}
                                </div>
                                {application.type === 'supplementary' && (
                                  <span className="inline-block px-1.5 py-0.2 bg-amber-50 text-amber-800 border border-amber-200/80 rounded text-[9px] font-bold uppercase">
                                    Supplementary
                                  </span>
                                )}
                              </div>
                            );
                          })()}
                        </td>

                        {/* Pass # Column */}
                        <td className="p-3.5 font-bold">
                          {item.pass?.passNumber ? (
                            <span className="px-2.5 py-1 bg-[#800020]/10 text-[#800020] rounded-lg text-xs font-extrabold border border-[#800020]/20">
                              #{item.pass.passNumber}
                            </span>
                          ) : item.pass?.id ? (
                            <span className="px-2.5 py-1 bg-[#800020]/10 text-[#800020] rounded-lg text-xs font-extrabold border border-[#800020]/20">
                              #{item.pass.id.toUpperCase()}
                            </span>
                          ) : (
                            <span className="text-gray-400 font-normal italic">Pending Issue</span>
                          )}
                        </td>

                        {/* Pass Validity & Expiry Column */}
                        <td className="p-3.5 font-medium">
                          {(() => {
                            const indExp = (application.individualExpiries as any)?.[item.id] || (application.individualExpiries as any)?.[item.employee?.id || ''];
                            const indStart = (application.individualStartDates as any)?.[item.id] || (application.individualStartDates as any)?.[item.employee?.id || ''];

                            const startVal = indStart || item.pass?.startDate || application.startDate || application.createdAt;
                            const endVal = indExp || item.pass?.expiryDate || application.endDate || application.expiryDate;
                            const startFmt = formatDate(startVal);
                            const endFmt = formatDate(endVal);

                            return (
                              <>
                                <div className="flex items-center gap-1.5 text-xs text-gray-900 font-bold whitespace-nowrap">
                                  <Calendar size={13} className="text-[#800020] shrink-0" />
                                  <span>
                                    {startFmt !== '-' && endFmt !== '-'
                                      ? `${startFmt} to ${endFmt}`
                                      : endFmt !== '-'
                                      ? `Pass Expires: ${endFmt}`
                                      : startFmt !== '-'
                                      ? `From ${startFmt}`
                                      : 'Dates pending'}
                                  </span>
                                </div>
                                <div className="text-[10px] text-gray-400 mt-0.5">
                                  {indExp ? 'Per-Applicant Expiry' : item.pass?.expiryDate ? 'Issued Pass Expiry' : (application.endDate || application.expiryDate) ? 'Application Expiry' : 'Default Pass Expiry'}
                                </div>
                              </>
                            );
                          })()}
                        </td>

                        {/* Member Status Badge */}
                        <td className="p-3.5">
                          <span className={cn(
                            "px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-wider inline-flex items-center gap-1",
                            item.status === 'collected' || item.status === 'active' || item.status === 'completed' 
                              ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                              : item.status === 'accepted' || item.status === 'approved'
                              ? "bg-indigo-100 text-indigo-800 border border-indigo-300"
                              : item.status === 'pending' || item.status === 'processing'
                              ? "bg-amber-100 text-amber-800 border border-amber-300"
                              : "bg-rose-100 text-rose-800 border border-rose-300"
                          )}>
                            <span className="w-1.5 h-1.5 rounded-full bg-current" />
                            {item.status === 'collected' ? 'Collected / Active' : (item.statusLabel || item.status)}
                          </span>
                        </td>

                        {/* Actions */}
                        {currentUser?.role !== 'viewer' && application.status !== 'archived' && (
                          <td className="p-3.5 text-right space-x-1.5 whitespace-nowrap">
                            {currentUser?.role === 'admin' && (
                              <>
                                {/* Stage 1 Action: Change to Stage 2 (Moves to Stage 2: Under Processing) */}
                                {(item.status === 'pending' || item.status === 'under_review' || item.status === 'clarification') && (
                                  <>
                                    <button
                                      onClick={() => handleQuickApproveSingleMember(item.id, item.displayName)}
                                      className="px-2.5 py-1 bg-blue-50 hover:bg-blue-600 hover:text-white border border-blue-300 rounded-lg text-[11px] font-bold text-blue-800 transition-all cursor-pointer inline-flex items-center gap-1 shadow-2xs"
                                      title="Change to Stage 2: Under Processing"
                                    >
                                      <ArrowRightCircle size={12} />
                                      Change to Stage 2
                                    </button>
                                    <button
                                      onClick={() => handleQuickRejectSingleMember(item.id, item.displayName)}
                                      className="px-2 py-1 bg-rose-50 hover:bg-rose-600 hover:text-white border border-rose-200 rounded-lg text-[11px] font-bold text-rose-700 transition-all cursor-pointer inline-flex items-center gap-1"
                                      title="Reject applicant pass"
                                    >
                                      <Ban size={12} />
                                      Reject
                                    </button>
                                  </>
                                )}

                                {/* Stage 2 Action: Change to Stage 3 OR Issue Pass (Next Process in 1 step) */}
                                {(item.status === 'processing' || item.status === 'under_processing' || item.status === 'forwarded') && (
                                  <>
                                    <button
                                      onClick={() => handleQuickAcceptSingleMember(item.id, item.displayName)}
                                      className="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-600 hover:text-white border border-indigo-300 rounded-lg text-[11px] font-bold text-indigo-800 transition-all cursor-pointer inline-flex items-center gap-1 shadow-2xs"
                                      title="Change to Stage 3: Accepted for Processing"
                                    >
                                      <ArrowRightCircle size={12} />
                                      Change to Stage 3
                                    </button>
                                    <button
                                      onClick={() => handleOpenIssuePassForMember(item.id)}
                                      className="px-2.5 py-1 bg-[#800020] hover:bg-[#600018] text-white rounded-lg text-[11px] font-bold transition-all cursor-pointer inline-flex items-center gap-1 shadow-2xs"
                                      title="Proceed directly to pass issuance (Next Process) in one click without doing it two times"
                                    >
                                      <Plus size={12} />
                                      Issue Pass (Next Process)
                                    </button>
                                    <button
                                      onClick={() => handleQuickRejectSingleMember(item.id, item.displayName)}
                                      className="px-2 py-1 bg-rose-50 hover:bg-rose-600 hover:text-white border border-rose-200 rounded-lg text-[11px] font-bold text-rose-700 transition-all cursor-pointer inline-flex items-center gap-1"
                                      title="Reject applicant pass"
                                    >
                                      <Ban size={12} />
                                      Reject
                                    </button>
                                  </>
                                )}

                                {/* Stage 3 Action: Issue Pass (Pass Issuance & Encoding -> Moves to Stage 4: Pass Handover & Collection) */}
                                {(item.status === 'accepted' || item.status === 'approved') && !item.pass && (
                                  <>
                                    <button
                                      onClick={() => handleOpenIssuePassForMember(item.id)}
                                      className="px-2.5 py-1 bg-[#800020] hover:bg-[#600018] text-white rounded-lg text-[11px] font-bold transition-all cursor-pointer inline-flex items-center gap-1 shadow-2xs"
                                      title="Open pass issuance form for this applicant (Stage 3: Accepted for Processing)"
                                    >
                                      <Plus size={12} />
                                      Issue Pass
                                    </button>
                                    <button
                                      onClick={() => handleQuickRejectSingleMember(item.id, item.displayName)}
                                      className="px-2 py-1 bg-rose-50 hover:bg-rose-600 hover:text-white border border-rose-200 rounded-lg text-[11px] font-bold text-rose-700 transition-all cursor-pointer inline-flex items-center gap-1"
                                      title="Reject applicant"
                                    >
                                      <Ban size={12} />
                                      Reject
                                    </button>
                                  </>
                                )}

                                {/* Stage 4 Action: Pass Handover & Collection (Pass Issued & Waiting for Physical Counter Collection) */}
                                {(item.status === 'issued' || item.status === 'ready_for_collection' || (item.pass && item.pass.status !== 'collected' && item.pass.status !== 'active' && item.pass.status !== 'cancelled' && item.pass.status !== 'rejected' && item.pass.status !== 'revoked' && item.pass.status !== 'replaced')) && (
                                  <>
                                    <button
                                      onClick={() => handleQuickCollectSingleMember(item.id, item.displayName)}
                                      className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[11px] font-bold transition-all cursor-pointer inline-flex items-center gap-1 shadow-2xs"
                                      title="Mark pass as collected at security counter (Stage 4: Pass Handover & Collection)"
                                    >
                                      <ClipboardCheck size={12} />
                                      Mark Collected
                                    </button>
                                    {item.pass && (
                                      <button
                                        onClick={() => setInspectingPass(item.pass)}
                                        className="px-2.5 py-1 bg-amber-50 hover:bg-amber-600 hover:text-white border border-amber-200 rounded-lg text-[11px] font-bold text-amber-800 transition-all cursor-pointer inline-flex items-center gap-1"
                                        title="Edit pass validity or details"
                                      >
                                        <Edit3 size={12} />
                                        Edit Pass
                                      </button>
                                    )}
                                    <button
                                      onClick={() => handleQuickRejectSingleMember(item.id, item.displayName)}
                                      className="px-2 py-1 bg-rose-50 hover:bg-rose-600 hover:text-white border border-rose-200 rounded-lg text-[11px] font-bold text-rose-700 transition-all cursor-pointer inline-flex items-center gap-1"
                                      title="Reject pass"
                                    >
                                      <Ban size={12} />
                                      Reject
                                    </button>
                                  </>
                                )}

                                {/* Stage 4 Completed: Active Access / Collected */}
                                {(item.status === 'collected' || item.status === 'active' || item.pass?.status === 'collected' || item.pass?.status === 'active') && (
                                  <>
                                    <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg text-[10px] font-bold inline-flex items-center gap-1">
                                      <CheckCircle2 size={12} />
                                      Collected / Active
                                    </span>
                                    {item.pass && (
                                      <button
                                        onClick={() => setInspectingPass(item.pass)}
                                        className="px-2.5 py-1 bg-amber-50 hover:bg-amber-600 hover:text-white border border-amber-200 rounded-lg text-[11px] font-bold text-amber-800 transition-all cursor-pointer inline-flex items-center gap-1"
                                        title="Edit pass validity or details"
                                      >
                                        <Edit3 size={12} />
                                        Edit Pass
                                      </button>
                                    )}
                                  </>
                                )}

                                {/* Rejected or Cancelled Applicant Re-open Action */}
                                {(item.status === 'rejected' || item.status === 'cancelled') && (
                                  <button
                                    onClick={() => handleQuickReopenSingleMember(item.id, item.displayName)}
                                    className="px-2.5 py-1 bg-blue-50 hover:bg-blue-600 hover:text-white border border-blue-200 rounded-lg text-[11px] font-bold text-blue-700 transition-all cursor-pointer inline-flex items-center gap-1 shadow-2xs"
                                    title="Re-open applicant"
                                  >
                                    <RefreshCw size={12} />
                                    Re-open
                                  </button>
                                )}
                              </>
                            )}

                            <button
                              onClick={() => {
                                setSelectedEmpIds([item.id]);
                                setIsMemberStatusModalOpen(true);
                              }}
                              className="px-2.5 py-1 bg-gray-100 hover:bg-[#800020] hover:text-white rounded-lg text-[11px] font-bold text-gray-700 transition-all cursor-pointer"
                              title="Open status management modal"
                            >
                              Update Status
                            </button>

                            {currentUser?.role === 'admin' && (
                              <button
                                onClick={() => handleRemovePersonnel(item.id, item.displayName)}
                                className="p-1 text-gray-400 hover:text-rose-600 rounded hover:bg-rose-50 transition-all cursor-pointer inline-block align-middle"
                                title="Remove personnel from application"
                              >
                                <UserMinus size={14} />
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB CONTENT 2: PASS BADGES GRID */}
      {activeTab === 'passes' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between bg-white p-4 rounded-2xl border border-gray-200/80 shadow-2xs">
            <div>
              <h3 className="text-xs font-bold text-gray-900">Pass Badges</h3>
              <p className="text-[11px] text-gray-500">Visual cards ready for printing and identification</p>
            </div>
            <button 
              onClick={() => setIsPrintModalOpen(true)}
              className="px-3 py-1.5 bg-[#800020] text-white rounded-lg text-xs font-medium hover:bg-[#600018] flex items-center gap-1.5 cursor-pointer"
            >
              <Printer size={13} />
              Print Pass Cards
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredPersonnel.length === 0 ? (
              <div className="col-span-full p-8 text-center text-xs text-gray-400 italic bg-white rounded-2xl border border-gray-200/80">
                No pass badges match the current search or status filter.
              </div>
            ) : (
              filteredPersonnel.map(item => {
                const cardLocId = item.pass?.locationId || application.locationId;
                const cardLoc = locations.find(l => l.id === cardLocId) || location;
                const cardCat = categories.find(c => c.id === cardLoc?.categoryId) || category;
                const cardCodes = (item.pass?.accessCodes && item.pass.accessCodes.length > 0)
                  ? item.pass.accessCodes
                  : (application.accessCodes || []);
                return (
                  <div 
                    key={item.id} 
                    className="bg-white rounded-2xl border border-gray-200/80 shadow-2xs p-4 flex flex-col justify-between space-y-3 hover:border-gray-300 transition-all"
                  >
                    {/* Header Banner inside card */}
                    <div className="flex items-start justify-between border-b border-gray-100 pb-3">
                      <div>
                        <div className="flex items-center gap-1.5 mb-1">
                          <span className="text-[9px] font-bold uppercase text-[#800020] tracking-wider">Access Pass</span>
                          <span className="px-1.5 py-0.2 bg-gray-100 text-gray-600 rounded text-[9px] font-bold uppercase">
                            {item.pass?.type || application.type || 'Main'}
                          </span>
                        </div>
                        <h4 className="font-bold text-gray-900 text-sm">{cardLoc?.name || 'Site Pass'}</h4>
                        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                          {cardLoc?.code && (
                            <span className="px-1.5 py-0.2 bg-[#800020]/10 text-[#800020] rounded font-mono font-bold text-[10px] border border-[#800020]/20">
                              {cardLoc.code}
                            </span>
                          )}
                          {cardCat?.name && (
                            <span className="text-[10px] text-gray-400">
                              • {cardCat.name}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="text-right">
                        <span className="text-[9px] text-gray-400 block uppercase font-medium">Pass #</span>
                        <span className="font-bold text-[#800020] text-xs font-mono">
                          {item.pass?.passNumber ? `#${item.pass.passNumber}` : item.pass?.id ? `#${item.pass.id.slice(-6).toUpperCase()}` : `P-${application.id.slice(-5)}`}
                        </span>
                        {application.contractNumber && (
                          <span className="text-[9px] text-gray-500 block font-mono mt-0.5 font-bold">
                            Ctr: {application.contractNumber}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Main Employee Avatar and Data */}
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-gray-100 text-[#800020] flex items-center justify-center font-bold text-sm border border-gray-200/60">
                        {item.displayName.charAt(0)}
                      </div>
                      <div className="space-y-0.5">
                        <h5 className="font-bold text-gray-900 text-xs">{item.displayName}</h5>
                        <p className="text-[11px] font-medium text-gray-500">{item.jobTitle}</p>
                        <p className="text-[10px] text-gray-400">ID: {item.code} • QID: {item.qid}</p>
                      </div>
                    </div>

                    {/* Authorized Access Codes & Zones */}
                    <div className="bg-slate-50/70 p-2.5 rounded-xl border border-slate-100 space-y-1.5">
                      <div className="flex items-center justify-between text-[9px] font-bold text-gray-500 uppercase tracking-wider">
                        <span className="flex items-center gap-1">
                          <Shield size={10} className="text-[#800020]" />
                          Authorized Access Zones ({cardCodes.length})
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {cardCodes.length > 0 ? (
                          cardCodes.map(codeStr => {
                            const acObj = getAccessCodeInfo(codeStr, cardLoc?.id);
                            return (
                              <span 
                                key={codeStr} 
                                className="px-2 py-0.5 bg-white text-slate-800 border border-slate-200 rounded text-[10px] font-bold inline-flex items-center gap-1 shadow-2xs"
                                title={acObj?.accessArea ? `${acObj.areaCode}: ${acObj.accessArea}` : codeStr}
                              >
                                <span className="text-[#800020] font-mono">#</span>
                                <span>{acObj?.areaCode || codeStr}</span>
                                {acObj?.accessArea && (
                                  <span className="text-gray-500 font-normal text-[9px] truncate max-w-[90px]">
                                    ({acObj.accessArea})
                                  </span>
                                )}
                              </span>
                            );
                          })
                        ) : (
                          <span className="text-[10px] text-gray-400 italic">General Site Access</span>
                        )}
                      </div>
                    </div>

                    {/* Validity and Status */}
                    <div className="bg-gray-50/70 p-2.5 rounded-xl border border-gray-100 flex items-center justify-between text-[11px]">
                      <div>
                        <span className="text-gray-400 text-[9px] uppercase font-semibold block mb-0.5">Validity</span>
                        <div className="text-[10px] space-y-0.5">
                          <p className="text-gray-500">From: <strong className="text-gray-900 font-semibold">{formatDate(item.pass?.startDate || application.startDate)}</strong></p>
                          <p className="text-gray-500">To: <strong className="text-[#800020] font-semibold">{formatDate(item.pass?.endDate || item.pass?.expiryDate || application.endDate)}</strong></p>
                        </div>
                      </div>
                      <span className={cn(
                        "px-2 py-0.5 rounded-full text-[10px] font-medium uppercase",
                        item.status === 'collected' || item.status === 'active' 
                          ? "bg-emerald-50 text-emerald-700 border border-emerald-200/60" 
                          : "bg-amber-50 text-amber-700 border border-amber-200/60"
                      )}>
                        {item.statusLabel || item.status}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* TAB CONTENT 3: DETAILS & REMARKS */}
      {activeTab === 'info' && (
        <div className="space-y-5">
          {/* Card 1: Access Configuration & Location Details */}
          <div className="bg-white rounded-2xl border border-gray-200/80 shadow-2xs p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-gray-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-[#800020]/10 text-[#800020] flex items-center justify-center">
                  <ShieldCheck size={18} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-gray-900">Access Configuration & Authorized Site</h3>
                  <p className="text-[11px] text-gray-500">Location, facility code, category and authorized zone permissions</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-1 bg-slate-100 text-slate-800 rounded-lg text-xs font-bold font-mono">
                  {application.accessCodes?.length || 0} Zone(s) Authorized
                </span>
                <button
                  onClick={handleOpenEditApp}
                  className="px-2.5 py-1 bg-gray-100 hover:bg-[#800020] hover:text-white rounded-lg text-xs font-bold text-gray-700 transition-all inline-flex items-center gap-1 cursor-pointer"
                >
                  <Edit2 size={12} />
                  Edit Details
                </button>
              </div>
            </div>

            {/* Location & Pass Scope Info Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 p-3.5 bg-gray-50/70 rounded-xl border border-gray-100 text-xs">
              <div>
                <span className="text-gray-400 text-[10px] uppercase font-bold block mb-0.5">Location / Site Name</span>
                <span className="font-bold text-gray-900 flex items-center gap-1">
                  <MapPin size={13} className="text-[#800020]" />
                  {location?.name || 'Unassigned Location'}
                </span>
              </div>
              <div>
                <span className="text-gray-400 text-[10px] uppercase font-bold block mb-0.5">Location / Site Code</span>
                {location?.code ? (
                  <span className="font-mono bg-[#800020]/10 text-[#800020] px-2 py-0.5 rounded font-bold border border-[#800020]/20 inline-block">
                    {location.code}
                  </span>
                ) : (
                  <span className="text-gray-500 font-medium">No Code Assigned</span>
                )}
              </div>
              <div>
                <span className="text-gray-400 text-[10px] uppercase font-bold block mb-0.5">Facility Category</span>
                <span className="font-semibold text-gray-800">
                  {category?.name || 'General Operations'}
                </span>
              </div>
              <div>
                <span className="text-gray-400 text-[10px] uppercase font-bold block mb-0.5">Pass Classification</span>
                <span className="font-bold uppercase text-[#800020]">
                  {application.type || 'Main'} Pass
                </span>
              </div>
            </div>

            {/* Detailed Authorized Access Codes Breakdown */}
            <div className="space-y-2 pt-1">
              <h4 className="text-xs font-bold text-gray-800 uppercase tracking-wider flex items-center gap-1.5">
                <Key size={13} className="text-[#800020]" />
                Authorized Access Codes & Areas
              </h4>
              
              {application.accessCodes && application.accessCodes.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                  {application.accessCodes.map(codeStr => {
                    const acObj = getAccessCodeInfo(codeStr, location?.id);
                    return (
                      <div 
                        key={codeStr}
                        className="p-3 bg-white border border-gray-200 rounded-xl shadow-2xs hover:border-[#800020]/30 transition-all flex items-start justify-between gap-2"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-1.5">
                            <span className="px-2 py-0.5 bg-[#800020] text-white font-mono text-xs font-bold rounded">
                              {acObj?.areaCode || codeStr}
                            </span>
                            <span className={cn(
                              "px-1.5 py-0.2 rounded text-[9px] font-bold uppercase",
                              acObj?.status === 'inactive' ? "bg-gray-100 text-gray-600" : "bg-emerald-50 text-emerald-700"
                            )}>
                              {acObj?.status || 'Active'}
                            </span>
                          </div>
                          <p className="text-xs font-bold text-gray-900 leading-snug">
                            {acObj?.accessArea || 'General Area Access'}
                          </p>
                          {acObj?.description && (
                            <p className="text-[10px] text-gray-500 line-clamp-2">
                              {acObj.description}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="p-4 bg-gray-50 rounded-xl border border-gray-200/70 text-center">
                  <p className="text-xs text-gray-500 italic">No specific zone access codes configured. Standard facility-wide open area access applies.</p>
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Card 2: Contract & Governance Details */}
            <div className="bg-white rounded-2xl border border-gray-200/80 shadow-2xs p-5 space-y-3.5">
              <div className="flex items-center gap-2 border-b border-gray-100 pb-2.5">
                <Briefcase size={16} className="text-[#800020]" />
                <h3 className="text-sm font-bold text-gray-900">Contract & Client Governance</h3>
              </div>

              <div className="space-y-2.5 text-xs">
                <div>
                  <span className="text-gray-400 text-[10px] uppercase font-bold block mb-0.5">Contract Number</span>
                  <span className="font-bold text-gray-900 font-mono">
                    {application.contractNumber || 'Direct / Internal Pass Application'}
                  </span>
                </div>
                <div>
                  <span className="text-gray-400 text-[10px] uppercase font-bold block mb-0.5">Contract / Project Name</span>
                  <span className="font-semibold text-gray-800">
                    {application.contractName || 'General Facility Services'}
                  </span>
                </div>
                <div>
                  <span className="text-gray-400 text-[10px] uppercase font-bold block mb-0.5">Client Company</span>
                  <span className="font-semibold text-gray-800">
                    {application.clientCompany || 'Internal Organization'}
                  </span>
                </div>
                <div>
                  <span className="text-gray-400 text-[10px] uppercase font-bold block mb-0.5">Client Approvers</span>
                  <p className="text-xs text-gray-700 font-medium">
                    {application.clientApprovers || 'Standard Authority Approvers'}
                  </p>
                </div>
              </div>
            </div>

            {/* Card 3: Application Lifecycle & Metadata */}
            <div className="bg-white rounded-2xl border border-gray-200/80 shadow-2xs p-5 space-y-3.5">
              <div className="flex items-center gap-2 border-b border-gray-100 pb-2.5">
                <FileText size={16} className="text-[#800020]" />
                <h3 className="text-sm font-bold text-gray-900">Application Reference</h3>
              </div>

              <div className="space-y-2.5 text-xs">
                <div className="flex justify-between py-1 border-b border-gray-100">
                  <span className="text-gray-500">Application Ref:</span>
                  <span className="font-mono font-bold text-gray-900">{application.id}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-gray-100">
                  <span className="text-gray-500">Authority Ref #:</span>
                  <span className="font-mono font-bold text-[#800020]">{application.authorityAppNumber || '—'}</span>
                </div>
                {(application.type === 'supplementary' || application.parentPassId) && (
                  <div className="flex justify-between py-1 border-b border-gray-100 bg-amber-50/70 px-2 rounded">
                    <span className="text-amber-800 font-medium">Parent Pass:</span>
                    <span className="font-bold text-[#800020] font-mono">
                      {application.parentPassId || 'Auto Linked'}
                    </span>
                  </div>
                )}
                <div className="flex justify-between py-1 border-b border-gray-100">
                  <span className="text-gray-500">Submitted On:</span>
                  <span className="font-semibold text-gray-900">{formatDate(application.createdAt)}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-gray-100">
                  <span className="text-gray-500">Submitted By:</span>
                  {(() => {
                    const reqUser = allUsers.find(u => u.id === application.requesterId || u.email === application.requesterId);
                    return (
                      <span className="font-semibold text-gray-900 text-right">
                        {reqUser ? `${reqUser.displayName || reqUser.email} (${reqUser.role})` : (application.requesterId || 'System')}
                      </span>
                    );
                  })()}
                </div>
                <div className="flex justify-between py-1 border-b border-gray-100">
                  <span className="text-gray-500">Approver / Reviewer:</span>
                  {(() => {
                    const appUser = allUsers.find(u => u.id === application.approverId || u.email === application.approverId);
                    return (
                      <span className="font-semibold text-gray-900 text-right">
                        {appUser ? `${appUser.displayName || appUser.email}` : (application.approverId || 'Pending Assignment')}
                      </span>
                    );
                  })()}
                </div>
                {application.forwardedToId && (
                  <div className="flex justify-between py-1 border-b border-gray-100 bg-amber-50/50 px-2 rounded">
                    <span className="text-amber-800 font-medium">Forwarded To:</span>
                    {(() => {
                      const fwdUser = allUsers.find(u => u.id === application.forwardedToId || u.email === application.forwardedToId);
                      return (
                        <span className="font-semibold text-amber-900 text-right">
                          {fwdUser ? `${fwdUser.displayName || fwdUser.email}` : application.forwardedToId}
                        </span>
                      );
                    })()}
                  </div>
                )}
                <div className="flex justify-between py-1 border-b border-gray-100">
                  <span className="text-gray-500">Last Updated:</span>
                  <span className="font-semibold text-gray-900">{formatDate(application.updatedAt)}</span>
                </div>
              </div>
            </div>

            {/* Card 4: Remarks & Approval Justifications */}
            <div className="bg-white rounded-2xl border border-gray-200/80 shadow-2xs p-5 space-y-3.5">
              <div className="flex items-center gap-2 border-b border-gray-100 pb-2.5">
                <MessageSquare size={16} className="text-[#800020]" />
                <h3 className="text-sm font-bold text-gray-900">Remarks & Justifications</h3>
              </div>

              <div className="space-y-3 text-xs">
                <div className="p-3 bg-gray-50/80 rounded-xl border border-gray-100">
                  <span className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Requester Remarks</span>
                  <p className="text-gray-700 leading-relaxed">
                    {application.remarks || 'No initial remarks provided.'}
                  </p>
                </div>

                {application.approvalRemarks && (
                  <div className="p-3 bg-blue-50/50 rounded-xl border border-blue-100 text-blue-900">
                    <span className="text-[10px] font-bold text-blue-600 uppercase block mb-1">Approver Justification</span>
                    <p className="leading-relaxed">
                      {application.approvalRemarks}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB CONTENT 4: AUDIT TRAIL */}
      {activeTab === 'history' && (
        <div className="bg-white rounded-2xl border border-gray-200/80 shadow-2xs p-5 space-y-4">
          <h3 className="text-sm font-bold text-gray-900">Application Audit Log</h3>

          {isLoadingHistory ? (
            <div className="p-8 text-center text-xs text-gray-400">Loading audit history...</div>
          ) : auditHistory.length === 0 ? (
            <div className="p-8 text-center text-xs text-gray-400 italic">No audit history logged yet.</div>
          ) : (
            <div className="relative border-l border-gray-200 ml-3 space-y-4 py-1">
              {auditHistory.map((item, idx) => (
                <div key={item.id || idx} className="relative pl-5">
                  <div className="absolute -left-[5px] top-1.5 w-2.5 h-2.5 rounded-full bg-[#800020] ring-4 ring-white" />
                  <div className="bg-gray-50/70 p-3 rounded-xl border border-gray-100 space-y-1">
                    <div className="flex items-center justify-between">
                      <h4 className="font-semibold text-xs text-gray-900 capitalize">{item.action.replace('_', ' ')}</h4>
                      <span className="text-[10px] text-gray-400 font-medium">{formatDate(item.timestamp)}</span>
                    </div>
                    {item.userId && (
                      <p className="text-[10px] text-slate-500 font-medium">
                        By {(() => {
                          const histUser = allUsers.find(u => u.id === item.userId || u.email === item.userId);
                          return histUser ? `${histUser.displayName || histUser.email} (${histUser.role})` : (item.userId !== 'system' ? item.userId : 'System Operator');
                        })()}
                      </p>
                    )}
                    {item.remarks && <p className="text-xs text-gray-600 mt-1">{item.remarks}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* MODAL 1: PRINT / EXPORT SUMMARY */}
      <PrintExportModal
        isOpen={isPrintModalOpen}
        onClose={() => setIsPrintModalOpen(false)}
        title="Application Summary & Pass Report"
        documentTitle={`Application_${application.authorityAppNumber || application.id}`}
        onExportExcel={handleExportApplicationExcel}
      >
        <div className="space-y-6 p-4">
          <div className="flex justify-between items-start border-b border-gray-200 pb-4">
            <div>
              <h2 className="text-xl font-bold text-gray-900">PASS APPLICATION SUMMARY</h2>
              <p className="text-xs text-gray-500">Ref: #{application.authorityAppNumber || application.id}</p>
            </div>
            <div className="text-right">
              <p className="text-xs font-bold text-gray-900">Status: {application.status.toUpperCase()}</p>
              <p className="text-[10px] text-gray-500">Date: {formatDate(application.createdAt)}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 text-xs">
            <div>
              <p className="font-bold text-gray-500">Location / Category:</p>
              <p className="font-black text-gray-900">{location?.name} ({location?.code}) • {category?.name || 'General'}</p>
            </div>
            <div>
              <p className="font-bold text-gray-500">Validity Period:</p>
              <p className="font-black text-gray-900">{formatDate(application.startDate)} to {formatDate(application.endDate)}</p>
            </div>
          </div>

          {/* Breakdown Summary Grid */}
          <div className="grid grid-cols-4 gap-2 border border-gray-200 rounded-lg p-3 bg-gray-50 text-center">
            <div>
              <p className="text-[10px] text-gray-500 uppercase font-bold">Total Applicants</p>
              <p className="text-sm font-black text-gray-900">{allPersonnelIds.length}</p>
            </div>
            <div>
              <p className="text-[10px] text-emerald-700 uppercase font-bold">Collected / Active</p>
              <p className="text-sm font-black text-emerald-700">{stats.collectedCount ?? stats.active ?? 0}</p>
            </div>
            <div>
              <p className="text-[10px] text-indigo-700 uppercase font-bold">In Processing</p>
              <p className="text-sm font-black text-indigo-700">{(stats.processingCount ?? 0) + (stats.acceptedCount ?? 0)}</p>
            </div>
            <div>
              <p className="text-[10px] text-amber-700 uppercase font-bold">Pending Review</p>
              <p className="text-sm font-black text-amber-700">{stats.pendingCount ?? 0}</p>
            </div>
          </div>

          {/* Member Roster Table for Print */}
          <div>
            <h4 className="font-bold text-xs text-gray-900 mb-2">Personnel Roster ({allPersonnelIds.length})</h4>
            <table className="w-full text-left text-xs border border-gray-300">
              <thead>
                <tr className="bg-gray-100 border-b border-gray-300 font-bold text-gray-700 text-[11px]">
                  <th className="p-2 border-r">#</th>
                  <th className="p-2 border-r">Name</th>
                  <th className="p-2 border-r">QID / Visa</th>
                  <th className="p-2 border-r">Job Title</th>
                  <th className="p-2 border-r">Pass #</th>
                  <th className="p-2 border-r">Validity</th>
                  <th className="p-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {personnelData.map((p, index) => {
                  const indExp = (application.individualExpiries as any)?.[p.id];
                  const indStart = (application.individualStartDates as any)?.[p.id];
                  const pExp = p.pass?.expiryDate || indExp || application.endDate;
                  const pStart = p.pass?.startDate || indStart || application.startDate;

                  return (
                    <tr key={p.id}>
                      <td className="p-2 border-r">{index + 1}</td>
                      <td className="p-2 border-r font-bold">{p.displayName}</td>
                      <td className="p-2 border-r">{p.qid}</td>
                      <td className="p-2 border-r">{p.jobTitle}</td>
                      <td className="p-2 border-r font-bold">{p.pass?.passNumber || '—'}</td>
                      <td className="p-2 border-r text-[11px]">
                        {formatDate(pStart)} - {formatDate(pExp)}
                      </td>
                      <td className="p-2 font-bold uppercase text-[11px]">{p.statusLabel || p.status}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </PrintExportModal>

      {/* MODAL 2: UPDATE APPLICATION STATUS */}
      <Modal
        isOpen={isAppStatusModalOpen}
        onClose={() => setIsAppStatusModalOpen(false)}
        title="Update Application Stage / Status"
      >
        <div className="space-y-4">
          {/* Access Scope Summary */}
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1.5 text-xs">
            <div className="flex items-center justify-between text-gray-500 text-[10px] font-bold uppercase">
              <span>Access Scope & Location</span>
              <span className="text-[#800020]">{application.type || 'Main'} Pass</span>
            </div>
            <div className="flex items-center gap-2 flex-wrap font-semibold text-gray-900">
              <MapPin size={13} className="text-[#800020]" />
              <span>{location?.name || 'Unassigned Location'}</span>
              {location?.code && (
                <span className="px-1.5 py-0.5 bg-[#800020]/10 text-[#800020] rounded font-mono font-bold text-[10px] border border-[#800020]/20">
                  {location.code}
                </span>
              )}
              {category && <span className="text-gray-500 font-normal">({category.name})</span>}
            </div>
            <div className="flex items-center gap-1.5 flex-wrap pt-1 border-t border-slate-200/60">
              <span className="text-[10px] text-gray-500 font-bold uppercase">Access Codes:</span>
              {application.accessCodes && application.accessCodes.length > 0 ? (
                application.accessCodes.map(c => {
                  const ac = getAccessCodeInfo(c, location?.id);
                  return (
                    <span key={c} className="px-1.5 py-0.5 bg-white border border-slate-300 rounded text-[10px] font-bold text-slate-800" title={ac?.accessArea}>
                      {ac?.areaCode || c}
                    </span>
                  );
                })
              ) : (
                <span className="text-[10px] text-gray-400 italic">General Site Access</span>
              )}
            </div>
            {application.contractNumber && (
              <div className="text-[10px] text-gray-500 pt-0.5">
                Contract: <strong className="text-gray-800">{application.contractNumber}</strong> {application.clientCompany ? `(${application.clientCompany})` : ''}
              </div>
            )}
          </div>

          <div className="p-3 bg-amber-50/70 border border-amber-200/80 rounded-xl text-[11px] text-amber-900 leading-relaxed">
            <span className="font-bold">Workflow Process Effect:</span> Changing the Application stage triggers the defined workflow effect across all active applicant passes in this envelope. Individual applicant statuses remain independently editable afterwards when required.
          </div>

          {application && isWorkflowStageRollback(application.status, targetAppStatus) && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-[11px] text-rose-900 leading-relaxed font-semibold">
              ⚠️ <span className="font-bold">Stage Reversion Requirement:</span> You are moving this application back to an earlier workflow stage. Entering a mandatory justification remark is required for the audit log.
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1">Select Stage / Status</label>
            <select
              value={targetAppStatus}
              onChange={(e) => setTargetAppStatus(e.target.value)}
              className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold focus:outline-none focus:border-[#800020]"
            >
              <option value="pending">Stage 1: Under Review</option>
              <option value="processing">Stage 2: Under Processing</option>
              <option value="accepted">Stage 3: Accepted for Processing</option>
              <option value="issued">Stage 4: Pass Issued (Awaiting Handover)</option>
              <option value="collected">Stage 4: Collected & Active</option>
              <option value="clarification">Clarification Requested</option>
              <option value="rejected">Rejected</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1">
              Status Remarks / Notes {application && isWorkflowStageRollback(application.status, targetAppStatus) && <span className="text-rose-600 font-bold">* (Required)</span>}
            </label>
            <textarea
              rows={3}
              value={appRemarks}
              onChange={(e) => setAppRemarks(e.target.value)}
              placeholder={application && isWorkflowStageRollback(application.status, targetAppStatus) ? "Please explain reason for reverting to previous stage (Mandatory)..." : "Enter remarks explaining this status change..."}
              className={cn(
                "w-full p-2.5 bg-gray-50 border rounded-xl text-xs font-medium focus:outline-none focus:border-[#800020]",
                application && isWorkflowStageRollback(application.status, targetAppStatus) && !appRemarks.trim() ? "border-rose-300 bg-rose-50/30" : "border-gray-200"
              )}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => setIsAppStatusModalOpen(false)}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-xl text-xs font-bold hover:bg-gray-200"
            >
              Cancel
            </button>
            <button
              onClick={handleUpdateAppStatus}
              disabled={isSubmittingAction}
              className="px-4 py-2 bg-[#800020] text-white rounded-xl text-xs font-bold hover:bg-[#600018] disabled:opacity-50"
            >
              {isSubmittingAction ? 'Updating...' : 'Save Status'}
            </button>
          </div>
        </div>
      </Modal>

      {/* MODAL 3: UPDATE MEMBER STATUS */}
      <Modal
        isOpen={isMemberStatusModalOpen}
        onClose={() => setIsMemberStatusModalOpen(false)}
        title={`Update Individual Applicant Status (${selectedEmpIds.length} Selected)`}
      >
        <div className="space-y-4">
          <div className="p-3 bg-blue-50/70 border border-blue-200/80 rounded-xl text-[11px] text-blue-900 leading-relaxed">
            <span className="font-bold">Individual Control:</span> Updates the specific applicant(s) without modifying the status of other personnel in the application.
          </div>

          {/* Access Scope Summary */}
          <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl space-y-1 text-xs">
            <div className="flex items-center justify-between text-gray-500 text-[10px] font-bold uppercase">
              <span>Access Scope</span>
              <span className="text-[#800020] font-mono">{location?.code || ''}</span>
            </div>
            <div className="flex items-center gap-1.5 font-bold text-gray-900">
              <MapPin size={12} className="text-[#800020]" />
              <span>{location?.name}</span>
            </div>
            <div className="flex items-center gap-1 flex-wrap pt-0.5">
              <span className="text-[10px] text-gray-400 font-bold uppercase">Codes:</span>
              {application.accessCodes && application.accessCodes.length > 0 ? (
                application.accessCodes.map(c => (
                  <span key={c} className="px-1.5 py-0.2 bg-white border border-slate-200 rounded text-[10px] font-bold text-slate-800">
                    {c}
                  </span>
                ))
              ) : (
                <span className="text-[10px] text-gray-400 italic">General Site Access</span>
              )}
            </div>
          </div>

          {selectedEmpIds.length > 0 && application && isWorkflowStageRollback(application.employeeStatuses?.[selectedEmpIds[0]] || application.status || 'pending', targetMemberStatus) && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-[11px] text-rose-900 leading-relaxed font-semibold">
              ⚠️ <span className="font-bold">Applicant Status Reversion:</span> You are moving applicant status back to an earlier stage. Entering a mandatory justification remark is required for the audit log.
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1">Target Personnel Stage / Status</label>
            <select
              value={targetMemberStatus}
              onChange={(e) => setTargetMemberStatus(e.target.value)}
              className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold focus:outline-none focus:border-[#800020]"
            >
              <option value="pending">Stage 1: Under Review</option>
              <option value="processing">Stage 2: Under Processing</option>
              <option value="accepted">Stage 3: Accepted for Processing</option>
              <option value="issued">Stage 4: Pass Issued (Awaiting Handover)</option>
              <option value="collected">Stage 4: Collected & Active</option>
              <option value="rejected">Rejected</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>

          {targetMemberStatus === 'collected' && (
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">Collected By / Receiver Name</label>
              <input
                type="text"
                value={receiverParty}
                onChange={(e) => setReceiverParty(e.target.value)}
                placeholder="Enter person/PRO who collected the physical passes..."
                className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-medium focus:outline-none focus:border-[#800020]"
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1">
              Member Status Remarks {selectedEmpIds.length > 0 && application && isWorkflowStageRollback(application.employeeStatuses?.[selectedEmpIds[0]] || application.status || 'pending', targetMemberStatus) && <span className="text-rose-600 font-bold">* (Required)</span>}
            </label>
            <textarea
              rows={2}
              value={memberRemarks}
              onChange={(e) => setMemberRemarks(e.target.value)}
              placeholder="Enter remarks or justification for this personnel status change..."
              className={cn(
                "w-full p-2.5 bg-gray-50 border rounded-xl text-xs font-medium focus:outline-none focus:border-[#800020]",
                selectedEmpIds.length > 0 && application && isWorkflowStageRollback(application.employeeStatuses?.[selectedEmpIds[0]] || application.status || 'pending', targetMemberStatus) && !memberRemarks.trim() ? "border-rose-300 bg-rose-50/30" : "border-gray-200"
              )}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => setIsMemberStatusModalOpen(false)}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-xl text-xs font-bold hover:bg-gray-200"
            >
              Cancel
            </button>
            <button
              onClick={handleBatchMemberStatus}
              disabled={isSubmittingAction}
              className="px-4 py-2 bg-[#800020] text-white rounded-xl text-xs font-bold hover:bg-[#600018] disabled:opacity-50"
            >
              {isSubmittingAction ? 'Updating...' : 'Confirm Status Update'}
            </button>
          </div>
        </div>
      </Modal>

      {/* MODAL 4: EDIT APPLICATION DETAILS */}
      <Modal
        isOpen={isEditAppModalOpen}
        onClose={() => setIsEditAppModalOpen(false)}
        title="Edit Application Details"
        size="full"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1">Authority App Number</label>
            <input
              type="text"
              value={editAuthNum}
              onChange={(e) => setEditAuthNum(e.target.value)}
              placeholder="e.g. APP-2026-99"
              className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold focus:outline-none focus:border-[#800020]"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">Location / Site</label>
              <select
                value={editLocationId}
                onChange={(e) => setEditLocationId(e.target.value)}
                className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold focus:outline-none focus:border-[#800020]"
              >
                {locations.map(loc => (
                  <option key={loc.id} value={loc.id}>{loc.name} ({loc.code})</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">Pass Type</label>
              <select
                value={editType}
                onChange={(e) => setEditType(e.target.value)}
                className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold focus:outline-none focus:border-[#800020]"
              >
                <option value="main">Main Pass</option>
                <option value="supplementary">Supplementary Pass</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1">Application Workflow Status</label>
            <select
              value={editStatus}
              onChange={(e) => setEditStatus(e.target.value)}
              className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold focus:outline-none focus:border-[#800020]"
            >
              <option value="pending">Stage 1: Under Review (pending)</option>
              <option value="processing">Stage 2: Under Processing (processing)</option>
              <option value="accepted">Stage 3: Accepted for Processing (accepted)</option>
              <option value="issued">Stage 4: Pass Issuance & Collection (issued)</option>
              <option value="collected">Collected & Active (collected)</option>
              <option value="rejected">Rejected (rejected)</option>
              <option value="cancelled">Cancelled (cancelled)</option>
            </select>
          </div>

          {editType === 'supplementary' && (
            <div className="bg-amber-50 border border-amber-200 p-3 rounded-xl space-y-1 text-xs">
              <p className="font-bold text-amber-900 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>
                Automatic Parent Main Pass Linkage
              </p>
              <p className="text-[11px] text-amber-800">
                Supplementary passes are automatically linked to each personnel's active Main Pass in this location/category.
              </p>
            </div>
          )}

          {/* Authorized Access Codes Selection */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-bold text-gray-700">Authorized Access Codes & Areas</label>
              <span className="text-[11px] text-[#800020] font-bold">
                {editAccessCodes.length} selected
              </span>
            </div>
            <div className="p-3 bg-gray-50 border border-gray-200 rounded-xl space-y-2 max-h-44 overflow-y-auto">
              {(() => {
                const availableCodes = accessCodes.filter(ac => ac.locationId === editLocationId || !ac.locationId);
                if (availableCodes.length === 0) {
                  return <p className="text-xs text-gray-400 italic">No access codes found for this location.</p>;
                }
                return (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {availableCodes.map(ac => {
                      const isSelected = editAccessCodes.includes(ac.areaCode) || editAccessCodes.includes(ac.id);
                      return (
                        <div
                          key={ac.id}
                          onClick={() => {
                            const codeKey = ac.areaCode || ac.id;
                            if (isSelected) {
                              setEditAccessCodes(editAccessCodes.filter(c => c !== ac.areaCode && c !== ac.id));
                            } else {
                              setEditAccessCodes([...editAccessCodes, codeKey]);
                            }
                          }}
                          className={cn(
                            "p-2 rounded-lg border text-xs cursor-pointer transition-all flex items-start gap-2 select-none",
                            isSelected 
                              ? "bg-rose-50/70 border-[#800020] text-[#800020]" 
                              : "bg-white border-gray-200 text-gray-700 hover:border-gray-300"
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => {}}
                            className="mt-0.5 rounded border-gray-300 text-[#800020] focus:ring-[#800020]"
                          />
                          <div>
                            <div className="font-bold flex items-center gap-1">
                              <span className="font-mono">{ac.areaCode}</span>
                              <span className="text-gray-400 font-normal">({ac.status || 'Active'})</span>
                            </div>
                            <div className="text-[11px] text-gray-500 line-clamp-1">{ac.accessArea}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          </div>

          {/* Contract Details */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 bg-gray-50/80 p-3 rounded-xl border border-gray-200">
            <div>
              <label className="block text-[10px] font-bold text-gray-700 uppercase mb-1">Contract Number</label>
              <input
                type="text"
                value={editContractNumber}
                onChange={(e) => setEditContractNumber(e.target.value)}
                placeholder="e.g. CTR-2026-001"
                className="w-full p-2 bg-white border border-gray-200 rounded-lg text-xs font-mono font-semibold focus:outline-none focus:border-[#800020]"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-gray-700 uppercase mb-1">Contract Name</label>
              <input
                type="text"
                value={editContractName}
                onChange={(e) => setEditContractName(e.target.value)}
                placeholder="e.g. Facility Maintenance"
                className="w-full p-2 bg-white border border-gray-200 rounded-lg text-xs font-semibold focus:outline-none focus:border-[#800020]"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-gray-700 uppercase mb-1">Client Company</label>
              <input
                type="text"
                value={editClientCompany}
                onChange={(e) => setEditClientCompany(e.target.value)}
                placeholder="e.g. Qatar Energy"
                className="w-full p-2 bg-white border border-gray-200 rounded-lg text-xs font-semibold focus:outline-none focus:border-[#800020]"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-gray-700 uppercase mb-1">Client Approvers</label>
              <input
                type="text"
                value={editClientApprovers}
                onChange={(e) => setEditClientApprovers(e.target.value)}
                placeholder="e.g. John Doe, Sarah Smith"
                className="w-full p-2 bg-white border border-gray-200 rounded-lg text-xs font-semibold focus:outline-none focus:border-[#800020]"
              />
            </div>
          </div>

          {/* Personnel Selection & Dates Section */}
          <div className="border border-gray-200 rounded-2xl p-3.5 bg-gray-50/50 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-gray-200/80 pb-2.5">
              <div>
                <h4 className="text-xs font-bold text-gray-900">Personnel Assigned ({editEmployeeIds.length})</h4>
                <p className="text-[10px] text-gray-500">Already assigned personnel appear on top with individual validity dates</p>
              </div>
              {editEmployeeIds.length > 0 && (
                <div className="flex items-center gap-1.5 self-end sm:self-auto">
                  <input
                    type="date"
                    value={parseToYMD(editStartDate) || ''}
                    onChange={(e) => setEditStartDate(e.target.value)}
                    className="p-1 px-2 bg-white border border-gray-200 rounded-lg text-[11px] font-semibold focus:outline-none focus:border-[#800020]"
                    title="Batch Default Start Date"
                  />
                  <input
                    type="date"
                    value={parseToYMD(editEndDate) || ''}
                    onChange={(e) => setEditEndDate(e.target.value)}
                    className="p-1 px-2 bg-white border border-gray-200 rounded-lg text-[11px] font-semibold focus:outline-none focus:border-[#800020]"
                    title="Batch Default Expiry Date"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (!editStartDate && !editEndDate) {
                        showToast("Please pick a batch start or expiry date first", "error");
                        return;
                      }
                      const updatedStart: Record<string, string> = { ...editIndStartDates };
                      const updatedExp: Record<string, string> = { ...editIndExpiries };
                      editEmployeeIds.forEach(empId => {
                        if (editStartDate) updatedStart[empId] = editStartDate;
                        if (editEndDate) updatedExp[empId] = editEndDate;
                      });
                      setEditIndStartDates(updatedStart);
                      setEditIndExpiries(updatedExp);
                      showToast("Updated dates for all assigned personnel");
                    }}
                    className="px-2.5 py-1 bg-white border border-gray-200 text-[#800020] hover:bg-gray-100 rounded-lg text-[11px] font-bold shadow-2xs cursor-pointer transition-all whitespace-nowrap"
                  >
                    Apply Dates to All
                  </button>
                </div>
              )}
            </div>

            {/* Personnel Filter Input & Add Personnel Toggle */}
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={editPersonnelSearch}
                onChange={(e) => setEditPersonnelSearch(e.target.value)}
                placeholder="Filter personnel by name, QID or ID..."
                className="flex-1 px-3 py-1.5 bg-white border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-[#800020]"
              />
            </div>

            {/* Personnel List - Already Added ON TOP */}
            <div className="max-h-64 overflow-y-auto space-y-2 pr-1 scrollbar-thin">
              {employees
                .filter(e => {
                  if (!editPersonnelSearch) return true;
                  const s = editPersonnelSearch.toLowerCase();
                  return e.name.toLowerCase().includes(s) || e.id.toLowerCase().includes(s) || (e.qatarId && e.qatarId.toLowerCase().includes(s)) || (e.employeeId && e.employeeId.toLowerCase().includes(s));
                })
                .sort((a, b) => {
                  const aChecked = editEmployeeIds.includes(a.id) ? 1 : 0;
                  const bChecked = editEmployeeIds.includes(b.id) ? 1 : 0;
                  return bChecked - aChecked; // Checked employees first
                })
                .map(emp => {
                  const isChecked = editEmployeeIds.includes(emp.id);
                  const empStart = editIndStartDates[emp.id] || editStartDate;
                  const empExp = editIndExpiries[emp.id] || editEndDate;

                  const targetCatId = locations.find(l => l.id === editLocationId)?.categoryId || category?.id || (application as any)?.categoryId;
                  const activeMainPass = findActiveMainPassForEmp(emp.id, editLocationId, targetCatId);
                  const activeMainApp = findActiveMainAppForEmp(emp.id, editLocationId, targetCatId, application.id);

                  return (
                    <div
                      key={emp.id}
                      className={cn(
                        "p-2.5 rounded-xl border transition-all text-xs space-y-2",
                        isChecked ? "bg-white border-[#800020]/40 shadow-2xs" : "bg-gray-100/60 border-gray-200 opacity-60 hover:opacity-100"
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <label className="flex items-center gap-2 cursor-pointer font-bold text-gray-900 select-none">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setEditEmployeeIds([...editEmployeeIds, emp.id]);
                                setEditIndStartDates({ ...editIndStartDates, [emp.id]: editStartDate });
                                setEditIndExpiries({ ...editIndExpiries, [emp.id]: editEndDate });
                              } else {
                                setEditEmployeeIds(editEmployeeIds.filter(i => i !== emp.id));
                              }
                            }}
                            className="w-4 h-4 rounded text-[#800020] focus:ring-[#800020] cursor-pointer"
                          />
                          <span>{emp.name}</span>
                          <span className="text-[10px] font-semibold text-gray-500">({emp.qatarId || emp.employeeId || emp.id})</span>
                        </label>

                        {/* Status Badge & Check Marker */}
                        <div className="flex items-center gap-2">
                          {isChecked && (
                            <span className="text-[10px] font-bold text-white bg-[#800020] px-2 py-0.5 rounded-full">
                              Assigned
                            </span>
                          )}
                          {editType === 'main' ? (
                            activeMainPass ? (
                              <span className="text-[10px] font-bold text-amber-800 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                                ⚠️ Main Pass Exists ({activeMainPass.passNumber || activeMainPass.id})
                              </span>
                            ) : activeMainApp ? (
                              <span className="text-[10px] font-bold text-amber-800 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                                ⚠️ Has Main App ({activeMainApp.authorityAppNumber || activeMainApp.id})
                              </span>
                            ) : (
                              <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                                Eligible
                              </span>
                            )
                          ) : (
                            activeMainPass ? (
                              <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                                ✓ Main Pass ({activeMainPass.passNumber || activeMainPass.id})
                              </span>
                            ) : activeMainApp ? (
                              <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                                ✓ Main App ({activeMainApp.authorityAppNumber || activeMainApp.id})
                              </span>
                            ) : (
                              <span className="text-[10px] font-bold text-rose-700 bg-rose-50 px-2 py-0.5 rounded-full border border-rose-200">
                                ❌ No Main Pass
                              </span>
                            )
                          )}
                        </div>
                      </div>

                      {/* Individual Dates per Personnel when checked */}
                      {isChecked && (
                        <div className="grid grid-cols-2 gap-2 pt-1 border-t border-gray-100">
                          <div>
                            <span className="text-[10px] font-bold text-gray-500 block mb-0.5">Start Date</span>
                            <input
                              type="date"
                              value={parseToYMD(empStart) || ''}
                              onChange={(e) => setEditIndStartDates({ ...editIndStartDates, [emp.id]: e.target.value })}
                              className="w-full p-1.5 bg-gray-50 border border-gray-200 rounded-lg text-xs font-semibold focus:outline-none focus:border-[#800020]"
                            />
                          </div>
                          <div>
                            <span className="text-[10px] font-bold text-gray-500 block mb-0.5">Expiry Date</span>
                            <input
                              type="date"
                              value={parseToYMD(empExp) || ''}
                              onChange={(e) => setEditIndExpiries({ ...editIndExpiries, [emp.id]: e.target.value })}
                              className="w-full p-1.5 bg-gray-50 border border-gray-200 rounded-lg text-xs font-semibold focus:outline-none focus:border-[#800020]"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1">Remarks / Justification</label>
            <textarea
              rows={3}
              value={editRemarks}
              onChange={(e) => setEditRemarks(e.target.value)}
              placeholder="Enter notes or justification..."
              className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-medium focus:outline-none focus:border-[#800020]"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => setIsEditAppModalOpen(false)}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-xl text-xs font-bold hover:bg-gray-200 cursor-pointer"
            >
              Cancel
            </button>
            <button
              onClick={handleSaveEditApp}
              disabled={isSubmittingAction}
              className="px-4 py-2 bg-[#800020] text-white rounded-xl text-xs font-bold hover:bg-[#600018] disabled:opacity-50 cursor-pointer shadow-sm flex items-center gap-1.5"
            >
              <Save size={14} />
              {isSubmittingAction ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>
      </Modal>

      {/* MODAL 5: ADD PERSONNEL TO APPLICATION */}
      <Modal
        isOpen={isAddPersonnelModalOpen}
        onClose={() => {
          setIsAddPersonnelModalOpen(false);
          setSelectedNewEmpIds([]);
          setAddPersonnelSearch('');
        }}
        title={`Add Personnel to Application #${application.id}`}
        size="3xl"
      >
        <div className="space-y-4 flex flex-col max-h-[70vh]">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search available personnel by name, QID, job title..."
              value={addPersonnelSearch}
              onChange={(e) => setAddPersonnelSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-medium focus:outline-none focus:border-[#800020]"
            />
          </div>

          <div className="flex-1 overflow-y-auto min-h-[200px] max-h-[320px] border border-gray-200 rounded-xl divide-y divide-gray-100">
            {availableEmployeesToAdd.length === 0 ? (
              <div className="p-8 text-center text-xs text-gray-400 italic">
                No available personnel found to add.
              </div>
            ) : (
              availableEmployeesToAdd.map(emp => {
                const isSelected = selectedNewEmpIds.includes(emp.id);
                return (
                  <div
                    key={emp.id}
                    onClick={() => {
                      setSelectedNewEmpIds(prev => 
                        prev.includes(emp.id) ? prev.filter(i => i !== emp.id) : [...prev, emp.id]
                      );
                    }}
                    className={cn(
                      "p-3 flex items-center justify-between cursor-pointer hover:bg-gray-50 transition-colors",
                      isSelected && "bg-emerald-50/50"
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => {}}
                        className="rounded border-gray-300 text-[#800020] focus:ring-[#800020]"
                      />
                      <div>
                        <p className="text-xs font-bold text-gray-900">{emp.name}</p>
                        <p className="text-[10px] text-gray-500">
                          ID: {emp.employeeId} • QID: {emp.qatarId || 'N/A'} • {emp.jobTitle || emp.department}
                        </p>
                      </div>
                    </div>
                    <span className="text-[10px] font-semibold text-gray-400 uppercase">
                      {emp.employeeType || 'Employee'}
                    </span>
                  </div>
                );
              })
            )}
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-gray-100">
            <span className="text-xs font-bold text-[#800020]">
              {selectedNewEmpIds.length} Selected
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setIsAddPersonnelModalOpen(false);
                  setSelectedNewEmpIds([]);
                }}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-xl text-xs font-bold hover:bg-gray-200 cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleAddPersonnelSubmit}
                disabled={isSubmittingAction || selectedNewEmpIds.length === 0}
                className="px-4 py-2 bg-[#800020] text-white rounded-xl text-xs font-bold hover:bg-[#600018] disabled:opacity-50 cursor-pointer shadow-sm flex items-center gap-1.5"
              >
                <UserPlus size={14} />
                {isSubmittingAction ? 'Adding...' : `Add ${selectedNewEmpIds.length} Personnel`}
              </button>
            </div>
          </div>
        </div>
      </Modal>

      {/* MODAL 6: PASS INSPECTION & ADMIN VALIDITY EDIT */}
      {inspectingPass && (
        <Modal
          isOpen={!!inspectingPass}
          onClose={() => setInspectingPass(null)}
          title={`Pass Validity & Management (${inspectingPass.passNumber || inspectingPass.id})`}
        >
          <PassDetails
            pass={inspectingPass}
            employee={employees.find(e => e.id === inspectingPass.employeeId || e.employeeId === inspectingPass.employeeId)}
            location={locations.find(l => l.id === inspectingPass.locationId)}
            accessCodes={accessCodes}
            currentUser={currentUser}
            onClose={() => setInspectingPass(null)}
            onSavePass={async () => {
              await onSuccess();
              setInspectingPass(null);
            }}
            onUpdateStatus={async (newStatus) => {
              try {
                const res = await apiFetch(`/api/passes/${inspectingPass.id}/status`, {
                  method: 'PATCH',
                  body: JSON.stringify({ status: newStatus })
                });
                if (res.ok) {
                  showToast(`Pass status updated to ${newStatus}`);
                  setInspectingPass(null);
                  await onSuccess();
                } else {
                  showToast("Failed to update status", "error");
                }
              } catch (err) {
                showToast("Error updating status", "error");
              }
            }}
          />
        </Modal>
      )}

      {/* MODAL 7: PASS ISSUANCE MODAL */}
      {isIssuePassModalOpen && (
        <Modal
          isOpen={isIssuePassModalOpen}
          onClose={() => {
            setIsIssuePassModalOpen(false);
            setIssuePassModalData(null);
          }}
          title="Issue Passes for Application"
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
            initialData={issuePassModalData}
            onSuccess={async () => {
              setIsIssuePassModalOpen(false);
              setIssuePassModalData(null);
              await onSuccess();
              fetchHistory();
            }}
            onClose={() => {
              setIsIssuePassModalOpen(false);
              setIssuePassModalData(null);
            }}
            currentUser={currentUser}
            logAction={() => {}}
            showToast={showToast}
          />
        </Modal>
      )}

      {/* Stage Skip Confirmation Modal */}
      {stageSkipConfirmModal && (
        <StageSkipConfirmModal
          isOpen={!!stageSkipConfirmModal}
          onClose={() => setStageSkipConfirmModal(null)}
          onConfirm={stageSkipConfirmModal.onConfirm}
          currentStatus={stageSkipConfirmModal.currentStatus}
          targetStatus={stageSkipConfirmModal.targetStatus}
          entityName={stageSkipConfirmModal.entityName}
          isSubmitting={isSubmittingAction}
        />
      )}
    </div>
  );
}
