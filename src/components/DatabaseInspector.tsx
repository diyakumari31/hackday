import { Database, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { AuditEntry, TokenRecord } from '../types.ts';

interface DatabaseDumpResponse {
  storageMode: 'memory' | 'postgres';
  rawCnicStored: number;
  tokens: Array<Omit<TokenRecord, 'signature' | 'tokenCode'>>;
  auditLogs: AuditEntry[];
}

interface DatabaseInspectorProps {
  onReset?: () => void;
}

export function DatabaseInspector({ onReset }: DatabaseInspectorProps) {
  const [dump, setDump] = useState<DatabaseDumpResponse | null>(null);
  const [adminKey, setAdminKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const loadDump = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const headers: Record<string, string> = {};
      if (adminKey.trim()) headers['x-admin-key'] = adminKey.trim();
      const res = await fetch('/api/database/dump', { headers });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Unable to inspect database.');
        return;
      }
      setDump(data as DatabaseDumpResponse);
    } catch {
      setError('Network error loading database dump.');
    } finally {
      setLoading(false);
    }
  }, [adminKey]);

  useEffect(() => {
    loadDump();
  }, [loadDump]);

  const handleReset = async () => {
    setError(null);
    const headers: Record<string, string> = {};
    if (adminKey.trim()) headers['x-admin-key'] = adminKey.trim();
    const res = await fetch('/api/reset', { method: 'POST', headers });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || 'Reset failed.');
      return;
    }
    await loadDump();
    onReset?.();
  };

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <Database className="h-5 w-5 text-emerald-400" />
            <div>
              <h1 className="text-xl font-semibold text-slate-100">
                Database &amp; Audit Inspector
              </h1>
              <p className="text-xs text-slate-400">
                Live cryptographic proof that zero raw CNICs, DOBs, or names are persisted.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              type="password"
              value={adminKey}
              onChange={(e) => setAdminKey(e.target.value)}
              placeholder="Optional x-admin-key"
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
            />
            <button
              type="button"
              onClick={loadDump}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </button>
            <button
              type="button"
              onClick={handleReset}
              className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-500/15 px-3 py-1.5 text-xs font-medium text-rose-300 hover:bg-rose-500/25"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Reset Store
            </button>
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200">
            {error}
          </div>
        )}

        {dump && (
          <div className="mt-5 space-y-6">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4">
                <div className="flex items-center gap-1.5 text-xs text-emerald-300">
                  <ShieldCheck className="h-4 w-4" />
                  Measured Raw CNICs Stored
                </div>
                <div className="mt-1 font-mono text-2xl font-bold text-emerald-400 tabular-nums">
                  {dump.rawCnicStored}
                </div>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-4">
                <div className="text-xs text-slate-400">Stored Token Records (HMAC only)</div>
                <div className="mt-1 font-mono text-2xl font-bold text-slate-100 tabular-nums">
                  {dump.tokens.length}
                </div>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-4">
                <div className="text-xs text-slate-400">Audit Events</div>
                <div className="mt-1 font-mono text-2xl font-bold text-slate-100 tabular-nums">
                  {dump.auditLogs.length}
                </div>
              </div>
            </div>

            <div>
              <h2 className="text-sm font-semibold text-slate-200 mb-2">
                Tokens Table (HMACs &amp; Masked Identifiers Only)
              </h2>
              {dump.tokens.length === 0 ? (
                <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-4 text-xs text-slate-400">
                  No tokens stored yet.
                </div>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-slate-800">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-950 text-slate-400">
                      <tr>
                        <th className="px-3 py-2 font-medium">Masked Token</th>
                        <th className="px-3 py-2 font-medium">Identity HMAC</th>
                        <th className="px-3 py-2 font-medium">Organization</th>
                        <th className="px-3 py-2 font-medium">Purpose</th>
                        <th className="px-3 py-2 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800 bg-slate-900/40">
                      {dump.tokens.map((t) => (
                        <tr key={t.id}>
                          <td className="px-3 py-2 font-mono text-slate-100">{t.maskedToken}</td>
                          <td className="px-3 py-2 font-mono text-slate-400">
                            {t.identityHmac.slice(0, 16)}...
                          </td>
                          <td className="px-3 py-2 text-slate-200">{t.organizationName}</td>
                          <td className="px-3 py-2 text-slate-300">{t.purpose}</td>
                          <td className="px-3 py-2 font-mono text-slate-200">{t.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div>
              <h2 className="text-sm font-semibold text-slate-200 mb-2">Audit Log</h2>
              {dump.auditLogs.length === 0 ? (
                <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-4 text-xs text-slate-400">
                  No audit entries yet.
                </div>
              ) : (
                <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                  {dump.auditLogs.map((log) => (
                    <div
                      key={log.id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2 text-xs"
                    >
                      <div className="min-w-0">
                        <span className="font-mono font-semibold text-emerald-300">
                          {log.status}
                        </span>{' '}
                        <span className="font-mono text-slate-400">{log.tokenMasked}</span>
                        <div className="text-slate-300 truncate">{log.details}</div>
                      </div>
                      <span className="font-mono text-[11px] text-slate-500 tabular-nums shrink-0">
                        {new Date(log.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
