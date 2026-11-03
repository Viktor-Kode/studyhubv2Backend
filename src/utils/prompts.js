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
- Make each node ONE narrow subtopic. Split broad sections into separate nodes with distinct, specific titles; do not combine several subtopics in a comma-separated or "A, B and C" title. Keep titles to at most 12 words.
- Group content so every instructional page is represented. Skip pages with no study content (title, agenda, thank-you).
- For each node, fill fields strictly and concisely:
  1. "id": Sequential integer starting from 1.
  2. "title": Specific subject in the source material's own words.
  3. "sourcePages": Array of 1-based page numbers for this node (look for '--- Page X ---' markers if present).
  4. "sourceFacts": 4 to 8 short, high-yield items copied from the pages, preserving exact terminology, names, numbers and relationships.
  5. "summary": ONE sentence, at most 25 words. Say what the topic is and why it matters. Do not list items. Use only sourceFacts.
  6. "breakdown": exactly two explanatory slides that teach this one subtopic, following the TEACHING RULES below.
  7. "keyConcepts": 3 to 5 recap items. Each is at most 15 words, starts with its key term in the form "Term: what it is / does", adds at least one specific fact that the summary does not state, and does not repeat another concept or copy breakdown sentences word for word.
  8. "quiz": One multiple-choice question testing a specific fact, formula, or clinical correlation from this node. It must be answerable from the breakdown.
     - "question": At most 25 words; ask directly about one specific fact. Never use the pattern "how does X interact with the mechanics of <title>".
     - "options": Array of 4 plausible options. Draw distractors from OTHER items in the same document (same category as the answer).
     - Each option is at most 10 words.
     - "correctAnswerIndex": Index (0-3) of the correct answer.
     - "explanation": At most 30 words explaining why the answer is correct.
  9. "quiz2": A second multiple-choice question testing a different specific fact from the same node. Follow all the same question, option, answer-index, and explanation limits as "quiz". Do not repeat or rephrase quiz 1.
  If more facts need explaining than these limits allow, create another node instead of lengthening the text.
  10. "unit": (optional) Chapter or section heading from the document that this node belongs to. Omit if no clear headings.

