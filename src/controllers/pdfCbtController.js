import pdfParse from 'pdf-parse';
import fetch from 'node-fetch';

export const extractQuestionsFromPDF = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No PDF uploaded' });
    }

    const pdfData = await pdfParse(req.file.buffer);
    const rawText = pdfData?.text || '';

    if (!rawText || rawText.trim().length < 50) {
      return res.status(400).json({
        error: 'Could not extract text from this PDF. Make sure it is not a scanned image.',
      });
    }

    const truncated = rawText.slice(0, 12000);

    const prompt = `You are an exam question extractor. The text below is from a past question PDF that contains questions AND their answers mixed together.

Your job:
1. Extract ONLY the questions (multiple choice questions with options A, B, C, D)
2. Identify the correct answer for each question
3. Strip the answer explanations completely
4. Return them in structured JSON

Rules:
- Only include questions that have clear multiple choice options (A, B, C, D)
- If a question has an answer key or "Answer: X" nearby, capture that as the correct answer
- If no answer is found, make your best judgment based on the options
- Extract maximum 40 questions
- Keep questions exactly as written — do not rephrase
- Do not include essay or theory questions

Return ONLY this JSON format with no extra text:
{
  "subject": "detected subject name or General",
  "totalFound": number,
  "questions": [
    {
      "question": "Question text here?",
      "options": {
        "A": "Option A text",
        "B": "Option B text",
        "C": "Option C text",
        "D": "Option D text"
      },
      "answer": "A"
    }
  ]
}

PDF TEXT:
${truncated}`;

    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 4000,
        temperature: 0.1,
      }),
    });

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content?.trim();

    if (!content) {
      return res.status(500).json({ error: 'AI failed to process the PDF' });
    }

    const clean = content.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);

    if (!parsed?.questions || parsed.questions.length === 0) {
      return res.status(400).json({
        error:
          'No multiple choice questions found in this PDF. Make sure the PDF contains questions with A, B, C, D options.',
      });
    }

    const questions = parsed.questions
      .filter((q) => q?.question && q?.options?.A && q?.options?.B && q?.options?.C && q?.options?.D)
      .slice(0, 40)
      .map((q) => {
        const answer = String(q.answer || 'A').trim().toUpperCase();
        const safeAnswer = ['A', 'B', 'C', 'D'].includes(answer) ? answer : 'A';
        return {
          question: String(q.question).trim(),
          options: {
            A: String(q.options.A || '').trim(),
            B: String(q.options.B || '').trim(),
            C: String(q.options.C || '').trim(),
            D: String(q.options.D || '').trim(),
          },
          answer: safeAnswer,
        };
      });

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
