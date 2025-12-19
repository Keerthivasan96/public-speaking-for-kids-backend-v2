// ============================================
// api/stream.js - GEMINI STREAMING FOR VERCEL
// Works with your existing Vercel environment variables
// ============================================

export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  try {
    const body = await req.json();
    const { prompt, temperature = 0.7, max_tokens = 150 } = body;

    if (!prompt) {
      return new Response(JSON.stringify({ error: 'Prompt required' }), {
        status: 400,
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    // Get API key from Vercel Environment Variables
    const apiKey = process.env.GEMINI_API_KEY;
    
    if (!apiKey) {
      console.error('GEMINI_API_KEY not found in environment variables');
      return new Response(JSON.stringify({ error: 'API key not configured' }), {
        status: 500,
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    // ============================================
    // GEMINI STREAMING API
    // ============================================
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:streamGenerateContent?alt=sse&key=${apiKey}`;

    const geminiResponse = await fetch(geminiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: prompt
              }
            ]
          }
        ],
        generationConfig: {
          temperature: temperature,
          maxOutputTokens: max_tokens,
          topP: 0.95,
          topK: 40,
        },
        safetySettings: [
          {
            category: "HARM_CATEGORY_HARASSMENT",
            threshold: "BLOCK_ONLY_HIGH"
          },
          {
            category: "HARM_CATEGORY_HATE_SPEECH",
            threshold: "BLOCK_ONLY_HIGH"
          },
          {
            category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
            threshold: "BLOCK_ONLY_HIGH"
          },
          {
            category: "HARM_CATEGORY_DANGEROUS_CONTENT",
            threshold: "BLOCK_ONLY_HIGH"
          }
        ]
      }),
    });

    if (!geminiResponse.ok) {
      const errorText = await geminiResponse.text();
      console.error('Gemini API error:', errorText);
      throw new Error(`Gemini API error: ${geminiResponse.status}`);
    }

    // Transform Gemini SSE stream to our simple format
    const transformStream = new TransformStream({
      transform(chunk, controller) {
        const text = new TextDecoder().decode(chunk);
        const lines = text.split('\n').filter(line => line.trim());
        
        for (const line of lines) {
          // Gemini sends: data: {"candidates":[{"content":{"parts":[{"text":"Hello"}]}}]}
          if (line.startsWith('data: ')) {
            const jsonStr = line.slice(6).trim();
            
            if (!jsonStr || jsonStr === '[DONE]') {
              controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
              continue;
            }

            try {
              const parsed = JSON.parse(jsonStr);
              
              // Extract text from Gemini response structure
              const candidates = parsed.candidates;
              if (candidates && candidates[0]) {
                const content = candidates[0].content;
                if (content && content.parts && content.parts[0]) {
                  const token = content.parts[0].text || '';
                  if (token) {
                    // Send in our simple format
                    controller.enqueue(
                      new TextEncoder().encode(`data: ${JSON.stringify({ token })}\n\n`)
                    );
                  }
                }
                
                // Check if this is the last chunk
                if (candidates[0].finishReason === 'STOP') {
                  controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
                }
              }
            } catch (e) {
              // Skip invalid JSON chunks
              console.log('Parse error for chunk:', jsonStr.substring(0, 100));
            }
          }
        }
      },
    });

    const stream = geminiResponse.body.pipeThrough(transformStream);

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'X-Accel-Buffering': 'no',
      },
    });

  } catch (error) {
    console.error('Stream handler error:', error);
    return new Response(JSON.stringify({ 
      error: error.message,
      details: 'Streaming failed, client should fallback to non-streaming API'
    }), {
      status: 500,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }
}