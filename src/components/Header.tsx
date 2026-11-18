import { Activity, Building2, Database, FileSearch, ShieldCheck, UserCheck } from 'lucide-react';
import { TabId } from '../types.ts';

interface HeaderProps {
  activeTab: TabId;
  onSelectTab: (tab: TabId) => void;
  storageMode: 'memory' | 'postgres';
  rawCnicStored: number;
  flaggedCount?: number;
}

const TABS: Array<{ id: TabId; label: string; icon: typeof UserCheck }> = [
  { id: 'citizen', label: '1. Citizen Portal', icon: UserCheck },
  { id: 'organization', label: '2. Organization Portal', icon: Building2 },
  { id: 'analyzer', label: '3. Privacy Analyzer', icon: FileSearch },
  { id: 'inspector', label: '4. DB & Audit', icon: Database },
  { id: 'activity', label: '5. My Activity', icon: Activity },
];

export function Header({
  activeTab,
  onSelectTab,
  storageMode,
  rawCnicStored,
  flaggedCount = 0,
}: HeaderProps) {
  return (
    <header className="no-print sticky top-0 z-30 border-b border-slate-800/90 bg-slate-950/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3 shrink-0">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <div className="text-base font-bold tracking-tight text-slate-100 whitespace-nowrap">
              BasItna
            </div>
            <div className="text-xs text-slate-400 whitespace-nowrap">
              Proof, Not Data
            </div>
          </div>
        </div>

        <nav className="flex flex-wrap items-center gap-1.5" aria-label="Primary navigation">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => onSelectTab(tab.id)}
                className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  isActive
                    ? 'bg-emerald-500 text-slate-950 font-semibold'
                    : 'text-slate-300 hover:bg-slate-800/80 hover:text-slate-100'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{tab.label}</span>
                {tab.id === 'activity' && flaggedCount > 0 && (
                  <span
                    className={`ml-0.5 font-mono text-[11px] font-bold tabular-nums ${
                      isActive ? 'text-slate-950' : 'text-rose-400'
                    }`}
                  >
                    ({flaggedCount})
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="flex items-center gap-4 text-xs text-slate-400 shrink-0 whitespace-nowrap">
          <span>
            Store:{' '}
            <span className="font-medium text-slate-200">
              {storageMode === 'postgres' ? 'PostgreSQL' : 'In-Memory'}
            </span>
          </span>
          <span aria-hidden="true">·</span>
          <span>
            Raw CNICs stored:{' '}
            <span
              className={`font-mono font-semibold tabular-nums ${
                rawCnicStored === 0 ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {rawCnicStored}
            </span>
          </span>
        </div>
      </div>
    </header>
  );
}
