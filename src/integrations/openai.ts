import { supabase } from '../lib/supabaseClient';

export interface InventoryAnalysis {
  recommendations: string[];
  riskAssessment: 'low' | 'medium' | 'high';
  suggestedActions: string[];
  predictedShortages: Array<{
    player_name: string;
    edition: string;
    size: string;
    daysUntilShortage: number;
    confidence: number;
  }>;
}

export interface OrderOptimization {
  suggestedQuantity: number;
  reasoning: string;
  alternatives: Array<{
    quantity: number;
    pros: string[];
    cons: string[];
  }>;
  costEstimate: number;
}

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
            content: 'You write concise, professional reorder emails for sports equipment. Include urgency indicators and specific details.'
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

export async function analyzeInventory(): Promise<InventoryAnalysis> {
  const key = import.meta.env.VITE_OPENAI_API_KEY as string | undefined;
  if (!key) {
    return getDefaultAnalysis();
  }

  try {
    // Get current inventory data
    const { data: jerseys } = await supabase
      .from('jerseys')
      .select('*');
    
    await supabase
      .from('activity_logs')
      .select('*')
      .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()); // Last 30 days

    if (!jerseys) {
      return getDefaultAnalysis();
    }

    const inventorySummary = jerseys.map(j => ({
      player: j.player_name,
      edition: j.edition,
      size: j.size,
      current_stock: j.qty_inventory,
      due_to_lva: j.qty_due_lva,
      last_updated: j.updated_at,
    }));

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
            content: `You are an inventory management AI for a professional basketball team. Analyze inventory data and provide insights on:
            1. Risk assessment (low/medium/high)
            2. Recommendations for inventory management
            3. Suggested actions to prevent stockouts
            4. Predictions for potential shortages
            
            Consider factors like:
            - Current stock levels
            - Historical usage patterns
            - Season timing
            - Player popularity
            - Edition types
            
            Respond with a JSON object containing: recommendations (array), riskAssessment (string), suggestedActions (array), predictedShortages (array of objects with player_name, edition, size, daysUntilShortage, confidence).`
          },
          {
            role: 'user',
            content: `Analyze this inventory data: ${JSON.stringify(inventorySummary)}`
          },
        ],
        temperature: 0.3,
      }),
    });

    if (!res.ok) {
      return getDefaultAnalysis();
    }

    const data = await res.json();
    const analysisText = data.choices?.[0]?.message?.content?.trim();
    
    try {
      return JSON.parse(analysisText);
    } catch {
      // If JSON parsing fails, return default analysis
      return getDefaultAnalysis();
    }
  } catch (error) {
    console.error('OpenAI analysis error:', error);
    return getDefaultAnalysis();
  }
}

function getDefaultAnalysis(): InventoryAnalysis {
  return {
    recommendations: [
      'Monitor low stock items daily',
      'Set up automated reorder alerts',
      'Consider bulk ordering for popular items',
    ],
    riskAssessment: 'medium',
    suggestedActions: [
      'Review inventory levels weekly',
      'Contact suppliers for lead times',
      'Implement safety stock levels',
    ],
    predictedShortages: [],
  };
}

export async function optimizeOrderQuantity(
  playerName: string,
  edition: string,
  size: string,
  currentStock: number
): Promise<OrderOptimization> {
  const key = import.meta.env.VITE_OPENAI_API_KEY as string | undefined;
  if (!key) {
    return getDefaultOrderOptimization();
  }

  try {
    // Get historical data for this specific jersey
    await supabase
      .from('activity_logs')
      .select('*')
      .gte('created_at', new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()) // Last 90 days
      .contains('details', { player_name: playerName });

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
            content: `You are an inventory optimization AI. Given jersey details and current stock, suggest optimal order quantities considering:
            1. Current stock level
            2. Historical usage patterns
            3. Season timing
            4. Lead times
            5. Storage constraints
            6. Cost considerations
            
            Respond with a JSON object containing: suggestedQuantity (number), reasoning (string), alternatives (array of objects with quantity, pros, cons), costEstimate (number).`
          },
          {
            role: 'user',
            content: `Optimize order for: Player: ${playerName}, Edition: ${edition}, Size: ${size}, Current Stock: ${currentStock}`
          },
        ],
        temperature: 0.2,
      }),
    });

    if (!res.ok) {
      return getDefaultOrderOptimization();
    }

    const data = await res.json();
    const optimizationText = data.choices?.[0]?.message?.content?.trim();
    
    try {
      return JSON.parse(optimizationText);
    } catch {
      return getDefaultOrderOptimization();
    }
  } catch (error) {
    console.error('OpenAI optimization error:', error);
    return getDefaultOrderOptimization();
  }
}

