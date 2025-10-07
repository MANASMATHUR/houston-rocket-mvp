import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import type { JerseyItem, JerseyEdition } from '../../types';
import { Adjuster } from '../../components/Adjuster';
import { notifyLowStock } from '../../integrations/make';
import { buildReorderEmailDraft, buildReorderEmailDraftAI, optimizeOrderQuantity } from '../../integrations/openai';
import { VoiceMic } from './VoiceMic';
import { initiateOrderCall } from '../../integrations/voiceflow';
import { Search, Plus, Phone, Download, Filter, AlertTriangle, CheckCircle, Clock, Package, Upload, Send } from 'lucide-react';
import toast from 'react-hot-toast';

type Row = JerseyItem;

const EDITIONS: JerseyEdition[] = ['Icon', 'Statement', 'Association', 'City'];

export function InventoryTable() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [edition, setEdition] = useState<string>('');
  const [showLowStockOnly, setShowLowStockOnly] = useState(false);
  const [sortBy, setSortBy] = useState<'player_name' | 'qty_inventory' | 'updated_at'>('player_name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [showAddModal, setShowAddModal] = useState(false);
  const [newItem, setNewItem] = useState<{ player_name: string; edition: JerseyEdition; size: string; qty_inventory: number; qty_due_lva: number }>(
    { player_name: '', edition: 'Icon', size: '48', qty_inventory: 0, qty_due_lva: 0 }
  );
  const [adding, setAdding] = useState(false);

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
    let filteredRows = rows.filter((r) => {
      const matchesSearch = search
        ? r.player_name.toLowerCase().includes(search.toLowerCase()) || r.size.includes(search)
        : true;
      const matchesEdition = edition ? r.edition === edition : true;
      const matchesLowStock = showLowStockOnly ? r.qty_inventory <= 1 : true;
      return matchesSearch && matchesEdition && matchesLowStock;
    });

    // Sort the filtered results
    filteredRows.sort((a, b) => {
      let aValue: any = a[sortBy];
      let bValue: any = b[sortBy];
      
      if (sortBy === 'updated_at') {
        aValue = new Date(aValue).getTime();
        bValue = new Date(bValue).getTime();
      }
      
      if (typeof aValue === 'string') {
        aValue = aValue.toLowerCase();
        bValue = bValue.toLowerCase();
      }
      
      if (sortOrder === 'asc') {
        return aValue < bValue ? -1 : aValue > bValue ? 1 : 0;
      } else {
        return aValue > bValue ? -1 : aValue < bValue ? 1 : 0;
      }
    });

    return filteredRows;
  }, [rows, search, edition, showLowStockOnly, sortBy, sortOrder]);

  const turnInOne = async (row: Row) => {
    const newInventory = Math.max(0, row.qty_inventory - 1);
    const newDueLva = row.qty_due_lva + 1;
    await updateField(row, { qty_inventory: newInventory, qty_due_lva: newDueLva });
  };

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
      toast.error('Failed to update inventory item');
    } else {
      toast.success('Inventory updated successfully');
    }

    // Low stock notify (client-side MVP)
    try {
      const { data: settings } = await supabase.from('settings').select('low_stock_threshold').single();
      const threshold = settings?.low_stock_threshold ?? 1;
      const effectiveQty = 'qty_inventory' in fields ? (fields.qty_inventory as number) : row.qty_inventory;
      if (effectiveQty <= threshold) {
        const fallback = buildReorderEmailDraft({
          player_name: updated.player_name,
          edition: updated.edition,
          size: updated.size,
          qty_needed: Math.max(1, (threshold - effectiveQty) || 1)
        });
        const draft = await buildReorderEmailDraftAI(fallback);
        await notifyLowStock({
          id: row.id,
          player_name: updated.player_name,
          edition: updated.edition,
          size: updated.size,
          qty_inventory: effectiveQty,
          reorder_email_draft: draft,
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

  const openAddModal = () => {
    setNewItem({ player_name: '', edition: 'Icon', size: '48', qty_inventory: 0, qty_due_lva: 0 });
    setShowAddModal(true);
  };

  const submitNewItem = async () => {
    if (!newItem.player_name.trim()) {
      toast.error('Player name is required');
      return;
    }
    if (!['Icon','Statement','Association','City'].includes(newItem.edition)) {
      toast.error('Select a valid edition');
      return;
    }
    if (!newItem.size.trim()) {
      toast.error('Size is required');
      return;
    }
    setAdding(true);
    try {
      const { data: userRes } = await supabase.auth.getUser();
      const updatedBy = userRes.user?.email ?? null;
      const { data, error } = await supabase
        .from('jerseys')
        .insert({
          player_name: newItem.player_name.trim(),
          edition: newItem.edition,
          size: newItem.size.trim(),
          qty_inventory: Math.max(0, Number(newItem.qty_inventory) || 0),
          qty_due_lva: Math.max(0, Number(newItem.qty_due_lva) || 0),
          updated_by: updatedBy,
          updated_at: new Date().toISOString(),
        })
        .select()
        .single();
      if (error) throw new Error(error.message);
      setRows((prev) => [data as Row, ...prev]);
      setShowAddModal(false);
      toast.success('Jersey added');
      try {
        await supabase.from('activity_logs').insert({
          actor: updatedBy,
          action: 'inventory_update',
          details: { id: (data as any)?.id, created: true }
        });
      } catch {}
    } catch (e: any) {
      toast.error(e?.message || 'Failed to add jersey');
    } finally {
      setAdding(false);
    }
  };

  const handleOrderCall = async (row: Row) => {
    try {
      toast.loading('Initiating order call...', { id: 'order-call' });
      await initiateOrderCall(row.player_name, row.edition, row.size, Math.max(1, 5 - row.qty_inventory));
      toast.success('Order call initiated successfully', { id: 'order-call' });
    } catch (error: any) {
      const message = error?.message || 'Failed to initiate order call';
      toast.error(message, { id: 'order-call' });
      console.error('Order call error:', error);
    }
  };

  const handleOptimizeOrder = async (row: Row) => {
    try {
      toast.loading('Analyzing optimal order quantity...', { id: 'optimize-order' });
      const optimization = await optimizeOrderQuantity(row.player_name, row.edition, row.size, row.qty_inventory);
      toast.success(`Recommended quantity: ${optimization.suggestedQuantity} ($${optimization.costEstimate})`, { id: 'optimize-order' });
    } catch (error) {
      toast.error('Failed to optimize order', { id: 'optimize-order' });
      console.error('Optimization error:', error);
    }
  };

  const exportData = () => {
    const csvContent = [
      ['Player', 'Edition', 'Size', 'Inventory', 'Due to LVA', 'Last Updated', 'Updated By'],
      ...filtered.map(row => [
        row.player_name,
        row.edition,
        row.size,
        row.qty_inventory,
        row.qty_due_lva,
        new Date(row.updated_at).toLocaleDateString(),
        row.updated_by || ''
      ])
    ].map(row => row.join(',')).join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `inventory-export-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
    toast.success('Inventory data exported');
  };

  const importCsv = async (file: File) => {
    const text = await file.text();
    const rows = text.split(/\r?\n/).filter(Boolean);
    const [header, ...lines] = rows;
    const cols = header.split(',').map((h) => h.trim().toLowerCase());
    const required = ['player', 'edition', 'size', 'inventory', 'due to lva'];
    const ok = required.every((r) => cols.includes(r));
    if (!ok) {
      toast.error('CSV must include: Player, Edition, Size, Inventory, Due to LVA');
      return;
    }
    let imported = 0;
    for (const line of lines) {
      const parts = line.split(',');
      if (parts.length < cols.length) continue;
      const get = (name: string) => parts[cols.indexOf(name)].trim();
      const player_name = get('player');
      const edition = get('edition') as JerseyEdition;
      const size = get('size');
      const qty_inventory = Number(get('inventory')) || 0;
      const qty_due_lva = Number(get('due to lva')) || 0;
      try {
        const { data: userRes } = await supabase.auth.getUser();
        const updatedBy = userRes.user?.email ?? null;
        const { data, error } = await supabase
          .from('jerseys')
          .insert({ player_name, edition, size, qty_inventory, qty_due_lva, updated_by: updatedBy, updated_at: new Date().toISOString() })
          .select()
          .single();
        if (!error && data) {
          setRows((prev) => [data as Row, ...prev]);
          imported += 1;
        }
      } catch {}
    }
    toast.success(`Imported ${imported} item(s)`);
  };

  const sendToLeague = async (row: Row) => {
    const qtyStr = window.prompt(`Send how many of ${row.player_name} ${row.edition} size ${row.size} to LVA?`, '1');
    if (!qtyStr) return;
    const qty = Math.max(0, Math.min(row.qty_inventory, Number(qtyStr) || 0));
    if (qty <= 0) return;
    await updateField(row, { qty_inventory: row.qty_inventory - qty, qty_due_lva: row.qty_due_lva + qty });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="loading"></div>
        <span className="ml-2 text-gray-600">Loading inventory...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Inventory Management</h1>
          <p className="text-gray-600">Manage jersey inventory and track stock levels</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={exportData}
            className="btn btn-secondary btn-sm"
          >
            <Download className="h-4 w-4" />
            Export
          </button>
          <label className="btn btn-secondary btn-sm cursor-pointer">
            <Upload className="h-4 w-4" />
            Import CSV
            <input
              type="file"
              accept=".csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) importCsv(f);
                e.currentTarget.value = '';
              }}
            />
          </label>
          <button
            onClick={openAddModal}
            className="btn btn-primary btn-sm"
          >
            <Plus className="h-4 w-4" />
            Add Jersey
          </button>
        </div>
      </div>

      {/* Filters and Search */}
      <div className="card p-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex-1 min-w-64">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                className="input pl-10"
                placeholder="Search player or size..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
          
          <select 
            className="input w-48" 
            value={edition} 
            onChange={(e) => setEdition(e.target.value)}
          >
            <option value="">All editions</option>
            {EDITIONS.map((ed) => (
              <option key={ed} value={ed}>{ed}</option>
            ))}
          </select>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={showLowStockOnly}
              onChange={(e) => setShowLowStockOnly(e.target.checked)}
              className="rounded border-gray-300"
            />
            <span className="text-sm text-gray-700">Low stock only</span>
          </label>

          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-gray-400" />
            <select
              className="input w-32"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
            >
              <option value="player_name">Player</option>
              <option value="qty_inventory">Stock</option>
              <option value="updated_at">Updated</option>
            </select>
            <button
              onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
              className="btn btn-secondary btn-sm"
            >
              {sortOrder === 'asc' ? '↑' : '↓'}
            </button>
          </div>

          <VoiceMic rows={rows} onAction={async (intent) => {
            if (intent.type === 'adjust') {
              if (!intent.player_name || !intent.edition) return;
              const playerName = intent.player_name as string;
              const edition = intent.edition as string;
              const match = rows.find((r) =>
                r.player_name.toLowerCase() === playerName.toLowerCase() &&
                r.edition.toLowerCase() === edition.toLowerCase() &&
                (!intent.size || r.size === intent.size)
              );
              if (match) {
                const fields: Partial<Row> = {};
                if (intent.qty_inventory_delta) fields.qty_inventory = Math.max(0, match.qty_inventory + intent.qty_inventory_delta);
                if (intent.qty_due_lva_delta) fields.qty_due_lva = Math.max(0, match.qty_due_lva + intent.qty_due_lva_delta);
                if (Object.keys(fields).length) await updateField(match, fields);
              }
            } else if (intent.type === 'order') {
              if (!intent.player_name || !intent.edition) return;
              const playerName = intent.player_name as string;
              const edition = intent.edition as string;
              const match = rows.find((r) =>
                r.player_name.toLowerCase() === playerName.toLowerCase() &&
                r.edition.toLowerCase() === edition.toLowerCase() &&
                (!intent.size || r.size === intent.size)
              );
              if (match) {
                await handleOrderCall(match);
              }
            }
          }} />
        </div>
      </div>

      {/* Low Stock Banner + Stats Summary */}
      {filtered.some(r => r.qty_inventory <= 1) && (
        <div className="bg-yellow-50 border border-yellow-200 text-yellow-900 rounded-lg p-3 flex items-center justify-between">
          <div>
            <strong>Low stock alert:</strong> {filtered.filter(r => r.qty_inventory <= 1).length} item(s) at or below threshold.
          </div>
          <button className="btn btn-secondary btn-sm" onClick={() => setShowLowStockOnly(true)}>Show low stock</button>
        </div>
      )}

      {/* Stats Summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="card p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Total Items</p>
              <p className="text-2xl font-bold text-gray-900">{filtered.length}</p>
            </div>
            <Package className="h-8 w-8 text-blue-500" />
          </div>
        </div>
        
        <div className="card p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Low Stock</p>
              <p className="text-2xl font-bold text-red-600">{filtered.filter(r => r.qty_inventory <= 1).length}</p>
            </div>
            <AlertTriangle className="h-8 w-8 text-red-500" />
          </div>
        </div>
        
        <div className="card p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Total Value</p>
              <p className="text-2xl font-bold text-green-600">${filtered.reduce((sum, r) => sum + (r.qty_inventory * 75), 0).toLocaleString()}</p>
            </div>
            <CheckCircle className="h-8 w-8 text-green-500" />
          </div>
        </div>
        
        <div className="card p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Due to LVA</p>
              <p className="text-2xl font-bold text-orange-600">{filtered.reduce((sum, r) => sum + r.qty_due_lva, 0)}</p>
            </div>
            <Clock className="h-8 w-8 text-orange-500" />
          </div>
        </div>
      </div>

      {/* Inventory Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table min-w-[1100px]">
            <thead>
              <tr className="sticky top-0 bg-gray-50 z-10">
                <th className="w-[220px]">Player</th>
                <th className="w-[160px]">Edition</th>
                <th className="w-[100px]">Size</th>
                <th className="w-[150px]">Inventory</th>
                <th className="w-[150px]">Due to LVA</th>
                <th className="w-[140px]">Status</th>
                <th className="w-[160px]">Last Updated</th>
                <th className="w-[180px]">Updated By</th>
                <th className="w-[220px]">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className={r.qty_inventory <= 1 ? 'bg-red-50' : ''}>
                  <td>
                    <input
                      className="input w-full"
                      value={r.player_name}
                      onChange={(e) => updateField(r, { player_name: e.target.value })}
                    />
                  </td>
                  <td>
                    <select
                      className="input w-full"
                      value={r.edition}
                      onChange={(e) => updateField(r, { edition: e.target.value as JerseyEdition })}
                    >
                      {EDITIONS.map((ed) => (
                        <option key={ed} value={ed}>{ed}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input 
                      className="input w-20" 
                      value={r.size} 
                      onChange={(e) => updateField(r, { size: e.target.value })} 
                    />
                  </td>
                  <td>
                    <Adjuster 
                      value={r.qty_inventory} 
                      onChange={(v) => updateField(r, { qty_inventory: v })} 
                    />
                  </td>
                  <td>
                    <Adjuster 
                      value={r.qty_due_lva} 
                      onChange={(v) => updateField(r, { qty_due_lva: v })} 
                    />
                  </td>
                  <td>
                    <span className={`status-${r.qty_inventory <= 1 ? 'low' : 'normal'}`}>
                      {r.qty_inventory <= 1 ? 'Low Stock' : 'Normal'}
                    </span>
                  </td>
                  <td className="text-sm text-gray-600">
                    <div>{new Date(r.updated_at).toLocaleDateString()}</div>
                    <div className="text-xs text-gray-500">{new Date(r.updated_at).toLocaleTimeString()}</div>
                  </td>
                  <td className="text-sm text-gray-600">
                    {r.updated_by || '-'}
                  </td>
                  <td>
                    <div className="flex items-center gap-2">
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => handleOrderCall(r)}
                        title="Place order call"
                      >
                        <Phone className="h-3 w-3" />
                      </button>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => turnInOne(r)}
                        title="Turn in 1 (dec inv, inc LVA)"
                      >
                        Turn In 1
                      </button>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => sendToLeague(r)}
                        title="Send quantity to league (LVA)"
                      >
                        <Send className="h-3 w-3" />
                      </button>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => handleOptimizeOrder(r)}
                        title="Optimize order quantity"
                      >
                        <CheckCircle className="h-3 w-3" />
                      </button>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={async () => {
                          const fallback = buildReorderEmailDraft({
                            player_name: r.player_name,
                            edition: r.edition,
                            size: r.size,
                            qty_needed: Math.max(1, (5 - r.qty_inventory))
                          });
                          const draft = await buildReorderEmailDraftAI(fallback);
                          navigator.clipboard.writeText(draft);
                          toast.success('Reorder email draft copied to clipboard');
                        }}
                        title="Copy reorder email"
                      >
                        📧
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        
        {filtered.length === 0 && (
          <div className="text-center py-8 text-gray-500">
            No items found matching your criteria
          </div>
        )}
      </div>

      {/* Add Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="card w-full max-w-md p-6">
            <h2 className="text-lg font-semibold mb-4">Add Jersey</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gray-700 mb-1">Player Name</label>
                <input
                  className="input w-full"
                  value={newItem.player_name}
                  onChange={(e) => setNewItem((s) => ({ ...s, player_name: e.target.value }))}
                  placeholder="e.g., Jalen Green"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-700 mb-1">Edition</label>
                <select
                  className="input w-full"
                  value={newItem.edition}
                  onChange={(e) => setNewItem((s) => ({ ...s, edition: e.target.value as JerseyEdition }))}
                >
                  {EDITIONS.map((ed) => (
                    <option key={ed} value={ed}>{ed}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-gray-700 mb-1">Size</label>
                  <input
                    className="input w-full"
                    value={newItem.size}
                    onChange={(e) => setNewItem((s) => ({ ...s, size: e.target.value }))}
                    placeholder="48"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-700 mb-1">Inventory</label>
                  <input
                    type="number"
                    className="input w-full"
                    value={newItem.qty_inventory}
                    onChange={(e) => setNewItem((s) => ({ ...s, qty_inventory: Number(e.target.value) }))}
                    min={0}
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm text-gray-700 mb-1">Due to LVA</label>
                <input
                  type="number"
                  className="input w-full"
                  value={newItem.qty_due_lva}
                  onChange={(e) => setNewItem((s) => ({ ...s, qty_due_lva: Number(e.target.value) }))}
                  min={0}
                />
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button className="btn btn-secondary btn-sm" onClick={() => setShowAddModal(false)} disabled={adding}>Cancel</button>
              <button className="btn btn-primary btn-sm" onClick={submitNewItem} disabled={adding}>
                {adding ? 'Adding...' : 'Add'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


