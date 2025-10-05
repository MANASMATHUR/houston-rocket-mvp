import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import type { JerseyItem, JerseyEdition } from '../../types';
import { Adjuster } from '../../components/Adjuster';
import { notifyLowStock } from '../../integrations/make';
import { buildReorderEmailDraft, buildReorderEmailDraftAI } from '../../integrations/openai';
import { VoiceMic } from './VoiceMic';
import toast from 'react-hot-toast';

type Row = JerseyItem;

const EDITIONS: JerseyEdition[] = ['Icon', 'Statement', 'Association', 'City'];

export function InventoryTable() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [edition, setEdition] = useState<string>('');

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('jerseys')
        .select('*')
        .order('player_name');
      if (!error && data) setRows(data as Row[]);
      setLoading(false);
    };
    load();
  }, []);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      const matchesSearch = search
        ? r.player_name.toLowerCase().includes(search.toLowerCase()) || r.size.includes(search)
        : true;
      const matchesEdition = edition ? r.edition === edition : true;
      return matchesSearch && matchesEdition;
    });
  }, [rows, search, edition]);

  const updateField = async (row: Row, fields: Partial<Row>) => {
    const updated = { ...row, ...fields } as Row;
    setRows((prev) => prev.map((r) => (r.id === row.id ? updated : r)));
    const { data: userRes } = await supabase.auth.getUser();
    const updatedBy = userRes.user?.email ?? null;
    const { error } = await supabase
      .from('jerseys')
      .update({ ...fields, updated_at: new Date().toISOString(), updated_by: updatedBy })
      .eq('id', row.id);
    if (error) {
      // revert on failure
      setRows((prev) => prev.map((r) => (r.id === row.id ? row : r)));
      alert('Failed to update.');
    }

    // Low stock notify (client-side MVP)
    try {
      const { data: settings } = await supabase.from('settings').select('low_stock_threshold').single();
      const threshold = settings?.low_stock_threshold ?? 1;
      const effectiveQty = 'qty_inventory' in fields ? (fields.qty_inventory as number) : row.qty_inventory;
      if (effectiveQty <= threshold) {
        await notifyLowStock({
          id: row.id,
          player_name: updated.player_name,
          edition: updated.edition,
          size: updated.size,
          qty_inventory: effectiveQty,
        });
        await supabase.from('activity_logs').insert({
          actor: updatedBy,
          action: 'low_stock_alert',
          details: { id: row.id, player_name: updated.player_name, edition: updated.edition, size: updated.size, qty_inventory: effectiveQty }
        });
      }
    } catch {}

    // Write generic update log
    try {
      await supabase.from('activity_logs').insert({
        actor: updatedBy,
        action: 'inventory_update',
        details: { id: row.id, fields }
      });
    } catch {}
  };

  const addRow = async () => {
    const defaults: Omit<Row, 'id' | 'updated_at'> = {
      player_name: '',
      edition: 'Icon',
      size: '48',
      qty_inventory: 0,
      qty_due_lva: 0,
      updated_by: null,
    };
    const { data, error } = await supabase
      .from('jerseys')
      .insert({ ...defaults })
      .select()
      .single();
    if (!error && data) {
      setRows((prev) => [data as Row, ...prev]);
      toast.success('New jersey added');
    } else {
      toast.error('Failed to add jersey');
    }
  };

  if (loading) return <div className="p-6">Loading...</div>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="w-64 rounded border px-3 py-2"
          placeholder="Search player or size"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className="rounded border px-3 py-2" value={edition} onChange={(e) => setEdition(e.target.value)}>
          <option value="">All editions</option>
          {EDITIONS.map((ed) => (
            <option key={ed} value={ed}>
              {ed}
            </option>
          ))}
        </select>
        <button onClick={addRow} className="ml-auto rounded bg-brand-600 px-3 py-2 text-white hover:bg-brand-700">
          + New jersey
        </button>
        <VoiceMic rows={rows} onAction={async (intent) => {
          if (intent.type === 'adjust') {
            const match = rows.find((r) =>
              r.player_name.toLowerCase() === intent.player_name.toLowerCase() &&
              r.edition.toLowerCase() === intent.edition.toLowerCase() &&
              (!intent.size || r.size === intent.size)
            );
            if (match) {
              const fields: Partial<Row> = {};
              if (intent.qty_inventory_delta) fields.qty_inventory = Math.max(0, match.qty_inventory + intent.qty_inventory_delta);
              if (intent.qty_due_lva_delta) fields.qty_due_lva = Math.max(0, match.qty_due_lva + intent.qty_due_lva_delta);
              if (Object.keys(fields).length) await updateField(match, fields);
            }
          }
        }} />
      </div>

      <div className="overflow-x-auto rounded-xl border shadow-sm">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-2 text-left text-sm font-semibold text-gray-700">Player</th>
              <th className="px-3 py-2 text-left text-sm font-semibold text-gray-700">Edition</th>
              <th className="px-3 py-2 text-left text-sm font-semibold text-gray-700">Size</th>
              <th className="px-3 py-2 text-left text-sm font-semibold text-gray-700">Inventory</th>
              <th className="px-3 py-2 text-left text-sm font-semibold text-gray-700">Due to LVA</th>
              <th className="px-3 py-2 text-left text-sm font-semibold text-gray-700">Last Updated</th>
              <th className="px-3 py-2 text-left text-sm font-semibold text-gray-700">Updated By</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.map((r) => (
              <tr key={r.id} className={r.qty_inventory <= 1 ? 'bg-red-50' : ''}>
                <td className="px-3 py-2">
                  <input
                    className="w-48 rounded border px-2 py-1"
                    value={r.player_name}
                    onChange={(e) => updateField(r, { player_name: e.target.value })}
                  />
                </td>
                <td className="px-3 py-2">
                  <select
                    className="rounded border px-2 py-1"
                    value={r.edition}
                    onChange={(e) => updateField(r, { edition: e.target.value as JerseyEdition })}
                  >
                    {EDITIONS.map((ed) => (
                      <option key={ed} value={ed}>
                        {ed}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2">
                  <input className="w-20 rounded border px-2 py-1" value={r.size} onChange={(e) => updateField(r, { size: e.target.value })} />
                </td>
                <td className="px-3 py-2">
                  <Adjuster value={r.qty_inventory} onChange={(v) => updateField(r, { qty_inventory: v })} />
                </td>
                <td className="px-3 py-2">
                  <Adjuster value={r.qty_due_lva} onChange={(v) => updateField(r, { qty_due_lva: v })} />
                </td>
                <td className="px-3 py-2 text-sm text-gray-600">
                  {new Date(r.updated_at).toLocaleString()}
                  <div>
                    <button
                      className="mt-1 text-xs text-brand-700 hover:underline"
                      onClick={async () => {
                        const fallback = buildReorderEmailDraft({
                          player_name: r.player_name,
                          edition: r.edition,
                          size: r.size,
                          qty_needed: Math.max(1, (1 - r.qty_inventory))
                        });
                        const draft = await buildReorderEmailDraftAI(fallback);
                        navigator.clipboard.writeText(draft);
                        alert('Reorder email draft copied to clipboard');
                      }}
                    >
                      Copy reorder email
                    </button>
                  </div>
                </td>
                <td className="px-3 py-2 text-sm text-gray-600">{r.updated_by ?? '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}


