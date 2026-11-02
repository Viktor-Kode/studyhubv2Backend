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

export const studyPathSystemPrompt = `You are the lead AI instructor for StudyHelp. You receive an academic document (such as a lecture slide deck or textbook chapter). Turn it into a detailed, sequential study path that a student could use to pass an exam on this exact material.

HOW TO READ THE DOCUMENT
- Read page by page. Slides and sections are fragments: titles, bullets, tables, diagrams. Reassemble them into connected explanations.
- Treat tables as relationships and keep every row together (e.g. item -> action/function -> supply/cause/effect).
- Keep every clinical correlation, formula, value, classification, exception and mnemonic included in the material.
- Follow the lecture's own order and major sections.

HOW TO BUILD NODES
- Group content into 5 to 10 coherent subtopics (nodes) so every instructional page is represented. Do not create excessive nodes; synthesize related slides into 1 node. Skip pages with no study content (title, agenda, thank-you).
- A node's title is the specific subject of its slides/pages, in the source's own words.
- For each node, fill fields strictly and concisely:
  1. "id": Sequential integer starting from 1.
  2. "title": Specific subject in the source material's own words.
  3. "sourcePages": Array of 1-based page numbers for this node (look for '--- Page X ---' markers if present).
  4. "sourceFacts": 4 to 8 short, high-yield items copied from the pages, preserving exact terminology, names, numbers and relationships.
  5. "summary": Maximum 35 words in ONE or TWO short sentences. Say what the topic is and why it matters. Do not list items. Use only sourceFacts.
  6. "keyConcepts": 3 to 5 items. Each is a short fact of at most 15 words, starts with its key term in the form "Term: what it is / does", adds detail absent from the summary, and does not repeat another concept.
  7. "quiz": One multiple-choice question testing a specific fact, formula, or clinical correlation from this node.
     - "question": At most 25 words; ask directly about one specific fact. Never use the pattern "how does X interact with the mechanics of <title>".
     - "options": Array of 4 plausible options. Draw distractors from OTHER items in the same document (same category as the answer).
     - Each option is at most 10 words.
     - "correctAnswerIndex": Index (0-3) of the correct answer.
     - "explanation": At most 30 words explaining why the answer is correct.
  If more facts need explaining than these limits allow, create another node instead of lengthening the text.
  8. "unit": (optional) Chapter or section heading from the document that this node belongs to. Omit if no clear headings.

IF THE SOURCE IS THIN
- If a section has little content, merge it into a neighbouring node — but only within the same subtopic. Never merge across different subtopics. Never pad with generic filler. Never introduce facts that are not on the pages.
- If the document has no usable text or diagrams, return an empty "nodes" array.

SKIPPED PAGES
- List in "skippedPages" every 1-based page number that you deliberately excluded because it has no study content (title slide, agenda, references list, blank page, thank-you slide).
- Every other page must appear in at least one node's sourcePages.

Subject area is unknown in advance: match the exact terminology of whatever the document covers (anatomy, pharmacology, law, engineering, etc.).

OUTPUT FORMAT:
Return a single valid JSON object with EXACTLY this structure:
{
  "title": "Main topic or course title based on the document",
  "courseCode": "Relevant course code e.g. 'PATH 101 · Interactive Study Path'",
  "skippedPages": [1, 2],
  "nodes": [
    {
      "id": 1,
      "title": "Subtopic Title",
      "unit": "Section or Chapter Heading",
      "sourcePages": [1, 2],
      "sourceFacts": [
        "Exact fact or definition from text",
        "Second fact with exact terms",
        "Third fact with formula or detail",
        "Fourth fact with relationship",
        "Fifth fact",
        "Sixth fact"
      ],
      "summary": "At most 35 words, one or two short sentences, describing the topic and why it matters; no lists.",
      "keyConcepts": [
        "Term: concise fact of at most 15 words, adding detail absent from the summary",
        "Term: another distinct fact of at most 15 words",
        "Term: another distinct fact of at most 15 words"
      ],
      "quiz": {
        "question": "Direct question about one specific fact, at most 25 words; never ask how a concept interacts with the mechanics of the node title.",
        "options": ["Option A", "Option B", "Option C", "Option D"],
        "correctAnswerIndex": 0,
        "explanation": "Explanation of at most 30 words."
      }
    }
  ]
}
Return valid raw JSON only. Do not wrap in markdown or backticks.`;

export const studyPathResponseSchema = {
  type: 'object', required: ['title', 'nodes'], properties: {
    title: { type: 'string', description: 'Main topic or course title.' },
    courseCode: { type: 'string', description: 'Course code when present in the source.' },
    skippedPages: { type: 'array', items: { type: 'integer' } },
    nodes: { type: 'array', items: { type: 'object', required: ['id', 'title', 'sourcePages', 'sourceFacts', 'summary', 'keyConcepts', 'quiz'], properties: {
      id: { type: 'integer', description: 'Sequential node number.' }, title: { type: 'string', description: 'Specific subject in source wording.' },
      sourcePages: { type: 'array', items: { type: 'integer' }, description: '1-based pages covered by this node.' },
      sourceFacts: { type: 'array', items: { type: 'string' }, description: '4 to 8 short source-grounded facts.' },
      summary: { type: 'string', description: 'Maximum 35 words; one or two short sentences saying what the topic is and why it matters; no list.' },
      keyConcepts: { type: 'array', minItems: 3, maxItems: 5, items: { type: 'string', description: 'At most 15 words; start with the key term (Term: what it is/does); add detail absent from summary and other concepts.' } },
      quiz: { type: 'object', required: ['question', 'options', 'correctAnswerIndex', 'explanation'], properties: {
        question: { type: 'string', description: 'Direct question on one specific fact, maximum 25 words. Never use the mechanics interaction template.' },
        options: { type: 'array', minItems: 4, maxItems: 4, items: { type: 'string', description: 'One of exactly four same-category answer options, maximum 10 words.' } },
        correctAnswerIndex: { type: 'integer', minimum: 0, maximum: 3, description: 'Index of the correct option.' },
        explanation: { type: 'string', description: 'Maximum 30 words.' }
      } }
    } } }
  }
};

export const studyPathPrompt = (textOrTitle = 'Study Material', title = 'Study Material') => {
  const resolvedTitle = typeof textOrTitle === 'string' && textOrTitle.length < 120 ? textOrTitle : title;
  return `Generate a comprehensive, sequential study path for "${resolvedTitle}" based strictly on the provided document content. Create as many nodes as the material needs — one node per coherent subtopic. Follow all system instructions. Return valid JSON only.`;
};
