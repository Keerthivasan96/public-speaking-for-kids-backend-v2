// ============================================
// api/stream.js - STREAMING ENDPOINT
// Gemini 2.5 Flash with SSE
// ============================================

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  
  if (req.method === "GET") {
    return res.json({ ok: true, endpoint: "stream", status: "ready" });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }

  const prompt = req.body?.prompt;
  if (!prompt) {
    return res.status(400).json({ error: "Missing prompt" });
  }

  const GEMINI_KEY = process.env.GEMINI_API_KEY;
  const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

  if (!GEMINI_KEY) {
    return res.status(500).json({ error: "API key not configured" });
  }

  const maxTokens = Math.max(500, req.body?.max_tokens || 600);
  const temperature = req.body?.temperature ?? 0.85;

  // Set SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:streamGenerateContent?alt=sse&key=${GEMINI_KEY}`;

    console.log(`🚀 Stream: ${prompt.substring(0, 50)}...`);

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }], role: "user" }],
        generationConfig: {
          temperature,
          maxOutputTokens: maxTokens,
          topP: 0.95,
          topK: 40,
        },
        safetySettings: [
          { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" },
          { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
          { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_ONLY_HIGH" },
          { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" },
        ],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error("❌ Gemini error:", response.status, err);
      res.write(`data: ${JSON.stringify({ error: "API error" })}\n\n`);
      res.write("data: [DONE]\n\n");
      return res.end();
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        
        const json = line.slice(6).trim();
        if (!json) continue;

        try {
          const parsed = JSON.parse(json);
          const token = parsed?.candidates?.[0]?.content?.parts?.[0]?.text || "";
          
          if (token) {
            res.write(`data: ${JSON.stringify({ token })}\n\n`);
          }

          if (parsed?.candidates?.[0]?.finishReason) {
            res.write("data: [DONE]\n\n");
          }
        } catch (e) {}
      }
    }

    res.write("data: [DONE]\n\n");
    res.end();
    console.log("✅ Stream complete");

  } catch (err) {
    console.error("❌ Stream error:", err.message);
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.write("data: [DONE]\n\n");
    res.end();
  }
}