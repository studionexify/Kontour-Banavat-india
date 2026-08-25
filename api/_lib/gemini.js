/* gemini.js — Gemini, wearing the Anthropic Messages API's clothes.
 *
 * readBill() in the app builds one request shape and reads one response
 * shape. Rather than teach it a second dialect — and every error path a
 * second set of field names — the translation happens here, so switching
 * provider in Settings changes a dropdown and nothing else.
 *
 * Only the slice of either API that reading a bill actually uses is
 * covered: one turn, one image, one block of text back.
 */

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/** Anthropic-shaped request → Gemini's generateContent body. */
export function toGemini(body) {
  const parts = [];

  for (const block of (body.messages[0] && body.messages[0].content) || []) {
    if (block.type === 'image' && block.source && block.source.type === 'base64') {
      parts.push({
        inline_data: { mime_type: block.source.media_type, data: block.source.data },
      });
    } else if (block.type === 'text') {
      parts.push({ text: block.text });
    }
  }

  const out = {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      maxOutputTokens: body.max_tokens || 2000,
      // A bill read is extraction, not writing. Left at zero the model
      // stops inventing values it cannot quite make out.
      temperature: 0,
      responseMimeType: 'application/json',
    },
  };

  if (body.system) {
    out.systemInstruction = { parts: [{ text: String(body.system) }] };
  }
  return out;
}

/** Gemini's response → the shape readBill() already parses. */
export function fromGemini(json, model) {
  const candidate = (json.candidates && json.candidates[0]) || null;
  const finish = candidate ? candidate.finishReason : '';

  // Gemini reports a safety stop on the candidate rather than as an
  // error, which is the same event Anthropic calls a refusal.
  const refused = finish === 'SAFETY' || finish === 'PROHIBITED_CONTENT' || json.promptFeedback?.blockReason;

  const text = candidate
    ? ((candidate.content && candidate.content.parts) || [])
        .map((p) => p.text || '')
        .join('')
    : '';

  const usage = json.usageMetadata || {};

  return {
    id: `gemini_${Date.now().toString(36)}`,
    model,
    // MAX_TOKENS is Gemini's name for the cap Anthropic calls max_tokens.
    stop_reason: refused ? 'refusal' : finish === 'MAX_TOKENS' ? 'max_tokens' : 'end_turn',
    stop_details: refused ? { type: 'refusal', category: null, explanation: String(finish || '') } : null,
    content: [{ type: 'text', text }],
    usage: {
      input_tokens: usage.promptTokenCount || 0,
      output_tokens: usage.candidatesTokenCount || 0,
    },
  };
}

/**
 * Runs one bill read against Gemini.
 * Returns { status, json } rather than throwing, so the route can pass a
 * failure back with the same shape it uses for Anthropic.
 */
export async function readWithGemini(body, apiKey) {
  const model = body.model || 'gemini-2.5-flash';
  const url = `${BASE}/${encodeURIComponent(model)}:generateContent`;

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // Header rather than ?key=, so the key stays out of any URL that
        // might be logged by something in between.
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(toGemini(body)),
    });
  } catch {
    return { status: 502, json: { error: 'Could not reach Gemini' } };
  }

  const raw = await res.text();
  let json;
  try {
    json = raw ? JSON.parse(raw) : {};
  } catch {
    return { status: 502, json: { error: 'Gemini sent something unreadable' } };
  }

  if (!res.ok) {
    const message = (json.error && json.error.message) || `Gemini refused the request (${res.status})`;
    // 401/429 are mapped through unchanged: readBill() already turns
    // those into "that key was rejected" and "rate limited".
    return { status: res.status, json: { error: message } };
  }

  return { status: 200, json: fromGemini(json, model) };
}
