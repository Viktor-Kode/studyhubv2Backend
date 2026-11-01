export const quizPrompt = (text, amount = 3, typeInstructions = 'multiple-choice questions with 4 options each', excludeQuestions = []) => {
  let exclusionClause = "";
  if (excludeQuestions.length > 0) {
    exclusionClause = `\n\nCRITICAL: DO NOT generate questions that are similar to these already existing questions:
    ${excludeQuestions.map(q => `- ${q}`).join("\n")}`;
  }

  return `Generate exactly ${amount} ${typeInstructions} based on the text below.${exclusionClause}

  CRITICAL: Keep each question concise — maximum 2 sentences. Avoid lengthy preambles.

  CRITICAL REQUIREMENT: For EVERY single question, you must provide a "knowledgeDeepDive" field. 
  This field is NOT just the answer, but a 3-4 sentence educational explanation that teaches the underlying concept. If there is a calculation, show the steps.
  
  IMPORTANT: You must ensure 100% accuracy of the answers. Double-check your logic against the provided text before providing the final JSON. Incorrect answers are unacceptable.
  
  NOTE: The system will automatically shuffle the options for the user. You do not need to worry about the position of the correct answer; just ensure it is correctly identified in the "answer" field.

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
  return `You are an expert academic tutor helping Nigerian university students prepare for exams. Generate concise, structured study notes based on the text below.

Format in Markdown. Include:

1. Title — name of the topic or course

2. Key Concepts — bullet points of the most important ideas

3. Detailed Explanations — break down complex topics in simple, clear language a Nigerian university student can understand

4. Likely Exam Questions — 3 to 5 short questions a lecturer might ask based on this material

5. Summary — a brief recap of the entire topic in 5 sentences or less

Be concise. Avoid unnecessary repetition. Focus on what matters for passing exams.

Do NOT wrap output in markdown code blocks. Return raw markdown only.

Text: ${text}`;
};

export const studyPathPrompt = (text, title = 'Study Material') => {
  return `You are an elite educational curriculum designer. Based on the provided study material, generate a gamified, structured learning path for a student.

Material Title: ${title}

Rules:
1. Break down the material into 4 to 6 sequential learning nodes (steps).
2. The nodes must progress logically from foundational concepts to advanced application, with the final node being a review / unit assessment.
3. Every node MUST have:
   - "id": sequential number starting from 1
   - "title": clear, engaging concept title
   - "xp": 20 for early nodes, up to 50 for the final assessment
   - "duration": estimated time e.g. "5 min", "8 min", "10 min"
   - "summary": 2-3 sentence overview of this node
   - "keyConcepts": array of 3-4 specific concept terms
   - "lessonContent": object with:
       - "analogy": a memorable real-world analogy explaining the concept
       - "paragraphs": array of 2-3 short, clear explanatory paragraphs
       - "keyConcepts": array of 3-4 key concept strings
   - "quiz": object testing this node with:
       - "question": realistic multiple-choice question testing the concept
       - "options": array of 4 distinct answer strings
       - "correctAnswerIndex": index (0-3) of the correct answer
       - "explanation": educational explanation of why the answer is correct
       - "hint": helpful hint without giving away the answer directly
   - "nextNodeTitle": title of the next node (or null for the last node)

4. Overall structure:
   - "topicId": URL-safe slug e.g. "custom-topic-${Date.now()}"
   - "title": Main topic/course title based on content
   - "courseCode": Relevant subject/code e.g. "STUDY 101 · Interactive Study Path"
   - "currentProgress": 0
   - "nodes": array of the node objects above, with the first node having "status": "active" and all subsequent nodes having "status": "locked".

CRITICAL: Return ONLY raw valid JSON matching this schema. No markdown formatting, no backticks, no introductory text.

Material:
${text}`;
};