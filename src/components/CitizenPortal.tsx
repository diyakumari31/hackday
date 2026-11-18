import {
  AlertCircle,
  Check,
  Clock,
  Copy,
  KeyRound,
  MessageSquare,
  Receipt,
  ShieldCheck,
  UserCheck,
} from 'lucide-react';
import { FormEvent, useState } from 'react';
import { InstitutionType, Organization, ProofCategory } from '../types.ts';
import { PrivacyReceiptModal, QrCodeSvg, ReceiptData } from './PrivacyReceiptModal.tsx';

interface CitizenPortalProps {
  organizations: Organization[];
  onTokenIssued?: () => void;
}

interface IssuedTokenResponse {
  id: string;
  token: string;
  maskedToken: string;
  organizationId: string;
  organizationName: string;
  category: ProofCategory;
  purpose: string;
  proofResult: string;
  ttlHours: number;
  createdAt: string;
  expiresAt: string;
  details: {
    maskedCnic: string;
    email?: string;
    institutionType?: string;
  };
}

const DEMO_PERSONAS = [
  { label: 'Adult Verified', cnic: '42101-1234567-1', note: '18+ & Alive' },
  { label: 'Minor (<18)', cnic: '35201-9988776-3', note: 'Refused for 18+' },
  { label: 'Adult Persona 2', cnic: '61101-5544332-9', note: '18+ & Alive' },
];

const INSTITUTION_TYPES: InstitutionType[] = [
  'School',
  'College',
  'University',
  'Undergraduate',
  'Postgraduate',
];

const TTL_OPTIONS = [
  { label: '15 minutes', hours: 0.25 },
  { label: '1 hour', hours: 1 },
  { label: '24 hours', hours: 24 },
];

