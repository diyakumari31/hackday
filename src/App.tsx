import { useCallback, useEffect, useState } from 'react';
import { CitizenActivity } from './components/CitizenActivity.tsx';
import { CitizenPortal } from './components/CitizenPortal.tsx';
import { DatabaseInspector } from './components/DatabaseInspector.tsx';
import { FormPrivacyAnalyzer } from './components/FormPrivacyAnalyzer.tsx';
import { Header } from './components/Header.tsx';
import { OrganizationPortal } from './components/OrganizationPortal.tsx';
import { Organization, TabId } from './types.ts';

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>('citizen');
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [storageMode, setStorageMode] = useState<'memory' | 'postgres'>('memory');
  const [rawCnicStored, setRawCnicStored] = useState<number>(0);
  const [flaggedCount, setFlaggedCount] = useState<number>(0);

  const refreshHealthAndOrgs = useCallback(async () => {
    try {
      const [healthRes, orgsRes] = await Promise.all([
        fetch('/api/health'),
        fetch('/api/organizations'),
      ]);
      if (healthRes.ok) {
        const health = await healthRes.json();
        setStorageMode(health.storageMode || 'memory');
        setRawCnicStored(Number(health.rawCnicStored ?? 0));
      }
      if (orgsRes.ok) {
        const orgData = await orgsRes.json();
        setOrganizations(orgData.organizations || []);
      }
    } catch {
      // Ignore transient load error
    }
  }, []);

  useEffect(() => {
    refreshHealthAndOrgs();
  }, [refreshHealthAndOrgs]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <Header
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        storageMode={storageMode}
        rawCnicStored={rawCnicStored}
        flaggedCount={flaggedCount}
      />

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        {activeTab === 'citizen' && (
          <CitizenPortal
            organizations={organizations}
            onTokenIssued={refreshHealthAndOrgs}
          />
        )}
        {activeTab === 'organization' && (
          <OrganizationPortal
            organizations={organizations}
            onVerified={refreshHealthAndOrgs}
          />
        )}
        {activeTab === 'analyzer' && <FormPrivacyAnalyzer />}
        {activeTab === 'inspector' && (
          <DatabaseInspector onReset={refreshHealthAndOrgs} />
        )}
        {activeTab === 'activity' && (
          <CitizenActivity
            onActivityChanged={refreshHealthAndOrgs}
            onFlaggedCountChange={setFlaggedCount}
          />
        )}
      </main>
    </div>
  );
}
