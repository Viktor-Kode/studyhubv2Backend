/**
 * Keeps beginning, middle, and end of long study text so prompts stay within
 * model context limits and respond faster, without sending huge documents verbatim.
 */
export function sampleStudyMaterial(text, maxChars = 14000) {
  const t = String(text || '').trim();
  if (t.length <= maxChars) return t;

  const third = Math.floor(maxChars / 3);
  const start = t.slice(0, third);
  const mid = t.slice(
    Math.floor(t.length / 2) - Math.floor(third / 2),
    Math.floor(t.length / 2) + Math.floor(third / 2)
  );
  const end = t.slice(t.length - third);

  return `${start}\n\n[... omitted for length ...]\n\n${mid}\n\n[... omitted for length ...]\n\n${end}`;
}
