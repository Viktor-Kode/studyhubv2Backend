export const BLUEPRINTS = {
  medicine: {
    id: 'medical-clinical',
    name: 'Medical & Clinical Blueprint',
    outlineRules: `
- Partition nodes by anatomical compartment, organ system, or physiological pathway.
- Keep nerves, arteries, veins, and muscle actions for a single compartment together within that compartment's node.
- Clinical correlations and related pathologies belong to the node of the structure they affect.`,
    slide1TeachingGoal: 'Explain anatomical organization, structural boundaries, and physiological mechanisms. Connect form to function using causal connectors (because, allows, enables, results in).',
    slide2TeachingGoal: 'Explain clinical correlations, surgical implications, diagnostic pitfalls, or presentation mimicry. Provide an anatomical mnemonic in memoryTip.',
    quizGuidance: 'Test clinical vignettes, adjacent neurovascular structures, innervation sources, and contraindications. Distractors should draw from adjacent structures or mimicked conditions.',
    bannedPatterns: [/basic general concepts/i, /important to doctors/i]
  },
  stem: {
    id: 'stem-computational',
    name: 'STEM & Computational Blueprint',
    outlineRules: `
- Partition nodes strictly in order of dependency: Definition -> Governing Law/Theorem -> Derivation -> Edge Cases/Applications.
- Never place a complex calculation before the foundational theorem is established in an earlier node.`,
    slide1TeachingGoal: 'Define the mathematical or physical law, explain every variable in plain language, and state the physical intuition behind why the equation holds.',
    slide2TeachingGoal: 'Walk through a concrete problem-solving strategy or derivation step. Highlight a common arithmetic, sign, or dimensional pitfall in memoryTip.',
    quizGuidance: 'Test conceptual application of equations, parameter sensitivity, and edge cases. Distractors must include common calculation traps (e.g. inverted fractions, forgotten negatives, dimensional mismatches).',
    bannedPatterns: [/math is everywhere/i, /calculations are important/i]
  },
  law: {
    id: 'law-jurisprudence',
    name: 'Law & Jurisprudence Blueprint',
    outlineRules: `
- Partition nodes by legal doctrine, statutory rule, landmark precedent, and defense/exception.
- Keep the ratio decidendi and key case facts grouped within the node of the doctrine they established.`,
    slide1TeachingGoal: 'State the legal doctrine or statutory provision plainly, explaining its historical objective and the substantive elements required to establish it.',
    slide2TeachingGoal: 'Analyze a landmark precedent case illustrating how courts apply the doctrine in practice. Highlight exceptions or jurisdictional caveats in memoryTip.',
    quizGuidance: 'Test the application of legal tests to scenario facts, distinguishing between majority and minority opinions or valid defenses. Distractors should draw from overruled precedents or inapplicable doctrines.',
    bannedPatterns: [/the law is complex/i, /courts decide cases/i]
  },
  general: {
    id: 'general-academic',
    name: 'General Academic Blueprint',
    outlineRules: `
- Partition nodes into sequential, focused subtopics of at most 4 dense slides each.
- Ensure narrative continuity from foundational concepts to advanced synthesis.`,
    slide1TeachingGoal: 'Explain the core concept, mechanism, or principle clearly. Use reasoning connectors (because, so, therefore, which means) to teach why it matters.',
    slide2TeachingGoal: 'Provide a concrete practical example, real-world consequence, or common student misconception. Provide an analogy or memory hook in memoryTip.',
    quizGuidance: 'Test factual precision, cause-and-effect relationships, and conceptual distinctions. Distractors must be drawn from other categories in the same document.',
    bannedPatterns: [/fundamental principles/i, /overview of/i]
  }
};

/**
 * Returns the active blueprint configuration for a given discipline.
 * Defaults safely to 'general' if unknown.
 */
export function getBlueprint(discipline) {
  const normalized = String(discipline || '').toLowerCase();
  return BLUEPRINTS[normalized] || BLUEPRINTS.general;
}

/**
 * Injects blueprint pedagogical instructions into the node generation prompt.
 */
export function applyBlueprintToPrompt(basePrompt, blueprint) {
  if (!blueprint || blueprint.id === 'general-academic') {
    return basePrompt;
  }

  return `${basePrompt}

=== ADAPTIVE LEARNING BLUEPRINT: ${blueprint.name.toUpperCase()} ===
TEACHING DIRECTIVES:
- Slide 1 Requirement: ${blueprint.slide1TeachingGoal}
- Slide 2 Requirement: ${blueprint.slide2TeachingGoal}
- Assessment Archetype: ${blueprint.quizGuidance}
Strictly follow these domain-specific directives while honoring all length, formatting, bolding, and JSON contract rules.`;
}
