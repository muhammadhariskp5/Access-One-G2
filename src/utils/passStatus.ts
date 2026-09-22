export type DisplayStatusKey = 
  | 'active'
  | 'completed'
  | 'collected'
  | 'issued'
  | 'partially_issued'
  | 'accepted'
  | 'approved'
  | 'processing'
  | 'pending'
  | 'rejected'
  | 'cancelled'
  | 'expired'
  | 'revoked'
  | 'replaced';

export interface PassBreakdownStats {
  activeCollectedCount: number;
  issuedCount: number;
  acceptedCount: number;
  processingCount: number;
  pendingCount: number;
  cancelledCount: number;
  total: number;
  allDone: boolean;
  collected: number;
  pending: number;
  cancelled: number;
  rejected: number;
}

/**
 * Single Source of Truth for resolving an individual personnel's pass status.
 * Stage 1: Under Review (Verification & Document Review)
 * Stage 2: Under Processing (Processing in Progress)
 * Stage 3: Accepted for Processing (Pass Issuance & Encoding / Pass Generation)
 * Stage 4: Pass Handover & Collection (Counter Handover, Collection & Activation)
 * Terminal: Rejected, Cancelled, Revoked, Expired, Replaced
 */
export function resolvePersonnelStatus(
  rawEmpStatus?: string,
  passStatus?: string,
  appStatus?: string
): { 
  label: string; 
  statusKey: string; 
  stageNumber: 1 | 2 | 3 | 4 | 0; 
  isFinished: boolean; 
  isCreatedAndActive: boolean 
} {
  const empStatusLower = (rawEmpStatus || '').trim().toLowerCase();
  const passStatusLower = (passStatus || '').trim().toLowerCase();
  const appStatusLower = (appStatus || '').trim().toLowerCase();

  // Terminal checks (Stage 0)
  if (empStatusLower === 'replaced' || passStatusLower === 'replaced' || passStatusLower === 'superseded') {
    return { label: 'Replaced', statusKey: 'replaced', stageNumber: 0, isFinished: true, isCreatedAndActive: false };
  }
  if (empStatusLower === 'cancelled' || passStatusLower === 'cancelled' || (empStatusLower === '' && appStatusLower === 'cancelled')) {
    return { label: 'Cancelled', statusKey: 'cancelled', stageNumber: 0, isFinished: true, isCreatedAndActive: false };
  }
  if (empStatusLower === 'rejected' || passStatusLower === 'rejected' || (empStatusLower === '' && appStatusLower === 'rejected')) {
    return { label: 'Rejected', statusKey: 'rejected', stageNumber: 0, isFinished: true, isCreatedAndActive: false };
  }
  if (passStatusLower === 'revoked') {
    return { label: 'Revoked', statusKey: 'revoked', stageNumber: 0, isFinished: true, isCreatedAndActive: false };
  }
  if (passStatusLower === 'expired') {
    return { label: 'Expired', statusKey: 'expired', stageNumber: 0, isFinished: true, isCreatedAndActive: false };
  }

  // Stage 4 Completed: Active / Collected (Physical counter collection has occurred)
  if (
    passStatusLower === 'collected' ||
    passStatusLower === 'active' ||
    empStatusLower === 'collected' ||
    empStatusLower === 'completed' ||
    (empStatusLower === '' && (appStatusLower === 'collected' || appStatusLower === 'completed' || appStatusLower === 'active'))
  ) {
    return { label: 'Collected / Active', statusKey: 'collected', stageNumber: 4, isFinished: true, isCreatedAndActive: true };
  }

  // Stage 4 (Pass Issued / Handover Stage)
  if (
    passStatusLower === 'issued' || 
    empStatusLower === 'issued' || 
    empStatusLower === 'ready_for_collection' ||
    passStatusLower === 'ready_for_collection' ||
    (empStatusLower === '' && (appStatusLower === 'issued' || appStatusLower === 'ready_for_collection'))
  ) {
    return { label: 'Pass Issued (Awaiting Handover)', statusKey: 'issued', stageNumber: 4, isFinished: false, isCreatedAndActive: false };
  }

  // Stage 3: Accepted for Processing (Pass Issuance & Encoding / Pass Not Issued Yet)
  if (
    empStatusLower === 'accepted' ||
    passStatusLower === 'accepted' ||
    empStatusLower === 'approved' ||
    passStatusLower === 'approved' ||
    empStatusLower === 'approved_for_issue' ||
    (empStatusLower === '' && (appStatusLower === 'accepted' || appStatusLower === 'approved'))
  ) {
    return { label: 'Accepted for Processing (Pass Not Issued Yet)', statusKey: 'accepted', stageNumber: 3, isFinished: false, isCreatedAndActive: false };
  }

  // Stage 2: Under Processing
  if (
    empStatusLower === 'processing' ||
    empStatusLower === 'under_processing' ||
    empStatusLower === 'forwarded' ||
    empStatusLower === 'clarification' ||
    passStatusLower === 'processing' ||
    (empStatusLower === '' && (appStatusLower === 'processing' || appStatusLower === 'under_processing' || appStatusLower === 'forwarded' || appStatusLower === 'clarification'))
  ) {
    return { label: 'Under Processing', statusKey: 'processing', stageNumber: 2, isFinished: false, isCreatedAndActive: false };
  }

  // Stage 1: Under Review (Default initial state)
  return { label: 'Under Review', statusKey: 'pending', stageNumber: 1, isFinished: false, isCreatedAndActive: false };
}

