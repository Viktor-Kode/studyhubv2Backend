import StudyPath from '../models/StudyPath.js';
import { parseDocumentBuffer } from '../utils/documentParser.js';
import { studyPathSystemPrompt, challengePrompt } from '../utils/prompts.js';
import { PASS_MARK, CHALLENGE_XP_PER_QUESTION, TOTAL_CHALLENGE_QUESTIONS, MAX_CHALLENGE_XP } from '../config/challengeConfig.js';
import { getEnv } from '../config/env.js';
import aiClient from '../utils/aiClient.js';
import { incrementAIUsage } from '../middleware/usageMiddleware.js';
import { awardXP } from './progressController.js';
import { buildPdfStudyPath } from '../services/studyPathPdfPipeline.js';
import { createStudyPathJob, getStudyPathJob, serializeStudyPathJob, updateStudyPathJob } from '../services/studyPathJobs.js';

const BANNED_FILLER_REGEX = /(fundamental principles|core terminology|key ideas build|introduction to (the )?primary concepts|^definition$)/i;
const QUIZ_TEMPLATE_REGEX = /how does .{1,120} interact with the (overall )?mechanics of/i;
const wordCount = (value) => String(value || '').trim().split(/\s+/).filter(Boolean).length;
const GROUNDING_STOP_WORDS = new Set(['a', 'an', 'and', 'are', 'as', 'at', 'by', 'for', 'from', 'in', 'into', 'is', 'it', 'of', 'on', 'or', 'that', 'the', 'their', 'this', 'to', 'was', 'were', 'with']);
const BREAKDOWN_FILLER_REGEX = /\b(includes?|covers?|discusses?|overview of|various|several)\b|with specific (?:actions|nerve supply|attachments)/i;
const BREAKDOWN_CONNECTOR_REGEX = /\b(?:because|so|which means|therefore|by\s|when\s|causes|leads to|allows|results in|while|whereas|in contrast|so that|as a result|since)\b/i;

function durationFromLessonText(summary, keyConcepts, breakdown) {
  const text = [summary || '', ...(Array.isArray(keyConcepts) ? keyConcepts : []), ...(Array.isArray(breakdown) ? breakdown.flatMap((slide) => [slide?.heading || '', slide?.body || '', slide?.memoryTip || '']) : [])].join(' ');
  const readingWords = wordCount(text);
  return `${Math.min(9, Math.max(5, Math.ceil(readingWords / 200)))} min`;
}

function normalizeGroundingText(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/([a-z0-9])-\s+(?=[a-z0-9])/g, '$1')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sourceFactMatches(fact, normalizedSource) {
  const normalizedFact = normalizeGroundingText(fact);
  if (!normalizedFact) return false;
  if (` ${normalizedSource} `.includes(` ${normalizedFact} `)) return true;

  // Extractors often split words at line endings or reflow text boxes. If
  // punctuation-normalized exact matching fails, require most meaningful
  // fact terms to occur in the extracted document.
  const terms = normalizedFact.split(' ').filter((term) => term.length > 1 && !GROUNDING_STOP_WORDS.has(term));
  if (terms.length === 0) return false;
  const sourceTerms = new Set(normalizedSource.split(' '));
  const matchedTerms = terms.filter((term) => sourceTerms.has(term)).length;
  const requiredMatches = terms.length === 1 ? 1 : Math.max(2, Math.ceil(terms.length * 0.7));
  return matchedTerms >= requiredMatches;
}

function normalizedWords(value) {
  return normalizeGroundingText(String(value || '').replace(/\*\*/g, '')).split(' ').filter(Boolean);
}

function firstSentence(value) {
  return String(value || '').trim().split(/(?<=[.!?])\s+/)[0] || '';
}

function longestSharedRun(left, right) {
  let longest = 0;
  let previous = new Array(right.length + 1).fill(0);
  for (let i = 1; i <= left.length; i++) {
    const current = new Array(right.length + 1).fill(0);
    for (let j = 1; j <= right.length; j++) {
      if (left[i - 1] === right[j - 1]) {
        current[j] = previous[j - 1] + 1;
        longest = Math.max(longest, current[j]);
      }
    }
    previous = current;
  }
  return longest;
}

/**
 * Validates generated study path nodes against quality criteria.
 * Enforces at least 1 node, 3-5 keyConcepts, concise fields, no banned filler, grounded sourceFacts.
 */
