import {
  DOMAIN_DISCIPLINES,
  DOCUMENT_TYPES,
  COGNITIVE_DENSITIES,
  DISCIPLINE_KEYWORDS,
  COURSE_CODE_REGEX
} from '../config/domainTaxonomy.js';
import aiClient from '../utils/aiClient.js';
import { getEnv } from '../config/env.js';

/**
 * Heuristic classifier: scores text against discipline keywords and course codes.
 */
function heuristicClassify({ title = '', textSample = '', visualRatio = 0 }) {
  const combined = `${title} ${textSample}`.toLowerCase();
  const scores = {};

  // 1. Check Course Code Regex
  for (const [discipline, regex] of Object.entries(COURSE_CODE_REGEX)) {
    if (regex.test(combined)) {
      scores[discipline] = (scores[discipline] || 0) + 5;
    }
  }

  // 2. Count Keyword Occurrences
  for (const [discipline, keywords] of Object.entries(DISCIPLINE_KEYWORDS)) {
    let hits = 0;
    for (const kw of keywords) {
      // Word boundary match
      const count = (combined.match(new RegExp(`\\b${kw}\\b`, 'gi')) || []).length;
      if (count > 0) hits += Math.min(count, 3);
    }
    scores[discipline] = (scores[discipline] || 0) + hits;
  }

  // Sort by score
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const topDiscipline = sorted[0]?.[0];
  const topScore = sorted[0]?.[1] || 0;
  const runnerUpScore = sorted[1]?.[1] || 0;

  // Determine cognitive density heuristics
  let cognitiveDensity = COGNITIVE_DENSITIES.CONCEPTUAL;
  if (visualRatio > 0.4) {
    cognitiveDensity = COGNITIVE_DENSITIES.VISUAL;
  } else if (topDiscipline === 'stem' && (combined.match(/[=+\-*/∑∫√^]/g) || []).length > 20) {
    cognitiveDensity = COGNITIVE_DENSITIES.FORMULA_DENSE;
  } else if (topDiscipline === 'medicine') {
    cognitiveDensity = COGNITIVE_DENSITIES.TERMINOLOGICAL;
  }

  // Determine document type heuristics
  let documentType = DOCUMENT_TYPES.LECTURE_SLIDES;
  if (/syllabus|course outline|grading scheme/i.test(combined)) {
    documentType = DOCUMENT_TYPES.SYLLABUS;
  } else if (/chapter\s+\d+|table of contents|preface|edition/i.test(combined)) {
    documentType = DOCUMENT_TYPES.TEXTBOOK;
  } else if (/examination|exam questions|past questions|time allowed/i.test(combined)) {
    documentType = DOCUMENT_TYPES.EXAM_PAPER;
  }

  const confidence = topScore >= 4 && topScore > runnerUpScore * 1.5 ? Math.min(0.95, 0.6 + topScore * 0.05) : 0.45;

  return {
    discipline: topDiscipline || DOMAIN_DISCIPLINES.GENERAL,
    documentType,
    cognitiveDensity,
    confidence
  };
}

/**
 * AI-assisted fallback classification for ambiguous documents.
 */
async function aiClassify({ title = '', textSample = '', heuristicResult }) {
  if (!getEnv('DEEPSEEK_API_KEY')) {
    return heuristicResult;
  }

  try {
    const prompt = `Classify this academic study document into its discipline, document type, and cognitive density.
Title: "${title}"
Content Sample:
${textSample.slice(0, 2000)}

Return ONLY JSON matching:
{
  "discipline": "medicine" | "stem" | "law" | "business" | "humanities" | "general",
  "subDiscipline": "specific subject e.g. Gross Anatomy, Organic Chemistry",
  "documentType": "lecture_slides" | "textbook" | "exam_paper" | "notes" | "syllabus",
  "cognitiveDensity": "visual" | "formula_dense" | "terminological" | "conceptual",
  "confidence": 0.0 to 1.0
}`;

    const response = await aiClient.chatCompletion({
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 250,
      temperature: 0.1,
      response_format: { type: 'json_object' }
    });

    const parsed = JSON.parse(response.choices?.[0]?.message?.content || '{}');
    const validDiscipline = Object.values(DOMAIN_DISCIPLINES).includes(parsed.discipline) ? parsed.discipline : heuristicResult.discipline;

    return {
      discipline: validDiscipline,
      subDiscipline: parsed.subDiscipline || null,
      documentType: parsed.documentType || heuristicResult.documentType,
      cognitiveDensity: parsed.cognitiveDensity || heuristicResult.cognitiveDensity,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.85
    };
  } catch (err) {
    console.warn('[domainClassifierService] AI classification fallback notice:', err.message);
    return heuristicResult;
  }
}

/**
 * Main Domain Classification Entrypoint.
 */
export async function classifyDocumentDomain({ title = '', text = '', inventory = [] }) {
  const visualCount = inventory.filter((p) => p.visual).length;
  const visualRatio = inventory.length > 0 ? visualCount / inventory.length : 0;
  const textSample = text.slice(0, 4000);

  const heuristic = heuristicClassify({ title, textSample, visualRatio });

  // If heuristic is already high confidence, skip external LLM roundtrip (< 1ms execution)
  if (heuristic.confidence >= 0.75) {
    return heuristic;
  }

  // Otherwise, run fast zero-shot LLM classification
  return await aiClassify({ title, textSample, heuristicResult: heuristic });
}
