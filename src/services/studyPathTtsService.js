import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import https from 'https';

/**
 * Normalizes study note markdown/text into smooth conversational tutor prose.
 */
export function sanitizeTextForSpeech(text = '') {
  if (!text || typeof text !== 'string') return '';

  let clean = text;

  // Remove markdown headers, bold, italics, strikethrough, backticks
  clean = clean.replace(/#{1,6}\s+/g, '');
  clean = clean.replace(/(\*\*|__)(.*?)\1/g, '$2');
  clean = clean.replace(/(\*|_)(.*?)\1/g, '$2');
  clean = clean.replace(/~~(.*?)~~/g, '$2');
  clean = clean.replace(/`([^`]+)`/g, '$1');

  // Strip code blocks
  clean = clean.replace(/```[\s\S]*?```/g, '');

  // Convert bullet points to soft pauses
  clean = clean.replace(/^\s*[-*+]\s+/gm, ', ');
  clean = clean.replace(/^\s*\d+\.\s+/gm, ', ');

  // Clean common LaTeX and mathematical symbols
  clean = clean.replace(/\$([^$]+)\$/g, '$1');
  clean = clean.replace(/\\rightarrow/g, ' leads to ');
  clean = clean.replace(/\\Rightarrow/g, ' implies that ');
  clean = clean.replace(/\\times/g, ' times ');
  clean = clean.replace(/\\pm/g, ' plus or minus ');
  clean = clean.replace(/\\le|\\leq/g, ' less than or equal to ');
  clean = clean.replace(/\\ge|\\geq/g, ' greater than or equal to ');
  clean = clean.replace(/\\ne|\\neq/g, ' not equal to ');
  clean = clean.replace(/\\approx/g, ' approximately ');
  clean = clean.replace(/=/g, ' equals ');
  clean = clean.replace(/\+/g, ' plus ');
  clean = clean.replace(/\^2/g, ' squared ');
  clean = clean.replace(/\^3/g, ' cubed ');

  // Common chemical abbreviations spoken naturally
  clean = clean.replace(/\bH2O\b/g, 'H 2 O');
  clean = clean.replace(/\bCO2\b/g, 'C O 2');
  clean = clean.replace(/\bATP\b/g, 'A T P');
  clean = clean.replace(/\bDNA\b/g, 'D N A');
  clean = clean.replace(/\bRNA\b/g, 'R N A');

  // Normalize consecutive spaces, tabs, and newlines
  clean = clean.replace(/[ \t]+/g, ' ');
  clean = clean.replace(/\n\s*\n+/g, '. ');
  clean = clean.replace(/\n+/g, ', ');

  return clean.trim();
}

/**
 * Builds the structured, timed narration script from learning node properties.
 */
export function buildNodeNarration(node) {
  if (!node) return { scriptText: '', sections: [] };

  const sections = [];

  // 1. Introduction
  const titleClean = sanitizeTextForSpeech(node.title || 'Study Note');
  sections.push({
    type: 'intro',
    text: `Lesson: ${titleClean}.`
  });

  // 2. Analogy (if available)
  const analogy = node.lessonContent?.analogy || '';
  if (analogy.trim()) {
    const cleanAnalogy = sanitizeTextForSpeech(analogy);
    sections.push({
      type: 'analogy',
      label: 'Analogy',
      text: `To understand this simply: ${cleanAnalogy}`
    });
  }

  // 3. Core Lesson Paragraphs
  const paragraphs = Array.isArray(node.lessonContent?.paragraphs) ? node.lessonContent.paragraphs : [];
  paragraphs.forEach((p, index) => {
    const cleanP = sanitizeTextForSpeech(p);
    if (cleanP) {
      sections.push({
        type: 'paragraph',
        index,
        text: cleanP
      });
    }
  });

  // 4. Breakdown slides (if paragraphs are empty, fallback to breakdown)
  if (paragraphs.length === 0 && Array.isArray(node.breakdown) && node.breakdown.length > 0) {
    node.breakdown.forEach((slide, idx) => {
      const heading = sanitizeTextForSpeech(slide.heading || '');
      const body = sanitizeTextForSpeech(slide.body || '');
      if (body) {
        sections.push({
          type: 'breakdown',
          index: idx,
          text: heading ? `${heading}: ${body}` : body
        });
      }
    });
  }

  // 5. Memory Tip
  const memoryTip = node.breakdown?.find(b => b?.memoryTip)?.memoryTip || '';
  if (memoryTip.trim()) {
    const cleanTip = sanitizeTextForSpeech(memoryTip);
    sections.push({
      type: 'memoryTip',
      label: 'Memory Tip',
      text: `Quick memory tip: ${cleanTip}`
    });
  }

  // Combine full script with natural pauses between sections
  const fullScript = sections.map(s => s.text).join('\n\n');

  return {
    scriptText: fullScript,
    sections,
    estimatedDurationSeconds: Math.ceil(fullScript.split(/\s+/).length / 2.5) // ~150 words per minute
  };
}

/**
 * Splits text into sentence chunks under 180 characters at punctuation boundaries.
 */
function splitTextIntoSentences(text, maxChunkLen = 180) {
  if (!text) return [];
  // Split on periods, exclamation marks, question marks, semicolons or newlines
  const rawSentences = text.match(/[^.!?;\n]+[.!?;\n]+/g) || [text];
  const chunks = [];
  let current = '';

  for (const raw of rawSentences) {
    const s = raw.trim();
    if (!s) continue;

    if ((current + ' ' + s).trim().length <= maxChunkLen) {
      current = (current + ' ' + s).trim();
    } else {
      if (current) chunks.push(current);
      if (s.length <= maxChunkLen) {
        current = s;
      } else {
        // Fallback for very long single sentence: split on comma/spaces
        const words = s.split(' ');
        let subChunk = '';
        for (const w of words) {
          if ((subChunk + ' ' + w).trim().length <= maxChunkLen) {
            subChunk = (subChunk + ' ' + w).trim();
          } else {
            if (subChunk) chunks.push(subChunk);
            subChunk = w;
          }
        }
        current = subChunk;
      }
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

/**
 * Fetches a single audio chunk from the zero-auth Google TTS endpoint.
 */
function fetchTtsChunk(chunkText, locale = 'en-ng') {
  return new Promise((resolve, reject) => {
    const encoded = encodeURIComponent(chunkText);
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encoded}&tl=${locale}&client=tw-ob`;

    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
      }
    }, (res) => {
      if (res.statusCode !== 200) {
        return reject(new Error(`TTS server returned HTTP ${res.statusCode}`));
      }
      const data = [];
      res.on('data', d => data.push(d));
      res.on('end', () => resolve(Buffer.concat(data)));
    }).on('error', reject);
  });
}

