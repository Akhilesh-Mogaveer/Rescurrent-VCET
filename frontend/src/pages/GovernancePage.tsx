import React, { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext';
import { apiRequest } from '../services/api';
import { RoleHeroBand } from '../components/RoleHeroBand';
import { t } from '../utils/i18n';
import {
  InlineError,
  SkeletonBlock,
  SkeletonCard,
  SkeletonTable,
  useDelayedLoading,
  useLoadTimeout,
} from '../components/Skeleton';

const BADGE_STYLE: Record<string, string> = {
  'VERIFIED SOURCE FACT': 'bg-emerald-100 text-emerald-900 border-emerald-300',
  'MODEL ASSUMPTION': 'bg-amber-100 text-amber-900 border-amber-300',
  'SIMULATED RESULT': 'bg-blue-100 text-blue-900 border-blue-300',
  'FIELD OBSERVATION': 'bg-purple-100 text-purple-900 border-purple-300',
  'EXPERT REVIEWED': 'bg-teal-100 text-teal-900 border-teal-300',
};

export const GovernancePage: React.FC = () => {
  const { lang, pushToast } = useApp();
  const [gov, setGov] = useState<any>(null);
  const [selectedSetIdx, setSelectedSetIdx] = useState<number>(1);
  const [decision, setDecision] = useState<'approved' | 'changes_requested' | 'comment'>('approved');
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(true);
  const [timedOut, setTimedOut] = useState(false);

  const showSkeleton = useDelayedLoading(loading);
  useLoadTimeout(loading, () => setTimedOut(true), 20000);

  const loadGovernance = async () => {
    setLoading(true);
    setTimedOut(false);
    try {
      const res = await apiRequest('/governance/overview');
      setGov(res);
    } catch (err: any) {
      pushToast('Governance Load Error', err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadGovernance();
  }, []);

  const handleSubmitFeedback = async (e: React.FormEvent) => {
    e.preventDefault();
    const activeSet = gov?.parameter_sets?.[selectedSetIdx] || gov?.parameter_sets?.[0];
    if (!activeSet || !comment.trim()) return;
    try {
      await apiRequest('/governance/feedback', {
        method: 'POST',
        body: JSON.stringify({
          entity_type: 'twin_parameter_set',
          entity_id: String(activeSet.id),
          decision,
          comment,
        }),
      });
      setComment('');
      pushToast('Expert Review Recorded', `Recorded ${decision} on ${activeSet.version}`, 'success');
      await loadGovernance();
    } catch (err: any) {
      pushToast('Review Submission Failed', err.message, 'error');
    }
  };

  if (!gov) {
    if (timedOut || (!loading && !gov)) {
      return (
        <div className="p-6">
          <InlineError
            target="model governance records"
            message={timedOut ? 'Request timed out after 20s. Could not load governance center.' : undefined}
            onRetry={loadGovernance}
          />
        </div>
      );
    }

    if (loading || showSkeleton) {
      return (
        <div aria-busy="true" className="space-y-6">
          <div className="bg-white rounded-2xl border border-stone-200 p-6 space-y-3">
            <SkeletonBlock height={20} width={220} radius={999} />
            <SkeletonBlock height={28} width="45%" />
            <SkeletonBlock height={14} width="65%" />
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            <SkeletonCard height={160} />
            <SkeletonCard height={160} />
            <SkeletonCard height={160} />
          </div>
          <SkeletonTable rows={5} cols={5} />
        </div>
      );
    }
  }

  const paramSets: any[] = gov?.parameter_sets || [];
  const activeSet = paramSets[selectedSetIdx] || paramSets[0];
  const docs = gov?.parameter_docs || {};
  const wMeta = gov?.weather;

  return (
    <div className="space-y-6">
      <RoleHeroBand
        roleImage="/page_img/admin.png"
        roleLabel={t(lang, 'role_admin')}
        heroTitle={t(lang, 'dashboard_title_admin')}
        subtitle="Transparent scientific governance, assumptions, and provenance review."
        showCluster
      />

      {/* Epistemic Evidence Taxonomy */}
      <div className="bg-white rounded-2xl border border-stone-200 p-6 shadow-xs space-y-3">
        <h2 className="text-sm font-bold text-[#17211C] flex items-center gap-2">
          Evidence Labeling Taxonomy
        </h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3 text-xs">
          {(gov?.evidence_taxonomy || []).map((t: any) => (
            <div key={t.label} className="p-3.5 rounded-xl border border-stone-200 bg-stone-50">
              <span
                className={`inline-block text-[10px] font-mono font-bold px-2 py-0.5 rounded border ${
                  BADGE_STYLE[t.label] || 'bg-stone-100'
                }`}
              >
                {t.label}
              </span>
              <p className="text-stone-600 mt-2 leading-relaxed">{t.meaning}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Weather Source Metadata + Parameter Set Provenance */}
      <div className="grid lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 bg-white rounded-2xl border border-stone-200 p-6 shadow-xs space-y-4">
          <h2 className="text-sm font-bold text-[#17211C] flex items-center gap-2">
            Active Weather Scenario Provenance
          </h2>
          {wMeta && (
            <div className="space-y-2 text-xs bg-stone-50 p-4 rounded-xl border border-stone-200">
              <div className="flex items-center justify-between">
                <span className="font-bold">Scenario Set #{wMeta.id}</span>
                <span
                  className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded border ${
                    BADGE_STYLE[wMeta.evidence_label] || 'bg-amber-100'
                  }`}
                >
                  {wMeta.evidence_label}
                </span>
              </div>
              <div>
                <strong>Provider:</strong> {wMeta.provider}
              </div>
              <div>
                <strong>Weather Model:</strong> {wMeta.model} ({wMeta.source_type.toUpperCase()})
              </div>
              <div>
                <strong>Fetched Timestamp:</strong> {new Date(wMeta.fetched_at).toLocaleString()}
              </div>
              <div>
                <strong>Geographic Coverage:</strong> [{wMeta.request_location?.join(', ')}]
              </div>
              <div>
                <strong>Ensemble Member Count:</strong> {wMeta.member_count} members × {wMeta.hours}h
              </div>
              <div>
                <strong>Synthetic Flag:</strong> {wMeta.is_synthetic ? 'YES (Demo/Replay)' : 'NO (Live)'}
              </div>
            </div>
          )}

          {/* Expert Feedback Form */}
          <form onSubmit={handleSubmitFeedback} className="pt-3 border-t border-stone-200 space-y-3 text-xs">
            <h3 className="font-bold text-[#17211C] flex items-center gap-1.5">
              Record Agricultural Expert Review / Sign-Off
            </h3>
            <div className="grid grid-cols-2 gap-2">
              <select
                value={selectedSetIdx}
                onChange={(e) => setSelectedSetIdx(Number(e.target.value))}
                className="px-2.5 py-2 rounded-lg border border-stone-300 bg-white"
              >
                {paramSets.map((ps, idx) => (
                  <option key={ps.id} value={idx}>
                    {ps.version} ({ps.sensitivity})
                  </option>
                ))}
              </select>
              <select
                value={decision}
                onChange={(e) => setDecision(e.target.value as any)}
                className="px-2.5 py-2 rounded-lg border border-stone-300 bg-white"
              >
                <option value="approved">EXPERT APPROVED</option>
                <option value="changes_requested">CHANGES REQUESTED</option>
                <option value="comment">REVIEW COMMENT</option>
              </select>
            </div>
            <textarea
              rows={2}
              required
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Enter agronomy / plant pathology review note on wetness or wash-off parameters..."
              className="w-full px-3 py-2 rounded-lg border border-stone-300"
            />
            <button
              type="submit"
              className="w-full py-2 rounded-xl bg-[#0C1F17] text-white font-bold cursor-pointer"
            >
              Record Expert Governance Note
            </button>
          </form>
        </div>

        {/* Parameter Provenance Table */}
        <div className="lg:col-span-7 bg-white rounded-2xl border border-stone-200 p-6 shadow-xs space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-bold text-[#17211C] flex items-center gap-2">
                Twin Parameter Provenance ({activeSet?.version})
              </h2>
              <p className="text-xs text-stone-500">
                Reviewer: {activeSet?.reviewer || 'Unassigned'} · Status:{' '}
                <strong>{activeSet?.validation_status}</strong>
              </p>
            </div>
            <div className="flex gap-1.5">
              {paramSets.map((ps, idx) => (
                <button
                  key={ps.id}
                  onClick={() => setSelectedSetIdx(idx)}
                  className={`px-3 py-1 rounded-lg text-xs font-bold uppercase cursor-pointer ${
                    selectedSetIdx === idx
                      ? 'bg-[#0C1F17] text-white'
                      : 'bg-stone-100 text-stone-700'
                  }`}
                >
                  {ps.sensitivity}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto max-h-[380px]">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-stone-200 text-stone-500 uppercase text-[10px]">
                  <th className="py-2 pr-3">Parameter</th>
                  <th className="py-2 pr-3">Value</th>
                  <th className="py-2 pr-3">Unit</th>
                  <th className="py-2 pr-3">Evidence Label</th>
                  <th className="py-2">Physical Meaning & Assumption</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {Object.entries(activeSet?.params || {}).map(([k, val]: [string, any]) => {
                  const doc = docs[k] || {};
                  return (
                    <tr key={k} className="hover:bg-stone-50">
                      <td className="py-2 pr-3 font-mono font-bold text-[#17211C]">{k}</td>
                      <td className="py-2 pr-3 font-mono font-semibold text-emerald-900">
                        {typeof val === 'number' ? val.toFixed(3) : String(val)}
                      </td>
                      <td className="py-2 pr-3 font-mono text-stone-500">{doc.unit || '-'}</td>
                      <td className="py-2 pr-3">
                        <span
                          className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded border ${BADGE_STYLE['MODEL ASSUMPTION']}`}
                        >
                          MODEL ASSUMPTION
                        </span>
                      </td>
                      <td className="py-2 text-stone-600">{doc.meaning}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Simulation Run History & Solver Run History */}
      <div className="grid lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-2xl border border-stone-200 p-6 shadow-xs">
          <h2 className="text-sm font-bold text-[#17211C] flex items-center gap-2 mb-3">
            Simulation Run History ({gov?.simulation_runs?.length || 0})
          </h2>
          <div className="space-y-2 max-h-60 overflow-y-auto text-xs">
            {(gov?.simulation_runs || []).map((s: any) => (
              <div
                key={s.id}
                className="p-3 rounded-xl bg-stone-50 border border-stone-200 flex items-center justify-between"
              >
                <div>
                  <span className="font-bold">Simulation Run #{s.id}</span> · Model{' '}
                  <code>{s.model_version}</code>
                  <div className="text-[10px] font-mono text-stone-500">
                    Input SHA256: {s.input_hash.slice(0, 16)}... · Scenario Set #{s.scenario_set_id}
                  </div>
                </div>
                <span className="font-mono text-emerald-800 font-bold">{s.duration_ms} ms</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-stone-200 p-6 shadow-xs">
          <h2 className="text-sm font-bold text-[#17211C] flex items-center gap-2 mb-3">
            CP-SAT Solver & Validator Audit History ({gov?.solver_runs?.length || 0})
          </h2>
          <div className="space-y-2 max-h-60 overflow-y-auto text-xs">
            {(gov?.solver_runs || []).map((sr: any) => (
              <div
                key={sr.plan_id}
                className="p-3 rounded-xl bg-stone-50 border border-stone-200 flex items-center justify-between"
              >
                <div>
                  <span className="font-bold">
                    Plan #{sr.plan_id} (v{sr.version})
                  </span>{' '}
                  — {sr.name}
                  <div className="text-[10px] font-mono text-stone-500">
                    Solver: {sr.solver?.status} · Obj: {sr.solver?.objective} · Time:{' '}
                    {sr.solver?.solve_time_s}s
                  </div>
                </div>
                <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-900 font-mono text-[10px] font-bold flex items-center gap-1"> Validated
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