export function validateStudyPathNodes(nodes, extractedText = '') {
  const problems = [];
  if (!Array.isArray(nodes) || nodes.length < 1) {
    problems.push(`Expected at least 1 node, but received ${Array.isArray(nodes) ? nodes.length : 0}`);
    return problems;
  }

  const normExtracted = normalizeGroundingText(extractedText);

  nodes.forEach((node, index) => {
    const nodeNum = node.id ?? (index + 1);
    const titleText = String(node.title || '').trim();
    const sourceFacts = Array.isArray(node.sourceFacts) ? node.sourceFacts : [];
    if (wordCount(titleText) > 12) problems.push(`Node ${nodeNum} title exceeds 12 words: "${titleText}"`);
    if (/,\s*[^,]+\s+(?:and|&)\s+/i.test(titleText)) problems.push(`Node ${nodeNum} title appears to combine multiple subtopics: "${titleText}". Split them into distinct nodes.`);
    if (sourceFacts.length > 8) problems.push(`Node ${nodeNum} has ${sourceFacts.length} sourceFacts; split this broad subtopic into nodes with at most 8 facts.`);

    // 1. Banned filler
    const textsToCheck = [
      node.title || '',
      node.summary || '',
      ...(Array.isArray(node.keyConcepts) ? node.keyConcepts : []),
      ...(Array.isArray(node.sourceFacts)  ? node.sourceFacts  : [])
    ];
    for (const txt of textsToCheck) {
      if (BANNED_FILLER_REGEX.test(String(txt).trim())) {
        problems.push(`Node ${nodeNum} contains banned filler text: "${String(txt).trim()}"`);
        break;
      }
    }

    // 2. keyConcepts count
    if (!Array.isArray(node.keyConcepts) || node.keyConcepts.length < 3 || node.keyConcepts.length > 5) {
      problems.push(`Node ${nodeNum} must have 3 to 5 keyConcepts (found ${node.keyConcepts?.length || 0})`);
    }

    const limits = [
      ...((Array.isArray(node.keyConcepts) ? node.keyConcepts : []).map((text, i) => [`keyConcepts[${i}]`, text, 15])),
      ['quiz.question', node.quiz?.question, 25],
      ...((Array.isArray(node.quiz?.options) ? node.quiz.options : []).map((text, i) => [`quiz.options[${i}]`, text, 10])),
      ['quiz.explanation', node.quiz?.explanation, 30],
      ['quiz2.question', node.quiz2?.question, 25],
      ...((Array.isArray(node.quiz2?.options) ? node.quiz2.options : []).map((text, i) => [`quiz2.options[${i}]`, text, 10])),
      ['quiz2.explanation', node.quiz2?.explanation, 30]
    ];
    for (const [field, value, limit] of limits) {
      const count = wordCount(value);
      if (count > limit * 1.2) problems.push(`Node ${nodeNum} ${field} exceeds its ${limit}-word limit by more than 20% (${count} words)`);
    }
    if (wordCount(node.summary) > 25) problems.push(`Node ${nodeNum} summary exceeds its 25-word limit (${wordCount(node.summary)} words).`);
    const summarySentences = String(node.summary || '').trim().split(/(?<=[.!?])\s+/).filter(Boolean);
    if (summarySentences.length !== 1) problems.push(`Node ${nodeNum} summary must be one sentence of at most 25 words.`);
    const summaryTerms = new Set(normalizedWords(node.summary).filter((term) => term.length > 3 && !GROUNDING_STOP_WORDS.has(term)));
    const conceptDetails = [];
    for (const [conceptIndex, concept] of (Array.isArray(node.keyConcepts) ? node.keyConcepts : []).entries()) {
      const text = String(concept || '').trim();
      if (!/^[^:]{1,40}:\s*\S/.test(text)) problems.push(`Node ${nodeNum} keyConcepts[${conceptIndex}] must start with its key term in "Term: fact" form.`);
      const detailText = text.includes(':') ? text.slice(text.indexOf(':') + 1) : text;
      const detailTerms = new Set(normalizedWords(detailText).filter((term) => term.length > 3 && !GROUNDING_STOP_WORDS.has(term)));
      const newDetails = [...detailTerms].filter((term) => !summaryTerms.has(term));
      if (newDetails.length < 1) problems.push(`Node ${nodeNum} keyConcepts[${conceptIndex}] must state at least one specific fact detail absent from the summary.`);
      if (conceptDetails.some((previous) => {
        const shared = [...detailTerms].filter((term) => previous.has(term)).length;
        const union = new Set([...detailTerms, ...previous]).size;
        return shared >= 3 && shared / Math.max(1, union) >= 0.8;
      })) problems.push(`Node ${nodeNum} keyConcepts[${conceptIndex}] repeats another key concept.`);
      conceptDetails.push(detailTerms);
    }

    const breakdown = Array.isArray(node.breakdown) ? node.breakdown : [];
    if (breakdown.length !== 2) {
      problems.push(`Node ${nodeNum} breakdown must contain exactly 2 teaching slides.`);
    } else {
      const sentenceSets = breakdown.map((slide, slideIndex) => {
        const label = `breakdown[${slideIndex}]`;
        const heading = String(slide?.heading || '').trim();
        const body = String(slide?.body || '').trim();
        const minWords = slideIndex === 0 ? 50 : 40;
        const maxWordsWithTolerance = slideIndex === 0 ? 96 : 84;
        const count = wordCount(body);
        if (!heading || wordCount(heading) > 8) problems.push(`Node ${nodeNum} ${label}.heading must be specific and at most 8 words.`);
        if (count < minWords || count > maxWordsWithTolerance) {
          const sentence = firstSentence(body);
          problems.push(`Node ${nodeNum} ${label}.body must be ${minWords}-${slideIndex === 0 ? 80 : 70} words (allowing +20% over the maximum); found ${count}. Offending sentence: "${sentence}"`);
        }
        if (BREAKDOWN_FILLER_REGEX.test(body)) {
          const sentence = body.split(/(?<=[.!?])\s+/).find((item) => BREAKDOWN_FILLER_REGEX.test(item)) || body;
          problems.push(`Node ${nodeNum} ${label}.body uses prohibited listing filler. State the actual explanation. Offending sentence: "${sentence}"`);
        }
        if (!/\*\*[^*]+\*\*/.test(body)) {
          problems.push(`Node ${nodeNum} ${label}.body needs at least one **bold** technical term. Offending sentence: "${firstSentence(body)}"`);
        }
        const factTerms = new Set(sourceFacts.flatMap((fact) => normalizedWords(fact)));
        const groundedTerms = new Set(normalizedWords(body).filter((term) => term.length > 4 && !GROUNDING_STOP_WORDS.has(term) && factTerms.has(term)));
        if (groundedTerms.size < 4) {
          problems.push(`Node ${nodeNum} ${label}.body has only ${groundedTerms.size} distinct content words grounded in sourceFacts; at least 4 are required. Offending sentence: "${firstSentence(body)}"`);
        }
        const bodyWords = normalizedWords(body);
        const copiedFact = sourceFacts.find((fact) => longestSharedRun(bodyWords, normalizedWords(fact)) > 12);
        if (copiedFact) {
          problems.push(`Node ${nodeNum} ${label}.body copies more than 12 consecutive words from a sourceFact. Rewrite the explanation. Offending sentence: "${firstSentence(body)}"`);
        }
        if (slideIndex === 0 && !BREAKDOWN_CONNECTOR_REGEX.test(body)) {
          problems.push(`Node ${nodeNum} slide 1 only lists facts. Explain how and why with a reasoning connector. Offending sentence: "${firstSentence(body)}"`);
        }
        if (slideIndex === 1) {
          const memoryTip = String(slide?.memoryTip || '').trim();
          if (!memoryTip || wordCount(memoryTip) > 20) problems.push(`Node ${nodeNum} breakdown[1].memoryTip must be one line of at most 20 words. Offending sentence: "${memoryTip}"`);
        }
        return new Set(body.split(/(?<=[.!?])\s+/).map((sentence) => normalizeGroundingText(sentence.replace(/\*\*/g, ''))).filter(Boolean));
      });
      for (const sentence of sentenceSets[1]) {
        if (sentenceSets[0].has(sentence)) {
          problems.push(`Node ${nodeNum} slide 2 repeats a slide 1 sentence: "${sentence}"`);
          break;
        }
      }
    }
    for (const field of ['quiz', 'quiz2']) {
      const quiz = node[field];
      if (!quiz || typeof quiz.question !== 'string' || !quiz.question.trim()) {
        problems.push(`Node ${nodeNum} is missing ${field}.question`);
        continue;
      }
      if (!Array.isArray(quiz.options) || quiz.options.length !== 4 || quiz.options.some((option) => typeof option !== 'string' || !option.trim())) {
        problems.push(`Node ${nodeNum} ${field}.options must contain exactly 4 non-empty options`);
      }
      if (!Number.isInteger(quiz.correctAnswerIndex) || quiz.correctAnswerIndex < 0 || quiz.correctAnswerIndex > 3) {
        problems.push(`Node ${nodeNum} ${field}.correctAnswerIndex must be from 0 to 3`);
      }
      if (typeof quiz.explanation !== 'string' || !quiz.explanation.trim()) {
        problems.push(`Node ${nodeNum} ${field}.explanation is missing`);
      }
    }
    for (const field of ['quiz', 'quiz2']) {
      if (QUIZ_TEMPLATE_REGEX.test(String(node[field]?.question || ''))) {
        problems.push(`Node ${nodeNum} ${field}.question uses the prohibited mechanics-interaction template`);
      }
    }
    if (QUIZ_TEMPLATE_REGEX.test(String(node.quiz2?.question || ''))) {
      problems.push(`Node ${nodeNum} quiz2.question uses the prohibited mechanics-interaction template`);
    }
    if (node.quiz?.question && node.quiz2?.question && tokenJaccardSimilarity(node.quiz.question, node.quiz2.question) > 0.55) {
      problems.push(`Node ${nodeNum} quiz2 repeats quiz.question`);
    }

    // 3. sourceFacts grounding check (skip when extracted text is unavailable)
    if (normExtracted.length > 0) {
        const facts = sourceFacts;
      if (facts.length === 0) {
        problems.push(`Node ${nodeNum} has 0 sourceFacts`);
      } else {
        let matchCount = 0;
        for (const fact of facts) if (sourceFactMatches(fact, normExtracted)) matchCount++;
        if (matchCount / facts.length < 0.5) {
          problems.push(`Node ${nodeNum} has under half of sourceFacts matching extracted document text (${matchCount}/${facts.length} matched)`);
        }
      }
    }
  });

  return problems;
}