/**
 * Single Source of Truth for calculating breakdown statistics & rollup status for an application.
 */
export function calculateApplicationStats(
  employeeIds: string[] = [],
  employeeStatuses: Record<string, string> = {},
  passesForApp: { employeeId?: string; status?: string }[] = [],
  appStatus?: string
): PassBreakdownStats {
  let activeCollectedCount = 0;
  let issuedCount = 0;
  let acceptedCount = 0;
  let processingCount = 0;
  let pendingCount = 0;
  let cancelledCount = 0;

  employeeIds.forEach(empId => {
    const empPass = passesForApp.find(p => p.employeeId === empId);
    const empStatus = employeeStatuses[empId];
    
    const resolved = resolvePersonnelStatus(empStatus, empPass?.status, appStatus);

    if (resolved.statusKey === 'cancelled' || resolved.statusKey === 'rejected' || resolved.statusKey === 'revoked' || resolved.statusKey === 'replaced') {
      cancelledCount++;
    } else if (resolved.isCreatedAndActive) {
      activeCollectedCount++;
    } else if (resolved.statusKey === 'issued') {
      issuedCount++;
    } else if (resolved.statusKey === 'accepted') {
      acceptedCount++;
    } else if (resolved.statusKey === 'processing') {
      processingCount++;
    } else {
      pendingCount++;
    }
  });

  const total = employeeIds.length;
  const nonCancelledTotal = total - cancelledCount;
  const allDone = total > 0 && nonCancelledTotal > 0 && activeCollectedCount === nonCancelledTotal;

  return {
    activeCollectedCount,
    issuedCount,
    acceptedCount,
    processingCount,
    pendingCount,
    cancelledCount,
    total,
    allDone,
    collected: activeCollectedCount,
    pending: pendingCount,
    cancelled: cancelledCount,
    rejected: cancelledCount
  };
}

/**
 * Single Source of Truth for application status badge styling and labels.
 */
