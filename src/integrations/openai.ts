export function buildReorderEmailDraft(input: {
  player_name: string;
  edition: string;
  size: string;
  qty_needed: number;
}) {
  const body = `Subject: Jersey Reorder Request - ${input.player_name} ${input.edition} ${input.size}

Hi Team,

We are at or below threshold for the following item and request reorder:

- Player: ${input.player_name}
- Edition: ${input.edition}
- Size: ${input.size}
- Quantity requested: ${input.qty_needed}

Please advise on lead time and confirm order.

Thanks,
Equipment Team`;
  return body;
}

// Optional: placeholder for OpenAI call if credits are configured
export async function buildReorderEmailDraftAI(
  fallback: ReturnType<typeof buildReorderEmailDraft>,
) {
  const key = import.meta.env.VITE_OPENAI_API_KEY as string | undefined;
  if (!key) return fallback;
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You write concise, professional reorder emails for sports equipment.'
          },
          { role: 'user', content: fallback },
        ],
        temperature: 0.2,
      }),
    });
    if (!res.ok) return fallback;
    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || fallback;
  } catch {
    return fallback;
  }
}


