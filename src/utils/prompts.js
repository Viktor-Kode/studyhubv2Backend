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

import { SchemaType } from '@google/generative-ai';

export const studyPathSystemPrompt = `You are the lead AI instructor for StudyHelp. You receive an academic document (such as a lecture slide deck or textbook chapter). Turn it into a detailed, sequential study path that a student could use to pass an exam on this exact material.

HOW TO READ THE DOCUMENT
- Read page by page. Slides are fragments: titles, bullets, tables, labelled diagrams. Reassemble them into connected explanations.
- Treat tables as relationships and keep every row together (e.g. item -> action/function -> supply/cause/effect).
- Read labels and captions on diagrams, charts and images; they are primary source content.
- Keep every clinical correlation, formula, value, classification, exception and mnemonic the lecturer included.
- Follow the lecture's own order and major sections.

HOW TO BUILD NODES
- Create as many nodes as the material needs so that every page with instructional content belongs to at least one node. One node = one coherent subtopic that can be studied in 5-9 minutes. As a guide, use roughly 1 node per 1-3 dense pages or 1 node per 3-5 light slides, and always split at the lecture's own section boundaries. Do not merge distinct subtopics to keep the list short. Do not split one subtopic into several nodes just to add count. Skip only pages with no study content (title, agenda, references, thank-you). Every node must cover a different part of the material; no repeats.
- A node's title is the specific subject of its slides, in the lecture's own words.
- For each node, fill fields strictly in propertyOrdering sequence:
  1. "id": Sequential integer starting from 1.
  2. "title": Specific subject in the lecture's own words.
  3. "sourcePages": Array of 1-based page or slide numbers for this node.
  4. "sourceFacts": 6 to 12 short items copied from the pages, preserving exact terminology, names, numbers and table relationships.
  5. "summary": 2 to 3 sentences that connect the facts into one explanation (what it is, how it relates to neighbouring structures/ideas, why it matters). Written ONLY from sourceFacts.
  6. "keyConcepts": 4 to 6 items. Each must be a complete, specific, testable statement containing at least one term that appears in sourceFacts.
  7. "quiz": One multiple-choice question testing a specific fact, formula, or clinical correlation from this node.
     - "options": 4 plausible options. Draw distractors from OTHER items in the same document (same category as the answer).
     - "correctAnswerIndex": Index (0-3) of the correct answer.
     - "explanation": Explain why the answer is correct and, briefly, why the closest distractor is not.
  8. "unit": (optional) Chapter or section heading from the document that this node belongs to, in the document's own words. Omit if the document has no clear headings.

IF THE SOURCE IS THIN
- If a section has little content, merge it into a neighbouring node — but only within the same subtopic. Never merge across different subtopics. Never pad with generic filler. Never introduce facts that are not on the pages.
- If the document has no usable text or diagrams, return an empty "nodes" array.

SKIPPED PAGES
- List in "skippedPages" every 1-based page number that you deliberately excluded because it has no study content (title slide, agenda, references list, blank page, thank-you slide).
- Every other page must appear in at least one node's sourcePages.

Subject area is unknown in advance: match the exact terminology of whatever the document covers (anatomy, pharmacology, law, engineering, etc.).`;

export const studyPathResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    title: {
      type: SchemaType.STRING,
      description: "Main topic or course title based on the document"
    },
    courseCode: {
      type: SchemaType.STRING,
      description: "Relevant course code e.g. 'PATH 101 · Interactive Study Path'"
    },
    skippedPages: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.INTEGER },
      description: "1-based page numbers deliberately excluded because they have no study content (title, agenda, references, thank-you)"
    },
    nodes: {
      type: SchemaType.ARRAY,
      description: "Sequential learning nodes — one per coherent subtopic, covering all instructional pages",
      items: {
        type: SchemaType.OBJECT,
        properties: {
          id: { type: SchemaType.INTEGER },
          title: { type: SchemaType.STRING },
          unit: {
            type: SchemaType.STRING,
            description: "Chapter or section heading from the document this node belongs to. Omit if no clear headings."
          },
          sourcePages: {
            type: SchemaType.ARRAY,
            items: { type: SchemaType.INTEGER },
            description: "1-based page/slide numbers for this node"
          },
          sourceFacts: {
            type: SchemaType.ARRAY,
            items: { type: SchemaType.STRING },
            description: "6 to 12 short items copied from pages with exact terminology and numbers"
          },
          summary: {
            type: SchemaType.STRING,
            description: "2 to 3 sentences connecting facts into one explanation"
          },
          keyConcepts: {
            type: SchemaType.ARRAY,
            items: { type: SchemaType.STRING },
            description: "4 to 6 specific, testable statements containing terms from sourceFacts"
          },
          quiz: {
            type: SchemaType.OBJECT,
            properties: {
              question: { type: SchemaType.STRING },
              options: {
                type: SchemaType.ARRAY,
                items: { type: SchemaType.STRING },
                description: "4 plausible options with distractors from elsewhere in document"
              },
              correctAnswerIndex: { type: SchemaType.INTEGER },
              explanation: {
                type: SchemaType.STRING,
                description: "Why answer is correct and why closest distractor is not"
              }
            },
            required: ["question", "options", "correctAnswerIndex", "explanation"]
          }
        },
        propertyOrdering: ["id", "title", "unit", "sourcePages", "sourceFacts", "summary", "keyConcepts", "quiz"],
        required: ["id", "title", "sourcePages", "sourceFacts", "summary", "keyConcepts", "quiz"]
      }
    }
  },
  required: ["title", "courseCode", "nodes"]
};

export const studyPathPrompt = (textOrTitle = 'Study Material', title = 'Study Material') => {
  const resolvedTitle = typeof textOrTitle === 'string' && textOrTitle.length < 120 ? textOrTitle : title;
  return `Generate a comprehensive, sequential study path for "${resolvedTitle}" based strictly on the provided document content. Create as many nodes as the material needs — one node per coherent subtopic. Follow all system instructions.`;
};
