// ============================================
// api/stream.js - STREAMING ENDPOINT FOR VERCEL
// 
// ADD THIS FILE TO YOUR BACKEND:
// public-speaking-for-kids-backend-v2/api/stream.js
// ============================================

export default async function handler(req, res) {
  // Handle CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { prompt, temperature = 0.7, max_tokens = 150 } = req.body || {};

  if (!prompt) {
    return res.status(400).json({ error: "Prompt required" });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  
  if (!apiKey) {
    console.error("GEMINI_API_KEY not found in env");
    return res.status(500).json({ error: "API key not configured" });
  }

  // Set SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  try {
    // Use gemini-1.5-flash (stable, fast model)
    const model = process.env.GEMINI_MODEL || "gemini-1.5-flash";
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`;

    console.log(`🚀 Streaming request to ${model}...`);

    const geminiResponse = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature,
          maxOutputTokens: max_tokens,
          topP: 0.95,
          topK: 40,
        },
        safetySettings: [
          { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" },
          { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
          { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_ONLY_HIGH" },
          { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" }
        ]
      }),
    });

    if (!geminiResponse.ok) {
      const errorText = await geminiResponse.text();
      console.error("Gemini API error:", geminiResponse.status, errorText);
      res.write(`data: ${JSON.stringify({ error: "Gemini error: " + geminiResponse.status })}\n\n`);
      res.write("data: [DONE]\n\n");
      return res.end();
    }

    // Process the SSE stream from Gemini
    const reader = geminiResponse.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      
      // Process complete lines only
      const lines = buffer.split("\n");
      buffer = lines.pop() || ""; // Keep incomplete line in buffer

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) continue;
        
        const jsonStr = trimmed.slice(6).trim();
        if (!jsonStr) continue;

        try {
          const parsed = JSON.parse(jsonStr);
          const candidates = parsed.candidates;
          
          if (candidates && candidates[0]) {
            const content = candidates[0].content;
            const token = content?.parts?.[0]?.text || "";
            
            if (token) {
              // Send token to client in our simple format
              res.write(`data: ${JSON.stringify({ token })}\n\n`);
            }
            
            // Check if generation is complete
            if (candidates[0].finishReason === "STOP") {
              res.write("data: [DONE]\n\n");
            }
          }
        } catch (parseError) {
          // Skip invalid JSON - this is normal for SSE
        }
      }
    }

    // Send final DONE signal
    res.write("data: [DONE]\n\n");
    res.end();
    console.log("✅ Streaming complete");

  } catch (error) {
    console.error("❌ Stream handler error:", error.message);
    res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    res.write("data: [DONE]\n\n");
    res.end();
  }
}