import React from 'react';
import { 
  CheckCircle2, 
  Clock, 
  ShieldCheck, 
  Award, 
  Layers, 
  ArrowRight, 
  Plus, 
  ClipboardCheck, 
  Ban, 
  RefreshCw,
  AlertCircle
} from 'lucide-react';
import { getWorkflowStageInfo, WorkflowStageInfo, PassBreakdownStats } from '../../utils/passStatus';
import { cn } from '../../lib/utils';

interface WorkflowStageStepperProps {
  currentStatus: string;
  className?: string;
  stats?: PassBreakdownStats;
  canChangeStage?: boolean;
  isSubmitting?: boolean;
  onChangeStage?: (targetStatus: string, description: string) => void;
  onOpenIssuePasses?: () => void;
  onMarkAllCollected?: () => void;
  onReject?: () => void;
  onReopen?: () => void;
}

export const WorkflowStageStepper: React.FC<WorkflowStageStepperProps> = ({ 
  currentStatus, 
  className, 
  stats,
  canChangeStage,
  isSubmitting,
  onChangeStage,
  onOpenIssuePasses,
  onMarkAllCollected,
  onReject,
  onReopen
}) => {
  const currentInfo: WorkflowStageInfo = getWorkflowStageInfo(currentStatus);
  const currentStageNum = currentInfo.stageNumber; // 1, 2, 3, 4, or 0 (terminal)

  const isTerminal = currentStageNum === 0;
  const isAllDone = Boolean(
    currentInfo.isAllCompleted || 
    (stats && (stats.total || (stats as any).totalCount || 0) > 0 && stats.allDone) || 
    ['collected', 'completed', 'active'].includes((currentStatus || '').toLowerCase())
  );

  const stages = [
    {
      stageNum: 1,
      title: 'Stage 1',
      name: 'Under Review',
      description: 'Review & Verification',
      nextStatus: 'processing',
      nextLabel: 'Change to Stage 2 (Under Processing) →',
      icon: Clock,
    },
    {
      stageNum: 2,
      title: 'Stage 2',
      name: 'Under Processing',
      description: 'Approval & Document Verification',
      nextStatus: 'accepted',
      nextLabel: 'Change to Stage 3 (Accepted) →',
      icon: Layers,
    },
    {
      stageNum: 3,
      title: 'Stage 3',
      name: 'Accepted for Processing',
      description: 'Ready for Pass Issuance & Encoding',
      nextStatus: 'issued',
      nextLabel: 'Issue Passes (Stage 4) →',
      icon: ShieldCheck,
    },
    {
      stageNum: 4,
      title: 'Stage 4',
      name: 'Pass Issuance & Collection',
      description: isAllDone ? 'Passes Handed Over & Active' : 'Issuance, Handover & Counter Collection',
      nextStatus: 'collected',
      nextLabel: 'Mark All Collected ✓',
      icon: Award,
    },
  ];

  const currentStageObj = stages.find(s => s.stageNum === currentStageNum);

  return (
    <div className={cn("bg-white rounded-xl border border-slate-200/90 shadow-2xs overflow-hidden", className)}>
      {/* 1. Slim Connected Linear Pipeline View */}
      <div className="px-4 py-3 bg-slate-50/70 border-b border-slate-200/80">
        <div className="flex items-center justify-between gap-3 mb-2.5">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-2 h-2 rounded-full bg-[#800020] shrink-0" />
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-600 truncate">
              Workflow Stages
            </span>
          </div>
          <span className={cn(
            "px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase border shadow-2xs whitespace-nowrap",
            isAllDone ? "bg-emerald-600 text-white border-emerald-700" : currentInfo.badgeColor
          )}>
            {isAllDone ? "✓ All 4 Stages Completed" : isTerminal ? `Stopped: ${currentStatus}` : `Active: Stage ${currentStageNum} - ${currentInfo.stepName}`}
          </span>
        </div>

        {/* Linear Stepper Bar */}
        <div className="grid grid-cols-4 gap-2 relative">
          {stages.map((st) => {
            const isCompleted = !isTerminal && (isAllDone || currentStageNum > st.stageNum);
            const isCurrent = !isTerminal && !isAllDone && currentStageNum === st.stageNum;
            const isUpcoming = !isTerminal && !isAllDone && currentStageNum < st.stageNum;

            return (
              <div 
                key={st.stageNum}
                className={cn(
                  "relative flex items-center gap-2 p-2 rounded-lg border transition-all select-none",
                  isCompleted && "bg-emerald-50/80 border-emerald-200 text-emerald-900",
                  isCurrent && "bg-white border-[#800020] text-[#800020] shadow-2xs ring-1 ring-[#800020]/20 font-bold",
                  isUpcoming && "bg-white/60 border-slate-200 text-slate-400 opacity-75",
                  isTerminal && "bg-slate-100 border-slate-200 text-slate-400"
                )}
              >
                <div className={cn(
                  "w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-extrabold shrink-0 border",
                  isCompleted && "bg-emerald-600 text-white border-emerald-600",
                  isCurrent && "bg-[#800020] text-white border-[#800020]",
                  isUpcoming && "bg-slate-100 text-slate-500 border-slate-300",
                  isTerminal && "bg-slate-200 text-slate-600 border-slate-300"
                )}>
                  {isCompleted ? <CheckCircle2 className="w-3.5 h-3.5" /> : st.stageNum}
                </div>
                <div className="min-w-0 flex-1">
                  <p className={cn(
                    "text-[11px] truncate leading-tight",
                    isCurrent ? "font-extrabold text-[#800020]" : isCompleted ? "font-bold text-emerald-900" : "font-medium text-slate-500"
                  )}>
                    {st.name}
                  </p>
                  <p className="text-[9px] font-semibold opacity-70 truncate leading-none mt-0.5">
                    {isCompleted ? 'Completed' : isCurrent ? 'Active Now' : `Stage ${st.stageNum}`}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 2. Focused Current Stage Details & Next Step Action Row */}
      <div className="p-4 bg-white flex flex-col md:flex-row md:items-center justify-between gap-4">
        {/* Current Stage Context */}
        <div className="min-w-0 flex-1">
          {isAllDone ? (
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-xl bg-emerald-100 border border-emerald-300 flex items-center justify-center text-emerald-700 shrink-0">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h4 className="text-xs font-extrabold text-emerald-900 leading-tight">
                  All 4 Stages Completed & Handed Over
                </h4>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Application review, verification, pass encoding, and counter handover are fully finalized.
                </p>
              </div>
            </div>
          ) : isTerminal ? (
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-xl bg-rose-100 border border-rose-300 flex items-center justify-center text-rose-700 shrink-0">
                <Ban className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h4 className="text-xs font-extrabold text-rose-900 leading-tight">
                  Application {currentStatus.toUpperCase()} (Workflow Stopped)
                </h4>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  This application is currently {currentStatus}. You can re-open it to restart Stage 1 (Under Review).
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-xl bg-[#800020]/10 border border-[#800020]/20 flex items-center justify-center text-[#800020] shrink-0">
                {currentStageObj?.icon ? React.createElement(currentStageObj.icon, { className: "w-4 h-4" }) : <Clock className="w-4 h-4" />}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold text-[#800020] uppercase tracking-wide">
                    Stage {currentStageNum} of 4
                  </span>
                  <span className="text-slate-300">•</span>
                  <h4 className="text-xs font-extrabold text-slate-900 truncate">
                    {currentStageObj?.name || currentInfo.stepName}
                  </h4>
                </div>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  {currentStageObj?.description || "Processing active envelope application."}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Action Controls for Current Stage / Next Step */}
        {canChangeStage && (
          <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
            {/* Stage 1: Next Step -> Stage 2 */}
            {currentStageNum === 1 && !isTerminal && (
              <>
                {onReject && (
                  <button
                    type="button"
                    onClick={onReject}
                    disabled={isSubmitting}
                    className="h-8 px-3 rounded-lg border border-rose-200 text-rose-700 hover:bg-rose-50 text-[11px] font-bold transition-all cursor-pointer flex items-center gap-1.5"
                    title="Reject Application"
                  >
                    <Ban size={12} />
                    <span>Reject</span>
                  </button>
                )}
                {onChangeStage && (
                  <button
                    type="button"
                    onClick={() => onChangeStage('processing', 'Change from Stage 1 (Under Review) to Stage 2 (Under Processing)')}
                    disabled={isSubmitting}
                    className="h-8 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-[11px] font-bold flex items-center gap-1.5 transition-all shadow-xs cursor-pointer"
                  >
                    <span>Next: Move to Stage 2 (Under Processing)</span>
                    <ArrowRight size={13} />
                  </button>
                )}
              </>
            )}

            {/* Stage 2: Next Step -> Stage 3 or Issue Passes */}
            {currentStageNum === 2 && !isTerminal && (
              <>
                {onReject && (
                  <button
                    type="button"
                    onClick={onReject}
                    disabled={isSubmitting}
                    className="h-8 px-3 rounded-lg border border-rose-200 text-rose-700 hover:bg-rose-50 text-[11px] font-bold transition-all cursor-pointer flex items-center gap-1.5"
                    title="Reject Application"
                  >
                    <Ban size={12} />
                    <span>Reject</span>
                  </button>
                )}
                {onChangeStage && (
                  <button
                    type="button"
                    onClick={() => onChangeStage('accepted', 'Change from Stage 2 (Under Processing) to Stage 3 (Accepted for Processing)')}
                    disabled={isSubmitting}
                    className="h-8 px-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-[11px] font-bold flex items-center gap-1.5 transition-all shadow-xs cursor-pointer"
                  >
                    <span>Move to Stage 3 (Accepted)</span>
                    <ArrowRight size={13} />
                  </button>
                )}
                {onOpenIssuePasses && (
                  <button
                    type="button"
                    onClick={onOpenIssuePasses}
                    disabled={isSubmitting}
                    className="h-8 px-3 bg-[#800020] hover:bg-[#600018] text-white rounded-lg text-[11px] font-bold flex items-center gap-1.5 transition-all shadow-xs cursor-pointer"
                    title="Proceed directly to Pass Issuance (Next Process) in one click"
                  >
                    <Plus size={13} />
                    <span>Issue Passes (Next Process)</span>
                  </button>
                )}
              </>
            )}

            {/* Stage 3: Next Step -> Issue Passes */}
            {currentStageNum === 3 && !isTerminal && (
              <>
                {onReject && (
                  <button
                    type="button"
                    onClick={onReject}
                    disabled={isSubmitting}
                    className="h-8 px-3 rounded-lg border border-rose-200 text-rose-700 hover:bg-rose-50 text-[11px] font-bold transition-all cursor-pointer flex items-center gap-1.5"
                    title="Reject Application"
                  >
                    <Ban size={12} />
                    <span>Reject</span>
                  </button>
                )}
                {onOpenIssuePasses && (
                  <button
                    type="button"
                    onClick={onOpenIssuePasses}
                    disabled={isSubmitting}
                    className="h-8 px-4 bg-[#800020] hover:bg-[#600018] text-white rounded-lg text-[11px] font-bold flex items-center gap-1.5 transition-all shadow-xs cursor-pointer"
                  >
                    <Plus size={13} />
                    <span>Next: Issue All Passes (Stage 4)</span>
                    <ArrowRight size={13} />
                  </button>
                )}
              </>
            )}

            {/* Stage 4: Next Step -> Mark All Collected */}
            {currentStageNum === 4 && !isAllDone && !isTerminal && (
              <>
                {onMarkAllCollected && (
                  <button
                    type="button"
                    onClick={onMarkAllCollected}
                    disabled={isSubmitting}
                    className="h-8 px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[11px] font-bold flex items-center gap-1.5 transition-all shadow-xs cursor-pointer"
                  >
                    <ClipboardCheck size={13} />
                    <span>Next: Mark All Collected ✓</span>
                  </button>
                )}
              </>
            )}

            {/* Terminal Re-open */}
            {isTerminal && onReopen && (
              <button
                type="button"
                onClick={onReopen}
                disabled={isSubmitting}
                className="h-8 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-[11px] font-bold flex items-center gap-1.5 transition-all shadow-xs cursor-pointer"
              >
                <RefreshCw size={12} />
                <span>Re-open Application to Stage 1</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
