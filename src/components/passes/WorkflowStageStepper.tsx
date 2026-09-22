import React from 'react';
import { CheckCircle2, Clock, ShieldCheck, Award, Layers, ArrowRight, Plus, ClipboardCheck } from 'lucide-react';
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
}

export const WorkflowStageStepper: React.FC<WorkflowStageStepperProps> = ({ 
  currentStatus, 
  className, 
  stats,
  canChangeStage,
  isSubmitting,
  onChangeStage,
  onOpenIssuePasses,
  onMarkAllCollected
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
      title: 'Stage 1: Under Review',
      subtitle: 'Verification & Review',
      targetStatus: 'processing',
      statuses: ['pending', 'under_review', 'review'],
      icon: Clock,
    },
    {
      stageNum: 2,
      title: 'Stage 2: Under Processing',
      subtitle: 'Processing in Progress',
      targetStatus: 'accepted',
      statuses: ['processing', 'under_processing', 'forwarded', 'clarification'],
      icon: Layers,
    },
    {
      stageNum: 3,
      title: 'Stage 3: Accepted for Processing',
      subtitle: 'Pass Issuance & Encoding',
      targetStatus: 'issued',
      statuses: ['approved', 'accepted'],
      icon: ShieldCheck,
    },
    {
      stageNum: 4,
      title: 'Stage 4: Pass Issuance & Collection',
      subtitle: isAllDone ? 'Passes Handed Over & Active' : 'Pass Issuance & Collection',
      targetStatus: 'collected',
      statuses: ['issued', 'ready_for_collection', 'partially_issued', 'collected', 'completed', 'active'],
      icon: Award,
    },
  ];

  return (
    <div className={cn("bg-white rounded-2xl border border-gray-200/80 p-5 shadow-2xs space-y-3", className)}>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <h3 className="text-xs font-extrabold uppercase tracking-wider text-gray-500 flex items-center gap-1.5">
          <ShieldCheck className="w-4 h-4 text-[#800020]" />
          Workflow Stages & Progress {isAllDone ? '(All 4 Stages Completed)' : '(Sequential 1 → 2 → 3 → 4)'}
        </h3>
        <span className={cn("px-2.5 py-1 rounded-full text-[11px] font-extrabold uppercase border shadow-2xs whitespace-nowrap self-start sm:self-auto", isAllDone ? 'bg-emerald-600 text-white border-emerald-700' : currentInfo.badgeColor)}>
          {isAllDone ? '✓ All 4 Stages Completed (Collected)' : `Current: ${currentInfo.stepName}`}
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 relative pt-1">
        {stages.map((st) => {
          const isCompleted = !isTerminal && (isAllDone || currentStageNum > st.stageNum);
          const isCurrent = !isTerminal && !isAllDone && currentStageNum === st.stageNum;
          const isPending = !isTerminal && !isAllDone && currentStageNum < st.stageNum;

          const IconComponent = st.icon;

          return (
            <div
              key={st.stageNum}
              className={cn(
                "p-3.5 rounded-xl border transition-all relative flex flex-col justify-between",
                isCompleted && "bg-emerald-50/70 border-emerald-200 text-emerald-950",
                isCurrent && "bg-[#800020]/5 border-[#800020] text-[#800020] ring-2 ring-[#800020]/15 shadow-2xs",
                isPending && "bg-gray-50/70 border-gray-200/80 text-gray-400 opacity-80",
                isTerminal && "bg-rose-50/50 border-rose-200 text-rose-800"
              )}
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <div
                      className={cn(
                        "w-8 h-8 rounded-xl font-black text-xs flex items-center justify-center shrink-0 border shadow-2xs",
                        isCompleted && "bg-emerald-600 text-white border-emerald-600",
                        isCurrent && "bg-[#800020] text-white border-[#800020]",
                        isPending && "bg-white text-gray-400 border-gray-200",
                        isTerminal && "bg-rose-100 text-rose-700 border-rose-200"
                      )}
                    >
                      {isCompleted ? <CheckCircle2 className="w-4 h-4" /> : st.stageNum}
                    </div>
                    <div>
                      <h4 className="text-xs font-bold tracking-tight">{st.title}</h4>
                      <p className="text-[10px] font-medium opacity-80">{st.subtitle}</p>
                    </div>
                  </div>

                  <IconComponent
                    className={cn(
                      "w-4 h-4 shrink-0 mt-1",
                      isCompleted && "text-emerald-600",
                      isCurrent && "text-[#800020]",
                      isPending && "text-gray-300"
                    )}
                  />
                </div>

                {/* Direct Action Buttons for the Active Stage */}
                {canChangeStage && isCurrent && (
                  <div className="mt-3 pt-2.5 border-t border-current/15 space-y-1.5">
                    {st.stageNum === 1 && onChangeStage && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onChangeStage('processing', 'Change from Stage 1 (Under Review) to Stage 2 (Under Processing)');
                        }}
                        disabled={isSubmitting}
                        className="w-full py-1.5 px-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-[11px] font-bold flex items-center justify-center gap-1.5 transition-all shadow-xs cursor-pointer"
                        title="Change stage to Stage 2: Under Processing"
                      >
                        <ArrowRight size={13} />
                        <span>Change to Stage 2 →</span>
                      </button>
                    )}

                    {st.stageNum === 2 && (
                      <div className="space-y-1.5">
                        {onChangeStage && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onChangeStage('accepted', 'Change from Stage 2 (Under Processing) to Stage 3 (Accepted for Processing)');
                            }}
                            disabled={isSubmitting}
                            className="w-full py-1.5 px-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-[11px] font-bold flex items-center justify-center gap-1.5 transition-all shadow-xs cursor-pointer"
                            title="Change stage to Stage 3: Accepted for Processing"
                          >
                            <ArrowRight size={13} />
                            <span>Change to Stage 3 →</span>
                          </button>
                        )}
                        {onOpenIssuePasses && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onOpenIssuePasses();
                            }}
                            disabled={isSubmitting}
                            className="w-full py-1.5 px-2.5 bg-[#800020] hover:bg-[#600018] text-white rounded-lg text-[11px] font-bold flex items-center justify-center gap-1.5 transition-all shadow-xs cursor-pointer"
                            title="Proceed directly to Pass Issuance (Next Process) in one click"
                          >
                            <Plus size={13} />
                            <span>Issue Passes (Next Process) →</span>
                          </button>
                        )}
                      </div>
                    )}

                    {st.stageNum === 3 && onOpenIssuePasses && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenIssuePasses();
                        }}
                        disabled={isSubmitting}
                        className="w-full py-1.5 px-2.5 bg-[#800020] hover:bg-[#600018] text-white rounded-lg text-[11px] font-bold flex items-center justify-center gap-1.5 transition-all shadow-xs cursor-pointer"
                        title="Open pass issuance form for applicants (Stage 4)"
                      >
                        <Plus size={13} />
                        <span>Issue All Passes (Stage 4) →</span>
                      </button>
                    )}

                    {st.stageNum === 4 && !isAllDone && onMarkAllCollected && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onMarkAllCollected();
                        }}
                        disabled={isSubmitting}
                        className="w-full py-1.5 px-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[11px] font-bold flex items-center justify-center gap-1.5 transition-all shadow-xs cursor-pointer"
                        title="Mark all issued passes collected at counter"
                      >
                        <ClipboardCheck size={13} />
                        <span>Mark All Collected ✓</span>
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Status Indicator */}
              <div className="mt-3 pt-2 border-t border-current/10 flex items-center justify-between text-[10px] font-bold">
                <span>
                  {isCompleted ? '✓ Completed' : isCurrent ? '● Active Stage' : 'Pending Stage'}
                </span>
                <span className="opacity-75 font-mono">
                  {isCompleted ? 'Stage Complete' : `Stage ${st.stageNum} of 4`}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
