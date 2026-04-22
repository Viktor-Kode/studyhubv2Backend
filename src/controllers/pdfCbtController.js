import { parsePdfBuffer } from '../utils/parsePdf.js';
import fetch from 'node-fetch';

const cleanPdfText = (text) => {
  return text
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/page \d+ of \d+/gi, '')
    .replace(/^\s*\d+\s*$/gm, '')
    .replace(/copyright.{0,80}/gi, '')
    .replace(/all rights reserved.{0,50}/gi, '')
    .trim();
};

const smartExtract = (text, maxChars = 14000) => {
  if (text.length <= maxChars) return text;
  const third = Math.floor(maxChars / 3);
  const start = text.slice(0, third);
  const mid = text.slice(
    Math.floor(text.length / 2) - Math.floor(third / 2),
    Math.floor(text.length / 2) + Math.floor(third / 2)
  );
  const end = text.slice(text.length - third);
  return `${start}\n...\n${mid}\n...\n${end}`;
};

const extractJsonCandidate = (text) => {
  const withoutFences = String(text || '').replace(/```json|```/gi, '').trim();
  const start = withoutFences.indexOf('{');
  const end = withoutFences.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return withoutFences;
  return withoutFences.slice(start, end + 1);
};

const repairJsonString = (jsonLike) => {
  return String(jsonLike || '')
    .replace(/,\s*([}\]])/g, '$1')
    .replace(/\u201c|\u201d/g, '"')
    .replace(/\u2018|\u2019/g, "'")
    .replace(/\t/g, ' ');
};

const parseAiJson = (content) => {
  const candidate = extractJsonCandidate(content);
  try {
    return JSON.parse(candidate);
  } catch (_e) {
    const repaired = repairJsonString(candidate);
    return JSON.parse(repaired);
  }
};

const normalizeLine = (line) => String(line || '').replace(/\s+/g, ' ').trim();

const extractQuestionsHeuristically = (text, requestedCount = 60) => {
  const lines = String(text || '')
    .split('\n')
    .map((line) => normalizeLine(line))
    .filter(Boolean);

  const questions = [];
  let i = 0;

  while (i < lines.length && questions.length < requestedCount) {
    const line = lines[i];
    const qMatch = line.match(/^(\d+[\).\s-]+|Q(?:uestion)?\s*\d+[:.)\s-]+)(.+)$/i);

    if (!qMatch) {
      i += 1;
      continue;
    }

    let questionText = qMatch[2]?.trim() || '';
    const optionBag = { A: '', B: '', C: '', D: '' };
    const optionRegex = /^([A-D])[\).:\-\s]+(.+)$/i;
    let j = i + 1;
    let optionHits = 0;

    while (j < lines.length) {
      const nextLine = lines[j];
      if (/^(\d+[\).\s-]+|Q(?:uestion)?\s*\d+[:.)\s-]+)/i.test(nextLine)) break;

      const opt = nextLine.match(optionRegex);
      if (opt) {
        const key = opt[1].toUpperCase();
        optionBag[key] = opt[2].trim();
        optionHits += 1;
      } else if (optionHits === 0 && !/^ans(wer)?[:\s-]/i.test(nextLine)) {
        questionText = `${questionText} ${nextLine}`.trim();
      }

      j += 1;
    }

    if (questionText) {
      if (optionHits >= 3 && optionBag.A && optionBag.B) {
        questions.push({
          type: 'objective',
          question: questionText,
          options: optionBag,
          answer: 'A',
        });
      } else {
        questions.push({
          type: 'theory',
          question: questionText,
          options: null,
          answer: 'No model answer provided.',
        });
      }
    }

    i = j;
  }

  return questions.slice(0, requestedCount);
};

const requestJsonRepair = async (rawContent) => {
  const repairPrompt = `Convert the following content into valid JSON only.
Rules:
- Output valid JSON only (no markdown, no explanation)
- Keep original meaning
- Ensure the root shape is:
{"subject":"General","totalFound":0,"questions":[]}

CONTENT:
${rawContent}`;

  const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: repairPrompt }],
      max_tokens: 2500,
      temperature: 0,
    }),
  });

  const data = await response.json();
  return data?.choices?.[0]?.message?.content?.trim() || '';
};