export function getApplicationBadgeProps(status?: string, _totalPersonnel = 1) {
  const s = (status || '').toLowerCase();
  switch (s) {
    case 'collected':
    case 'completed':
    case 'active':
      return { 
        label: 'Collected & Active', 
        badgeClass: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
        text: 'Collected & Active',
        bg: 'bg-emerald-50 text-emerald-700 border-emerald-200' 
      };
    case 'issued':
    case 'ready_for_collection':
      return {
        label: 'Pass Issued (Awaiting Handover)',
        badgeClass: 'bg-teal-50 text-teal-700 border border-teal-200',
        text: 'Pass Issued',
        bg: 'bg-teal-50 text-teal-700 border-teal-200'
      };
    case 'partially_issued':
    case 'partial':
      return {
        label: 'Partially Issued',
        badgeClass: 'bg-cyan-50 text-cyan-700 border border-cyan-200',
        text: 'Partially Issued',
        bg: 'bg-cyan-50 text-cyan-700 border-cyan-200'
      };
    case 'accepted':
    case 'approved':
      return { 
        label: 'Accepted for Processing (Stage 3)', 
        badgeClass: 'bg-indigo-50 text-indigo-700 border border-indigo-200',
        text: 'Accepted for Processing',
        bg: 'bg-indigo-50 text-indigo-700 border-indigo-200' 
      };
    case 'processing':
    case 'under_processing':
    case 'forwarded':
      return { 
        label: 'Under Processing (Stage 2)', 
        badgeClass: 'bg-amber-50 text-amber-700 border border-amber-200',
        text: 'Under Processing',
        bg: 'bg-amber-50 text-amber-700 border-amber-200' 
      };
    case 'clarification':
      return { 
        label: 'Clarification', 
        badgeClass: 'bg-purple-50 text-purple-700 border border-purple-200',
        text: 'Clarification',
        bg: 'bg-purple-50 text-purple-700 border-purple-200' 
      };
    case 'rejected':
      return { 
        label: 'Rejected', 
        badgeClass: 'bg-rose-50 text-rose-700 border border-rose-200',
        text: 'Rejected',
        bg: 'bg-rose-50 text-rose-700 border-rose-200' 
      };
    case 'cancelled':
      return { 
        label: 'Cancelled', 
        badgeClass: 'bg-rose-50 text-rose-700 border border-rose-200',
        text: 'Cancelled',
        bg: 'bg-rose-50 text-rose-700 border-rose-200' 
      };
    case 'archived':
      return { 
        label: 'Archived', 
        badgeClass: 'bg-gray-100 text-gray-700 border border-gray-300',
        text: 'Archived',
        bg: 'bg-gray-100 text-gray-700 border-gray-300' 
      };
    case 'replaced':
      return { 
        label: 'Replaced', 
        badgeClass: 'bg-gray-100 text-gray-600 border border-gray-300',
        text: 'Replaced',
        bg: 'bg-gray-100 text-gray-600 border-gray-300' 
      };
    default:
      return { 
        label: 'Under Review (Stage 1)', 
        badgeClass: 'bg-gray-50 text-gray-700 border border-gray-200',
        text: 'Under Review',
        bg: 'bg-gray-50 text-gray-700 border-gray-200' 
      };
  }
}

/**
 * Single Source of Truth for Workflow Stage Information.
 * 4-Stage Lifecycle Model:
 * Stage 1: Under Review
 * Stage 2: Under Processing
 * Stage 3: Accepted for Processing
 * Stage 4: Pass Issuance & Collection
 */
export interface WorkflowStageInfo {
  stageNumber: 1 | 2 | 3 | 4 | 0;
  stageName: string;
  stepName: string;
  orderRank: number;
  badgeColor: string;
  isAllCompleted?: boolean;
}