function getDefaultOrderOptimization(): OrderOptimization {
  return {
    suggestedQuantity: 5,
    reasoning: 'Standard reorder quantity based on typical usage patterns',
    alternatives: [
      {
        quantity: 3,
        pros: ['Lower upfront cost', 'Less storage space needed'],
        cons: ['May need more frequent reorders', 'Higher per-unit cost'],
      },
      {
        quantity: 10,
        pros: ['Better bulk pricing', 'Fewer reorders needed'],
        cons: ['Higher upfront cost', 'More storage space required'],
      },
    ],
    costEstimate: 375, // Assuming $75 per jersey
  };
}

export async function generateInventoryReport(): Promise<string> {
  const key = import.meta.env.VITE_OPENAI_API_KEY as string | undefined;
  if (!key) {
    return generateDefaultReport();
  }

  try {
    const { data: jerseys } = await supabase
      .from('jerseys')
      .select('*');
    
    const { data: callLogs } = await supabase
      .from('call_logs')
      .select('*')
      .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());

    if (!jerseys) {
      return generateDefaultReport();
    }

    const reportData = {
      totalJerseys: jerseys.length,
      lowStockItems: jerseys.filter(j => j.qty_inventory <= 1).length,
      totalValue: jerseys.reduce((sum, j) => sum + (j.qty_inventory * 75), 0),
      recentOrders: callLogs?.length || 0,
      editionBreakdown: jerseys.reduce((acc, j) => {
        acc[j.edition] = (acc[j.edition] || 0) + 1;
        return acc;
      }, {} as Record<string, number>),
    };

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
            content: 'You are a professional inventory management analyst. Generate a comprehensive monthly inventory report with insights, trends, and recommendations. Format as a professional business report.'
          },
          {
            role: 'user',
            content: `Generate a report for this data: ${JSON.stringify(reportData)}`
          },
        ],
        temperature: 0.3,
      }),
    });

    if (!res.ok) {
      return generateDefaultReport();
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || generateDefaultReport();
  } catch (error) {
    console.error('OpenAI report generation error:', error);
    return generateDefaultReport();
  }
}

function generateDefaultReport(): string {
  return `# Monthly Inventory Report

## Summary
- Total jerseys in inventory: [Data not available]
- Low stock items: [Data not available]
- Total inventory value: [Data not available]

## Recommendations
1. Review low stock items and place reorders
2. Analyze usage patterns to optimize stock levels
3. Consider seasonal variations in demand

## Next Steps
- Schedule weekly inventory reviews
- Set up automated reorder alerts
- Monitor supplier lead times
`;
}

export async function suggestInventoryImprovements(): Promise<string[]> {
  const key = import.meta.env.VITE_OPENAI_API_KEY as string | undefined;
  if (!key) {
    return [
      'Implement automated reorder alerts',
      'Set up inventory tracking dashboards',
      'Create supplier relationship management system',
      'Develop demand forecasting models',
    ];
  }

  try {
    const { data: jerseys } = await supabase
      .from('jerseys')
      .select('*');

    if (!jerseys) {
      return [
        'Implement automated reorder alerts',
        'Set up inventory tracking dashboards',
        'Create supplier relationship management system',
        'Develop demand forecasting models',
      ];
    }

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
            content: 'You are an inventory management consultant. Suggest specific, actionable improvements for inventory management systems. Focus on automation, efficiency, and cost reduction.'
          },
          {
            role: 'user',
            content: `Suggest improvements for an inventory system with ${jerseys.length} jersey items. Current challenges include manual tracking and reorder processes.`
          },
        ],
        temperature: 0.4,
      }),
    });

    if (!res.ok) {
      return [
        'Implement automated reorder alerts',
        'Set up inventory tracking dashboards',
        'Create supplier relationship management system',
        'Develop demand forecasting models',
      ];
    }

    const data = await res.json();
    const suggestionsText = data.choices?.[0]?.message?.content?.trim();
    
    // Extract suggestions from the response
    const suggestions = suggestionsText
      .split('\n')
      .filter((line: string) => line.trim().length > 0)
      .map((line: string) => line.replace(/^\d+\.\s*/, '').replace(/^[-*]\s*/, '').trim())
      .filter((line: string) => line.length > 10);
    
    return suggestions.length > 0 ? suggestions : [
      'Implement automated reorder alerts',
      'Set up inventory tracking dashboards',
      'Create supplier relationship management system',
      'Develop demand forecasting models',
    ];
  } catch (error) {
    console.error('OpenAI suggestions error:', error);
    return [
      'Implement automated reorder alerts',
      'Set up inventory tracking dashboards',
      'Create supplier relationship management system',
      'Develop demand forecasting models',
    ];
  }
}


