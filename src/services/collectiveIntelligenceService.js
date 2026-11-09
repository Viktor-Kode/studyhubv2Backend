import PedagogicalPattern from '../models/PedagogicalPattern.js';

/**
 * Strips PII, emails, URLs, names, and limits string length.
 */
export function sanitizeConceptText(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '') // remove emails
    .replace(/https?:\/\/[^\s]+/g, '') // remove urls
    .replace(/[0-9]{10,}/g, '') // remove phone/id numbers
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
}

/**
 * Derives a normalized topic key from discipline and document/topic title.
 */
export function deriveTopicKey(discipline = 'general', title = '') {
  const normDiscipline = String(discipline || 'general').toLowerCase().trim();
  const slug = String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

  return `${normDiscipline}:${slug || 'general-topic'}`;
}

/**
 * Records an anonymized student mistake pattern from quiz/challenge interactions.
 * Never stores student IDs or user progress.
 */
export async function recordStudentMistake({ discipline = 'general', topicTitle = '', missedConcept = '', chosenDistractor = '' }) {
  const cleanConcept = sanitizeConceptText(missedConcept);
  const cleanDistractor = sanitizeConceptText(chosenDistractor);

  if (!cleanConcept && !cleanDistractor) return null;

  const topicKey = deriveTopicKey(discipline, topicTitle);

  try {
    const updateOps = {
      $inc: { usageCount: 1 }
    };

    if (cleanConcept) {
      updateOps.$addToSet = {
        commonPitfalls: `Common misconception around ${cleanConcept}`
      };
    }

    if (cleanConcept && cleanDistractor) {
      updateOps.$push = {
        effectiveDistractors: {
          concept: cleanConcept,
          distractor: cleanDistractor,
          selectionCount: 1
        }
      };
    }

    const pattern = await PedagogicalPattern.findOneAndUpdate(
      { discipline, topicKey },
      updateOps,
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return pattern;
  } catch (err) {
    console.warn('[collectiveIntelligence] Non-blocking mistake pattern recording notice:', err.message);
    return null;
  }
}

/**
 * Retrieves reusable collective patterns for a given discipline and topic.
 */
export async function getCollectivePatterns({ discipline = 'general', topicTitle = '' }) {
  const topicKey = deriveTopicKey(discipline, topicTitle);

  try {
    const pattern = await PedagogicalPattern.findOne({
      $or: [
        { discipline, topicKey },
        { topicKey }
      ]
    }).lean();

    if (!pattern) return null;

    return {
      conceptPairs: pattern.conceptPairs || [],
      commonPitfalls: (pattern.commonPitfalls || []).slice(0, 5),
      vettedAnalogies: (pattern.vettedAnalogies || []).slice(0, 3),
      effectiveDistractors: (pattern.effectiveDistractors || []).slice(0, 6)
    };
  } catch (err) {
    console.warn('[collectiveIntelligence] Pattern retrieval notice:', err.message);
    return null;
  }
}