export function getWorkflowStageInfo(status: string = 'pending'): WorkflowStageInfo {
  const s = (status || 'pending').toLowerCase();
  switch (s) {
    case 'pending':
    case 'under_review':
    case 'review':
      return { 
        stageNumber: 1, 
        stageName: 'Stage 1 – Under Review', 
        stepName: 'Under Review (Stage 1)', 
        orderRank: 1, 
        badgeColor: 'bg-gray-100 text-gray-700 border-gray-200' 
      };
    case 'processing':
    case 'under_processing':
    case 'forwarded':
    case 'clarification':
      return { 
        stageNumber: 2, 
        stageName: 'Stage 2 – Under Processing', 
        stepName: 'Under Processing (Stage 2)', 
        orderRank: 2, 
        badgeColor: 'bg-amber-100 text-amber-800 border-amber-200' 
      };
    case 'approved':
    case 'accepted':
      return { 
        stageNumber: 3, 
        stageName: 'Stage 3 – Accepted for Processing', 
        stepName: 'Accepted for Processing (Stage 3)', 
        orderRank: 3, 
        badgeColor: 'bg-indigo-100 text-indigo-800 border-indigo-200' 
      };
    case 'partially_issued':
      return { 
        stageNumber: 4, 
        stageName: 'Stage 4 – Pass Issuance & Collection', 
        stepName: 'Partially Issued (Pass Issuance & Collection)', 
        orderRank: 4, 
        badgeColor: 'bg-cyan-100 text-cyan-800 border-cyan-200', 
        isAllCompleted: false 
      };
    case 'issued':
    case 'ready_for_collection':
      return { 
        stageNumber: 4, 
        stageName: 'Stage 4 – Pass Issuance & Collection', 
        stepName: 'Pass Issued (Awaiting Handover)', 
        orderRank: 4, 
        badgeColor: 'bg-teal-100 text-teal-800 border-teal-200', 
        isAllCompleted: false 
      };
    case 'collected':
    case 'completed':
    case 'active':
      return { 
        stageNumber: 4, 
        stageName: 'Stage 4 – Pass Issuance & Collection', 
        stepName: 'All Stages Completed (Collected & Active)', 
        orderRank: 5, 
        badgeColor: 'bg-emerald-600 text-white border-emerald-700', 
        isAllCompleted: true 
      };
    case 'archived':
      return { stageNumber: 0, stageName: 'Archived Application', stepName: 'ARCHIVED', orderRank: 0, badgeColor: 'bg-gray-100 text-gray-700 border-gray-300' };
    case 'rejected':
      return { stageNumber: 0, stageName: 'Rejected Application', stepName: 'REJECTED', orderRank: 0, badgeColor: 'bg-rose-100 text-rose-800 border-rose-200' };
    case 'cancelled':
      return { stageNumber: 0, stageName: 'Cancelled Application', stepName: 'CANCELLED', orderRank: 0, badgeColor: 'bg-rose-100 text-rose-800 border-rose-200' };
    case 'replaced':
      return { stageNumber: 0, stageName: 'Replaced Pass', stepName: 'REPLACED', orderRank: 0, badgeColor: 'bg-gray-100 text-gray-600 border-gray-300' };
    default:
      return { stageNumber: 0, stageName: 'Terminal Status', stepName: (s || 'TERMINAL').toUpperCase(), orderRank: 0, badgeColor: 'bg-rose-100 text-rose-800 border-rose-200' };
  }
}

export interface SkippedStageItem {
  statusKey: string;
  stageNumber: number;
  stageName: string;
  stepName: string;
}

export function getSkippedWorkflowStages(currentStatus: string, targetStatus: string): SkippedStageItem[] {
  const currentInfo = getWorkflowStageInfo(currentStatus);
  const targetInfo = getWorkflowStageInfo(targetStatus);

  if (currentInfo.orderRank === 0 || targetInfo.orderRank === 0) return [];
  if (targetInfo.orderRank <= currentInfo.orderRank + 1) return [];

  const sequence: { statusKey: string; info: WorkflowStageInfo }[] = [
    { statusKey: 'pending', info: getWorkflowStageInfo('pending') },
    { statusKey: 'processing', info: getWorkflowStageInfo('processing') },
    { statusKey: 'accepted', info: getWorkflowStageInfo('accepted') },
    { statusKey: 'issued', info: getWorkflowStageInfo('issued') },
    { statusKey: 'collected', info: getWorkflowStageInfo('collected') },
  ];

  const skipped: SkippedStageItem[] = [];
  sequence.forEach(item => {
    if (item.info.orderRank > currentInfo.orderRank && item.info.orderRank < targetInfo.orderRank) {
      skipped.push({
        statusKey: item.statusKey,
        stageNumber: item.info.stageNumber,
        stageName: item.info.stageName,
        stepName: item.info.stepName
      });
    }
  });

  return skipped;
}

