import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import type { Settings } from '../../types';
import { notifyLowStock } from '../../integrations/make';

export function SettingsPanel() {
  const [settings, setSettings] = useState<Settings>({ low_stock_threshold: 1 });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase.from('settings').select('*').single();
      if (data) setSettings(data as Settings);
    };
    load();
  }, []);

  const save = async () => {
    setSaving(true);
    await supabase.from('settings').upsert({ id: 1, ...settings });
    setSaving(false);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <label className="w-56 text-sm font-medium">Low stock threshold</label>
        <input
          type="number"
          className="w-24 rounded border px-2 py-1"
          value={settings.low_stock_threshold}
          min={0}
          onChange={(e) => setSettings((s) => ({ ...s, low_stock_threshold: parseInt(e.target.value || '0', 10) }))}
        />
      </div>
      <div className="flex gap-2">
        <button className="rounded bg-gray-900 px-3 py-2 text-white disabled:opacity-50" disabled={saving} onClick={save}>
          {saving ? 'Saving...' : 'Save settings'}
        </button>
        <button
          className="rounded border px-3 py-2"
          onClick={async () => {
            await notifyLowStock({
              id: 'test',
              player_name: 'Test Player',
              edition: 'Icon',
              size: '48',
              qty_inventory: settings.low_stock_threshold,
            });
            alert('Sent test low-stock payload to Make.com webhook (if configured).');
          }}
        >
          Send test low-stock alert
        </button>
      </div>
    </div>
  );
}


