import React from 'react';
import { Modal } from '../common/Modal';
import { ArrowRight, AlertTriangle, CheckCircle2, ShieldCheck, FastForward } from 'lucide-react';
import { getWorkflowStageInfo, getSkippedWorkflowStages } from '../../utils/passStatus';

interface StageSkipConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void> | void;
  currentStatus: string;
  targetStatus: string;
  entityName?: string;
  isSubmitting?: boolean;
}

export const StageSkipConfirmModal: React.FC<StageSkipConfirmModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  currentStatus,
  targetStatus,
  entityName = 'Pass Application',
  isSubmitting = false
}) => {
  if (!isOpen) return null;

  const currentInfo = getWorkflowStageInfo(currentStatus);
  const targetInfo = getWorkflowStageInfo(targetStatus);
  const skippedStages = getSkippedWorkflowStages(currentStatus, targetStatus);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Stage Progression Warning: Skipping Workflow Stages"
    >
      <div className="space-y-5 py-1">
        {/* Banner Alert */}
        <div className="p-4 bg-amber-50 rounded-2xl border border-amber-200/80 flex items-start gap-3">
          <div className="p-2 bg-amber-100 rounded-xl text-amber-800 shrink-0 mt-0.5">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div>
            <h4 className="text-xs font-bold text-amber-900 uppercase tracking-wider">
              Sequential Workflow Skip Detected
            </h4>
            <p className="text-xs text-amber-800 mt-1 leading-relaxed">
              You are advancing <strong>{entityName}</strong> across multiple stages. 
              The system requires confirmation before auto-completing skipped stages in order.
            </p>
          </div>
        </div>

        {/* Stage Jump Comparison */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-4 bg-gray-50/80 rounded-2xl border border-gray-200/70">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500 block mb-1">
              Current Stage
            </span>
            <div className="p-3 bg-white rounded-xl border border-gray-200 flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-gray-100 text-gray-700 text-xs font-black flex items-center justify-center shrink-0">
                {currentInfo.stageNumber || 1}
              </div>
              <div className="overflow-hidden">
                <p className="text-xs font-extrabold text-gray-900 truncate">{currentInfo.stageName}</p>
                <p className="text-[11px] font-medium text-gray-500 truncate">{currentInfo.stepName}</p>
              </div>
            </div>
          </div>

          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#800020] block mb-1">
              Target Stage
            </span>
            <div className="p-3 bg-white rounded-xl border border-[#800020]/20 flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-[#800020] text-white text-xs font-black flex items-center justify-center shrink-0">
                {targetInfo.stageNumber || 3}
              </div>
              <div className="overflow-hidden">
                <p className="text-xs font-extrabold text-[#800020] truncate">{targetInfo.stageName}</p>
                <p className="text-[11px] font-bold text-emerald-600 truncate">{targetInfo.stepName}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Skipped Stages List to be Auto-Completed */}
        {skippedStages.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-gray-700 flex items-center gap-1.5">
                <FastForward className="w-4 h-4 text-amber-600" />
                Skipped Stage(s) to be Auto-Completed:
              </span>
              <span className="text-[10px] font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
                {skippedStages.length} Step(s)
              </span>
            </div>

            <div className="space-y-1.5 bg-amber-50/40 p-3 rounded-2xl border border-amber-200/50">
              {skippedStages.map((st, idx) => (
                <div 
                  key={st.statusKey + idx} 
                  className="flex items-center justify-between p-2.5 bg-white rounded-xl border border-amber-200/60 shadow-2xs"
                >
                  <div className="flex items-center gap-2.5">
                    <span className="w-5 h-5 rounded-full bg-amber-50 text-amber-700 text-[10px] font-extrabold flex items-center justify-center border border-amber-200">
                      {st.stageNumber}
                    </span>
                    <div>
                      <p className="text-xs font-bold text-gray-800">{st.stageName}</p>
                      <p className="text-[10px] text-gray-500">{st.stepName}</p>
                    </div>
                  </div>
                  <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                    Auto-Finish
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <p className="text-xs text-gray-500 leading-relaxed italic">
          By clicking <strong>&quot;Confirm & Auto-Complete Skipped Stages&quot;</strong>, the system will systematically complete and record history entries for each skipped stage in proper order before applying <strong>{targetInfo.stepName}</strong>.
        </p>

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-2 pt-3 border-t border-gray-100">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="px-4 py-2.5 bg-gray-100 text-gray-700 rounded-xl text-xs font-bold hover:bg-gray-200 transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isSubmitting}
            className="px-5 py-2.5 bg-[#800020] text-white rounded-xl text-xs font-bold hover:bg-[#600018] transition-colors flex items-center gap-2 shadow-sm disabled:opacity-50 cursor-pointer"
          >
            {isSubmitting ? (
              <span>Auto-Completing Stages...</span>
            ) : (
              <>
                <ShieldCheck className="w-4 h-4" />
                Confirm & Auto-Complete Skipped Stages
              </>
            )}
          </button>
        </div>
      </div>
    </Modal>
  );
};
