import { supabase } from '../lib/supabaseClient';

export interface VoiceCommandResult {
  type: 'adjust' | 'order' | 'unknown';
  player_name?: string;
  edition?: string;
  qty_inventory_delta?: number;
  qty_due_lva_delta?: number;
  size?: string;
  order_quantity?: number;
  order_details?: {
    supplier?: string;
    priority?: 'high' | 'medium' | 'low';
    notes?: string;
  };
}

export interface CallLog {
  id: string;
  player_name: string;
  edition: string;
  size: string;
  status: 'initiated' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
  created_at?: string;
  duration_seconds?: number;
  voiceflow_session_id?: string;
  transcript?: string;
  order_placed: boolean;
  order_details?: any;
  error_message?: string;
  initiated_by?: string;
}

export async function interpretVoiceCommand(transcript: string): Promise<VoiceCommandResult> {
  const apiUrl = import.meta.env.VITE_VOICEFLOW_API_URL as string | undefined;
  const apiKey = import.meta.env.VITE_VOICEFLOW_API_KEY as string | undefined;
  
  if (!apiUrl || !apiKey) {
    // Fallback to local interpretation if Voiceflow is not configured
    return interpretVoiceCommandLocal(transcript);
  }

  try {
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ 
        transcript,
        context: {
          timestamp: new Date().toISOString(),
          user_agent: navigator.userAgent,
        }
      }),
    });
    
    if (!res.ok) {
      console.warn('Voiceflow API failed, falling back to local interpretation');
      return interpretVoiceCommandLocal(transcript);
    }
    
    const result = await res.json();
    return result as VoiceCommandResult;
  } catch (error) {
    console.error('Voiceflow API error:', error);
    return interpretVoiceCommandLocal(transcript);
  }
}

export function interpretVoiceCommandLocal(transcript: string): VoiceCommandResult {
  const lowerTranscript = transcript.toLowerCase();
  
  // Check for order commands
  if (lowerTranscript.includes('order') || lowerTranscript.includes('reorder') || lowerTranscript.includes('buy')) {
    const playerMatch = lowerTranscript.match(/(?:order|reorder|buy)\s+(\w+)/);
    const editionMatch = lowerTranscript.match(/(icon|statement|association|city)/);
    const sizeMatch = lowerTranscript.match(/size\s+(\d+)/);
    const qtyMatch = lowerTranscript.match(/(\d+)\s*(?:jerseys?|pieces?)/);
    
    return {
      type: 'order',
      player_name: playerMatch?.[1] || '',
      edition: editionMatch?.[1] || 'Icon',
      size: sizeMatch?.[1] || '48',
      order_quantity: parseInt(qtyMatch?.[1] || '1'),
      order_details: {
        priority: lowerTranscript.includes('urgent') || lowerTranscript.includes('asap') ? 'high' : 'medium',
        notes: transcript,
      }
    };
  }
  
  // Check for inventory adjustment commands
  if (lowerTranscript.includes('add') || lowerTranscript.includes('subtract') || lowerTranscript.includes('set')) {
    const playerMatch = lowerTranscript.match(/(?:add|subtract|set)\s+(\w+)/);
    const editionMatch = lowerTranscript.match(/(icon|statement|association|city)/);
    const sizeMatch = lowerTranscript.match(/size\s+(\d+)/);
    const qtyMatch = lowerTranscript.match(/(\d+)/);
    
    let delta = 0;
    if (lowerTranscript.includes('add') || lowerTranscript.includes('plus')) {
      delta = parseInt(qtyMatch?.[1] || '1');
    } else if (lowerTranscript.includes('subtract') || lowerTranscript.includes('minus')) {
      delta = -parseInt(qtyMatch?.[1] || '1');
    }
    
    return {
      type: 'adjust',
      player_name: playerMatch?.[1] || '',
      edition: editionMatch?.[1] || 'Icon',
      size: sizeMatch?.[1] || '48',
      qty_inventory_delta: delta,
    };
  }
  
  return { type: 'unknown' };
}

export async function initiateOrderCall(
  playerName: string,
  edition: string,
  size: string,
  quantity: number = 1
): Promise<CallLog> {
  const { data: userRes } = await supabase.auth.getUser();
  const initiatedBy = userRes.user?.email || 'system';
  
  // Create call log entry
  const { data: callLog, error } = await supabase
    .from('call_logs')
    .insert({
      player_name: playerName,
      edition: edition,
      size: size,
      status: 'initiated',
      initiated_by: initiatedBy,
      order_details: {
        quantity: quantity,
        timestamp: new Date().toISOString(),
      }
    })
    .select()
    .single();
    
  if (error) {
    throw new Error(`Failed to create call log: ${error.message}`);
  }
  
  // Start the actual call process
  try {
    await startVoiceflowCall(callLog.id, playerName, edition, size, quantity);
  } catch (error) {
    // Update call log with error
    await supabase
      .from('call_logs')
      .update({
        status: 'failed',
        error_message: error instanceof Error ? error.message : 'Unknown error',
      })
      .eq('id', callLog.id);
    
    throw error;
  }
  
  return callLog;
}

async function startVoiceflowCall(
  callLogId: string,
  playerName: string,
  edition: string,
  size: string,
  quantity: number
): Promise<void> {
  // Update status to in_progress
  await supabase
    .from('call_logs')
    .update({ status: 'in_progress' })
    .eq('id', callLogId);
  
  try {
    // Call our secure serverless proxy which holds the secret
    const response = await fetch('/api/start-call', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        call_log_id: callLogId,
        order_details: {
          player_name: playerName,
          edition: edition,
          size: size,
          quantity: quantity,
        },
      }),
    });
    
    if (!response.ok) {
      throw new Error(`Voiceflow call API failed: ${response.statusText}`);
    }
    
    const result = await response.json();
    
    // Update call log with session ID
    await supabase
      .from('call_logs')
      .update({
        voiceflow_session_id: result.session_id,
        transcript: result.transcript,
      })
      .eq('id', callLogId);
      
  } catch (error) {
    // Update call log with error
    await supabase
      .from('call_logs')
      .update({
        status: 'failed',
        error_message: error instanceof Error ? error.message : 'Unknown error',
      })
      .eq('id', callLogId);
    
    throw error;
  }
}

export async function updateCallStatus(
  callLogId: string,
  status: CallLog['status'],
  additionalData?: Partial<CallLog>
): Promise<void> {
  const updateData: any = { status };
  
  if (additionalData) {
    Object.assign(updateData, additionalData);
  }
  
  const { error } = await supabase
    .from('call_logs')
    .update(updateData)
    .eq('id', callLogId);
    
  if (error) {
    throw new Error(`Failed to update call status: ${error.message}`);
  }
}

export async function getCallLogs(limit: number = 50): Promise<CallLog[]> {
  const { data, error } = await supabase
    .from('call_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
    
  if (error) {
    throw new Error(`Failed to fetch call logs: ${error.message}`);
  }
  
  return data || [];
}

export async function getCallLogById(callLogId: string): Promise<CallLog | null> {
  const { data, error } = await supabase
    .from('call_logs')
    .select('*')
    .eq('id', callLogId)
    .single();
    
  if (error) {
    if (error.code === 'PGRST116') {
      return null; // Not found
    }
    throw new Error(`Failed to fetch call log: ${error.message}`);
  }
  
  return data;
}