function parseModelJson(content) {
  const text = String(content || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  return JSON.parse(text);
}

function getSourcePageText(source, requestedPages) {
  const sourceText = String(source || '').trim();
  if (!sourceText) return '';

  const pageMarker = /---\s*Page\s+\d+\s*---/i;
  // Text, DOCX, and slide extraction may provide one unpaginated text block.
  // In that case sourcePages cannot be used to slice it, so ground regeneration
  // in the complete extracted document instead of treating it as unavailable.
  if (!pageMarker.test(sourceText)) return sourceText;

  const parts = sourceText.split(/(?=---\s*Page\s+\d+\s*---)/i);
  const wanted = new Set(requestedPages.map(Number));
  const selected = parts.filter((part) => {
    const match = part.match(/---\s*Page\s+(\d+)\s*---/i);
    return match ? wanted.has(Number(match[1])) : false;
  });
  return selected.join('\n\n').trim();
}

export function formatStudyPathResponse(pathRecord) {
  if (!pathRecord) return null;
  const nodes = pathRecord.nodes || [];
  const allNodesCompleted = Array.isArray(nodes) && nodes.length > 0 && nodes.every(n => n.status === "completed");
  let challengeStatus = pathRecord.challenge?.status || (allNodesCompleted ? "active" : "locked");
  if (pathRecord.challenge?.passed || pathRecord.completed) {
    challengeStatus = "completed";
  } else if (allNodesCompleted && challengeStatus === "locked") {
    challengeStatus = "active";
  }

  return {
    topicId: pathRecord.topicId,
    title: pathRecord.title,
    courseCode: pathRecord.courseCode,
    currentProgress: pathRecord.currentProgress || 0,
    completed: Boolean(pathRecord.completed || pathRecord.challenge?.passed),
    challenge: {
      status: challengeStatus,
      questionCount: TOTAL_CHALLENGE_QUESTIONS,
      passMark: PASS_MARK,
      maxXp: MAX_CHALLENGE_XP,
      bestScore: pathRecord.challenge?.bestScore || 0,
      bestXp: pathRecord.challenge?.bestXp || 0
    },
    nodes
  };
}

/** kebab-case helper */
function toKebabCase(str) {
  return (str || 'study-path')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'study-path';
}

// ─── coverage helpers ──────────────────────────────────────────────────────────

function uncoveredPages(totalPages, nodes, skippedPages = []) {
  const covered = new Set(skippedPages.map(Number));
  for (const node of nodes) {
    for (const p of (node.sourcePages || [])) covered.add(Number(p));
  }
  const missing = [];
  for (let p = 1; p <= totalPages; p++) {
    if (!covered.has(p)) missing.push(p);
  }
  return missing;
}

function coveragePct(totalPages, missing) {
  if (totalPages === 0) return 100;
  return Math.round(((totalPages - missing.length) / totalPages) * 100);
}

// ─── DeepSeek call ────────────────────────────────────────────────────────────

/**
 * Safely parses JSON response, with salvage recovery if response was truncated mid-stream.
 */
function safeParseJson(rawContent) {
  let cleaned = (rawContent || '').trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  }

  // 1. Direct parse attempt
  try {
    return JSON.parse(cleaned);
  } catch (initialErr) {
    console.warn('[generateStudyPath] Direct JSON parse failed, attempting truncation salvage:', initialErr.message);
  }

  // 2. Salvage truncated JSON (e.g. unterminated string / cut-off array)
  let lastValidIdx = cleaned.lastIndexOf('}');
  while (lastValidIdx > 0) {
    const candidate = cleaned.slice(0, lastValidIdx + 1);
    let inString = false;
    let escaped = false;
    const stack = [];
    for (let i = 0; i < candidate.length; i++) {
      const ch = candidate[i];
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (!inString) {
        if (ch === '{' || ch === '[') stack.push(ch);
        else if (ch === '}' && stack[stack.length - 1] === '{') stack.pop();
        else if (ch === ']' && stack[stack.length - 1] === '[') stack.pop();
      }
    }
    if (!inString) {
      let suffix = '';
      for (let i = stack.length - 1; i >= 0; i--) {
        suffix += stack[i] === '{' ? '}' : ']';
      }
      try {
        const parsed = JSON.parse(candidate + suffix);
        if (parsed && Array.isArray(parsed.nodes) && parsed.nodes.length > 0) {
          console.log(`[generateStudyPath] Successfully salvaged truncated JSON with ${parsed.nodes.length} nodes.`);
          return parsed;
        }
      } catch (_) {}
    }
    lastValidIdx = cleaned.lastIndexOf('}', lastValidIdx - 1);
  }

  throw new Error('AI output was truncated or contained invalid JSON. Please try again.');
}

/**
 * Calls DeepSeek with extracted document text and returns parsed JSON.
 */
async function callDeepSeekForStudyPath({
  rawText,
  title,
  retryProblems = [],
  totalPages = 0
}) {
  let userInstruction = `Document Title: ${title || 'Study Material'}\n`;
  if (totalPages > 0) {
    userInstruction += `Total Pages: ${totalPages}. Include sourcePages (1-based) accurately covering the content based on page markers.\n`;
  }
  userInstruction += `Generate a sequential study path strictly following all system instructions and return as JSON.\n\n`;

  if (retryProblems && retryProblems.length > 0) {
    userInstruction += `REPAIR THE PREVIOUS STUDY PATH. Return the complete corrected JSON in the same schema. Fix every issue below in the named node and field; do not merely explain the correction. Preserve valid nodes, source facts, source pages, units, and document coverage.\n${retryProblems.map(p => `- ${p}`).join('\n')}\n\nREPAIR RULES:\n- For a short breakdown[0].body, rewrite it to 60-70 words (never below 55), with 3-4 explanatory sentences. Aim comfortably inside the range rather than at its boundary.\n- Slide 1 must explain a mechanism, cause, purpose, or consequence. Include a clear reasoning link in the body such as because, so, which means, while, whereas, or as a result; a bare definition or list of structures is not enough.\n- If key concepts repeat, give each a different fact after the colon; keep overlap between their detail phrases low. Each detail must add information absent from the summary.\n- For copied source wording, paraphrase the sentence from scratch and do not reuse 13 consecutive words from any sourceFact.\n- Every breakdown body must contain 1-3 literal **bold technical terms** and at least four specific terms grounded in that node's sourceFacts. Avoid phrases that introduce lists; explain how structures act or relate.\n- Keep both quiz and quiz2 complete: each needs a distinct question, four options, correctAnswerIndex, and explanation. Never omit quiz2.\n\n`;
  }

  // DeepSeek-V3 context window is 64k tokens (~180,000 characters)
  const safeText = typeof rawText === 'string' ? rawText : String(rawText || '');
  const trimmedText = safeText.length > 180000
    ? safeText.slice(0, 180000) + '\n\n[Content truncated due to size limit]'
    : safeText;

  userInstruction += `Document Content:\n${trimmedText}`;

  console.log(`[generateStudyPath] Invoking DeepSeek for "${title}" (${trimmedText.length} chars)...`);

  const response = await aiClient.chatCompletion({
    model: 'deepseek-chat',
    messages: [
      { role: 'system', content: studyPathSystemPrompt },
      { role: 'user', content: userInstruction }
    ],
    max_tokens: 8192,
    temperature: 0.2,
    response_format: { type: 'json_object' }
  });

  const content = response.choices?.[0]?.message?.content || '{}';
  return safeParseJson(content);
}

// ─── coverage-aware generation with retry ─────────────────────────────────────

async function generateAndVerify({ rawText, title, totalPages }) {
  let parsedData = await callDeepSeekForStudyPath({ rawText, title, totalPages });
  let validationProblems = validateStudyPathNodes(parsedData?.nodes, rawText);
  const getMissing = (data) => totalPages > 0
    ? uncoveredPages(totalPages, data?.nodes || [], data?.skippedPages || [])
    : [];
  let missing = getMissing(parsedData);
  let repairIssues = [...validationProblems];
  if (missing.length) repairIssues.push(`These pages are not covered by any node: ${missing.join(', ')}. Add nodes for them or list them in skippedPages if they have no study content.`);

  for (let attempt = 1; repairIssues.length && attempt <= 2; attempt++) {
    console.warn(`[generateStudyPath] Validation issues before repair ${attempt}:`, repairIssues);
    try {
      parsedData = await callDeepSeekForStudyPath({ rawText, title, totalPages, retryProblems: repairIssues });
      validationProblems = validateStudyPathNodes(parsedData?.nodes, rawText);
      missing = getMissing(parsedData);
      repairIssues = [...validationProblems];
      if (missing.length) repairIssues.push(`These pages are not covered by any node: ${missing.join(', ')}. Add nodes for them or list them in skippedPages if they have no study content.`);
    } catch (retryErr) {
      console.warn(`[generateStudyPath] Repair ${attempt} failed:`, retryErr.message);
      repairIssues.push(`Repair ${attempt} failed: ${retryErr.message}`);
      break;
    }
  }
  return { parsedData, validationProblems, uncovered: missing };
}

// ─── server-side post-processing ──────────────────────────────────────────────

function postProcessNodes(rawNodes, documentId) {
  return (rawNodes || []).map((node, index) => {
    const sourceFacts = Array.isArray(node.sourceFacts) ? node.sourceFacts : [];
    const sourcePages = Array.isArray(node.sourcePages) && node.sourcePages.length > 0
      ? node.sourcePages
      : [index + 1];

    const xp = 20 + Math.min(15, sourceFacts.length);

    const summaryText = node.summary || '';
    const keyConcepts = Array.isArray(node.keyConcepts) ? node.keyConcepts : [];
    const breakdown = Array.isArray(node.breakdown) ? node.breakdown.map((slide) => ({
      heading: String(slide?.heading || ''),
      body: String(slide?.body || ''),
      ...(slide?.memoryTip ? { memoryTip: String(slide.memoryTip) } : {})
    })) : [];
    const duration = durationFromLessonText(summaryText, keyConcepts, breakdown);

    const firstPage = sourcePages[0] || 1;
    const slideImage = `/api/slides/${documentId}/page-${firstPage}.png`;

    const status = index === 0 ? 'active' : 'locked';

    const formatQuiz = (rawQuiz = {}) => {
      let options = Array.isArray(rawQuiz.options) ? [...rawQuiz.options] : [];
      let correctIdx = typeof rawQuiz.correctAnswerIndex === 'number' ? rawQuiz.correctAnswerIndex : 0;
      if (options.length > 0) {
        if (correctIdx < 0 || correctIdx >= options.length) correctIdx = 0;
        const targetOption = options[correctIdx];
        for (let i = options.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [options[i], options[j]] = [options[j], options[i]];
        }
        const newIdx = options.indexOf(targetOption);
        correctIdx = newIdx >= 0 ? newIdx : 0;
      }
      return {
        question: rawQuiz.question || '',
        options,
        correctAnswerIndex: correctIdx,
        explanation: rawQuiz.explanation || ''
      };
    };

    const quiz = formatQuiz(node.quiz);
    const quiz2 = formatQuiz(node.quiz2);

    const result = {
      id: typeof node.id === 'number' ? node.id : index + 1,
      title: node.title || `Concept ${index + 1}`,
      status,
      xp,
      duration,
      slideImage,
      sourcePages,
      sourceFacts,
      summary: summaryText,
      breakdown,
      keyConcepts,
      quiz,
      quiz2,
      lessonContent: {
        analogy: '',
        paragraphs: summaryText ? [summaryText] : [],
        keyConcepts: Array.isArray(node.keyConcepts) ? node.keyConcepts : []
      }
    };

    // Optional unit field
    if (node.unit && typeof node.unit === 'string' && node.unit.trim()) {
      result.unit = node.unit.trim();
    }

    return result;
  });
}

