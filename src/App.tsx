import './App.css'
import { AuthGate } from './auth/AuthGate';
import { InventoryTable } from './features/inventory/InventoryTable';
import { SettingsPanel } from './features/settings/SettingsPanel';
import { LogsPanel } from './features/logs/LogsPanel';
import { useEffect, useState } from 'react';
import { supabase } from './lib/supabaseClient';

function App() {
  const [tab, setTab] = useState<'inventory' | 'settings' | 'logs'>('inventory');
  const [userEmail, setUserEmail] = useState<string>('');
  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      setUserEmail(data.user?.email ?? '');
    })();
  }, []);
  return (
    <AuthGate>
      <div className="space-y-4">
        <header className="flex items-center gap-3 py-3">
          <img src="/src/assets/rockets.svg" alt="Rockets" className="h-8 w-auto" />
          <h1 className="text-2xl font-semibold">Rockets Jerseys</h1>
          <nav className="ml-auto flex gap-2">
            <button
              className={`rounded px-3 py-1.5 ${tab === 'inventory' ? 'bg-gray-900 text-white' : 'border'}`}
              onClick={() => setTab('inventory')}
            >
              Inventory
            </button>
            <button
              className={`rounded px-3 py-1.5 ${tab === 'settings' ? 'bg-gray-900 text-white' : 'border'}`}
              onClick={() => setTab('settings')}
            >
              Settings
            </button>
            <button
              className={`rounded px-3 py-1.5 ${tab === 'logs' ? 'bg-gray-900 text-white' : 'border'}`}
              onClick={() => setTab('logs')}
            >
              Logs
            </button>
            <div className="mx-2 hidden sm:block self-center text-sm text-gray-600">{userEmail}</div>
            <button
              className="rounded border px-3 py-1.5"
              onClick={async () => {
                await supabase.auth.signOut();
                location.reload();
              }}
            >
              Sign out
            </button>
          </nav>
        </header>
        {tab === 'inventory' ? <InventoryTable /> : tab === 'settings' ? <SettingsPanel /> : <LogsPanel />}
      </div>
    </AuthGate>
  )
}

export default App
