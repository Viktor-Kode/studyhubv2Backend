import aiClient from '../utils/aiClient.js';

export const generateTeacherQuestions = async ({
    documentText,
    questionCount,
    marksPerQuestion,
    questionTypes,
    assessmentType,
    subject,
    classLevel
}) => {
    const typeInstructions = questionTypes.map(t => {
        if (t === 'mcq') return 'Multiple choice questions with 4 options (A, B, C, D)';
        if (t === 'true_false') return 'True or False questions';
        if (t === 'short_answer') return 'Short answer questions (1-3 sentences)';
        return t;
    }).join(', ');

    const prompt = `You are an expert Nigerian teacher creating a ${assessmentType || 'test'} for ${classLevel || 'students'}.

Subject: ${subject || 'General'}
Assessment Type: ${assessmentType || 'test'}
Number of Questions: ${questionCount}
Marks per Question: ${marksPerQuestion}
Question Types: ${typeInstructions}

Based on this document content:
---
${documentText}
---

Generate exactly ${questionCount} questions. Return ONLY a valid JSON array with no extra text.

Format:
[
  {
    "text": "Question text here",
    "type": "mcq",
    "options": ["A. Option 1", "B. Option 2", "C. Option 3", "D. Option 4"],
    "answer": "A. Option 1",
    "explanation": "Brief explanation why this is correct",
    "marks": ${marksPerQuestion},
    "order": 1
  }
]

For true_false questions, options should be ["True", "False"].
For short_answer questions, options should be [].
Answer must be the exact correct answer text.
Make questions relevant to the document content.
Vary difficulty — mix easy, medium and hard questions.`;

    const response = await aiClient.chatCompletion({
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 4000,
        temperature: 0.7
    });

    const content = response.choices?.[0]?.message?.content || '[]';

    const cleaned = content
        .replace(/```json/g, '')
        .replace(/```/g, '')
        .trim();

    const questions = JSON.parse(cleaned);

    if (!Array.isArray(questions)) throw new Error('AI returned invalid format');

    return questions.slice(0, questionCount).map((q, i) => ({
        ...q,
        order: i + 1,
        marks: marksPerQuestion
    }));
};