// ─── main handler ──────────────────────────────────────────────────────────────

/**
 * POST /api/generate-path
 * Accepts multipart/form-data with a PDF/document or JSON with text
 */
const generateStudyPathLegacy = async (req, res) => {
  try {
    let rawText = '';
    let fileName = '';
    let totalPages = 0;

    const file = req.file || (req.files && (req.files.pdf?.[0] || req.files.file?.[0] || req.files.document?.[0]));

    // 1. Prioritize client pre-extracted text if provided
    if (req.body?.text && String(req.body.text).trim().length >= 30) {
      rawText = String(req.body.text).trim();
      fileName = file?.originalname || req.body?.title || 'Study Material';
      console.log(`[generateStudyPath] Using client pre-extracted text for: ${fileName} (${rawText.length} chars)`);
    } else if (file && file.buffer) {
      fileName = file.originalname || 'document.pdf';
      console.log(`[generateStudyPath] Processing uploaded file: ${fileName} (${file.size || file.buffer?.length} bytes)`);
      try {
        const parsed = await parseDocumentBuffer(file.buffer, file.originalname, file.mimetype);
        if (typeof parsed === 'string') {
          rawText = parsed;
        } else if (parsed && typeof parsed.text === 'string') {
          rawText = parsed.text;
          totalPages = parsed.numpages || 0;
        } else if (parsed?.text) {
          rawText = String(parsed.text);
          totalPages = parsed.numpages || 0;
        }
      } catch (parseErr) {
        console.warn('[generateStudyPath] Document parser text extraction notice:', parseErr.message);
      }
    }

    // Ensure rawText is always safely coerced to a trimmed string
    rawText = typeof rawText === 'string' ? rawText.trim() : String(rawText || '').trim();

    if (!rawText || rawText.length < 30) {
      return res.status(400).json({
        success: false,
        message: 'Could not extract readable text from document. Please upload a clear document or paste text.'
      });
    }

    const explicitTitle = req.body?.title?.trim();
    const derivedTitle  = explicitTitle || fileName.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ') || 'Interactive Study Path';
    const cleanTitle    = derivedTitle.charAt(0).toUpperCase() + derivedTitle.slice(1);

    const apiKey = getEnv('DEEPSEEK_API_KEY') || process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      console.error('[generateStudyPath] Missing DEEPSEEK_API_KEY in environment.');
      return res.status(500).json({
        success: false,
        message: 'AI Service Unavailable: DeepSeek API key is not configured on the server.'
      });
    }

    let parsedData;
    let validationProblems = [];
    let uncovered = [];

    try {
      const result = await generateAndVerify({ rawText, title: cleanTitle, totalPages });
      parsedData         = result.parsedData;
      validationProblems = result.validationProblems || [];
      uncovered          = result.uncovered || [];

      if (validationProblems.length > 0) {
        console.error('[generateStudyPath] Validation failed after retry:', validationProblems);
        return res.status(502).json({
          success: false,
          message: `Generated study path failed quality validation: ${validationProblems.join('; ')}`,
          issues: validationProblems
        });
      }

      // Log coverage
      const skippedPages = parsedData?.skippedPages || [];
      if (totalPages > 0) {
        const pct = coveragePct(totalPages, uncovered);
        console.log(`[generateStudyPath] Coverage: ${pct}% (${totalPages - uncovered.length}/${totalPages} pages).`);
        if (uncovered.length > 0) {
          console.warn(`[generateStudyPath] Uncovered pages: [${uncovered.join(', ')}]`);
        }
        if (skippedPages.length > 0) {
          console.log(`[generateStudyPath] Skipped (no study content): [${skippedPages.join(', ')}]`);
        }
      }
    } catch (err) {
      console.error('[generateStudyPath] Generation failed:', err.message);
      return res.status(502).json({ success: false, message: `Failed to generate study path with DeepSeek: ${err.message}` });
    }

    const finalTitle  = parsedData.title || cleanTitle;
    const topicId     = toKebabCase(finalTitle);
    const courseCode  = parsedData.courseCode || `${finalTitle.slice(0, 6).toUpperCase()} 101 · Interactive Study Path`;
    const documentId  = req.body?.documentId || req.body?.docId || topicId;

    // Post-process
    const processedNodes = postProcessNodes(parsedData.nodes, documentId);

    // Persistence
    const userId = req.user?._id?.toString() || req.user?.firebaseUid || req.body?.userId || 'anonymous-user';

    try {
      if (userId && userId !== 'anonymous-user') {
        await StudyPath.updateMany({ userId, isActive: true }, { $set: { isActive: false } });
        await incrementAIUsage(req.user?._id || userId).catch(() => {});
        await awardXP(req.user?._id || userId, 'ai_study_path').catch(() => {});
      }

      await StudyPath.deleteOne({ topicId }).catch(() => {});

      const savedRecord = new StudyPath({
        userId,
        topicId,
        title: finalTitle,
        courseCode,
        currentProgress: 0,
        nodes: processedNodes,
        isActive: true,
        sourceFileName: fileName,
        extractedText: rawText
      });

      await savedRecord.save();
      console.log(`[generateStudyPath] Saved StudyPath: ${topicId} (${processedNodes.length} nodes) for user ${userId}`);
    } catch (dbErr) {
      console.warn('[generateStudyPath] MongoDB save warning (proceeding with response):', dbErr.message);
    }

    // Response formatting
    const responseNodes = processedNodes.map(node => {
      const nodeCopy = { ...node };
      // sourceFacts power the collapsed "From your notes" drawer in the lesson.
      // Keep them in the client payload; they are already part of each node.
      return nodeCopy;
    });

    const structuredStudyPath = {
      topicId,
      title: finalTitle,
      courseCode,
      currentProgress: 0,
      nodes: responseNodes
    };

    return res.status(201).json({
      success: true,
      message: 'Study path generated successfully',
      studyPath: structuredStudyPath,
      path: structuredStudyPath,
      topicId
    });

  } catch (error) {
    console.error('❌ generateStudyPath error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to process document and generate study path'
    });
  }
};

function resolveRequestFile(req) {
  return req.file || (req.files && (req.files.pdf?.[0] || req.files.file?.[0] || req.files.document?.[0]));
}

