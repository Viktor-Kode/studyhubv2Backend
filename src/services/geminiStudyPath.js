import { getEnv } from '../config/env.js';
import { STUDY_PATH_GEMINI_MODEL } from '../config/studyPathConfig.js';

const GEMINI_API_ROOT = 'https://generativelanguage.googleapis.com/v1beta';
const GEMINI_UPLOAD_ROOT = 'https://generativelanguage.googleapis.com/upload/v1beta';

function requireGeminiKey() {
  const key = getEnv('GEMINI_API_KEY');
  if (!key) throw new Error('Study path generation requires GEMINI_API_KEY to be configured on the server.');
  return key;
}

async function readGeminiError(response, action) {
  const body = await response.text().catch(() => '');
  let detail = body;
  try { detail = JSON.parse(body)?.error?.message || body; } catch { /* keep raw body */ }
  throw new Error(`Gemini ${action} failed (${response.status}): ${String(detail).slice(0, 700)}`);
}

export async function uploadGeminiPdf(buffer, displayName) {
  const key = requireGeminiKey();
  const start = await fetch(`${GEMINI_UPLOAD_ROOT}/files`, {
    method: 'POST',
    headers: {
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(buffer.length),
      'X-Goog-Upload-Header-Content-Type': 'application/pdf',
      'X-Goog-Api-Key': key,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ file: { display_name: displayName } }),
    signal: AbortSignal.timeout(60_000)
  });
  if (!start.ok) return readGeminiError(start, 'file upload initialization');
  const uploadUrl = start.headers.get('x-goog-upload-url');
  if (!uploadUrl) throw new Error('Gemini did not return a resumable upload URL for the PDF.');

  const uploaded = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Content-Length': String(buffer.length),
      'X-Goog-Upload-Offset': '0',
      'X-Goog-Upload-Command': 'upload, finalize'
    },
    body: buffer,
    signal: AbortSignal.timeout(180_000)
  });
  if (!uploaded.ok) return readGeminiError(uploaded, 'PDF upload');
  let file = await uploaded.json();
  if (!file?.uri || !file?.name) throw new Error('Gemini finished the PDF upload without returning a usable file.');
  const deadline = Date.now() + 90_000;
  while (file.state && file.state !== 'ACTIVE' && Date.now() < deadline) {
    if (file.state === 'FAILED') throw new Error(`Gemini could not process PDF ${displayName}.`);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const status = await fetch(`${GEMINI_API_ROOT}/${file.name}`, { headers: { 'X-Goog-Api-Key': key }, signal: AbortSignal.timeout(20_000) });
    if (!status.ok) return readGeminiError(status, 'file processing check');
    file = await status.json();
  }
  if (file.state && file.state !== 'ACTIVE') throw new Error(`Timed out waiting for Gemini to process ${displayName}.`);
  return file;
}

export async function deleteGeminiFile(fileName) {
  if (!fileName) return;
  const key = requireGeminiKey();
  await fetch(`${GEMINI_API_ROOT}/${fileName}`, {
    method: 'DELETE',
    headers: { 'X-Goog-Api-Key': key },
    signal: AbortSignal.timeout(20_000)
  }).catch(() => {});
}

function toGeminiSchema(schema) {
  if (!schema || typeof schema !== 'object') return undefined;
  const result = {};
  if (schema.type) result.type = String(schema.type).toUpperCase();
  if (schema.description) result.description = schema.description;
  if (schema.required) result.required = schema.required;
  if (schema.enum) result.enum = schema.enum;
  if (schema.format) result.format = schema.format;
  if (schema.properties) {
    result.properties = Object.fromEntries(Object.entries(schema.properties).map(([key, value]) => [key, toGeminiSchema(value)]));
  }
  if (schema.items) result.items = toGeminiSchema(schema.items);
  return result;
}

export async function generateGeminiJson({ prompt, file, schema, model = STUDY_PATH_GEMINI_MODEL }) {
  const key = requireGeminiKey();
  const contents = [{ role: 'user', parts: [
    { text: prompt },
    ...(file?.uri ? [{ file_data: { mime_type: 'application/pdf', file_uri: file.uri } }] : [])
  ] }];
  const generationConfig = { responseMimeType: 'application/json', temperature: 0.2, maxOutputTokens: 8192 };
  if (schema) generationConfig.responseSchema = toGeminiSchema(schema);
  const response = await fetch(`${GEMINI_API_ROOT}/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key },
    body: JSON.stringify({ contents, generationConfig }),
    signal: AbortSignal.timeout(180_000)
  });
  if (!response.ok) return readGeminiError(response, 'content generation');
  const payload = await response.json();
  const text = payload?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('').trim();
  if (!text) throw new Error('Gemini returned an empty study path response.');
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try { return JSON.parse(cleaned); }
  catch { throw new Error('Gemini returned invalid JSON for the study path.'); }
}

export function getStudyPathNodeGeminiSchema(studyPathResponseSchema) {
  const node = structuredClone(studyPathResponseSchema?.properties?.nodes?.items);
  if (!node) throw new Error('Study path node schema is unavailable.');
  node.properties.unit = { type: 'string', description: 'The unit title from the outline.' };
  return {
    type: 'OBJECT',
    required: ['node'],
    properties: { node }
  };
}
