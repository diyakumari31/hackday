import {
  AlertTriangle,
  BarChart3,
  Building2,
  CheckCircle2,
  HelpCircle,
  Key,
  ShieldAlert,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import {
  LiveEvent,
  Organization,
  OrganizationStatsResponse,
  VerificationResult,
} from '../types.ts';

interface OrganizationPortalProps {
  organizations: Organization[];
  onVerified?: () => void;
}

export function OrganizationPortal({ organizations, onVerified }: OrganizationPortalProps) {
  const [orgId, setOrgId] = useState<string>('hbl-digital');
  const [orgKey, setOrgKey] = useState<string>('');
  const [purpose, setPurpose] = useState<string>('Account Opening');
  const [tokenInput, setTokenInput] = useState<string>('');

  const [verifying, setVerifying] = useState(false);
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [stats, setStats] = useState<OrganizationStatsResponse | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [showSubjectTooltip, setShowSubjectTooltip] = useState(false);
  const [liveToast, setLiveToast] = useState<LiveEvent | null>(null);

  const selectedOrg = organizations.find((o) => o.id === orgId) ?? organizations[0];

  useEffect(() => {
    if (!selectedOrg) return;
    setOrgKey(selectedOrg.demoApiKey || '');
    if (!selectedOrg.allowedPurposes.includes(purpose)) {
      setPurpose(selectedOrg.allowedPurposes[0] || '');
    }
  }, [selectedOrg?.id, selectedOrg?.demoApiKey]);

  const fetchStats = useCallback(async () => {
    if (!selectedOrg || !orgKey.trim()) return;
    try {
      const res = await fetch(`/api/organizations/${encodeURIComponent(selectedOrg.id)}/stats`, {
        headers: { 'x-org-key': orgKey.trim() },
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        setStatsError(errData.error || 'Unable to load organization stats.');
        return;
      }
      const data = (await res.json()) as OrganizationStatsResponse;
      setStats(data);
      setStatsError(null);
    } catch {
      setStatsError('Network error loading stats.');
    }
  }, [selectedOrg?.id, orgKey]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  // Subscribe to SSE live events for real-time organization dashboard updates
  useEffect(() => {
    const es = new EventSource('/api/events');
    es.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data) as LiveEvent | { type: 'CONNECTED' };
        if (parsed.type === 'CONNECTED') return;
        const live = parsed as LiveEvent;
        if (live.organizationId === orgId) {
          setLiveToast(live);
          fetchStats();
          setTimeout(() => {
            setLiveToast((curr) => (curr?.id === live.id ? null : curr));
          }, 4500);
        }
      } catch {
        // Ignore malformed heartbeat frames
      }
    };
    return () => es.close();
  }, [orgId, fetchStats]);

  const handleVerify = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedOrg) return;
    setVerifying(true);
    setResult(null);

    // Support pasting either raw token BI-XXXX-XXXX or JSON QR payload
    let normalizedToken = tokenInput.trim();
    if (normalizedToken.startsWith('{')) {
      try {
        const parsed = JSON.parse(normalizedToken) as { token?: string; t?: string };
        normalizedToken = parsed.token || parsed.t || normalizedToken;
      } catch {
        // Keep raw input
      }
    }

    try {
      const res = await fetch('/api/tokens/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-org-key': orgKey.trim(),
        },
        body: JSON.stringify({
          token: normalizedToken,
          organizationId: selectedOrg.id,
          purpose,
        }),
      });
      const data = (await res.json()) as VerificationResult;
      setResult(data);
      fetchStats();
      onVerified?.();
    } catch {
      setResult({
        valid: false,
        status: 'INVALID',
        message: 'Network error while verifying token.',
      });
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="space-y-6">
      <AnimatePresence>
        {liveToast && (
          <motion.div
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-xs ${
              liveToast.type === 'FLAGGED'
                ? 'border-rose-500/50 bg-rose-500/15 text-rose-200'
                : 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <span className="h-2 w-2 rounded-full bg-current" />
              <span>
                <span className="font-semibold">{liveToast.organizationName}</span> ·{' '}
                <span className="font-mono">{liveToast.maskedToken}</span> · {liveToast.status} (
                {liveToast.purpose})
              </span>
            </div>
            <span className="font-mono text-[11px] opacity-80 tabular-nums">
              {new Date(liveToast.timestamp).toLocaleTimeString()}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Verification Form */}
        <section className="lg:col-span-6 rounded-xl border border-slate-800 bg-slate-900/70 p-6">
          <div className="border-b border-slate-800 pb-4">
            <h1 className="text-xl font-semibold text-slate-100">
              Organization Token Verifier
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              Authenticate as a relying organization, declare your purpose, and redeem a citizen&apos;s
              single-use BasItna proof token.
            </p>
          </div>

          <form onSubmit={handleVerify} className="mt-5 space-y-4">
            <div>
              <label htmlFor="org-select" className="block text-xs font-medium text-slate-300">
                1. Acting Organization
              </label>
              <select
                id="org-select"
                value={orgId}
                onChange={(e) => {
                  setOrgId(e.target.value);
                  setResult(null);
                }}
                className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none"
              >
                {organizations.map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.name} ({org.sector})
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="org-purpose" className="block text-xs font-medium text-slate-300">
                  2. Declared Purpose (Mandatory)
                </label>
                <select
                  id="org-purpose"
                  value={purpose}
                  onChange={(e) => setPurpose(e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none"
                >
                  {(selectedOrg?.allowedPurposes ?? []).map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="org-key" className="block text-xs font-medium text-slate-300">
                  3. Organization API Key (x-org-key)
                </label>
                <div className="relative mt-1.5">
                  <Key className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                  <input
                    id="org-key"
                    type="text"
                    value={orgKey}
                    onChange={(e) => setOrgKey(e.target.value)}
                    placeholder="Enter organization x-org-key"
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 pl-9 pr-3.5 py-2.5 font-mono text-xs text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                    required
                  />
                </div>
              </div>
            </div>

            <div>
              <label htmlFor="org-token" className="block text-xs font-medium text-slate-300">
                4. Citizen Proof Token
              </label>
              <input
                id="org-token"
                type="text"
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                placeholder="BI-XXXX-XXXX"
                className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-3 font-mono text-base tracking-wider text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                required
              />
            </div>

            <button
              type="submit"
              disabled={verifying}
              className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-500 px-5 py-3 text-sm font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-50 transition-colors"
            >
              <ShieldCheck className="h-4 w-4" />
              {verifying ? 'Verifying Proof Token...' : 'Verify & Redeem Token'}
            </button>
          </form>

          {result && (
            <div
              className={`mt-5 rounded-xl border p-4 ${
                result.valid
                  ? 'border-emerald-500/40 bg-emerald-500/10'
                  : result.status === 'WRONG_ORG' ||
                      result.status === 'WRONG_PURPOSE' ||
                      result.status === 'REDEEMED'
                    ? 'border-rose-500/40 bg-rose-500/10'
                    : 'border-amber-500/40 bg-amber-500/10'
              }`}
            >
              <div className="flex items-start gap-3">
                {result.valid ? (
                  <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />
                ) : result.status === 'WRONG_ORG' ||
                  result.status === 'WRONG_PURPOSE' ||
                  result.status === 'REDEEMED' ? (
                  <ShieldAlert className="h-5 w-5 text-rose-400 shrink-0 mt-0.5" />
                ) : (
                  <XCircle className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-bold uppercase tracking-wide text-slate-100">
                      {result.status}
                    </span>
                    {result.proofResult && (
                      <span className="text-xs font-semibold text-emerald-300">
                        · {result.proofResult}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-slate-200">{result.message}</p>

                  {result.valid && result.subjectId && (
                    <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950/80 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-xs text-slate-400">
                          Pairwise Org-Scoped Subject ID
                        </div>
                        <button
                          type="button"
                          onClick={() => setShowSubjectTooltip((v) => !v)}
                          className="inline-flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300"
                          title="Same citizen gets the same subjectId at this org for duplicate detection, but a different ID at every other org."
                        >
                          <HelpCircle className="h-3.5 w-3.5" />
                          Why pairwise?
                        </button>
                      </div>
                      <div className="mt-1 font-mono text-sm font-semibold text-emerald-300 tabular-nums">
                        {result.subjectId}
                      </div>
                      {showSubjectTooltip && (
                        <p className="mt-2 text-xs text-slate-300 border-t border-slate-800 pt-2">
                          Derived via{' '}
                          <code className="font-mono text-emerald-300">
                            HMAC(identityKey, identityHmac + &quot;|&quot; + orgId)
                          </code>{' '}
                          (16 hex chars). {result.organizationName} always receives this same ID for
                          this citizen to prevent duplicate signups, while any other organization gets a
                          completely unlinkable ID.
                        </p>
                      )}
                    </div>
                  )}

                  {!result.valid &&
                    (result.status === 'WRONG_ORG' ||
                      result.status === 'WRONG_PURPOSE' ||
                      result.status === 'REDEEMED') && (
                      <div className="mt-2 flex items-center gap-1.5 text-xs text-rose-300">
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                        <span>
                          Blocked attempt logged as FLAGGED in the citizen&apos;s Activity wallet.
                        </span>
                      </div>
                    )}
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Organization Live Dashboard (Tier 2 #7) */}
        <section className="lg:col-span-6 rounded-xl border border-slate-800 bg-slate-900/70 p-6">
          <div className="flex items-center justify-between gap-3 border-b border-slate-800 pb-4">
            <div className="flex items-center gap-2.5">
              <Building2 className="h-5 w-5 text-emerald-400" />
              <div>
                <h2 className="text-lg font-semibold text-slate-100">
                  {selectedOrg?.name || 'Organization'} Dashboard
                </h2>
                <p className="text-xs text-slate-400">
                  Live non-PII verification metrics &amp; recent events
                </p>
              </div>
            </div>
            <BarChart3 className="h-4 w-4 text-slate-500" />
          </div>

          {statsError ? (
            <div className="mt-5 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-xs text-amber-200">
              {statsError}
            </div>
          ) : stats ? (
            <div className="mt-5 space-y-5">
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3.5">
                  <div className="text-xs text-slate-400">Redeemed</div>
                  <div className="mt-1 font-mono text-2xl font-bold text-emerald-400 tabular-nums">
                    {stats.redeemedCount}
                  </div>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3.5">
                  <div className="text-xs text-slate-400">Rejected</div>
                  <div className="mt-1 font-mono text-2xl font-bold text-amber-400 tabular-nums">
                    {stats.rejectedCount}
                  </div>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3.5">
                  <div className="text-xs text-slate-400">Flagged</div>
                  <div className="mt-1 font-mono text-2xl font-bold text-rose-400 tabular-nums">
                    {stats.flaggedCount}
                  </div>
                </div>
              </div>

              <div>
                <div className="text-xs font-semibold text-slate-300 mb-2">
                  Verifications by Purpose
                </div>
                {stats.byPurpose.length === 0 ? (
                  <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-4 text-xs text-slate-400">
                    No verification events recorded for {stats.organizationName} yet.
                  </div>
                ) : (
                  <div className="overflow-hidden rounded-lg border border-slate-800">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-950 text-slate-400">
                        <tr>
                          <th className="px-3 py-2 font-medium">Purpose</th>
                          <th className="px-3 py-2 font-medium text-right">Redeemed</th>
                          <th className="px-3 py-2 font-medium text-right">Rejected</th>
                          <th className="px-3 py-2 font-medium text-right">Flagged</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800 bg-slate-900/40">
                        {stats.byPurpose.map((row) => (
                          <tr key={row.purpose}>
                            <td className="px-3 py-2 text-slate-200">{row.purpose}</td>
                            <td className="px-3 py-2 text-right font-mono text-emerald-400 tabular-nums">
                              {row.redeemed}
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-amber-400 tabular-nums">
                              {row.rejected}
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-rose-400 tabular-nums">
                              {row.flagged}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div>
                <div className="text-xs font-semibold text-slate-300 mb-2">
                  Last 10 Events (Zero PII)
                </div>
                {stats.recentEvents.length === 0 ? (
                  <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-4 text-xs text-slate-400">
                    Events will stream here live as tokens are issued or verified.
                  </div>
                ) : (
                  <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                    {stats.recentEvents.map((ev) => (
                      <div
                        key={ev.id}
                        className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2 text-xs"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span
                              className={`font-mono font-semibold ${
                                ev.status === 'VERIFIED'
                                  ? 'text-emerald-400'
                                  : ev.status === 'FLAGGED'
                                    ? 'text-rose-400'
                                    : ev.status === 'ISSUED'
                                      ? 'text-sky-400'
                                      : 'text-amber-400'
                              }`}
                            >
                              {ev.status}
                            </span>
                            <span className="font-mono text-slate-300">{ev.tokenMasked}</span>
                            {ev.purpose && (
                              <span className="text-slate-400 truncate">· {ev.purpose}</span>
                            )}
                          </div>
                          <div className="mt-0.5 text-[11px] text-slate-400 truncate">
                            {ev.details}
                          </div>
                        </div>
                        <span className="font-mono text-[11px] text-slate-500 tabular-nums shrink-0">
                          {new Date(ev.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="mt-5 text-xs text-slate-400">Loading organization metrics...</div>
          )}
        </section>
      </div>
    </div>
  );
}
