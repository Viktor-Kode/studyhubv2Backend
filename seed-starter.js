import mongoose from 'mongoose';
import dotenv from 'dotenv';
import StudyGuide from './src/models/StudyGuide.js';
import connectDB from './src/config/db.js';

dotenv.config();

const starterGuides = [
    {
        title: 'Comprehension Passages — JAMB Study Guide',
        subject: 'english',
        examType: 'JAMB',
        topic: 'Comprehension',
        difficulty: 'medium',
        summary: 'Master how to read and answer comprehension questions accurately in JAMB English.',
        keyPoints: [
            'Read the passage before looking at questions',
            'Answers are always in the passage — never guess',
            'Watch for negative questions like "which is NOT true"',
            'Vocabulary questions test context meaning not dictionary meaning',
            'Inference questions require reading between the lines'
        ],
        content: `## Topic Overview
Comprehension passages test your ability to understand written English and extract meaning accurately. It is one of the highest-scoring sections in JAMB English.

## Core Concepts
- **Active Reading**: Read with the purpose of understanding, not just finishing
- **Question Types**: Factual, Inferential, Vocabulary-in-context, Summary
- **Passage Structure**: Introduction → Body → Conclusion

## Common Exam Traps
- Choosing answers that sound correct but aren't stated in the passage
- Confusing the author's view with a character's view
- Missing negative questions ("which does NOT apply")
- Using outside knowledge instead of passage content

## Worked Examples
**Example:** If the passage says "the economy was sluggish", and the question asks what "sluggish" means in context, the answer is "slow-moving" not "lazy" (common trap).

## Quick Revision Summary
- Always read passage first, questions second
- All answers exist within the passage
- Underline key sentences as you read
- Eliminate obviously wrong options first
- Never use outside knowledge`,
        validated: true,
        isPremium: false
    },
    {
        title: 'Quadratic Equations — JAMB Study Guide',
        subject: 'mathematics',
        examType: 'JAMB',
        topic: 'Quadratic Equations',
        difficulty: 'medium',
        summary: 'Learn the three methods to solve quadratic equations and avoid common JAMB mistakes.',
        keyPoints: [
            'Three methods: factorization, completing the square, quadratic formula',
            'Always set equation to zero before solving',
            'Check your answers by substituting back',
            'Sum of roots = -b/a, Product of roots = c/a',
            'Discriminant determines number of solutions'
        ],
        content: `## Topic Overview
Quadratic equations appear in almost every JAMB Mathematics paper. Mastering this topic alone can add 4-6 marks to your score.

## Core Concepts
- **Standard Form**: ax² + bx + c = 0
- **Factorization**: Find two numbers that multiply to ac and add to b
- **Quadratic Formula**: x = (-b ± √(b²-4ac)) / 2a
- **Discriminant**: b²-4ac determines roots (positive=2 roots, zero=1 root, negative=no real roots)

## Common Exam Traps
- Forgetting to set equation to zero first
- Sign errors when substituting into the formula
- Confusing sum and product of roots
- Not checking if factorization is fully simplified

## Worked Examples
**Solve**: x² + 5x + 6 = 0
Step 1: Find factors of 6 that add to 5 → 2 and 3
Step 2: (x + 2)(x + 3) = 0
Step 3: x = -2 or x = -3

## Quick Revision Summary
- Set to zero first always
- Try factorization first (fastest)
- Use formula when factorization fails
- Sum of roots = -b/a
- Product of roots = c/a`,
        validated: true,
        isPremium: false
    },
    {
        title: 'Cell Structure and Function — JAMB Study Guide',
        subject: 'biology',
        examType: 'JAMB',
        topic: 'Cell Biology',
        difficulty: 'easy',
        summary: 'Understand cell organelles, their functions and the differences between plant and animal cells.',
        keyPoints: [
            'Plant cells have cell wall, chloroplast and large vacuole — animal cells do not',
            'Mitochondria is the powerhouse — produces ATP via respiration',
            'Nucleus controls cell activities and contains DNA',
            'Ribosomes are the site of protein synthesis',
            'Cell membrane controls what enters and leaves the cell'
        ],
        content: `## Topic Overview
Cell biology is the foundation of all Biology. JAMB tests this topic in almost every paper — usually 3-5 questions.

## Core Concepts
**Animal Cell Organelles:**
- Nucleus: control center, contains DNA
- Mitochondria: energy production (ATP)
- Ribosomes: protein synthesis
- Cell membrane: selective barrier

**Plant Cell (extra structures):**
- Cell wall: rigid support (made of cellulose)
- Chloroplast: photosynthesis
- Large central vacuole: stores water and maintains turgor

## Common Exam Traps
- Confusing cell wall (plant) with cell membrane (both)
- Saying mitochondria is only in animal cells (wrong — plants have it too)
- Confusing chloroplast function with mitochondria function
- Forgetting that ribosomes have NO membrane

## Worked Examples
**Q:** Which organelle is responsible for protein synthesis?
**A:** Ribosomes — found in both plant and animal cells, either free or on rough ER

## Quick Revision Summary
- Nucleus = control + DNA storage
- Mitochondria = energy (ATP)
- Ribosomes = protein synthesis (no membrane)
- Chloroplast = photosynthesis (plants only)
- Cell wall = plants only (cellulose)`,
        validated: true,
        isPremium: false
    }
];

async function seed() {
    try {
        await connectDB();
        await StudyGuide.deleteMany({});
        const result = await StudyGuide.insertMany(starterGuides);
        console.log(`✅ Seeded ${result.length} starter guides successfully!`);
        process.exit(0);
    } catch (err) {
        console.error('❌ Seed failed:', err.message);
        process.exit(1);
    }
}

seed();
