export const DOMAIN_DISCIPLINES = {
  MEDICINE: 'medicine',
  STEM: 'stem',
  LAW: 'law',
  BUSINESS: 'business',
  HUMANITIES: 'humanities',
  GENERAL: 'general'
};

export const DOCUMENT_TYPES = {
  LECTURE_SLIDES: 'lecture_slides',
  TEXTBOOK: 'textbook',
  EXAM_PAPER: 'exam_paper',
  NOTES: 'notes',
  SYLLABUS: 'syllabus'
};

export const COGNITIVE_DENSITIES = {
  VISUAL: 'visual',
  FORMULA_DENSE: 'formula_dense',
  TERMINOLOGICAL: 'terminological',
  CONCEPTUAL: 'conceptual'
};

export const DISCIPLINE_KEYWORDS = {
  medicine: [
    'anatomy', 'artery', 'vein', 'nerve', 'muscle', 'clinical', 'pathology', 'syndrome',
    'diagnosis', 'pharmacology', 'dosage', 'physiology', 'symptom', 'patient', 'treatment',
    'cardiac', 'pulmonary', 'cortex', 'plexus', 'innervation', 'foramen', 'ligament',
    'osteology', 'histology', 'microbiology', 'disease', 'tendon', 'fascia'
  ],
  stem: [
    'theorem', 'formula', 'equation', 'algorithm', 'function', 'derivative', 'integral',
    'matrix', 'vector', 'velocity', 'acceleration', 'quantum', 'chemical', 'reaction',
    'thermodynamics', 'circuits', 'frequency', 'probability', 'complexity', 'tensor',
    'entropy', 'molecular', 'kinetic', 'equilibrium', 'data structure', 'binary'
  ],
  law: [
    'statute', 'jurisdiction', 'court', 'appellate', 'constitution', 'precedent', 'doctrine',
    'plaintiff', 'defendant', 'tort', 'liability', 'contract', 'criminal', 'substantive',
    'jurisprudence', 'tribunal', 'legislation', 'provisions', 'amendment', 'verdict'
  ],
  business: [
    'accounting', 'balance sheet', 'cash flow', 'depreciation', 'equity', 'revenue',
    'market', 'macroeconomics', 'microeconomics', 'inflation', 'portfolio', 'dividend',
    'valuation', 'supply chain', 'gross margin', 'ebitda', 'management', 'asset'
  ],
  humanities: [
    'philosophy', 'epistemology', 'existential', 'ethics', 'historical', 'colonial',
    'literature', 'narrative', 'postmodern', 'rhetoric', 'sociology', 'ethnography',
    'ideology', 'historiography', 'aesthetic', 'discourse', 'metaphor'
  ]
};

export const COURSE_CODE_REGEX = {
  medicine: /\b(?:anat|phar|path|phys|med|surg|dent|nurs|peds|gyn)\s*\d{3,4}\b/i,
  stem: /\b(?:mth|mat|phy|chm|che|cos|csc|eee|cpe|eng|mee|bch)\s*\d{3,4}\b/i,
  law: /\b(?:law|jur|clw|plw|pbl)\s*\d{3,4}\b/i,
  business: /\b(?:acc|fin|ecn|bus|mgt|mkt)\s*\d{3,4}\b/i,
  humanities: /\b(?:his|phi|lit|eng|soc|rel|arc)\s*\d{3,4}\b/i
};
