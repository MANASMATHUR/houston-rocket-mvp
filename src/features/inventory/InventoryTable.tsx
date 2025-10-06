import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import type { JerseyItem, JerseyEdition } from '../../types';
import { Adjuster } from '../../components/Adjuster';
import { notifyLowStock } from '../../integrations/make';
import { buildReorderEmailDraft, buildReorderEmailDraftAI, optimizeOrderQuantity } from '../../integrations/openai';
import { VoiceMic } from './VoiceMic';
import { initiateOrderCall } from '../../integrations/voiceflow';
import { Search, Plus, Phone, Download, Filter, AlertTriangle, CheckCircle, Clock, Package } from 'lucide-react';
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

  const handleOrderCall = async (row: Row) => {
    try {
      toast.loading('Initiating order call...', { id: 'order-call' });
      await initiateOrderCall(row.player_name, row.edition, row.size, Math.max(1, 5 - row.qty_inventory));
      toast.success('Order call initiated successfully', { id: 'order-call' });
    } catch (error) {
      toast.error('Failed to initiate order call', { id: 'order-call' });
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
          <button
            onClick={addRow}
            className="btn btn-primary btn-sm"
          >
            <Plus className="h-4 w-4" />
            Add Jersey
          </button>
        </div>
      </div>

      {/* Filters and Search */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
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

      {/* Stats Summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Total Items</p>
              <p className="text-2xl font-bold text-gray-900">{filtered.length}</p>
            </div>
            <Package className="h-8 w-8 text-blue-500" />
          </div>
        </div>
        
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Low Stock</p>
              <p className="text-2xl font-bold text-red-600">{filtered.filter(r => r.qty_inventory <= 1).length}</p>
            </div>
            <AlertTriangle className="h-8 w-8 text-red-500" />
          </div>
        </div>
        
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Total Value</p>
              <p className="text-2xl font-bold text-green-600">${filtered.reduce((sum, r) => sum + (r.qty_inventory * 75), 0).toLocaleString()}</p>
            </div>
            <CheckCircle className="h-8 w-8 text-green-500" />
          </div>
        </div>
        
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
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
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Player</th>
                <th>Edition</th>
                <th>Size</th>
                <th>Inventory</th>
                <th>Due to LVA</th>
                <th>Status</th>
                <th>Last Updated</th>
                <th>Actions</th>
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
    </div>
  );
}


