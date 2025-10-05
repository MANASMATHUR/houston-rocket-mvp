export async function interpretVoiceCommand(transcript: string): Promise<
  | { type: 'adjust'; player_name: string; edition: string; qty_inventory_delta?: number; qty_due_lva_delta?: number; size?: string }
  | { type: 'unknown' }
> {
  const apiUrl = import.meta.env.VITE_VOICEFLOW_API_URL as string | undefined;
  const apiKey = import.meta.env.VITE_VOICEFLOW_API_KEY as string | undefined;
  if (!apiUrl || !apiKey) return { type: 'unknown' };
  try {
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ transcript }),
    });
    if (!res.ok) return { type: 'unknown' };
    return (await res.json()) as any;
  } catch {
    return { type: 'unknown' };
  }
}


