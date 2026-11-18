import {
  Activity,
  AlertOctagon,
  Ban,
  Building2,
  CheckCircle2,
  Clock,
  KeyRound,
  Lock,
  MessageSquare,
  Receipt,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Unlock,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  CitizenActivityResponse,
  CitizenTokenActivityItem,
  LiveEvent,
  TokenStatus,
} from '../types.ts';
import { PrivacyReceiptModal, ReceiptData } from './PrivacyReceiptModal.tsx';

interface CitizenActivityProps {
  onActivityChanged?: () => void;
  onFlaggedCountChange?: (count: number) => void;
}

const DEMO_CITIZENS = [
  { label: 'Adult Verified', cnic: '42101-1234567-1' },
  { label: 'Minor (<18)', cnic: '35201-9988776-3' },
  { label: 'Adult Persona 2', cnic: '61101-5544332-9' },
];

function statusStyle(status: TokenStatus): string {
  switch (status) {
    case 'ACTIVE':
      return 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300';
    case 'REDEEMED':
      return 'border-sky-500/40 bg-sky-500/15 text-sky-300';
    case 'REVOKED':
      return 'border-rose-500/40 bg-rose-500/15 text-rose-300';
    case 'EXPIRED':
      return 'border-slate-600 bg-slate-800 text-slate-300';
  }
}

