import React, { useEffect, useState } from 'react';
import { Bot, CheckCircle2, Send, ShieldCheck, Sparkles } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { apiRequest } from '../services/api';
import type { PlanItem } from '../types';

const SUGGESTED_QUESTIONS = [
  'Why is Plot 014 prioritized?',
  'Why was Crew 02 assigned?',
  'Why was a particular rainfall window selected?',
  'What changed after early rainfall?',
  'Which plots remain unscheduled and why?',
  'Crew 02 is unavailable tomorrow — propose constraint',
];

export const AssistantPage: React.FC = () => {
  const { pushToast, refreshNotifications } = useApp();
  const [plans, setPlans] = useState<PlanItem[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<number | null>(null);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<
    {
      role: 'user' | 'assistant';
      text?: string;
      response?: any;
    }[]
  >([]);
  const [loading, setLoading] = useState(false);
  const [executingProposal, setExecutingProposal] = useState(false);

  useEffect(() => {
    apiRequest<PlanItem[]>('/plans')
      .then((list) => {
        setPlans(list);
        if (list[0]) setSelectedPlanId(list[0].id);
      })
      .catch(() => {});
    // Initial welcome query
    sendQuery('Why is Plot 014 prioritized?');
  }, []);

  const sendQuery = async (qText: string) => {
    if (!qText.trim()) return;
    setMessages((prev) => [...prev, { role: 'user', text: qText }]);
    setInput('');
    setLoading(true);
    try {
      const res = await apiRequest('/assistant/chat', {
        method: 'POST',
        body: JSON.stringify({
          message: qText,
          plan_id: selectedPlanId || undefined,
        }),
      });
      setMessages((prev) => [...prev, { role: 'assistant', response: res }]);
    } catch (err: any) {
      pushToast('Assistant Error', err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmProposal = async (proposal: any) => {
    if (!selectedPlanId) return;
    setExecutingProposal(true);
    try {
      const res = await apiRequest(`/plans/${selectedPlanId}/replan`, {
        method: 'POST',
        body: JSON.stringify({
          disruption_type: proposal.constraint_type,
          occurs_at_slot: 8,
          payload: proposal.payload,
          description: proposal.summary,
          time_limit_s: 6.0,
        }),
      });
      setSelectedPlanId(res.new_plan.id);
      await refreshNotifications();
      pushToast(
        'Validated Constraint Executed',
        `Created Plan #${res.new_plan.id} (v${res.new_plan.version}) via CP-SAT & independent validator.`,
        'success',
      );
      await sendQuery(`What changed in Plan #${res.new_plan.id} after replanning?`);
    } catch (err: any) {
      pushToast('Execution Failed', err.message, 'error');
    } finally {
      setExecutingProposal(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Safe Architecture Flow */}
      <div className="bg-white rounded-2xl border border-stone-200 p-6 shadow-xs space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <span className="text-xs font-mono uppercase px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-900 border border-emerald-200">
              Safe Validated AI Pipeline · Deterministic Template Fallback
            </span>
            <h1 className="text-2xl font-bold text-[#17211C] mt-2 flex items-center gap-2">
              <Bot className="w-6 h-6 text-emerald-700" />
              MahaliShield Intelligence Assistant
            </h1>
            <p className="text-xs text-stone-600 mt-1">
              Explains actual computed simulation and CP-SAT optimization results. The assistant
              never invents schedules or prescribes pesticides.
            </p>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-stone-500 mb-1">
              Active Plan Context
            </label>
            <select
              value={selectedPlanId || ''}
              onChange={(e) => setSelectedPlanId(Number(e.target.value))}
              className="px-3 py-2 rounded-xl border border-stone-300 text-xs bg-white font-semibold"
            >
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  Plan #{p.id} (v{p.version}) — {p.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Suggested Question Chips */}
      <div className="flex flex-wrap gap-2">
        {SUGGESTED_QUESTIONS.map((q) => (
          <button
            key={q}
            onClick={() => sendQuery(q)}
            className="px-3.5 py-2 rounded-xl bg-white hover:bg-emerald-50 border border-stone-300 hover:border-emerald-500 text-xs font-semibold text-[#17211C] flex items-center gap-1.5 transition cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5 text-emerald-700" />
            {q}
          </button>
        ))}
      </div>

      {/* Conversation Feed */}
      <div className="bg-white rounded-2xl border border-stone-200 shadow-xs flex flex-col h-[540px]">
        <div className="flex-1 p-6 overflow-y-auto space-y-4">
          {messages.map((m, idx) => (
            <div
              key={idx}
              className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              {m.role === 'user' ? (
                <div className="max-w-xl px-4 py-3 rounded-2xl bg-[#0C1F17] text-white text-xs font-medium">
                  {m.text}
                </div>
              ) : (
                <div className="max-w-3xl w-full rounded-2xl border border-stone-200 bg-stone-50 p-5 space-y-3 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-200 pb-2">
                    <span className="font-bold text-sm text-[#17211C]">
                      {m.response?.headline}
                    </span>
                    <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-900 font-mono text-[10px]">
                      Mode: {m.response?.llm_mode} · Plan #{m.response?.plan_id}
                    </span>
                  </div>

                  {(m.response?.sections || []).map((sec: any, sIdx: number) => (
                    <div key={sIdx} className="space-y-1">
                      <div className="font-bold text-emerald-950">{sec.title}</div>
                      <div className="whitespace-pre-line text-stone-700 leading-relaxed">
                        {sec.body}
                      </div>
                    </div>
                  ))}

                  {/* Validated Constraint Proposal Card Requiring User Confirmation */}
                  {m.response?.proposal && (
                    <div className="p-4 rounded-xl bg-amber-50 border border-amber-300 space-y-2">
                      <div className="font-bold text-amber-950 flex items-center gap-1.5">
                        <ShieldCheck className="w-4 h-4 text-amber-700" />
                        Validated Constraint Proposal (Requires Confirmation Before CP-SAT Execution)
                      </div>
                      <div className="text-amber-900">{m.response.proposal.summary}</div>
                      <div className="text-[11px] font-mono text-stone-600">
                        Schema Valid: {String(m.response.proposal.validation.schema_valid)} ·
                        Business Rule Valid:{' '}
                        {String(m.response.proposal.validation.business_rule_valid)} (
                        {m.response.proposal.validation.notes})
                      </div>
                      <button
                        onClick={() => handleConfirmProposal(m.response.proposal)}
                        disabled={executingProposal}
                        className="px-4 py-2 rounded-lg bg-[#0C1F17] hover:bg-emerald-950 text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                        {executingProposal
                          ? 'Executing CP-SAT...'
                          : 'Confirm & Run CP-SAT Replanning'}
                      </button>
                    </div>
                  )}

                  {/* Provenance Citations */}
                  <div className="pt-2 border-t border-stone-200 flex flex-wrap items-center gap-2 text-[10px]">
                    {(m.response?.citations || []).map((c: any, cIdx: number) => (
                      <span
                        key={cIdx}
                        className="px-2 py-0.5 rounded bg-white border border-stone-200 font-mono text-stone-600"
                      >
                        <strong>{c.label}:</strong> {c.source}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div
                role="status"
                aria-label="Assistant is thinking"
                className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 flex items-center gap-2"
              >
                <span className="text-xs text-stone-600 font-medium">Assistant is thinking</span>
                <div className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-700 animate-bounce [animation-delay:0ms]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-700 animate-bounce [animation-delay:150ms]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-700 animate-bounce [animation-delay:300ms]" />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Input Form */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            sendQuery(input);
          }}
          className="p-4 border-t border-stone-200 flex items-center gap-2"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask why a plot was prioritized, why a crew or window was chosen, or propose a constraint..."
            className="flex-1 px-4 py-2.5 rounded-xl border border-stone-300 text-xs focus:outline-none focus:border-emerald-700"
          />
          <button
            type="submit"
            disabled={loading}
            className="px-5 py-2.5 rounded-xl bg-[#0C1F17] hover:bg-emerald-950 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
          >
            <Send className="w-3.5 h-3.5" /> Ask Assistant
          </button>
        </form>
      </div>
    </div>
  );
};