export const extractQuestionsFromPDF = async (req, res) => {
  try {
    let rawText = req.body?.text;

    if (!rawText && req.file) {
      const parsed = await parsePdfBuffer(req.file.buffer);
      rawText = parsed.text;
    }

    if (!rawText || rawText.trim().length < 50) {
      return res.status(400).json({
        error: 'Could not extract enough text from this document. If it is a scanned image or handwritten, please wait for the OCR to finish or try a clearer file.',
      });
    }

    const requestedCountRaw = Number.parseInt(String(req.body?.requestedCount || ''), 10);
    const requestedCount = Number.isFinite(requestedCountRaw)
      ? Math.min(Math.max(requestedCountRaw, 1), 100)
      : 60;

    const cleaned = cleanPdfText(rawText);
    const truncated = smartExtract(cleaned, 14000);

    const prompt = `You are an exam question extractor. The text below is from a past question PDF that contains questions AND their answers mixed together.

Your job:
1. Extract ALL valid questions (both objective and theory/essay/short-answer)
2. Identify the best answer for each question from nearby answer keys or marking guides
3. Strip long answer explanations, keeping only concise final answers
4. Return them in structured JSON

Rules:
- Include objective questions when options A, B, C, D are available
- Include theory/essay/short-answer questions even if options are not available
- If a question has an answer key or "Answer: X" nearby, capture that answer
- If no answer is found, provide the most likely concise answer
- Extract as many complete questions as possible (target up to ${requestedCount})
- Keep questions exactly as written — do not rephrase

Return ONLY this JSON format with no extra text:
{
  "subject": "detected subject name or General",
  "totalFound": number,
  "questions": [
    {
      "type": "objective or theory",
      "question": "Question text here?",
      "options": {
        "A": "Option A text",
        "B": "Option B text",
        "C": "Option C text",
        "D": "Option D text"
      } OR null,
      "answer": "For objective: A/B/C/D. For theory: concise model answer text"
    }
  ]
}

PDF TEXT:
${truncated}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 100000); // 100s timeout

    let response;
    try {
      response = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 3500,
          temperature: 0.1,
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content?.trim();

    if (!content) {
      return res.status(500).json({ error: 'AI failed to process the PDF' });
    }

    let parsed;
    try {
      parsed = parseAiJson(content);
    } catch (_parseError) {
      const repairedContent = await requestJsonRepair(content);
      parsed = parseAiJson(repairedContent);
    }

    const aiQuestions = Array.isArray(parsed?.questions) ? parsed.questions : [];
    let questions = aiQuestions
      .filter((q) => q?.question)
      .slice(0, requestedCount)
      .map((q) => {
        const hasObjectiveOptions = q?.options?.A && q?.options?.B && q?.options?.C && q?.options?.D;
        const answerText = String(q.answer || '').trim();
        const normalizedObjectiveAnswer = answerText.toUpperCase();
        const safeObjectiveAnswer = ['A', 'B', 'C', 'D'].includes(normalizedObjectiveAnswer)
          ? normalizedObjectiveAnswer
          : 'A';
        const isObjective = String(q.type || '').toLowerCase() === 'objective' || hasObjectiveOptions;
        return {
          type: isObjective ? 'objective' : 'theory',
          question: String(q.question).trim(),
          options: isObjective
            ? {
                A: String(q.options?.A || '').trim(),
                B: String(q.options?.B || '').trim(),
                C: String(q.options?.C || '').trim(),
                D: String(q.options?.D || '').trim(),
              }
            : null,
          answer: isObjective ? safeObjectiveAnswer : answerText || 'No model answer provided.',
        };
      });

    if (!questions.length) {
      questions = extractQuestionsHeuristically(cleaned, requestedCount);
    }

    if (!questions.length) {
      return res.status(400).json({
        error: 'No valid questions found in this PDF. Try a clearer or text-based PDF.',
      });
    }

    res.json({
      subject: parsed.subject || 'General',
      totalFound: questions.length,
      questions,
    });
  } catch (err) {
    console.error('[PDF CBT Extract]', err.message);
    if (err instanceof SyntaxError) {
      return res.status(500).json({ error: 'AI returned malformed data. Try a cleaner PDF.' });
    }
    return res.status(500).json({ error: err.message || 'Failed to extract questions from PDF.' });
  }
};
