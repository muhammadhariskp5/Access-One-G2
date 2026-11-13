import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Lock, RefreshCw, ShieldCheck, Unlock, Wrench } from 'lucide-react';
import { apiFetch, cn } from '../../lib/utils';

interface RelationReport {
  name: string;
  group: string;
  label: string;
  child: string;
  column: string;
  parent: string;
  rows: number;
  orphans: number;
  caseOnlyMismatches: number;
  samples: { id: string; ref: string }[];
  constraint: 'enforced' | 'missing' | 'not-supported';
  error?: string;
}

interface IntegrityReport {
  engine: string;
  generatedAt: string;
  clean: boolean;
  orphans: number;
  repairable: number;
  enforced: number;
  total: number;
  relations: RelationReport[];
}

interface Props {
  showToast: (message: string, type?: 'success' | 'error') => void;
  showConfirm: (title: string, message: string, onConfirm: () => void) => void;
}

const GROUP_ORDER = ['Applications & passes', 'People', 'Access codes', 'Organizations'];

export function DataIntegrityPanel({ showToast, showConfirm }: Props) {
  const [report, setReport] = useState<IntegrityReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<'repair' | 'enforce' | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const load = async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/platform/integrity');
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to load report');
      setReport(await res.json());
    } catch (e: any) {
      showToast(e.message || 'Failed to load the integrity report', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const runAction = async (kind: 'repair' | 'enforce') => {
    setBusy(kind);
    try {
      const res = await apiFetch(kind === 'repair' ? '/api/platform/integrity/repair' : '/api/platform/integrity/enforce', { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Action failed');
      if (kind === 'repair') {
        showToast(`Re-pointed ${body.total || 0} reference(s) to their records`, 'success');
      } else {
        const added = (body.added || []).length;
        const skipped = (body.skipped || []).length;
        showToast(`${added} protection(s) added${skipped ? `, ${skipped} still waiting on dangling rows` : ''}`, 'success');
      }
      await load();
    } catch (e: any) {
      showToast(e.message || 'Action failed', 'error');
    } finally {
      setBusy(null);
    }
  };

  const toggle = (name: string) => setExpanded(prev => {
    const next = new Set(prev);
    next.has(name) ? next.delete(name) : next.add(name);
    return next;
  });

  const supported = report?.engine === 'oracle';
  const canEnforce = supported && !!report?.relations.some(r => r.constraint === 'missing' && r.orphans === 0 && !r.error);
  const unrepairable = report ? report.orphans - report.repairable : 0;

  return (
    <div className="space-y-5 max-w-6xl">
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-2xs space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-black text-slate-900">Data Integrity</h2>
            <p className="text-xs text-slate-500 mt-0.5 max-w-2xl">
              Every link between records, checked against the database. A dangling reference points at a record that
              doesn't exist. Protected links are enforced by the database itself, so new dangling references can't be saved.
              Nothing here deletes data.
            </p>
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-200 text-slate-700 hover:bg-slate-50 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            <RefreshCw size={13} className={cn(loading && 'animate-spin')} />
            <span>Re-check</span>
          </button>
        </div>

        {report && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div className={cn('p-3 rounded-lg border space-y-1', report.clean ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200')}>
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Status</span>
              <p className={cn('font-bold flex items-center gap-1.5', report.clean ? 'text-emerald-700' : 'text-amber-700')}>
                {report.clean ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
                <span>{report.clean ? 'All links resolve' : `${report.orphans} dangling reference(s)`}</span>
              </p>
              <p className="text-slate-500 text-[11px]">Checked {new Date(report.generatedAt).toLocaleString()}</p>
            </div>
            <div className="p-3 rounded-lg border border-slate-200 bg-slate-50 space-y-1">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Protected by the database</span>
              <p className="font-bold text-slate-800 flex items-center gap-1.5">
                <ShieldCheck size={14} className="text-[#800020]" />
                <span>{supported ? `${report.enforced} of ${report.total} links` : 'Not available'}</span>
              </p>
              <p className="text-slate-500 text-[11px]">{supported ? 'Oracle foreign keys' : `The ${report.engine} development database can't add constraints`}</p>
            </div>
            <div className="p-3 rounded-lg border border-slate-200 bg-slate-50 space-y-1">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Needs attention</span>
              <p className="font-bold text-slate-800">
                {report.repairable} repairable · {unrepairable} to review
              </p>
              <p className="text-slate-500 text-[11px]">Repairable: ID matches a record except for upper/lower case</p>
            </div>
          </div>
        )}

        {report && (report.repairable > 0 || canEnforce) && (
          <div className="flex flex-wrap gap-2 pt-1">
            {report.repairable > 0 && (
              <button
                disabled={!!busy}
                onClick={() => showConfirm(
                  'Repair letter-case mismatches',
                  `${report.repairable} reference(s) match an existing record when upper/lower case is ignored. Each will be re-pointed to that record's exact ID. No rows are deleted.`,
                  () => runAction('repair')
                )}
                className="px-3 py-1.5 bg-[#800020] hover:bg-[#600018] text-white rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <Wrench size={13} />
                <span>{busy === 'repair' ? 'Repairing…' : `Repair ${report.repairable} case mismatch(es)`}</span>
              </button>
            )}
            {canEnforce && (
              <button
                disabled={!!busy}
                onClick={() => showConfirm(
                  'Add database protections',
                  'Adds a foreign key to every link that currently has no dangling references. Links that still have dangling references are skipped.',
                  () => runAction('enforce')
                )}
                className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <Lock size={13} />
                <span>{busy === 'enforce' ? 'Adding…' : 'Protect clean links'}</span>
              </button>
            )}
          </div>
        )}
      </div>

      {report && GROUP_ORDER.map(group => {
        const rows = report.relations.filter(r => r.group === group);
        if (rows.length === 0) return null;
        return (
          <div key={group} className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
            <div className="px-4 py-2.5 border-b border-slate-100 bg-slate-50/70">
              <h3 className="text-xs font-black text-slate-800">{group}</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-slate-400 text-left">
                    <th className="px-4 py-2 font-bold">Link</th>
                    <th className="px-4 py-2 font-bold text-right">References</th>
                    <th className="px-4 py-2 font-bold text-right">Dangling</th>
                    <th className="px-4 py-2 font-bold text-right">Repairable</th>
                    <th className="px-4 py-2 font-bold">Protection</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => {
                    const open = expanded.has(r.name);
                    const hasDetail = r.orphans > 0 || !!r.error;
                    return (
                      <React.Fragment key={r.name}>
                        <tr
                          className={cn('border-t border-slate-100', hasDetail && 'cursor-pointer hover:bg-slate-50')}
                          onClick={() => hasDetail && toggle(r.name)}
                        >
                          <td className="px-4 py-2">
                            <div className="flex items-center gap-1.5">
                              {hasDetail ? (open ? <ChevronDown size={12} className="text-slate-400" /> : <ChevronRight size={12} className="text-slate-400" />) : <span className="w-3" />}
                              <div>
                                <div className="font-bold text-slate-800">{r.label}</div>
                                <div className="font-mono text-[10px] text-slate-400">{r.child}.{r.column} → {r.parent}.id</div>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-2 text-right font-mono text-slate-600">{r.error ? '—' : r.rows}</td>
                          <td className={cn('px-4 py-2 text-right font-mono font-bold', r.orphans > 0 ? 'text-amber-700' : 'text-slate-400')}>{r.error ? '—' : r.orphans}</td>
                          <td className={cn('px-4 py-2 text-right font-mono', r.caseOnlyMismatches > 0 ? 'text-[#800020] font-bold' : 'text-slate-400')}>{r.error ? '—' : r.caseOnlyMismatches}</td>
                          <td className="px-4 py-2">
                            {r.error ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200 text-[10px] font-bold">Check failed</span>
                            ) : r.constraint === 'enforced' ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-bold"><Lock size={10} />Protected</span>
                            ) : r.constraint === 'missing' ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 text-[10px] font-bold"><Unlock size={10} />{r.orphans > 0 ? 'Blocked by dangling rows' : 'Not yet protected'}</span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200 text-[10px] font-bold">Dev database</span>
                            )}
                          </td>
                        </tr>
                        {open && hasDetail && (
                          <tr className="bg-slate-50/60">
                            <td colSpan={5} className="px-4 pb-3 pt-1">
                              {r.error ? (
                                <p className="text-[11px] text-rose-700 font-mono">{r.error}</p>
                              ) : (
                                <div className="space-y-1.5">
                                  <p className="text-[11px] text-slate-500">
                                    Examples (first {r.samples.length} of {r.orphans}). The row in <span className="font-mono">{r.child}</span> points at
                                    a <span className="font-mono">{r.parent}</span> ID that doesn't exist.
                                    {r.caseOnlyMismatches > 0 && ` ${r.caseOnlyMismatches} of them differ only in letter case and can be repaired above.`}
                                  </p>
                                  <table className="text-[11px] font-mono">
                                    <thead>
                                      <tr className="text-slate-400 text-left">
                                        <th className="pr-6 font-semibold">{r.child}.id</th>
                                        <th className="font-semibold">{r.column}</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {r.samples.map(s => (
                                        <tr key={s.id} className="text-slate-700">
                                          <td className="pr-6 py-0.5">{s.id}</td>
                                          <td className="py-0.5">{s.ref}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      {report && (
        <p className="text-[11px] text-slate-500 max-w-3xl">
          Audit logs are intentionally not linked: they are an append-only record kept on their own retention schedule and
          already store each actor's name and email. Deleted users, access codes and organizations are kept as deleted records,
          so history continues to show who and what it refers to.
        </p>
      )}
    </div>
  );
}