TEACHING RULES FOR breakdown
- Write as a patient tutor explaining the topic to a student meeting it for the first time. Explain; do not list facts.
- Every sentence must add understanding: what it is, how it works, why it happens, or what follows from it.
- Define each technical term in plain words the first time it appears, using a short clause or parentheses.
- Show relationships with connecting logic such as because, so, which means, therefore, when X happens Y follows.
- Use simple everyday words around technical terms and short sentences.
- Wrap 1 to 3 important technical terms in each body in **double asterisks**. These markers are rendered as emphasis in the lesson UI.
- Make the bold markers literal double-asterisk characters around a technical term in each body; do not rely on capitalization or formatting outside the text.
- Paraphrase sourceFacts in teaching prose. Never copy 13 or more consecutive words from one sourceFact into a breakdown body.
- You may use a brief plain-language analogy, but never add a fact, number, name, or clinical claim absent from sourceFacts. If unsure, leave it out.
- Do not use "includes", "covers", "discusses", "overview of", "various", or "several" to introduce a list. State the actual action, nerve, reason, or consequence and explain how it works.
- breakdown[0] is the "Understand it" slide: {"heading": specific title of at most 8 words, "body": 3-4 short sentences, 50-80 words}. Explain what the topic is, how it works, and why.
- breakdown[1] is the "Apply and remember it" slide: {"heading": specific title of at most 8 words, "body": 3-4 short sentences, 40-70 words, "memoryTip": one line of at most 20 words}. Explain a grounded practical consequence, example, or common mistake. The memoryTip is a source-provided mnemonic or, if absent, a simple analogy or memory hook using no new facts.
- Use at most 8 sourceFacts per node. If more are needed, split the material into separate nodes with distinct specific titles.

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
      "summary": "One sentence, at most 25 words, saying what the topic is and why it matters; no list.",
      "breakdown": [
        { "heading": "Specific explanation heading", "body": "Three or four short teaching sentences, 50 to 80 words, explaining what, how, and why. Bold one to three key terms with **markers**." },
        { "heading": "Specific practical heading", "body": "Three or four short teaching sentences, 40 to 70 words, explaining a source-grounded consequence or example. Bold one to three key terms with **markers**.", "memoryTip": "One short source-grounded memory hook." }
      ],
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
      },
      "quiz2": {
        "question": "A different direct question about another specific fact.",
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
    nodes: { type: 'array', items: { type: 'object', required: ['id', 'title', 'sourcePages', 'sourceFacts', 'summary', 'breakdown', 'keyConcepts', 'quiz', 'quiz2'], properties: {
      id: { type: 'integer', description: 'Sequential node number.' }, title: { type: 'string', description: 'One narrow, specific subtopic in source wording; at most 12 words; do not combine several subtopics.' },
      sourcePages: { type: 'array', items: { type: 'integer' }, description: '1-based pages covered by this node.' },
      sourceFacts: { type: 'array', maxItems: 8, items: { type: 'string' }, description: 'At most 8 short source-grounded facts for this one narrow subtopic.' },
      summary: { type: 'string', description: 'Exactly one sentence, maximum 25 words, saying what the topic is and why it matters; no list.' },
      breakdown: { type: 'array', minItems: 2, maxItems: 2, description: 'Exactly two distinct tutor-like teaching slides, grounded only in sourceFacts.', items: { type: 'object', required: ['heading', 'body'], properties: {
        heading: { type: 'string', description: 'Specific slide heading, maximum 8 words.' },
        body: { type: 'string', description: 'Slide 1: 3-4 short sentences, 50-80 words. Slide 2: 3-4 short sentences, 40-70 words. Explain what/how/why or real-world consequence, define technical terms plainly, connect reasoning, use 1-3 **bold** key terms, and do not list facts.' },
        memoryTip: { type: 'string', description: 'Slide 2 only: one source-grounded mnemonic or analogy/memory hook, maximum 20 words; omit on slide 1.' }
      } } },
      keyConcepts: { type: 'array', minItems: 3, maxItems: 5, items: { type: 'string', description: 'At most 15 words; start with the key term (Term: what it is/does); add specific detail absent from summary and not repeated by another concept.' } },
      quiz: { type: 'object', required: ['question', 'options', 'correctAnswerIndex', 'explanation'], properties: {
        question: { type: 'string', description: 'Direct question on one specific fact, maximum 25 words. Never use the mechanics interaction template.' },
        options: { type: 'array', minItems: 4, maxItems: 4, items: { type: 'string', description: 'One of exactly four same-category answer options, maximum 10 words.' } },
        correctAnswerIndex: { type: 'integer', minimum: 0, maximum: 3, description: 'Index of the correct option.' },
        explanation: { type: 'string', description: 'Maximum 30 words.' }
      } },
      quiz2: { type: 'object', required: ['question', 'options', 'correctAnswerIndex', 'explanation'], properties: {
        question: { type: 'string', description: 'Second distinct direct question on a different specific fact, maximum 25 words.' },
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

export const challengePrompt = ({ topicTitle, nodesData, excludeQuestions = [], retryProblems = [] }) => {
  let prompt = `You are designing the final Unit Challenge exam for "${topicTitle}".
Create exactly 10 comprehensive overview multiple-choice questions grounded STRICTLY in the provided node summaries, key concepts, and source facts.

EXAM DESIGN REQUIREMENTS:
1. OVERVIEW & SYNTHESIS: Connect, compare, sequence, cause-and-effect, and big-picture questions across the entire unit.
2. MULTI-NODE QUESTIONS: At least 4 of the 10 questions MUST synthesize ideas from 2 or more nodes (sourceNodeIds must list 2 or 3 node IDs).
3. COVERAGE: Cover all nodes or units evenly across the 10 questions. If there are <= 10 nodes, every node id must appear in at least one question's sourceNodeIds.
4. STRICT LENGTH LIMITS:
   - question: at most 25 words
   - options: exactly 4 options, each at most 10 words
   - explanation: at most 30 words
5. DISTRACTORS: Must be from the same category as the correct answer and drawn from other facts/nodes in the document.
6. NO FILLER: Never use "all of the above", "none of the above", or generic filler phrases. Never reveal the answer in the question.
7. VARY POSITIONS: Vary the correct option index across 0, 1, 2, and 3.
8. ATOMICITY & NO DUPLICATION: Never ask about the exact same fact twice within the 10 questions.
`;

  if (excludeQuestions.length > 0) {
    prompt += `\nALREADY USED: do not repeat or rephrase these questions or test the exact same facts as any of them:\n${excludeQuestions.map(q => `- ${q}`).join('\n')}\n`;
  }

  if (retryProblems.length > 0) {
    prompt += `\nCRITICAL FIXES REQUIRED (previous attempt failed these validation rules):\n${retryProblems.map(p => `- ${p}`).join('\n')}\n`;
  }

  prompt += `\nNODE STUDY MATERIAL:\n`;
  for (const n of nodesData) {
    prompt += `Node ${n.id}: "${n.title}"${n.unit ? ` (Unit: ${n.unit})` : ''}
  Summary: ${n.summary}
  Key Concepts: ${Array.isArray(n.keyConcepts) ? n.keyConcepts.join('; ') : ''}
  Source Facts: ${Array.isArray(n.sourceFacts) ? n.sourceFacts.join('; ') : ''}
\n`;
  }

  prompt += `\nReturn JSON conforming strictly to the requested schema.`;
  return prompt;
};
