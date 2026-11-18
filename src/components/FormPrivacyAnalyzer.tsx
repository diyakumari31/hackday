import { ArrowRight, CheckCircle2, FileSearch, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { FormFieldInput, FormPrivacyAnalysis, SensitiveCategory } from '../types.ts';

const SAMPLE_FIELDS: FormFieldInput[] = [
  { id: 'f1', label: 'Full Name', type: 'text', required: true },
  {
    id: 'f2',
    label: 'Email Address (School / College / University)',
    type: 'email',
    required: true,
  },
  { id: 'f3', label: 'Institution Type', type: 'select', required: true },
  { id: 'f4', label: 'CNIC Number', type: 'text', required: true },
  { id: 'f5', label: 'Date of Birth', type: 'date', required: true },
  { id: 'f6', label: 'Permanent Home Address', type: 'text', required: true },
  { id: 'f7', label: 'CNIC Front & Back Scan', type: 'file', required: true },
];

function categoryStyle(cat: SensitiveCategory): string {
  switch (cat) {
    case 'BIOMETRIC_PII':
      return 'border-rose-500/40 bg-rose-500/15 text-rose-300';
    case 'GOVERNMENT_ID':
      return 'border-amber-500/40 bg-amber-500/15 text-amber-300';
    case 'LOCATION_PII':
      return 'border-orange-500/40 bg-orange-500/15 text-orange-300';
    default:
      return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300';
  }
}

function scoreColor(score: number): string {
  if (score >= 85) return 'text-emerald-400';
  if (score >= 60) return 'text-amber-400';
  return 'text-rose-400';
}

export function FormPrivacyAnalyzer() {
  const [formTitle, setFormTitle] = useState('University & Bank KYC Registration Form');
  const [fields, setFields] = useState<FormFieldInput[]>(SAMPLE_FIELDS);
  const [newLabel, setNewLabel] = useState('');
  const [newType, setNewType] = useState('text');

  const [analysis, setAnalysis] = useState<FormPrivacyAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runAnalysis = async (targetFields = fields, targetTitle = formTitle) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/analyze-form', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ formTitle: targetTitle, fields: targetFields }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Analysis failed.');
        return;
      }
      setAnalysis(data as FormPrivacyAnalysis);
    } catch {
      setError('Network error analyzing form.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    runAnalysis(SAMPLE_FIELDS, formTitle);
  }, []);

  const handleAddField = () => {
    const trimmed = newLabel.trim();
    if (!trimmed) return;
    const next: FormFieldInput[] = [
      ...fields,
      { id: `f-${Date.now()}`, label: trimmed, type: newType, required: true },
    ];
    setFields(next);
    setNewLabel('');
  };

  const handleRemoveField = (id: string) => {
    setFields((prev) => prev.filter((f) => f.id !== id));
  };

  return (
    <div className="space-y-6">
      {/* Builder Section */}
      <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
          <div className="flex items-center gap-2.5">
            <FileSearch className="h-5 w-5 text-emerald-400" />
            <div>
              <h1 className="text-xl font-semibold text-slate-100">
                Form Privacy Analyzer &amp; Minimization Engine
              </h1>
              <p className="text-xs text-slate-400">
                Detect over-collected CNIC, DOB, and residential PII and preview a minimized BasItna form.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setFields(SAMPLE_FIELDS);
                setFormTitle('University & Bank KYC Registration Form');
                runAnalysis(SAMPLE_FIELDS, 'University & Bank KYC Registration Form');
              }}
              className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-700"
            >
              Reset Sample Form
            </button>
            <button
              type="button"
              onClick={() => runAnalysis()}
              disabled={loading || fields.length === 0}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
            >
              <ShieldCheck className="h-3.5 w-3.5" />
              {loading ? 'Analyzing...' : 'Analyze Form'}
            </button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-12">
          <div className="lg:col-span-5 space-y-3">
            <label htmlFor="form-title" className="block text-xs font-medium text-slate-300">
              Form Title
            </label>
            <input
              id="form-title"
              type="text"
              value={formTitle}
              onChange={(e) => setFormTitle(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none"
            />

            <div className="pt-2">
              <div className="text-xs font-medium text-slate-300 mb-1.5">Add Field</div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  placeholder="e.g. Email Address, Passport Number..."
                  className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                />
                <select
                  value={newType}
                  onChange={(e) => setNewType(e.target.value)}
                  className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs text-slate-200 focus:border-emerald-500 focus:outline-none"
                >
                  <option value="text">text</option>
                  <option value="email">email</option>
                  <option value="date">date</option>
                  <option value="file">file</option>
                  <option value="select">select</option>
                </select>
                <button
                  type="button"
                  onClick={handleAddField}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-medium text-slate-100 hover:bg-slate-700"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add
                </button>
              </div>
            </div>
          </div>

          <div className="lg:col-span-7">
            <div className="text-xs font-medium text-slate-300 mb-2">
              Form Fields ({fields.length})
            </div>
            <div className="flex flex-wrap gap-2">
              {fields.map((f) => (
                <div
                  key={f.id}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-950/70 px-3 py-1.5 text-xs text-slate-200"
                >
                  <span>{f.label}</span>
                  <span className="font-mono text-[11px] text-slate-500">({f.type})</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveField(f.id)}
                    className="text-slate-500 hover:text-rose-400"
                    aria-label={`Remove ${f.label}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200">
            {error}
          </div>
        )}
      </section>

      {/* Tier 3 #8: Before / After Side-by-Side Comparison */}
      {analysis && (
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4 text-sm text-slate-300">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>{analysis.summary}</span>
              <span className="font-mono text-xs text-slate-400">
                Engine: {analysis.source === 'gemini' ? 'Gemini + Local Rules' : 'Local Heuristic Engine'}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* BEFORE */}
            <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-6">
              <div className="flex items-center justify-between gap-4 border-b border-slate-800 pb-4">
                <div>
                  <div className="text-xs font-medium text-slate-400">BEFORE · ORIGINAL FORM</div>
                  <h2 className="text-lg font-semibold text-slate-100">{analysis.formTitle}</h2>
                </div>
                <div className="text-right">
                  <div className="text-xs text-slate-400">Privacy Score</div>
                  <motion.div
                    key={`orig-${analysis.score}`}
                    initial={{ scale: 0.85, opacity: 0.5 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ duration: 0.35 }}
                    className={`font-mono text-3xl font-bold tabular-nums ${scoreColor(analysis.score)}`}
                  >
                    {analysis.score}/100
                  </motion.div>
                </div>
              </div>

              <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-800">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${analysis.score}%` }}
                  transition={{ duration: 0.5 }}
                  className={`h-full ${
                    analysis.score >= 85
                      ? 'bg-emerald-500'
                      : analysis.score >= 60
                        ? 'bg-amber-500'
                        : 'bg-rose-500'
                  }`}
                />
              </div>

              <div className="mt-4 space-y-2.5">
                {analysis.fields.map((field) => (
                  <div
                    key={field.id}
                    className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-xs"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-slate-100">{field.label}</span>
                      <span
                        className={`rounded-md border px-2 py-0.5 font-mono text-[11px] font-semibold ${categoryStyle(
                          field.category
                        )}`}
                      >
                        {field.category}
                      </span>
                    </div>
                    <p className="mt-1 text-slate-400">{field.reason}</p>
                  </div>
                ))}
              </div>
            </section>

            {/* AFTER */}
            <section className="rounded-xl border border-emerald-500/40 bg-slate-900/80 p-6">
              <div className="flex items-center justify-between gap-4 border-b border-slate-800 pb-4">
                <div>
                  <div className="text-xs font-medium text-emerald-400">
                    AFTER · BASITNA MINIMIZED FORM
                  </div>
                  <h2 className="text-lg font-semibold text-slate-100">
                    Privacy-Preserving Replacement
                  </h2>
                </div>
                <div className="text-right">
                  <div className="text-xs text-slate-400 flex items-center justify-end gap-1">
                    <span>{analysis.score}</span>
                    <ArrowRight className="h-3 w-3 text-emerald-400" />
                    <span>Projected</span>
                  </div>
                  <motion.div
                    key={`proj-${analysis.projectedScore}`}
                    initial={{ scale: 0.85, opacity: 0.5 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ duration: 0.45 }}
                    className={`font-mono text-3xl font-bold tabular-nums ${scoreColor(
                      analysis.projectedScore
                    )}`}
                  >
                    {analysis.projectedScore}/100
                  </motion.div>
                </div>
              </div>

              <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-800">
                <motion.div
                  initial={{ width: `${analysis.score}%` }}
                  animate={{ width: `${analysis.projectedScore}%` }}
                  transition={{ duration: 0.6 }}
                  className="h-full bg-emerald-500"
                />
              </div>

              <div className="mt-4 space-y-2.5">
                {analysis.minimizedFormSuggestion.map((item, idx) => (
                  <div
                    key={`${item.label}-${idx}`}
                    className={`rounded-lg border p-3 text-xs ${
                      item.label.includes('BasItna Proof Token')
                        ? 'border-emerald-500/50 bg-emerald-500/10'
                        : 'border-slate-800 bg-slate-950/60'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1.5 font-medium text-slate-100">
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                        {item.label}
                      </span>
                      <span className="font-mono text-[11px] text-emerald-300">
                        {item.category}
                      </span>
                    </div>
                    {item.replaces && (
                      <p className="mt-1 text-emerald-200/80">
                        Replaces raw CNIC, Date of Birth, and document scans with single-use HMAC proof.
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