/**
 * Check if transitioning from currentStatus to targetStatus represents a backward / rollback step.
 */
export function isWorkflowStageRollback(currentStatus: string, targetStatus: string): boolean {
  const currentInfo = getWorkflowStageInfo(currentStatus);
  const targetInfo = getWorkflowStageInfo(targetStatus);

  if (currentInfo.orderRank > 0 && targetInfo.orderRank > 0) {
    return targetInfo.orderRank < currentInfo.orderRank;
  }
  return false;
}

/**
 * Single Source of Truth for computing overall application status rollup.
 */
export function computeApplicationRollupStatus(
  currentStatus: string = 'pending',
  stats: PassBreakdownStats
): string {
  const lowerStatus = (currentStatus || '').toLowerCase();
  
  if (lowerStatus === 'archived' || lowerStatus === 'rejected' || lowerStatus === 'cancelled' || lowerStatus === 'replaced') {
    return lowerStatus;
  }

  const nonCancelled = stats.total - stats.cancelledCount;
  if (nonCancelled > 0) {
    if (stats.activeCollectedCount === nonCancelled) {
      return 'completed';
    }
    if (stats.activeCollectedCount + stats.issuedCount === nonCancelled) {
      return 'issued';
    }
    if (stats.activeCollectedCount + stats.issuedCount > 0) {
      return 'partially_issued';
    }
    if (stats.acceptedCount + stats.issuedCount + stats.activeCollectedCount === nonCancelled) {
      return 'accepted';
    }
    if (stats.processingCount > 0 || (stats.acceptedCount > 0 && stats.pendingCount > 0)) {
      return 'processing';
    }
    if (stats.pendingCount === nonCancelled) {
      return 'pending';
    }
  } else if (stats.total > 0 && stats.cancelledCount === stats.total) {
    return 'cancelled';
  }

  return currentStatus;
}

/**
 * Single Source of Truth for evaluating if an application or pass item matches filter criteria.
 * Excludes replaced passes by default unless 'replaced' is explicitly requested.
 */
export function filterPassApplicationItem(
  itemStatus: string,
  filterType: string,
  stats?: PassBreakdownStats
): boolean {
  const s = (itemStatus || '').toLowerCase();
  const f = (filterType || 'all').toLowerCase();

  // Always hide replaced passes/items unless filterType is explicitly 'replaced'
  if (s === 'replaced' || s === 'superseded') {
    return f === 'replaced';
  }

  if (!filterType || filterType === 'all') return true;

  switch (f) {
    case 'active':
    case 'collected':
      return s === 'active' || s === 'collected' || s === 'completed';
    case 'issued':
    case 'ready_for_collection':
      return s === 'issued' || s === 'ready_for_collection' || s === 'partially_issued';
    case 'accepted':
    case 'approved':
      return s === 'accepted' || s === 'approved';
    case 'processing':
    case 'under_processing':
      return s === 'processing' || s === 'under_processing' || s === 'forwarded' || s === 'clarification';
    case 'pending':
    case 'under_review':
      return s === 'pending' || s === 'under_review' || s === 'review';
    case 'completed':
      return s === 'completed' || s === 'collected' || (stats ? stats.allDone : false);
    case 'expired':
      return s === 'expired';
    case 'revoked':
      return s === 'revoked';
    case 'replaced':
      return s === 'replaced' || s === 'superseded';
    case 'cancelled':
    case 'rejected':
      return s === 'cancelled' || s === 'rejected';
    case 'archived':
      return s === 'archived';
    default:
      return s === f;
  }
}