export function CitizenActivity({
  onActivityChanged,
  onFlaggedCountChange,
}: CitizenActivityProps) {
  const [cnic, setCnic] = useState('42101-1234567-1');
  const [otp, setOtp] = useState('');
  const [demoOtp, setDemoOtp] = useState<string | null>(null);
  const [otpLoading, setOtpLoading] = useState(false);

  const [walletSession, setWalletSession] = useState<string | null>(null);
  const [activity, setActivity] = useState<CitizenActivityResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [orgFilter, setOrgFilter] = useState<string>('ALL');
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [receiptTarget, setReceiptTarget] = useState<ReceiptData | null>(null);

  const [liveToast, setLiveToast] = useState<{
    id: string;
    message: string;
    variant: 'success' | 'danger' | 'info';
  } | null>(null);

  const fetchActivityWithSession = useCallback(
    async (targetCnic: string, sessionToken: string) => {
      try {
        const res = await fetch('/api/citizen/activity', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cnic: targetCnic, walletSession: sessionToken }),
        });
        const data = await res.json();
        if (!res.ok) {
          if (res.status === 401) {
            setWalletSession(null);
          }
          return;
        }
        const typed = data as CitizenActivityResponse;
        setActivity(typed);
        onFlaggedCountChange?.(typed.summary.blockedAttempts);
      } catch {
        // Ignore silent background refresh errors
      }
    },
    [onFlaggedCountChange]
  );

  // Live SSE feed subscription while unlocked
  useEffect(() => {
    if (!walletSession) return;
    const es = new EventSource('/api/events');
    es.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data) as LiveEvent | { type: 'CONNECTED' };
        if (parsed.type === 'CONNECTED') return;
        const ev = parsed as LiveEvent;

        let message = `${ev.organizationName} · ${ev.status} (${ev.purpose})`;
        let variant: 'success' | 'danger' | 'info' = 'info';

        if (ev.type === 'REDEEMED') {
          message = `${ev.organizationName} just redeemed your ${ev.proofResult || 'proof'} (${ev.maskedToken})`;
          variant = 'success';
        } else if (ev.type === 'FLAGGED') {
          message = `Alert: ${ev.organizationName} tried to use ${ev.maskedToken} for ${ev.purpose} — blocked`;
          variant = 'danger';
        } else if (ev.type === 'REVOKED') {
          message = `Token ${ev.maskedToken} for ${ev.organizationName} revoked`;
          variant = 'info';
        } else if (ev.type === 'ISSUED') {
          message = `New ${ev.proofResult || 'proof'} issued for ${ev.organizationName}`;
          variant = 'info';
        }

        setLiveToast({ id: ev.id, message, variant });
        fetchActivityWithSession(cnic, walletSession);
        setTimeout(() => {
          setLiveToast((curr) => (curr?.id === ev.id ? null : curr));
        }, 5000);
      } catch {
        // Ignore malformed SSE lines
      }
    };
    return () => es.close();
  }, [walletSession, cnic, fetchActivityWithSession]);

  const handleRequestOtp = async () => {
    setError(null);
    setOtpLoading(true);
    try {
      const res = await fetch('/api/otp/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cnic }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to dispatch OTP.');
        setDemoOtp(null);
        return;
      }
      setDemoOtp(data.demoOtp || null);
      setOtp('');
    } catch {
      setError('Network error while requesting OTP.');
    } finally {
      setOtpLoading(false);
    }
  };

  const handleUnlock = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/citizen/activity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cnic, otp }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to unlock activity wallet.');
        return;
      }
      const typed = data as CitizenActivityResponse;
      setActivity(typed);
      setWalletSession(typed.walletSession);
      setDemoOtp(null);
      setOtp('');
      onFlaggedCountChange?.(typed.summary.blockedAttempts);
    } catch {
      setError('Network error loading activity.');
    } finally {
      setLoading(false);
    }
  };

  const handleRevoke = async (item: CitizenTokenActivityItem) => {
    if (!walletSession) return;
    setRevokingId(item.id);
    setError(null);
    try {
      const res = await fetch('/api/tokens/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tokenId: item.id,
          cnic,
          walletSession,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Could not revoke token.');
        return;
      }
      await fetchActivityWithSession(cnic, walletSession);
      onActivityChanged?.();
    } catch {
      setError('Network error revoking token.');
    } finally {
      setRevokingId(null);
    }
  };

  const filteredTokens = useMemo(() => {
    if (!activity) return [];
    if (orgFilter === 'ALL') return activity.tokens;
    return activity.tokens.filter((t) => t.organizationId === orgFilter);
  }, [activity, orgFilter]);

  if (!activity || !walletSession) {
    return (
      <div className="mx-auto max-w-2xl rounded-xl border border-slate-800 bg-slate-900/70 p-6">
        <div className="flex items-center gap-3 border-b border-slate-800 pb-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-400">
            <Lock className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-slate-100">
              My Token Activity Wallet
            </h1>
            <p className="text-xs text-slate-400">
              OTP-protected ledger showing where your proofs were used, blocked attempts, and active revocations.
            </p>
          </div>
        </div>

        <div className="mt-5">
          <div className="text-xs font-medium text-slate-400 mb-2">Demo Citizens</div>
          <div className="flex flex-wrap gap-2">
            {DEMO_CITIZENS.map((c) => (
              <button
                key={c.cnic}
                type="button"
                onClick={() => {
                  setCnic(c.cnic);
                  setDemoOtp(null);
                  setOtp('');
                  setError(null);
                }}
                className={`rounded-lg border px-3 py-1.5 text-xs transition-colors ${
                  cnic === c.cnic
                    ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-300'
                    : 'border-slate-700 bg-slate-950/60 text-slate-300 hover:border-slate-600'
                }`}
              >
                <span className="font-mono">{c.cnic}</span>
                <span className="mx-1.5 text-slate-500">·</span>
                <span>{c.label}</span>
              </button>
            ))}
          </div>
        </div>

        <form onSubmit={handleUnlock} className="mt-5 space-y-4">
          <div>
            <label htmlFor="activity-cnic" className="block text-xs font-medium text-slate-300">
              Citizen CNIC
            </label>
            <div className="mt-1.5 flex flex-col sm:flex-row gap-2.5">
              <input
                id="activity-cnic"
                type="text"
                value={cnic}
                onChange={(e) => setCnic(e.target.value)}
                placeholder="42101-1234567-1"
                className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2.5 font-mono text-sm text-slate-100 focus:border-emerald-500 focus:outline-none"
                required
              />
              <button
                type="button"
                onClick={handleRequestOtp}
                disabled={otpLoading}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-emerald-500/50 bg-emerald-500/15 px-4 py-2.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                <MessageSquare className="h-3.5 w-3.5" />
                {otpLoading ? 'Sending...' : 'Send OTP'}
              </button>
            </div>
          </div>

          {demoOtp && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
              <div>
                <span className="font-semibold">Demo SMS OTP:</span>{' '}
                <span className="font-mono text-sm font-bold text-amber-100 tracking-wider">
                  {demoOtp}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setOtp(demoOtp)}
                className="rounded-md border border-amber-400/40 bg-amber-400/20 px-2.5 py-1 text-xs font-semibold text-amber-100 hover:bg-amber-400/30"
              >
                Fill OTP
              </button>
            </div>
          )}

          <div>
            <label htmlFor="activity-otp" className="block text-xs font-medium text-slate-300">
              6-Digit OTP
            </label>
            <div className="relative mt-1.5">
              <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input
                id="activity-otp"
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="Enter 6-digit OTP"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 pl-9 pr-3.5 py-2.5 font-mono text-sm text-slate-100 focus:border-emerald-500 focus:outline-none"
                required
              />
            </div>
          </div>

          {error && (
            <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-500 px-5 py-3 text-sm font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
          >
            <Unlock className="h-4 w-4" />
            {loading ? 'Unlocking Wallet...' : 'Unlock My Activity'}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <AnimatePresence>
        {liveToast && (
          <motion.div
            initial={{ opacity: 0, y: -14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -14 }}
            className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-xs font-medium ${
              liveToast.variant === 'danger'
                ? 'border-rose-500/60 bg-rose-500/20 text-rose-100'
                : liveToast.variant === 'success'
                  ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-100'
                  : 'border-sky-500/40 bg-sky-500/15 text-sky-100'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <span className="h-2 w-2 rounded-full bg-current" />
              <span>{liveToast.message}</span>
            </div>
            <span className="text-[11px] opacity-75">Live SSE update</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Top Wallet Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-800 bg-slate-900/70 px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-400">
            <Activity className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-slate-100">
              My Token Activity · <span className="font-mono text-emerald-300">{activity.maskedCnic}</span>
            </h1>
            <p className="text-xs text-slate-400">
              Live SSE feed connected · Real-time proof usage &amp; suspicious attempt monitoring
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => fetchActivityWithSession(cnic, walletSession)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-700"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
          <button
            type="button"
            onClick={() => {
              setWalletSession(null);
              setActivity(null);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800"
          >
            <Lock className="h-3.5 w-3.5" />
            Lock Wallet
          </button>
        </div>
      </div>

      {/* Summary Strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
          <div className="text-xs text-slate-400">Total Tokens</div>
          <div className="mt-1 font-mono text-2xl font-bold text-slate-100 tabular-nums">
            {activity.summary.totalTokens}
          </div>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
          <div className="text-xs text-slate-400">Active</div>
          <div className="mt-1 font-mono text-2xl font-bold text-emerald-400 tabular-nums">
            {activity.summary.activeTokens}
          </div>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
          <div className="text-xs text-slate-400">Redeemed</div>
          <div className="mt-1 font-mono text-2xl font-bold text-sky-400 tabular-nums">
            {activity.summary.redeemedTokens}
          </div>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
          <div className="text-xs text-slate-400">Expired / Revoked</div>
          <div className="mt-1 font-mono text-2xl font-bold text-slate-300 tabular-nums">
            {activity.summary.expiredTokens + activity.summary.revokedTokens}
          </div>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
          <div className="text-xs text-slate-400">Blocked Attempts</div>
          <div
            className={`mt-1 font-mono text-2xl font-bold tabular-nums ${
              activity.summary.blockedAttempts > 0 ? 'text-rose-400' : 'text-slate-300'
            }`}
          >
            {activity.summary.blockedAttempts}
          </div>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
          <div className="text-xs text-slate-400">Organizations</div>
          <div className="mt-1 font-mono text-2xl font-bold text-emerald-300 tabular-nums">
            {activity.summary.organizationsCount}
          </div>
        </div>
      </div>

      {/* Tier 2 #5: Red Suspicious-Activity Alert Cards */}
      {activity.flaggedAlerts.length > 0 && (
        <section className="space-y-2.5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-rose-300">
            <ShieldAlert className="h-4 w-4 text-rose-400" />
            Suspicious-Activity Alerts ({activity.flaggedAlerts.length})
          </h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {activity.flaggedAlerts.map((alert) => (
              <div
                key={alert.id}
                className="rounded-xl border border-rose-500/50 bg-rose-500/10 p-4 text-xs text-rose-100"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 font-semibold text-rose-300">
                    <AlertOctagon className="h-4 w-4" />
                    FLAGGED ATTEMPT BLOCKED
                  </span>
                  <span className="font-mono text-[11px] text-rose-300/80 tabular-nums">
                    {new Date(alert.timestamp).toLocaleTimeString()}
                  </span>
                </div>
                <p className="mt-1.5 text-sm text-rose-100">
                  Someone at{' '}
                  <span className="font-semibold">{alert.organizationName || 'Unknown Org'}</span>{' '}
                  tried to use your token for{' '}
                  <span className="font-semibold">{alert.purpose || 'verification'}</span> — blocked.
                </p>
                <p className="mt-1 text-[11px] text-rose-200/80">{alert.details}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {error && (
        <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Organizations that have received a proof from you */}
        <aside className="lg:col-span-4 space-y-4">
          <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-100">
              <Building2 className="h-4 w-4 text-emerald-400" />
              Organizations With Your Proof
            </h2>
            <p className="mt-1 text-xs text-slate-400">
              Grouped by relying organization with counts. Zero raw CNIC data shared.
            </p>

            {activity.organizations.length === 0 ? (
              <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950/50 p-4 text-xs text-slate-400">
                No proofs issued for this citizen yet.
              </div>
            ) : (
              <div className="mt-4 space-y-2.5">
                {activity.organizations.map((org) => (
                  <button
                    key={org.organizationId}
                    type="button"
                    onClick={() =>
                      setOrgFilter((prev) =>
                        prev === org.organizationId ? 'ALL' : org.organizationId
                      )
                    }
                    className={`w-full text-left rounded-lg border p-3 transition-colors ${
                      orgFilter === org.organizationId
                        ? 'border-emerald-500/60 bg-emerald-500/10'
                        : 'border-slate-800 bg-slate-950/60 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-slate-100">
                        {org.organizationName}
                      </span>
                      <span className="font-mono text-xs text-slate-300 tabular-nums">
                        {org.totalTokens} token{org.totalTokens === 1 ? '' : 's'}
                      </span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-3 text-[11px] text-slate-400 tabular-nums">
                      <span className="text-sky-300">{org.redeemedCount} redeemed</span>
                      <span className="text-emerald-300">{org.activeCount} active</span>
                      {org.flaggedCount > 0 && (
                        <span className="text-rose-400">{org.flaggedCount} flagged</span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </aside>

        {/* Token Timeline List */}
        <section className="lg:col-span-8 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-slate-200">
              Token Timeline ({filteredTokens.length})
            </h2>
            <div className="flex items-center gap-2">
              <label htmlFor="org-filter" className="text-xs text-slate-400">
                Filter by Organization:
              </label>
              <select
                id="org-filter"
                value={orgFilter}
                onChange={(e) => setOrgFilter(e.target.value)}
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
              >
                <option value="ALL">All Organizations</option>
                {activity.organizations.map((org) => (
                  <option key={org.organizationId} value={org.organizationId}>
                    {org.organizationName}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {filteredTokens.length === 0 ? (
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-8 text-center text-sm text-slate-400">
              No proof tokens match this filter yet. Issue one in the Citizen Portal tab.
            </div>
          ) : (
            <div className="space-y-3">
              {filteredTokens.map((item) => {
                const issuedTime = new Date(item.createdAt).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                });
                const redeemedTime = item.redeemedAt
                  ? new Date(item.redeemedAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })
                  : null;

                return (
                  <div
                    key={item.id}
                    className="rounded-xl border border-slate-800 bg-slate-900/70 p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2.5">
                          <span className="font-mono text-sm font-bold text-slate-100">
                            {item.maskedToken}
                          </span>
                          <span
                            className={`rounded-md border px-2 py-0.5 font-mono text-[11px] font-semibold ${statusStyle(
                              item.status
                            )}`}
                          >
                            {item.status}
                          </span>
                          <span className="text-xs font-medium text-emerald-300">
                            {item.proofResult}
                          </span>
                        </div>
                        <div className="mt-1.5 text-sm text-slate-200">
                          Issued for <span className="font-semibold">{item.organizationName}</span>
                          {item.status === 'REDEEMED' && redeemedTime
                            ? ` → Redeemed ${redeemedTime} for ${item.proofResult}`
                            : item.status === 'REVOKED'
                              ? ' → Revoked by you'
                              : item.status === 'EXPIRED'
                                ? ' → Expired unused'
                                : ` → Ready for single-use (${item.purpose})`}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() =>
                            setReceiptTarget({
                              maskedToken: item.maskedToken,
                              organizationName: item.organizationName,
                              purpose: item.purpose,
                              proofResult: item.proofResult,
                              status: item.status,
                              createdAt: item.createdAt,
                              expiresAt: item.expiresAt,
                              redeemedAt: item.redeemedAt,
                              revokedAt: item.revokedAt,
                            })
                          }
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700"
                        >
                          <Receipt className="h-3.5 w-3.5" />
                          Receipt
                        </button>
                        {item.status === 'ACTIVE' && (
                          <button
                            type="button"
                            onClick={() => handleRevoke(item)}
                            disabled={revokingId === item.id}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-500/15 px-2.5 py-1.5 text-xs font-semibold text-rose-300 hover:bg-rose-500/25 disabled:opacity-50"
                          >
                            <Ban className="h-3.5 w-3.5" />
                            {revokingId === item.id ? 'Revoking...' : 'Revoke'}
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-4 border-t border-slate-800/80 pt-2.5 text-xs text-slate-400 tabular-nums">
                      <span className="inline-flex items-center gap-1">
                        <ShieldCheck className="h-3.5 w-3.5 text-slate-500" />
                        Purpose: {item.purpose}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5 text-slate-500" />
                        Issued {issuedTime}
                      </span>
                      {redeemedTime && (
                        <span className="inline-flex items-center gap-1 text-sky-300">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Redeemed {redeemedTime}
                        </span>
                      )}
                      {item.status === 'ACTIVE' && (
                        <span>
                          Expires {new Date(item.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      )}
                    </div>

                    {item.blockedAttempts.length > 0 && (
                      <div className="mt-3 space-y-1.5 rounded-lg border border-rose-500/30 bg-rose-950/30 p-3">
                        <div className="text-[11px] font-semibold text-rose-300">
                          Blocked / Suspicious Attempts ({item.blockedAttempts.length})
                        </div>
                        {item.blockedAttempts.map((attempt) => (
                          <div
                            key={attempt.id}
                            className="flex items-center justify-between gap-2 text-xs text-rose-200"
                          >
                            <span>{attempt.details}</span>
                            <span className="font-mono text-[11px] text-rose-300/70 tabular-nums shrink-0">
                              {new Date(attempt.timestamp).toLocaleTimeString()}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      <PrivacyReceiptModal receipt={receiptTarget} onClose={() => setReceiptTarget(null)} />
    </div>
  );
}