async function persistGeneratedPdfPath(req, file, generation) {
  const fileName = file.originalname || 'document.pdf';
  const finalTitle = String(generation.title || req.body?.title || fileName.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ') || 'Study Material').trim();
  const topicId = toKebabCase(finalTitle);
  const documentId = req.body?.documentId || req.body?.docId || topicId;
  const processedNodes = postProcessNodes(generation.nodes, documentId);
  const userId = req.user?._id?.toString() || req.user?.firebaseUid || req.body?.userId || 'anonymous-user';
  const courseCode = generation.courseCode || `${finalTitle.slice(0, 6).toUpperCase()} 101 · Interactive Study Path`;
  const pathData = {
    userId,
    topicId,
    title: finalTitle,
    courseCode,
    currentProgress: 0,
    nodes: processedNodes,
    challenge: {},
    isActive: true,
    sourceFileName: fileName,
    extractedText: generation.rawText
  };
  const savedRecord = await StudyPath.findOneAndUpdate({ topicId }, { $set: pathData }, {
    new: true,
    upsert: true,
    runValidators: true,
    setDefaultsOnInsert: true
  });
  if (userId && userId !== 'anonymous-user') {
    await StudyPath.updateMany({ userId, isActive: true, topicId: { $ne: topicId } }, { $set: { isActive: false } }).catch((error) => {
      console.warn('[studyPathJob] Could not deactivate prior maps:', error.message);
    });
    await incrementAIUsage(req.user?._id || userId).catch(() => {});
    await awardXP(req.user?._id || userId, 'ai_study_path').catch(() => {});
  }
  return { topicId, studyPath: formatStudyPathResponse(savedRecord.toObject()) };
}

async function runPdfStudyPathJob(req, file, job) {
  try {
    updateStudyPathJob(job.jobId, { status: 'outline', stage: 'Reading slides... inspecting PDF pages' });
    const generation = await buildPdfStudyPath({
      buffer: file.buffer,
      title: req.body?.title?.trim() || file.originalname?.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ') || 'Study Material',
      validateNodes: validateStudyPathNodes,
      onProgress: (progress) => updateStudyPathJob(job.jobId, progress)
    });
    updateStudyPathJob(job.jobId, { status: 'writing', stage: 'Saving completed study map...', done: generation.nodes.length, total: generation.nodes.length });
    const saved = await persistGeneratedPdfPath(req, file, generation);
    updateStudyPathJob(job.jobId, { status: 'done', stage: 'Study map ready', done: generation.nodes.length, total: generation.nodes.length, topicId: saved.topicId, studyPath: saved.studyPath });
    console.log(`[studyPathJob] Saved ${saved.topicId}: ${generation.nodes.length} nodes, ${generation.coverage}% page coverage.`);
  } catch (error) {
    console.error(`[studyPathJob] PDF generation failed (${job.jobId}):`, error.message);
    updateStudyPathJob(job.jobId, { status: 'error', stage: 'Study path generation failed', message: error.message || 'Failed to generate a study path.' });
  }
}

async function runLegacyStudyPathJob(req, job) {
  try {
    updateStudyPathJob(job.jobId, { status: 'writing', stage: 'Building map... generating lesson nodes' });
    const response = {
      statusCode: 200,
      payload: null,
      status(code) { this.statusCode = code; return this; },
      json(data) { this.payload = data; return this; }
    };
    await generateStudyPathLegacy(req, response);
    if (response.statusCode >= 400 || !response.payload?.success) {
      throw new Error(response.payload?.message || 'Failed to generate a study path.');
    }
    updateStudyPathJob(job.jobId, {
      status: 'done', stage: 'Study map ready', done: 1, total: 1,
      topicId: response.payload.topicId || response.payload.studyPath?.topicId,
      studyPath: response.payload.studyPath || response.payload.path
    });
  } catch (error) {
    console.error(`[studyPathJob] Legacy generation failed (${job.jobId}):`, error.message);
    updateStudyPathJob(job.jobId, { status: 'error', stage: 'Study path generation failed', message: error.message || 'Failed to generate a study path.' });
  }
}

export const generateStudyPath = async (req, res) => {
  const file = resolveRequestFile(req);
  const ownerId = req.user?._id?.toString() || req.user?.firebaseUid || req.body?.userId || 'anonymous-user';
  const job = createStudyPathJob(ownerId);
  res.status(202).json({ success: true, jobId: job.jobId });
  const isPdf = Boolean(file?.buffer && (file.mimetype?.toLowerCase().includes('pdf') || file.originalname?.toLowerCase().endsWith('.pdf')));
  if (isPdf) void runPdfStudyPathJob(req, file, job);
  else void runLegacyStudyPathJob(req, job);
};

export const getStudyPathJobStatus = async (req, res) => {
  const job = getStudyPathJob(req.params.jobId);
  if (!job) return res.status(404).json({ success: false, message: 'Study path job was not found or has expired.' });
  const requesterId = req.user?._id?.toString() || req.user?.firebaseUid;
  if (job.ownerId !== 'anonymous-user' && requesterId !== job.ownerId) return res.status(403).json({ success: false, message: 'You are not allowed to view this study path job.' });
  return res.status(200).json({ success: true, ...serializeStudyPathJob(job) });
};

/**
 * GET /api/generate-path/active or /api/study-path/active
 */
export const getActiveStudyPath = async (req, res) => {
  try {
    const userId = req.user?._id?.toString() || req.user?.firebaseUid || req.query?.userId;

    if (!userId || userId === 'anonymous-user') {
      return res.status(200).json({ success: true, studyPath: null, message: 'No authenticated user session' });
    }

    const activeRecord = await StudyPath.findOne({ userId, isActive: true }).sort({ updatedAt: -1 }).lean();

    if (!activeRecord) {
      const recent = await StudyPath.findOne({ userId }).sort({ updatedAt: -1 }).lean();
      if (recent) {
        return res.status(200).json({
          success: true,
          studyPath: {
            topicId: recent.topicId,
            title: recent.title,
            courseCode: recent.courseCode,
            currentProgress: recent.currentProgress || 0,
            nodes: recent.nodes
          }
        });
      }
      return res.status(200).json({ success: true, studyPath: null });
    }

    return res.status(200).json({
      success: true,
      studyPath: {
        topicId: activeRecord.topicId,
        title: activeRecord.title,
        courseCode: activeRecord.courseCode,
        currentProgress: activeRecord.currentProgress || 0,
        nodes: activeRecord.nodes
      }
    });

  } catch (error) {
    console.error('[getActiveStudyPath] Error:', error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * GET /api/study-path/:topicId
 */
export const getStudyPathById = async (req, res) => {
  try {
    const { topicId } = req.params;
    const pathRecord = await StudyPath.findOne({ topicId }).lean();

    if (!pathRecord) {
      return res.status(404).json({ success: false, message: 'Study path not found' });
    }

    return res.status(200).json({
      success: true,
      studyPath: {
        topicId: pathRecord.topicId,
        title: pathRecord.title,
        courseCode: pathRecord.courseCode,
        currentProgress: pathRecord.currentProgress || 0,
        nodes: pathRecord.nodes
      }
    });

  } catch (error) {
    console.error('[getStudyPathById] Error:', error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * GET /api/study-path/all or /api/study-path/user/all
 */
export const getUserStudyPaths = async (req, res) => {
  try {
    const userId = req.user?._id?.toString() || req.user?.firebaseUid || req.query?.userId;

    if (!userId || userId === 'anonymous-user') {
      return res.status(200).json({ success: true, studyPaths: [] });
    }

    const paths = await StudyPath.find({ userId }).sort({ updatedAt: -1 }).lean();

    return res.status(200).json({
      success: true,
      studyPaths: paths.map(p => ({
        topicId: p.topicId,
        title: p.title,
        courseCode: p.courseCode,
        currentProgress: p.currentProgress || 0,
        nodes: p.nodes
      }))
    });
  } catch (error) {
    console.error('[getUserStudyPaths] Error:', error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * DELETE /api/study-path/:topicId
 */
export const deleteStudyPath = async (req, res) => {
  try {
    const { topicId } = req.params;
    const userId = req.user?._id?.toString() || req.user?.firebaseUid;

    const query = { topicId };
    if (userId && userId !== 'anonymous-user') query.userId = userId;

    const result = await StudyPath.deleteOne(query);
    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, message: 'Study path not found or not owned by user' });
    }

    return res.status(200).json({ success: true, message: 'Study path deleted' });
  } catch (error) {
    console.error('[deleteStudyPath] Error:', error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/** POST /api/study-path/:topicId/node/:nodeId/regenerate */
export const regenerateStudyPathNode = async (req, res) => {
  try {
    const { topicId, nodeId } = req.params;
    const pathRecord = await StudyPath.findOne({ topicId });
    if (!pathRecord) return res.status(404).json({ success: false, message: 'Study path not found' });
    const userId = req.user?._id?.toString() || req.user?.firebaseUid;
    if (userId && userId !== pathRecord.userId) return res.status(403).json({ success: false, message: 'Not allowed to update this study path' });
    const node = pathRecord.nodes.find((item) => item.id === Number(nodeId));
    if (!node) return res.status(404).json({ success: false, message: 'Study path node not found' });
    const sourceText = getSourcePageText(pathRecord.extractedText, node.sourcePages || []);
    if (!sourceText) return res.status(422).json({ success: false, message: 'Source pages are unavailable for this node.' });
    if (!getEnv('DEEPSEEK_API_KEY')) return res.status(503).json({ success: false, message: 'DeepSeek is not configured on the server.' });

    const prompt = `Regenerate only summary, breakdown, keyConcepts, quiz, and quiz2 for this node, using only the source pages and sourceFacts below. Return JSON with exactly those five fields. Keep the node to this one narrow subtopic. summary: exactly one sentence, maximum 25 words, what the topic is and why it matters. breakdown: exactly two slides. Slide 1 has heading (maximum 8 words) and body (3-4 short sentences, 50-80 words) explaining what it is, how it works, and why; include a reasoning connector (because, so, which means, therefore, by, when, causes, leads to, allows, or results in). Slide 2 has heading (maximum 8 words), body (3-4 short sentences, 40-70 words) explaining a source-grounded practical consequence, example, or common mistake, and memoryTip (one line, maximum 20 words). Both bodies must teach rather than list, define technical terms plainly the first time, use simple language and short sentences, and mark 1-3 important terms with **double asterisks**. At least four distinct content words over four letters in each body must occur in sourceFacts. Do not copy more than 12 consecutive words from any sourceFact. Slide 2 must not repeat any slide 1 sentence. Never use includes, covers, discusses, overview of, various, several, or "with specific actions/nerve supply/attachments" as the substance. Never add facts, names, numbers, or clinical claims beyond sourceFacts. keyConcepts: 3-5 recap items of at most 15 words each, starting "Term: fact" and not copying breakdown sentences. Create two distinct quiz questions answerable from breakdown and grounded in different source facts. For each quiz, question at most 25 words, four same-category options at most 10 words each, correctAnswerIndex 0-3, explanation at most 30 words.\nTitle: ${node.title}\nExisting source facts: ${JSON.stringify(node.sourceFacts || [])}\nSource pages: ${sourceText}`;
    let generated = await callDeepSeekForJson(prompt, { maxTokens: 4000 });
    let problems = validateStudyPathNodes([{ ...node.toObject(), ...generated }], sourceText);
    if (problems.length) {
      const retryPrompt = `${prompt}\n\nYour previous answer failed these validation checks. Fix every issue, especially any quoted offending sentence, and return the same JSON fields only:\n${problems.map((problem) => `- ${problem}`).join('\n')}`;
      generated = await callDeepSeekForJson(retryPrompt, { maxTokens: 4000 });
      problems = validateStudyPathNodes([{ ...node.toObject(), ...generated }], sourceText);
    }
    if (problems.length) return res.status(422).json({ success: false, message: 'DeepSeek returned content outside the lesson limits after retry.', issues: problems });
    node.summary = generated.summary;
    node.breakdown = generated.breakdown;
    node.keyConcepts = generated.keyConcepts;
    node.duration = durationFromLessonText(generated.summary, generated.keyConcepts, generated.breakdown);
    node.lessonContent.paragraphs = generated.summary ? [generated.summary] : [];
    node.lessonContent.keyConcepts = generated.keyConcepts;
    node.quiz = generated.quiz;
    node.quiz2 = generated.quiz2;
    if (pathRecord.challenge) pathRecord.challenge.stale = true;
    await pathRecord.save();
    return res.status(200).json({ success: true, node: node.toObject() });
  } catch (error) {
    console.error('[regenerateStudyPathNode] Error:', error.message);
    return res.status(500).json({ success: false, message: error.message || 'Failed to regenerate this lesson node.' });
  }
};

/** POST /api/study-path/:topicId/node/:nodeId/analyze-summary */
export const analyzeLessonSummary = async (req, res) => {
  try {
    const { topicId, nodeId } = req.params;
    const submittedSummary = String(req.body?.summary || '').trim();
    if (submittedSummary.length < 10) {
      return res.status(400).json({ success: false, message: 'Write a little more before asking for feedback.' });
    }
    if (submittedSummary.length > 10000) {
      return res.status(400).json({ success: false, message: 'Summary is too long. Keep it under 10,000 characters.' });
    }

    const pathRecord = await StudyPath.findOne({ topicId });
    if (!pathRecord) return res.status(404).json({ success: false, message: 'Study path not found' });
    const userId = req.user?._id?.toString() || req.user?.firebaseUid;
    if (!userId) return res.status(401).json({ success: false, message: 'Please sign in to analyze your summary.' });
    if (userId !== pathRecord.userId) return res.status(403).json({ success: false, message: 'Not allowed to access this study path.' });

    const node = pathRecord.nodes.find((item) => item.id === Number(nodeId));
    if (!node) return res.status(404).json({ success: false, message: 'Study path node not found' });
    const keyConcepts = Array.isArray(node.keyConcepts) ? node.keyConcepts : [];
    const referenceSummary = String(node.summary || node.lessonContent?.paragraphs?.join('\n') || '').trim();
    const prompt = `Assess a student's summary of one lesson. Compare it with the reference summary and key concepts. Credit accurate paraphrases. Do not require exact wording. Do not give credit for unrelated claims. Return only JSON with exactly these fields: {"covered": ["specific idea the student correctly included"], "missing": ["important idea the student omitted or misstated"], "feedback": "one brief encouraging sentence"}. Keep each list to at most 5 short items. If all major ideas are covered, return an empty missing list.\nLesson title: ${node.title}\nReference summary: ${referenceSummary}\nKey concepts: ${JSON.stringify(keyConcepts)}\nStudent summary: ${submittedSummary}`;
    const analysis = await callDeepSeekForJson(prompt, { maxTokens: 800 });
    if (!Array.isArray(analysis?.covered) || !Array.isArray(analysis?.missing) || typeof analysis?.feedback !== 'string') {
      return res.status(502).json({ success: false, message: 'The AI returned an invalid summary review. Please try again.' });
    }

    await incrementAIUsage(req.user._id);
    return res.status(200).json({
      success: true,
      analysis: {
        covered: analysis.covered.slice(0, 5).map((item) => String(item).slice(0, 300)),
        missing: analysis.missing.slice(0, 5).map((item) => String(item).slice(0, 300)),
        feedback: analysis.feedback.slice(0, 500)
      }
    });
  } catch (error) {
    console.error('[analyzeLessonSummary] Error:', error.message);
    return res.status(error.status || 500).json({ success: false, message: error.message || 'Could not analyze this lesson summary.' });
  }
};

function getChallengeTokens(text) {
  return normalizeGroundingText(text)
    .split(" ")
    .filter((term) => term.length > 1 && !GROUNDING_STOP_WORDS.has(term));
}

function tokenJaccardSimilarity(textA, textB) {
  const setA = new Set(getChallengeTokens(textA));
  const setB = new Set(getChallengeTokens(textB));
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersectionCount = 0;
  for (const term of setA) {
    if (setB.has(term)) intersectionCount++;
  }
  const unionSize = new Set([...setA, ...setB]).size;
  return unionSize === 0 ? 0 : intersectionCount / unionSize;
}

export function validateChallengeQuestions(questions, nodes = [], existingQuizzes = []) {
  const problems = [];
  if (!Array.isArray(questions) || questions.length !== TOTAL_CHALLENGE_QUESTIONS) {
    problems.push("Expected exactly " + TOTAL_CHALLENGE_QUESTIONS + " questions, got " + (Array.isArray(questions) ? questions.length : 0));
    return problems;
  }

  const seenQuestions = [];
  let multiNodeCount = 0;
  const coveredNodeIds = new Set();
  const coveredUnits = new Set();

  questions.forEach((q, idx) => {
    const qNum = idx + 1;
    if (!q || typeof q !== "object") {
      problems.push("Question " + qNum + " is not a valid object");
      return;
    }

    const qText = String(q.question || "").trim();
    if (!qText) {
      problems.push("Question " + qNum + " is empty");
    } else {
      const qWords = wordCount(qText);
      if (qWords > 25 * 1.2) {
        problems.push("Question " + qNum + " exceeds 25 words by >20% (" + qWords + " words)");
      }
    }

    if (!Array.isArray(q.options) || q.options.length !== 4) {
      problems.push("Question " + qNum + " must have exactly 4 options");
    } else {
      const normalizedOpts = q.options.map(o => normalizeGroundingText(o));
      if (new Set(normalizedOpts).size !== 4) {
        problems.push("Question " + qNum + " has duplicate options");
      }
      q.options.forEach((opt, optIdx) => {
        const optWords = wordCount(opt);
        if (optWords > 10 * 1.2) {
          problems.push("Question " + qNum + " option " + (optIdx + 1) + " exceeds 10 words by >20% (" + optWords + " words)");
        }
      });
    }

    if (!Number.isInteger(q.correctAnswerIndex) || q.correctAnswerIndex < 0 || q.correctAnswerIndex > 3) {
      problems.push("Question " + qNum + " has invalid correctAnswerIndex: " + q.correctAnswerIndex);
    }

    const expText = String(q.explanation || "").trim();
    if (!expText) {
      problems.push("Question " + qNum + " explanation is missing");
    } else {
      const expWords = wordCount(expText);
      if (expWords > 30 * 1.2) {
        problems.push("Question " + qNum + " explanation exceeds 30 words by >20% (" + expWords + " words)");
      }
    }

    const sourceIds = Array.isArray(q.sourceNodeIds) ? q.sourceNodeIds.map(Number).filter(Boolean) : [];
    if (sourceIds.length === 0) {
      problems.push("Question " + qNum + " has no sourceNodeIds");
    } else {
      sourceIds.forEach(id => coveredNodeIds.add(id));
      if (sourceIds.length >= 2) multiNodeCount++;
    }

    sourceIds.forEach(id => {
      const matchedNode = nodes.find(n => n.id === id);
      if (matchedNode?.unit) coveredUnits.add(matchedNode.unit.trim().toLowerCase());
    });

    for (const prev of seenQuestions) {
      const jaccard = tokenJaccardSimilarity(qText, prev.question);
      if (jaccard > 0.55) {
        problems.push("Question " + qNum + " is duplicate of question " + prev.qNum + " (Jaccard: " + jaccard.toFixed(2) + ")");
        break;
      }
    }
    seenQuestions.push({ qNum, question: qText });

    const correctOpt = Array.isArray(q.options) && q.correctAnswerIndex >= 0 ? q.options[q.correctAnswerIndex] : "";
    const normCorrectOpt = normalizeGroundingText(correctOpt);

    for (const ex of existingQuizzes) {
      const exQ = typeof ex === "string" ? ex : (ex?.question || "");
      const jaccard = tokenJaccardSimilarity(qText, exQ);
      if (jaccard > 0.55) {
        problems.push("Question " + qNum + " repeats existing question: \"" + exQ.slice(0, 35) + "...\" (Jaccard: " + jaccard.toFixed(2) + ")");
        break;
      }
      if (typeof ex === "object" && Array.isArray(ex.options) && ex.correctAnswerIndex != null) {
        const exCorrect = normalizeGroundingText(ex.options[ex.correctAnswerIndex]);
        if (normCorrectOpt && exCorrect && normCorrectOpt === exCorrect && jaccard > 0.35) {
          problems.push("Question " + qNum + " tests identical fact as existing quiz: \"" + exQ.slice(0, 35) + "...\"");
          break;
        }
      }
    }
  });

  if (multiNodeCount < 4) {
    problems.push("Requires at least 4 multi-node synthesis questions, found " + multiNodeCount);
  }

  if (nodes.length > 0) {
    if (nodes.length <= 10) {
      const missingNodes = nodes.filter(n => !coveredNodeIds.has(n.id));
      if (missingNodes.length > 0) {
        problems.push("Missing coverage for node(s): [" + missingNodes.map(n => n.id).join(", ") + "]");
      }
    } else {
      const unitsInNodes = new Set(nodes.map(n => n.unit?.trim().toLowerCase()).filter(Boolean));
      if (unitsInNodes.size > 0) {
        const missingUnits = Array.from(unitsInNodes).filter(u => !coveredUnits.has(u));
        if (missingUnits.length > 0) {
          problems.push("Missing coverage for unit(s): [" + missingUnits.join(", ") + "]");
        }
      }
    }
  }

  return problems;
}

function shuffleQuestionOptions(question) {
  const originalOptions = question.options.map((text, idx) => ({
    text,
    isCorrect: idx === question.correctAnswerIndex
  }));
  for (let i = originalOptions.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [originalOptions[i], originalOptions[j]] = [originalOptions[j], originalOptions[i]];
  }
  const shuffledOptions = originalOptions.map(o => o.text);
  const newCorrectIndex = originalOptions.findIndex(o => o.isCorrect);
  return {
    ...question,
    options: shuffledOptions,
    correctAnswerIndex: newCorrectIndex
  };
}

async function callDeepSeekForJson(prompt, { maxTokens = 6000 } = {}) {
  if (!getEnv('DEEPSEEK_API_KEY')) {
    const error = new Error('DeepSeek is not configured on the server.');
    error.status = 503;
    throw error;
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await aiClient.chatCompletion({
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: maxTokens,
        temperature: 0.2,
        response_format: { type: 'json_object' }
      });
      const content = response.choices?.[0]?.message?.content;
      if (!content) throw new Error('DeepSeek returned an empty response.');
      return parseModelJson(content);
    } catch (cause) {
      const status = Number(cause?.status || cause?.statusCode || 0);
      const transient = status === 429 || status >= 500 || !status;
      if (!transient || attempt === 1) {
        const error = new Error(cause?.message || 'DeepSeek could not generate the requested questions.');
        error.status = transient ? 503 : 502;
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}

async function callDeepSeekForChallenge({ pathRecord, excludeQuestions = [], retryProblems = [] }) {

  const nodesData = pathRecord.nodes.map(n => ({
    id: n.id,
    title: n.title,
    unit: n.unit || "",
    summary: n.summary || "",
    keyConcepts: n.keyConcepts || [],
    sourceFacts: n.sourceFacts || []
  }));

  const promptText = challengePrompt({
    topicTitle: pathRecord.title,
    nodesData,
    excludeQuestions,
    retryProblems
  });

  const generated = await callDeepSeekForJson(promptText, { maxTokens: 8192 });
  return generated?.questions || [];
}

export async function generateChallenge(pathRecord, additionalExclusions = []) {
  const existingQuizzes = [];
  if (Array.isArray(pathRecord.nodes)) {
    for (const node of pathRecord.nodes) {
      if (node.quiz?.question) existingQuizzes.push(node.quiz);
      if (node.quiz2?.question) existingQuizzes.push(node.quiz2);
    }
  }
  if (Array.isArray(pathRecord.challenge?.attempts)) {
    for (const att of pathRecord.challenge.attempts) {
      if (Array.isArray(att.questions)) {
        for (const q of att.questions) if (q?.question) existingQuizzes.push(q);
      }
    }
  }
  if (Array.isArray(pathRecord.challenge?.questions)) {
    for (const q of pathRecord.challenge.questions) if (q?.question) existingQuizzes.push(q);
  }
  for (const item of additionalExclusions) {
    if (typeof item === "string") existingQuizzes.push({ question: item });
    else if (item?.question) existingQuizzes.push(item);
  }

  const excludeQuestionsStrings = Array.from(
    new Set(existingQuizzes.map(item => (typeof item === "string" ? item : item.question)).filter(Boolean))
  );

  console.log("[generateChallenge] Generating 10 overview questions for \"" + pathRecord.title + "\" (excluding " + excludeQuestionsStrings.length + " questions)...");

  let rawQuestions = await callDeepSeekForChallenge({
    pathRecord,
    excludeQuestions: excludeQuestionsStrings,
    retryProblems: []
  });

  let problems = validateChallengeQuestions(rawQuestions, pathRecord.nodes, existingQuizzes);

  if (problems.length > 0) {
    console.warn("[generateChallenge] Validation failed on attempt 1. Retrying with feedback:", problems);
    rawQuestions = await callDeepSeekForChallenge({
      pathRecord,
      excludeQuestions: excludeQuestionsStrings,
      retryProblems: problems
    });
    problems = validateChallengeQuestions(rawQuestions, pathRecord.nodes, existingQuizzes);
    if (problems.length > 0) {
      console.error("[generateChallenge] Validation failed on attempt 2:", problems);
      const err = new Error("Generated challenge failed validation: " + problems.join("; "));
      err.status = 502;
      err.problems = problems;
      throw err;
    }
  }

  const processed = rawQuestions.map((q, idx) => {
    const shuffled = shuffleQuestionOptions(q);
    return {
      id: idx + 1,
      question: shuffled.question,
      options: shuffled.options,
      correctAnswerIndex: shuffled.correctAnswerIndex,
      explanation: shuffled.explanation,
      sourceNodeIds: Array.isArray(shuffled.sourceNodeIds) ? shuffled.sourceNodeIds.map(Number).filter(Boolean) : [],
      type: shuffled.type || "recall",
      xp: CHALLENGE_XP_PER_QUESTION
    };
  });

  return processed;
}

export const getChallenge = async (req, res) => {
  try {
    const { topicId } = req.params;
    const pathRecord = await StudyPath.findOne({ topicId });
    if (!pathRecord) return res.status(404).json({ success: false, message: "Study path not found" });

    const userId = req.user?._id?.toString() || req.user?.firebaseUid;
    if (userId && userId !== "anonymous-user" && pathRecord.userId && pathRecord.userId !== "anonymous-user" && userId !== pathRecord.userId) {
      return res.status(403).json({ success: false, message: "Not allowed to access this study path" });
    }

    if (!Array.isArray(pathRecord.nodes) || pathRecord.nodes.length === 0 || pathRecord.nodes.some(n => n.status !== "completed")) {
      return res.status(409).json({ success: false, message: "Complete every lesson before starting the unit challenge." });
    }

    if (Array.isArray(pathRecord.challenge?.questions) && pathRecord.challenge.questions.length === TOTAL_CHALLENGE_QUESTIONS && !pathRecord.challenge.stale) {
      return res.status(200).json({
        success: true,
        questions: pathRecord.challenge.questions,
        passMark: PASS_MARK,
        maxXp: MAX_CHALLENGE_XP
      });
    }

    const questions = await generateChallenge(pathRecord);
    if (!pathRecord.challenge) pathRecord.challenge = {};
    pathRecord.challenge.questions = questions;
    pathRecord.challenge.generatedAt = new Date();
    pathRecord.challenge.stale = false;
    if (pathRecord.challenge.status !== "completed") {
      pathRecord.challenge.status = "active";
    }
    await pathRecord.save();

    return res.status(200).json({
      success: true,
      questions,
      passMark: PASS_MARK,
      maxXp: MAX_CHALLENGE_XP
    });
  } catch (error) {
    console.error("[getChallenge] Error:", error.message);
    const status = error.status || 500;
    return res.status(status).json({
      success: false,
      message: error.message || "Failed to retrieve challenge questions",
      issues: error.problems || []
    });
  }
};

export const submitChallenge = async (req, res) => {
  try {
    const { topicId } = req.params;
    const { answers } = req.body || {};

    if (!Array.isArray(answers) || answers.length !== TOTAL_CHALLENGE_QUESTIONS) {
      return res.status(400).json({
        success: false,
        message: "Body must include answers array with exactly " + TOTAL_CHALLENGE_QUESTIONS + " items."
      });
    }

    const pathRecord = await StudyPath.findOne({ topicId });
    if (!pathRecord) return res.status(404).json({ success: false, message: "Study path not found" });

    const userId = req.user?._id?.toString() || req.user?.firebaseUid;
    if (userId && userId !== "anonymous-user" && pathRecord.userId && pathRecord.userId !== "anonymous-user" && userId !== pathRecord.userId) {
      return res.status(403).json({ success: false, message: "Not allowed to submit this challenge" });
    }

    const storedQuestions = pathRecord.challenge?.questions;
    if (!Array.isArray(storedQuestions) || storedQuestions.length !== TOTAL_CHALLENGE_QUESTIONS) {
      return res.status(400).json({
        success: false,
        message: "No active challenge questions found. Open the challenge first."
      });
    }

    let score = 0;
    let attemptXp = 0;
    const perQuestion = [];
    const missedNodeIdsSet = new Set();

    storedQuestions.forEach((q, idx) => {
      const studentAnswer = answers[idx];
      const isCorrect = studentAnswer === q.correctAnswerIndex;
      const qXp = q.xp || CHALLENGE_XP_PER_QUESTION;

      if (isCorrect) {
        score++;
        attemptXp += qXp;
      } else {
        if (Array.isArray(q.sourceNodeIds)) {
          q.sourceNodeIds.forEach(id => missedNodeIdsSet.add(Number(id)));
        }
      }

      perQuestion.push({
        id: q.id,
        correct: isCorrect,
        xp: isCorrect ? qXp : 0
      });
    });

    const passed = score >= PASS_MARK;
    const missedNodeIds = Array.from(missedNodeIdsSet).sort((a, b) => a - b);
    const alreadyPassedBefore = Boolean(pathRecord.challenge?.passed);

    let xpAwarded = 0;
    if (alreadyPassedBefore) {
      xpAwarded = 0;
    } else {
      const prevBestXp = pathRecord.challenge?.bestXp || 0;
      xpAwarded = Math.max(0, attemptXp - prevBestXp);
      if (!pathRecord.challenge) pathRecord.challenge = {};
      pathRecord.challenge.bestXp = Math.max(prevBestXp, attemptXp);
    }

    if (!pathRecord.challenge) pathRecord.challenge = {};
    pathRecord.challenge.bestScore = Math.max(pathRecord.challenge.bestScore || 0, score);

    if (passed) {
      pathRecord.challenge.passed = true;
      pathRecord.challenge.status = "completed";
      pathRecord.completed = true;
      pathRecord.currentProgress = 100;
    }

    if (!Array.isArray(pathRecord.challenge.attempts)) {
      pathRecord.challenge.attempts = [];
    }

    pathRecord.challenge.attempts.push({
      score,
      total: TOTAL_CHALLENGE_QUESTIONS,
      passed,
      attemptXp,
      xpAwarded,
      answers,
      missedNodeIds,
      takenAt: new Date()
    });

    await pathRecord.save();

    if (xpAwarded > 0 && userId && userId !== "anonymous-user") {
      try {
        await awardXP(userId, "unit_challenge", { amount: xpAwarded });
      } catch (xpErr) {
        console.warn("[submitChallenge] Failed to award XP:", xpErr.message);
      }
    }

    return res.status(200).json({
      success: true,
      score,
      total: TOTAL_CHALLENGE_QUESTIONS,
      passed,
      passMark: PASS_MARK,
      attemptXp,
      xpAwarded,
      maxXp: MAX_CHALLENGE_XP,
      missedNodeIds,
      perQuestion
    });
  } catch (error) {
    console.error("[submitChallenge] Error:", error.message);
    return res.status(500).json({ success: false, message: error.message || "Failed to submit challenge" });
  }
};

export const retryChallenge = async (req, res) => {
  try {
    const { topicId } = req.params;
    const pathRecord = await StudyPath.findOne({ topicId });
    if (!pathRecord) return res.status(404).json({ success: false, message: "Study path not found" });

    const userId = req.user?._id?.toString() || req.user?.firebaseUid;
    if (userId && userId !== "anonymous-user" && pathRecord.userId && pathRecord.userId !== "anonymous-user" && userId !== pathRecord.userId) {
      return res.status(403).json({ success: false, message: "Not allowed to retry this challenge" });
    }

    if (!Array.isArray(pathRecord.nodes) || pathRecord.nodes.length === 0 || pathRecord.nodes.some(n => n.status !== "completed")) {
      return res.status(409).json({ success: false, message: "Complete every lesson before starting the unit challenge." });
    }

    const previousQuestions = [];
    if (Array.isArray(pathRecord.challenge?.questions)) {
      for (const q of pathRecord.challenge.questions) if (q?.question) previousQuestions.push(q.question);
    }
    if (Array.isArray(pathRecord.challenge?.attempts)) {
      for (const att of pathRecord.challenge.attempts) {
        if (Array.isArray(att.questions)) {
          for (const q of att.questions) if (q?.question) previousQuestions.push(q.question);
        }
      }
    }

    if (!pathRecord.challenge) pathRecord.challenge = {};
    pathRecord.challenge.questions = [];

    const newQuestions = await generateChallenge(pathRecord, previousQuestions);
    pathRecord.challenge.questions = newQuestions;
    pathRecord.challenge.generatedAt = new Date();
    pathRecord.challenge.stale = false;
    if (pathRecord.challenge.status !== "completed") {
      pathRecord.challenge.status = "active";
    }

    await pathRecord.save();

    return res.status(200).json({
      success: true,
      questions: newQuestions,
      passMark: PASS_MARK,
      maxXp: MAX_CHALLENGE_XP
    });
  } catch (error) {
    console.error("[retryChallenge] Error:", error.message);
    const status = error.status || 500;
    return res.status(status).json({
      success: false,
      message: error.message || "Failed to regenerate challenge",
      issues: error.problems || []
    });
  }
};

export const generateStudyPathChallenge = getChallenge;


/**
 * PUT /api/study-path/:topicId/node/:nodeId
 */
export const updateNodeStatus = async (req, res) => {
  try {
    const { topicId, nodeId } = req.params;
    const { status } = req.body;
    const targetId = parseInt(nodeId, 10);

    const pathRecord = await StudyPath.findOne({ topicId });
    if (!pathRecord) {
      return res.status(404).json({ success: false, message: 'Study path not found' });
    }

    const nodeIndex = pathRecord.nodes.findIndex(n => n.id === targetId);
    if (nodeIndex !== -1) {
      pathRecord.nodes[nodeIndex].status = status;

      if (status === 'completed' && nodeIndex + 1 < pathRecord.nodes.length) {
        if (pathRecord.nodes[nodeIndex + 1].status === 'locked') {
          pathRecord.nodes[nodeIndex + 1].status = 'active';
        }
      }

      pathRecord.currentProgress = pathRecord.nodes.filter(n => n.status === 'completed').length;
      await pathRecord.save();
    }

    return res.status(200).json({
      success: true,
      studyPath: {
        topicId: pathRecord.topicId,
        title: pathRecord.title,
        courseCode: pathRecord.courseCode,
        currentProgress: pathRecord.currentProgress,
        nodes: pathRecord.nodes
      }
    });

  } catch (error) {
    console.error('[updateNodeStatus] Error:', error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
};
