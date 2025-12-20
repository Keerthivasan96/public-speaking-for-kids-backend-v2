// ============================================
// api/generate.js - FIXED FOR PROPER RESPONSES
// Gemini 2.5 Flash with correct token settings
// ============================================

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method === "GET") {
    return res.json({
      ok: true,
      endpoint: "generate",
      model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
      status: "ready"
    });
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

  // IMPORTANT: Use higher token count from request, minimum 500
  const requestedTokens = req.body?.max_tokens || 500;
  const maxTokens = Math.max(500, requestedTokens); // Never less than 500
  const temperature = req.body?.temperature ?? 0.8;

  console.log(`📥 Request: "${prompt.substring(0, 60)}..." | Tokens: ${maxTokens}`);

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ 
          parts: [{ text: prompt }],
          role: "user"
        }],
        generationConfig: {
          temperature: temperature,
          maxOutputTokens: maxTokens,
          topP: 0.95,
          topK: 40,
          // These help prevent truncation
          stopSequences: [],
        },
        safetySettings: [
          { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" },
          { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
          { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_ONLY_HIGH" },
          { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" },
        ],
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("❌ Gemini error:", response.status, data);
      return res.status(502).json({ 
        ok: false, 
        error: "Gemini API error",
        details: data?.error?.message || data
      });
    }

    // Extract full response
    const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    const finishReason = data?.candidates?.[0]?.finishReason;

    if (!reply) {
      console.error("❌ No reply in response:", JSON.stringify(data).substring(0, 200));
      return res.status(502).json({ ok: false, error: "No response from Gemini" });
    }

    // Log finish reason for debugging
    console.log(`✅ Reply (${reply.length} chars, finish: ${finishReason}): "${reply.substring(0, 80)}..."`);

    // Warn if truncated
    if (finishReason === "MAX_TOKENS") {
      console.warn("⚠️ Response was truncated due to max tokens!");
    }

    return res.json({ ok: true, reply: reply.trim() });

  } catch (err) {
    console.error("❌ Error:", err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}