export function CitizenPortal({ organizations, onTokenIssued }: CitizenPortalProps) {
  const defaultOrg =
    organizations.find((o) => o.id === 'hbl-digital') ?? organizations[0];

  const [cnic, setCnic] = useState('42101-1234567-1');
  const [otp, setOtp] = useState('');
  const [demoOtp, setDemoOtp] = useState<string | null>(null);
  const [otpRequestedFor, setOtpRequestedFor] = useState<string | null>(null);
  const [otpLoading, setOtpLoading] = useState(false);

  const [category, setCategory] = useState<ProofCategory>('AGE_18_PLUS');
  const [purpose, setPurpose] = useState('Account Opening');
  const [ttlHours, setTtlHours] = useState<number>(1);
  const [email, setEmail] = useState('');
  const [institutionType, setInstitutionType] = useState<InstitutionType>('University');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<IssuedTokenResponse | null>(null);
  const [copied, setCopied] = useState(false);
  const [receiptOpen, setReceiptOpen] = useState(false);

  const allowedPurposes = defaultOrg?.allowedPurposes ?? [
    'Account Opening',
    'KYC Verification',
    'Age-Restricted Product',
  ];

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
      setOtpRequestedFor(data.maskedCnic || cnic);
      setDemoOtp(data.demoOtp || null);
      setOtp('');
    } catch {
      setError('Network error while requesting OTP.');
    } finally {
      setOtpLoading(false);
    }
  };

  const handleIssue = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/tokens/issue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cnic,
          otp,
          organizationId: defaultOrg?.id || 'hbl-digital',
          purpose,
          category,
          ttlHours,
          email: email.trim() || undefined,
          institutionType,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to generate proof token.');
        return;
      }
      setIssued(data as IssuedTokenResponse);
      setDemoOtp(null);
      setOtp('');
      setOtpRequestedFor(null);
      onTokenIssued?.();
    } catch {
      setError('Network error while issuing token.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopyToken = async () => {
    if (!issued) return;
    await navigator.clipboard.writeText(issued.token);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const receiptData: ReceiptData | null = issued
    ? {
        maskedToken: issued.maskedToken,
        organizationName: issued.organizationName,
        purpose: issued.purpose,
        proofResult: issued.proofResult,
        status: 'ACTIVE',
        createdAt: issued.createdAt,
        expiresAt: issued.expiresAt,
      }
    : null;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
      <section className="lg:col-span-7 rounded-xl border border-slate-800 bg-slate-900/70 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-800 pb-4">
          <div>
            <h1 className="text-xl font-semibold text-slate-100">
              Generate Privacy-Preserving Proof Token
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              Verify via OTP and mint a single-use, audience-bound proof for{' '}
              <span className="text-slate-200 font-medium">
                {defaultOrg?.name || 'HBL Digital'}
              </span>{' '}
              without sharing your CNIC number.
            </p>
          </div>
        </div>

        <div className="mt-5">
          <div className="text-xs font-medium text-slate-400 mb-2">
            Demo Personas (Mock NADRA Registry)
          </div>
          <div className="flex flex-wrap gap-2">
            {DEMO_PERSONAS.map((persona) => (
              <button
                key={persona.cnic}
                type="button"
                onClick={() => {
                  setCnic(persona.cnic);
                  setDemoOtp(null);
                  setOtp('');
                  setOtpRequestedFor(null);
                  setError(null);
                }}
                className={`rounded-lg border px-3 py-1.5 text-xs transition-colors whitespace-nowrap shrink-0 ${
                  cnic === persona.cnic
                    ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-300'
                    : 'border-slate-700 bg-slate-950/60 text-slate-300 hover:border-slate-600'
                }`}
              >
                <span className="font-mono font-medium">{persona.cnic}</span>
                <span className="mx-1.5 text-slate-500">·</span>
                <span>{persona.label}</span>
              </button>
            ))}
          </div>
        </div>

        <form onSubmit={handleIssue} className="mt-6 space-y-5">
          <div>
            <label htmlFor="citizen-cnic" className="block text-xs font-medium text-slate-300">
              1. Citizen CNIC (hashed via HMAC, never stored)
            </label>
            <div className="mt-1.5 flex flex-col sm:flex-row gap-2.5">
              <input
                id="citizen-cnic"
                type="text"
                value={cnic}
                onChange={(e) => setCnic(e.target.value)}
                placeholder="42101-1234567-1"
                className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2.5 font-mono text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                required
              />
              <button
                type="button"
                onClick={handleRequestOtp}
                disabled={otpLoading}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-emerald-500/50 bg-emerald-500/15 px-4 py-2.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
              >
                <MessageSquare className="h-3.5 w-3.5" />
                {otpLoading ? 'Sending OTP...' : 'Send OTP'}
              </button>
            </div>
          </div>

          {demoOtp && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
              <div className="flex items-center gap-2.5">
                <MessageSquare className="h-4 w-4 text-amber-400 shrink-0" />
                <div>
                  <span className="font-semibold">Demo SMS</span> for {otpRequestedFor}: your
                  single-use verification code is{' '}
                  <span className="font-mono text-sm font-bold text-amber-100 tracking-wider">
                    {demoOtp}
                  </span>{' '}
                  (valid 5 min, max 3 attempts).
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOtp(demoOtp)}
                className="rounded-md border border-amber-400/40 bg-amber-400/20 px-2.5 py-1 text-xs font-semibold text-amber-100 hover:bg-amber-400/30 whitespace-nowrap shrink-0"
              >
                Fill OTP
              </button>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="citizen-otp" className="block text-xs font-medium text-slate-300">
                2. 6-Digit Verification OTP
              </label>
              <div className="relative mt-1.5">
                <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <input
                  id="citizen-otp"
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="Enter 6-digit OTP"
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 pl-9 pr-3.5 py-2.5 font-mono text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                  required
                />
              </div>
            </div>

            <div>
              <label htmlFor="citizen-ttl" className="block text-xs font-medium text-slate-300">
                3. Retention Control (Token TTL)
              </label>
              <div className="mt-1.5 grid grid-cols-3 gap-1.5 rounded-lg border border-slate-700 bg-slate-950 p-1">
                {TTL_OPTIONS.map((opt) => (
                  <button
                    key={opt.hours}
                    type="button"
                    onClick={() => setTtlHours(opt.hours)}
                    className={`rounded-md py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                      ttlHours === opt.hours
                        ? 'bg-emerald-500 text-slate-950 font-semibold'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <span className="block text-xs font-medium text-slate-300">4. Proof Claim</span>
              <div className="mt-1.5 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setCategory('IDENTITY_VERIFIED')}
                  className={`rounded-lg border px-3 py-2.5 text-left text-xs transition-colors ${
                    category === 'IDENTITY_VERIFIED'
                      ? 'border-emerald-500 bg-emerald-500/15 text-emerald-300 font-semibold'
                      : 'border-slate-700 bg-slate-950 text-slate-300 hover:border-slate-600'
                  }`}
                >
                  Identity Verified
                </button>
                <button
                  type="button"
                  onClick={() => setCategory('AGE_18_PLUS')}
                  className={`rounded-lg border px-3 py-2.5 text-left text-xs transition-colors ${
                    category === 'AGE_18_PLUS'
                      ? 'border-emerald-500 bg-emerald-500/15 text-emerald-300 font-semibold'
                      : 'border-slate-700 bg-slate-950 text-slate-300 hover:border-slate-600'
                  }`}
                >
                  18+ Verified
                </button>
              </div>
            </div>

            <div>
              <label htmlFor="citizen-purpose" className="block text-xs font-medium text-slate-300">
                5. Verification Purpose
              </label>
              <select
                id="citizen-purpose"
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none"
              >
                {allowedPurposes.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 pt-2 border-t border-slate-800/80">
            <div>
              <label htmlFor="citizen-email" className="block text-xs font-medium text-slate-300">
                Email Address (School / College / University / Personal, optional)
              </label>
              <input
                id="citizen-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="alex@college.edu.pk"
                className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
              />
            </div>

            <div>
              <label
                htmlFor="citizen-institution"
                className="block text-xs font-medium text-slate-300"
              >
                Institution Type (local echo only)
              </label>
              <select
                id="citizen-institution"
                value={institutionType}
                onChange={(e) => setInstitutionType(e.target.value as InstitutionType)}
                className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none"
              >
                {INSTITUTION_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-2.5 rounded-lg border border-rose-500/40 bg-rose-500/10 p-3.5 text-xs text-rose-200">
              <AlertCircle className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-500 px-5 py-3 text-sm font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-50 transition-colors"
          >
            <ShieldCheck className="h-4 w-4" />
            {submitting ? 'Minting Audience-Bound Token...' : 'Generate Proof Token'}
          </button>
        </form>
      </section>

      <aside className="lg:col-span-5 space-y-6">
        {issued ? (
          <div className="rounded-xl border border-emerald-500/40 bg-slate-900/90 p-6">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-400">
                <UserCheck className="h-4 w-4" />
                Proof Token Ready
              </span>
              <span className="inline-flex items-center gap-1 font-mono text-xs text-slate-400 tabular-nums">
                <Clock className="h-3.5 w-3.5" />
                Expires {new Date(issued.expiresAt).toLocaleTimeString()}
              </span>
            </div>

            <div className="mt-4 flex flex-col sm:flex-row items-center gap-5 rounded-xl border border-slate-800 bg-slate-950/80 p-4">
              <QrCodeSvg value={issued.token} size={132} />
              <div className="flex-1 min-w-0 text-center sm:text-left">
                <div className="text-xs text-slate-400">Single-Use Verification Token</div>
                <div className="mt-1 font-mono text-2xl font-bold tracking-wider text-emerald-300 break-all">
                  {issued.token}
                </div>
                <div className="mt-2 text-xs text-slate-400">
                  Bound to <span className="text-slate-200 font-medium">{issued.organizationName}</span> ·{' '}
                  <span className="text-slate-200">{issued.purpose}</span>
                </div>
                <div className="mt-3 flex flex-wrap justify-center sm:justify-start gap-2">
                  <button
                    type="button"
                    onClick={handleCopyToken}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-100 hover:bg-slate-700"
                  >
                    {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                    {copied ? 'Copied' : 'Copy Token'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setReceiptOpen(true)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-3 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-500/25"
                  >
                    <Receipt className="h-3.5 w-3.5" />
                    Privacy Receipt
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-5 rounded-lg border border-slate-800 bg-slate-950/60 p-4">
              <div className="text-xs font-semibold text-slate-200">
                Your Details (Echoed Locally Only)
              </div>
              <p className="mt-0.5 text-[11px] text-slate-400">
                Not stored in the database, not logged, and never transmitted to {issued.organizationName}.
              </p>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div>
                  <dt className="text-slate-500">Masked CNIC</dt>
                  <dd className="font-mono text-slate-200">{issued.details.maskedCnic}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Proof Claim</dt>
                  <dd className="font-medium text-emerald-400">{issued.proofResult}</dd>
                </div>
                {issued.details.email && (
                  <div>
                    <dt className="text-slate-500">Email</dt>
                    <dd className="text-slate-200 truncate">{issued.details.email}</dd>
                  </div>
                )}
                {issued.details.institutionType && (
                  <div>
                    <dt className="text-slate-500">Institution Type</dt>
                    <dd className="text-slate-200">{issued.details.institutionType}</dd>
                  </div>
                )}
              </dl>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
            <h2 className="text-base font-semibold text-slate-100">How BasItna Protects You</h2>
            <ul className="mt-4 space-y-3 text-sm text-slate-300">
              <li className="rounded-lg border border-slate-800/80 bg-slate-950/50 p-3">
                <div className="font-medium text-slate-100">1. OTP-Gated Issuance</div>
                <div className="mt-0.5 text-xs text-slate-400">
                  Even someone who knows your CNIC number cannot mint a proof without your 6-digit OTP.
                </div>
              </li>
              <li className="rounded-lg border border-slate-800/80 bg-slate-950/50 p-3">
                <div className="font-medium text-slate-100">2. Audience & Purpose Binding</div>
                <div className="mt-0.5 text-xs text-slate-400">
                  Each token is cryptographically signed for one organization and one purpose only.
                </div>
              </li>
              <li className="rounded-lg border border-slate-800/80 bg-slate-950/50 p-3">
                <div className="font-medium text-slate-100">3. Zero Raw PII Storage</div>
                <div className="mt-0.5 text-xs text-slate-400">
                  Only HMAC digests and masked token identifiers are retained. You can revoke active tokens anytime in My Activity.
                </div>
              </li>
            </ul>
          </div>
        )}
      </aside>

      <PrivacyReceiptModal receipt={receiptOpen ? receiptData : null} onClose={() => setReceiptOpen(false)} />
    </div>
  );
}
