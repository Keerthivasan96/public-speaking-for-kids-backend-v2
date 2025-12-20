// ============================================
// api/generate.js - IMPROVED NON-STREAMING
// Optimized for complete, quality responses
// ============================================

export default async function handler(req, res) {
  // ============================================
  // CORS HEADERS
  // ============================================
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Credentials", "true");

  // Handle preflight OPTIONS request
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // Health check endpoint
  if (req.method === "GET") {
    return res.json({
      ok: true,
      endpoint: "generate",
      message: "Luna AI - Non-streaming Endpoint",
      model: process.env.GEMINI_MODEL || "gemini-2.0-flash-exp",
      timestamp: new Date().toISOString(),
    });
  }

  // Only allow POST for generation
  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      error: "Method not allowed. Use POST.",
    });
  }

  // ============================================
  // EXTRACT PARAMETERS FROM REQUEST
  // ============================================
  const prompt = req.body?.prompt ?? req.body?.text ?? req.body?.message;

  if (!prompt || typeof prompt !== "string") {
    return res.status(400).json({
      ok: false,
      error: "Missing 'prompt' in request body.",
      usage: {
        method: "POST",
        body: { prompt: "Your message here" },
      },
    });
  }

  // Optional parameters with defaults
  const temperature = req.body?.temperature ?? 0.8;
  const maxTokens = req.body?.max_tokens ?? 300;

  console.log(`📥 Generate request: "${prompt.substring(0, 50)}..."`);
  console.log(`⚙️ Config: temp=${temperature}, max_tokens=${maxTokens}`);

  // ============================================
  // CHECK API KEY
  // ============================================
  const GEMINI_KEY = process.env.GEMINI_API_KEY;
  const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash-exp";

  if (!GEMINI_KEY) {
    console.error("❌ GEMINI_API_KEY not configured");
    return res.status(500).json({
      ok: false,
      error: "GEMINI_API_KEY not configured",
      hint: "Set GEMINI_API_KEY in Vercel environment variables",
    });
  }

  // ============================================
  // GEMINI API CALL
  // ============================================
  const GEMINI_BASE_URL = process.env.GEMINI_API_URL || "https://generativelanguage.googleapis.com/v1beta";
  const generateUrl = `${GEMINI_BASE_URL}/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${GEMINI_KEY}`;

  try {
    console.log(`🚀 Calling ${GEMINI_MODEL}...`);

    const requestBody = {
      contents: [
        {
          parts: [{ text: prompt }],
          role: "user",
        },
      ],
      generationConfig: {
        temperature: temperature,
        maxOutputTokens: maxTokens,
        topP: 0.95,
        topK: 40,
        stopSequences: [], // Don't stop early
      },
      safetySettings: [
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" },
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_ONLY_HIGH" },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" },
      ],
    };

    const geminiResponse = await fetch(generateUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    // ============================================
    // HANDLE API ERRORS
    // ============================================
    if (!geminiResponse.ok) {
      const errorText = await geminiResponse.text().catch(() => "Unknown error");
      console.error("❌ Gemini API error:", geminiResponse.status, errorText);

      return res.status(geminiResponse.status).json({
        ok: false,
        error: `Gemini API error: ${geminiResponse.status}`,
        details: errorText,
      });
    }

    // ============================================
    // PARSE RESPONSE
    // ============================================
    const data = await geminiResponse.json();

    // Extract text from Gemini response structure
    const candidates = data?.candidates;
    
    if (!candidates || candidates.length === 0) {
      console.error("❌ No candidates in response:", JSON.stringify(data));
      return res.status(500).json({
        ok: false,
        error: "No response candidates from Gemini",
        rawResponse: data,
      });
    }

    const content = candidates[0]?.content;
    const parts = content?.parts;
    
    if (!parts || parts.length === 0) {
      console.error("❌ No parts in content:", JSON.stringify(content));
      return res.status(500).json({
        ok: false,
        error: "No content parts in Gemini response",
        rawResponse: data,
      });
    }

    const reply = parts[0]?.text || "";
    
    if (!reply || reply.trim().length === 0) {
      console.error("❌ Empty reply from Gemini");
      return res.status(500).json({
        ok: false,
        error: "Empty response from Gemini",
        rawResponse: data,
      });
    }

    // Check for safety blocks
    const finishReason = candidates[0]?.finishReason;
    if (finishReason === "SAFETY") {
      console.warn("⚠️ Response blocked by safety filters");
      return res.status(400).json({
        ok: false,
        error: "Response blocked by safety filters",
        finishReason: "SAFETY",
      });
    }

    // Log response details
    const wordCount = reply.trim().split(/\s+/).length;
    console.log(`✅ Response: ${wordCount} words, finish: ${finishReason}`);
    console.log(`📝 Reply preview: "${reply.substring(0, 80)}..."`);

    // Warn if response is too short
    if (wordCount < 20) {
      console.warn(`⚠️ WARNING: Short response (${wordCount} words)`);
    }

    // ============================================
    // RETURN SUCCESS RESPONSE
    // ============================================
    return res.json({
      ok: true,
      reply: reply.trim(),
      metadata: {
        model: GEMINI_MODEL,
        wordCount: wordCount,
        finishReason: finishReason,
        promptTokens: data.usageMetadata?.promptTokenCount || 0,
        responseTokens: data.usageMetadata?.candidatesTokenCount || 0,
        totalTokens: data.usageMetadata?.totalTokenCount || 0,
      },
    });

  } catch (error) {
    console.error("❌ Handler error:", error.message);
    console.error(error.stack);

    return res.status(500).json({
      ok: false,
      error: "Internal server error",
      message: error.message,
    });
  }
}