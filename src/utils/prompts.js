export const quizPrompt = (text, amount = 3, typeInstructions = 'multiple-choice questions with 4 options each', excludeQuestions = []) => {
  let exclusionClause = "";
  if (excludeQuestions.length > 0) {
    exclusionClause = `\n\nCRITICAL: DO NOT generate questions that are similar to these already existing questions:
    ${excludeQuestions.map(q => `- ${q}`).join("\n")}`;
  }

  return `Generate exactly ${amount} ${typeInstructions} based on the text below.${exclusionClause}

  CRITICAL REQUIREMENT: For EVERY single question, you must provide a "knowledgeDeepDive" field. 
  This field is NOT just the answer, but a 3-4 sentence educational explanation that teaches the underlying concept. If there is a calculation, show the steps.
  
  Each question object MUST have:
  1. "question": The clear question text.
  2. "options": Array of 4 strings (only for multiple-choice).
  3. "answer": The correct index (0-3) for multiple-choice, or the full correct answer string for other types.
  4. "knowledgeDeepDive": COMPULSORY detailed educational explanation.

  IMPORTANT: Return ONLY the JSON array. Do not include any conversational text or markdown code blocks.

  Text: ${text}

  JSON Structure for Multiple Choice:
  [{"question": "string", "options": ["A", "B", "C", "D"], "answer": 0, "knowledgeDeepDive": "Detailed educational explanation..."}]
  
  JSON Structure for Theory/Blank:
  [{"question": "string", "options": [], "answer": "string", "knowledgeDeepDive": "Detailed educational explanation..."}]`;
};

export const flashCardPrompt = (text, amount = 10) => {
  return `Act as an expert educator. Based on the study material provided below, generate exactly ${amount} high-quality, concept-focused flashcards.
  
  CRITICAL RULES:
  1. CONCEPTS OVER FACTS: Focus on "why" and "how" more than just "what".
  2. ATOMICITY: Each card should cover ONE specific concept only.
  3. Q&A STYLE: The 'front' should be a clear, thought-provoking question or a term to define.
  4. DETAILED ANSWERS: The 'back' should be a concise but comprehensive explanation, including context where helpful.
  5. NO TRIVIA: Avoid obscure details; focus on main learning objectives.

  IMPORTANT: Return ONLY a raw JSON array. Do not include conversational text, markdown headers, or code blocks.

  Study Material:
  ${text}

  JSON Expected Structure:
  [
    {"front": "Thoughtful question or term", "back": "Comprehensive, clear explanation"},
    ...
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