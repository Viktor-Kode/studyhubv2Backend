export const quizPrompt = (text, amount = 3, typeInstructions = 'multiple-choice questions with 4 options each', excludeQuestions = []) => {
  let exclusionClause = "";
  if (excludeQuestions.length > 0) {
    exclusionClause = `\n\nCRITICAL: DO NOT generate questions that are similar to these already existing questions:
    ${excludeQuestions.map(q => `- ${q}`).join("\n")}`;
  }

  return `Generate exactly ${amount} ${typeInstructions} based on the text below.${exclusionClause}

  For each question, you MUST provide:
  1. The question content
  2. Options (for multiple-choice) labeled A, B, C, D
  3. The correct answer (index 0-3 for multiple-choice, or full string for others)
  4. A detailed "knowledgeDeepDive" that explains the concept in 2-3 sentences, providing educational context and background.

  IMPORTANT: Return ONLY the JSON array. Do not include any conversational text or markdown code blocks.

  Text: ${text}

  JSON Structure for Multiple Choice:
  [{"content": "string", "options": ["A", "B", "C", "D"], "answer": 0, "knowledgeDeepDive": "Detailed educational explanation..."}]
  
  JSON Structure for Theory/Blank:
  [{"content": "string", "options": [], "answer": "string", "knowledgeDeepDive": "Detailed educational explanation..."}]`;
};

export const flashCardPrompt = (text, amount = 10) => {
  return `Generate exactly ${amount} flashcards based on the text below.
  Each flashcard must have a 'front' (question or concept) and a 'back' (answer or definition).
  The front should be concise and the back should be informative.

  IMPORTANT: Return ONLY a JSON array. Do not include any conversational text or markdown code blocks.

  Text: ${text}

  JSON Structure:
  [
    {"front": "What is...", "back": "The answer is..."},
    {"front": "Define...", "back": "Definition..."}
  ]`;
};

export const notesPrompt = (text) => {
  return `Generate concise, structured study notes and a summary based on the text below.
  The notes should be formatted in Markdown.
  Include:
  1. A clear Title.
  2. Key Concepts (bullet points).
  3. Detailed Explanations for complex topics.
  4. A "Summary" section at the end.

  Do NOT wrap the output in markdown code blocks like \`\`\`markdown or \`\` \`\`. Just return the raw markdown text.

  Text: ${text}`;
};