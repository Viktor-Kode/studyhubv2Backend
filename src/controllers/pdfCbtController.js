import { parseDocumentBuffer } from '../utils/documentParser.js';
import fetch from 'node-fetch';
import { getEnv } from '../config/env.js';
import LibraryDocument from '../models/LibraryDocument.js';
import { uploadToCloudinary } from '../utils/cloudinary.js';

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
    const qMatch = line.match(/^(\d+[\).\s]+|Q(?:uestion)?\s*\d+[:.)\s]+|\*\s*\d+\.?)(.+)$/i);

    if (!qMatch) {
      i += 1;
      continue;
    }

    let questionText = qMatch[2]?.trim() || '';
    const optionBag = { A: '', B: '', C: '', D: '' };
    const optionRegex = /^([A-D])[\).:\-\s]+(.+)$/i;
    let j = i + 1;
    let optionHits = 0;
    let foundAnswer = '';

    while (j < lines.length) {
      const nextLine = lines[j];
      if (/^(\d+[\).\s-]+|Q(?:uestion)?\s*\d+[:.)\s-]+)/i.test(nextLine)) break;

      const opt = nextLine.match(optionRegex);
      if (opt) {
        const key = opt[1].toUpperCase();
        optionBag[key] = opt[2].trim();
        optionHits += 1;
      } else {
        const ansMatch = nextLine.match(/ans(?:wer)?[:\s-]+([A-D])\b/i);
        if (ansMatch) {
          foundAnswer = ansMatch[1].toUpperCase();
        } else if (optionHits === 0 && !/^ans(wer)?[:\s-]/i.test(nextLine)) {
          questionText = `${questionText} ${nextLine}`.trim();
        }
      }

      j += 1;
    }

    if (questionText) {
      if (optionHits >= 2 && (optionBag.A || optionBag.B)) {
        questions.push({
          type: 'objective',
          question: questionText,
          options: optionBag,
          answer: foundAnswer || 'A',
        });
      } else {
        questions.push({
          type: 'theory',
          question: questionText,
          options: null,
          answer: foundAnswer || 'No model answer provided.',
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
      Authorization: `Bearer ${getEnv('DEEPSEEK_API_KEY')}`,
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

/**
 * Step 1: Extract text from PDF/Document.
 */
export const extractOnly = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    console.log(`[PDF CBT Extract] Processing ${req.file.originalname}`);

    // Extraction with 30s timeout
    const extractionPromise = parseDocumentBuffer(req.file.buffer, req.file.originalname, req.file.mimetype);
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Extraction timed out after 30 seconds')), 30000)
    );

    const parsed = await Promise.race([extractionPromise, timeoutPromise]);
    const rawText = parsed.text;
    const docTitle = req.file.originalname.replace(/\.[^/.]+$/i, '');

    if (!rawText || rawText.trim().length < 50) {
      return res.status(422).json({
        error: 'The document does not contain enough readable text (minimum 50 characters required).'
      });
    }

    // Save to library in background (optional but helpful)
    void (async () => {
      try {
        const cloudinaryResult = await uploadToCloudinary(req.file.buffer, req.file.originalname);
        await LibraryDocument.create({
          userId: req.user._id,
          title: docTitle,
          fileUrl: cloudinaryResult.secure_url || cloudinaryResult.url,
          fileType: req.file.mimetype,
          fileSize: req.file.size,
          extractedText: rawText || ''
        });
      } catch (e) {
        console.error('[PDF CBT Background Save] Failed:', e.message);
      }
    })();

    return res.status(200).json({
      success: true,
      text: rawText,
      title: docTitle,
      chars: rawText.length
    });

  } catch (error) {
    console.error("❌ PDF CBT extractOnly Error:", error.message);
    return res.status(error.message.includes('timeout') ? 504 : 500).json({
      error: error.message || "Failed to extract text from document"
    });
  }
};

/**
 * Step 2: Generate questions from extracted text.
 */
export const generateOnly = async (req, res) => {
  try {
    const { text, requestedCount: reqCount } = req.body;

    if (!text || text.trim().length < 50) {
      return res.status(400).json({ error: 'Text content is too short for question generation.' });
    }

    const requestedCountRaw = Number.parseInt(String(reqCount || ''), 10);
    const requestedCount = Number.isFinite(requestedCountRaw)
      ? Math.min(Math.max(requestedCountRaw, 1), 100)
      : 60;

    const cleaned = cleanPdfText(text);
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

    const aiContent = await callAiForQuestions(prompt);
    const parsedData = parseAiJson(aiContent);

    if (!parsedData || !parsedData.questions) {
      return res.status(500).json({ error: 'AI failed to generate valid question data. Please try again.' });
    }

    // Post-process questions for consistency
    const questions = parsedData.questions
      .slice(0, requestedCount)
      .map((q) => {
        const hasObjectiveOptions = q?.options?.A && q?.options?.B && q?.options?.C && q?.options?.D;
        const answerText = String(q.answer || '').trim();
        const isObjective = String(q.type || '').toLowerCase() === 'objective' || hasObjectiveOptions;
        
        let safeAnswer = answerText;
        if (isObjective) {
          const normalized = answerText.toUpperCase();
          if (['A', 'B', 'C', 'D'].includes(normalized)) {
            safeAnswer = normalized;
          } else {
            const startMatch = answerText.match(/^([A-D])[\s\.)-]/i);
            if (startMatch) {
              safeAnswer = startMatch[1].toUpperCase();
            } else {
              const patternMatch = answerText.match(/answer[:\s]+([A-D])\b/i) || answerText.match(/\b([A-D])\b/i);
              if (patternMatch) {
                safeAnswer = patternMatch[1].toUpperCase();
              } else {
                safeAnswer = normalized.length === 1 && normalized >= 'A' && normalized <= 'D' ? normalized : 'A';
              }
            }
          }
        }

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
          answer: safeAnswer,
        };
      });

    return res.status(200).json({
      subject: parsedData.subject || 'General',
      totalFound: questions.length,
      questions,
    });

  } catch (error) {
    console.error("❌ PDF CBT generateOnly Error:", error.message);
    return res.status(500).json({ error: "Failed to generate questions from text. Please try again." });
  }
};

/**
 * Legacy wrapper for the two-step flow.
 * DEPRECATED: Frontends should move to extractOnly -> generateOnly.
 */
export const extractQuestionsFromPDF = async (req, res) => {
  try {
    return res.status(400).json({ error: "Endpoint deprecated. Use /extract and /generate steps." });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