/**
 * Synthesizes full prose text into a seamless, concatenated MP3 buffer.
 * Completely free ($0), requires zero API keys, and has zero external dependencies.
 */
export async function synthesizeNeuralTts(text, options = {}) {
  const voice = options.voice || 'en-NG-EzinneNeural';
  let locale = 'en-ng';

  if (voice.toLowerCase().includes('us') || voice.toLowerCase().includes('jenny') || voice.toLowerCase().includes('guy')) {
    locale = 'en-us';
  } else if (voice.toLowerCase().includes('gb') || voice.toLowerCase().includes('uk') || voice.toLowerCase().includes('sonia')) {
    locale = 'en-uk';
  } else {
    locale = 'en-ng';
  }

  const chunks = splitTextIntoSentences(text, 180);
  if (chunks.length === 0) {
    throw new Error('No readable sentences found to synthesize.');
  }

  const audioBuffers = [];

  // Synthesize chunks in small batches of 3 to be respectful and fast
  const batchSize = 3;
  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    const results = await Promise.all(batch.map(chunk => fetchTtsChunk(chunk, locale)));
    audioBuffers.push(...results);
  }

  return Buffer.concat(audioBuffers);
}

/**
 * Gets or synthesizes node audio, utilizing a persistent disk cache in uploads/study-path-audio/
 */
export async function getOrGenerateNodeAudio(topicId, node, options = {}) {
  const voice = options.voice || 'en-NG-EzinneNeural';
  const speed = options.speed || '+0%';

  // Ensure cache directory exists
  const cacheDir = path.resolve(process.cwd(), 'uploads', 'study-path-audio');
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }

  // Create safe cache filename based on topicId, nodeId, and voice
  const safeVoiceKey = voice.replace(/[^a-zA-Z0-9_-]/g, '');
  const cacheFileName = `${topicId}_node_${node.id}_${safeVoiceKey}.mp3`;
  const cacheFilePath = path.join(cacheDir, cacheFileName);

  // Return cached file path if already generated
  if (fs.existsSync(cacheFilePath)) {
    const stats = fs.statSync(cacheFilePath);
    if (stats.size > 1024) {
      return {
        filePath: cacheFilePath,
        isCached: true,
        size: stats.size
      };
    }
  }

  // Build the script from the node
  const { scriptText } = buildNodeNarration(node);
  if (!scriptText || scriptText.trim().length === 0) {
    throw new Error('This node has no lesson content to read out loud.');
  }

  // Synthesize via free audio engine
  const audioBuffer = await synthesizeNeuralTts(scriptText, { voice, speed });

  // Save to disk
  fs.writeFileSync(cacheFilePath, audioBuffer);

  return {
    filePath: cacheFilePath,
    isCached: false,
    size: audioBuffer.length
  };
}
