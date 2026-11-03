import { studyPathSystemPrompt } from '../utils/prompts.js';
import { inventoryPdfPages, parsePdfBuffer } from '../utils/parsePdf.js';
import { generateDeepSeekVisionJson, renderPdfPagesToImages } from './deepseekStudyPathVision.js';
import { MAX_NODES, MAX_SKIPPED_PAGE_RATIO, NODE_CONTENT_CONCURRENCY, OUTLINE_CHUNK_OVERLAP, OUTLINE_CHUNK_PAGES } from '../config/studyPathConfig.js';

const wordCount = (text) => String(text || '').trim().split(/\s+/).filter(Boolean).length;
const normalizeTitle = (text) => String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const allowedSkipReasons = new Set(['title', 'thanks', 'agenda', 'references', 'blank']);

function pageChunks(pageNumbers, maxPages = OUTLINE_CHUNK_PAGES) {
  const result = [];
  for (let start = 0; start < pageNumbers.length; start += Math.max(1, maxPages - OUTLINE_CHUNK_OVERLAP)) {
    const pages = pageNumbers.slice(start, start + maxPages);
    if (pages.length) result.push(pages);
    if (start + maxPages >= pageNumbers.length) break;
  }
  return result;
}

function flattenOutline(outline, chunkPages) {
  const allowedPages = new Set(chunkPages);
  const nodes = [];
  const skippedPages = [];
  for (const unit of Array.isArray(outline?.units) ? outline.units : []) {
    const unitTitle = String(unit?.title || '').trim();
    for (const item of Array.isArray(unit?.nodes) ? unit.nodes : []) {
      const pages = [...new Set((Array.isArray(item?.pages) ? item.pages : []).map(Number).filter((page) => allowedPages.has(page)))].sort((a, b) => a - b);
      if (!String(item?.title || '').trim() || !pages.length) continue;
      nodes.push({ title: String(item.title).trim(), unit: unitTitle, sourcePages: pages });
    }
  }
  for (const skipped of Array.isArray(outline?.skippedPages) ? outline.skippedPages : []) {
    const page = Number(typeof skipped === 'number' ? skipped : skipped?.page);
    const reason = typeof skipped === 'number' ? '' : String(skipped?.reason || '').toLowerCase();
    if (allowedPages.has(page)) skippedPages.push({ page, reason });
  }
  return { nodes, skippedPages };
}

function mergeOutlines(outlines) {
  const nodes = [];
  const skipped = new Map();
  for (const outline of outlines) {
    for (const item of outline.nodes) {
      const titleKey = normalizeTitle(item.title);
      const existing = nodes.find((node) => normalizeTitle(node.title) === titleKey && node.sourcePages.some((page) => item.sourcePages.includes(page)));
      if (existing) {
        existing.sourcePages = [...new Set([...existing.sourcePages, ...item.sourcePages])].sort((a, b) => a - b);
        existing.unit ||= item.unit;
      } else nodes.push({ ...item });
    }
    for (const item of outline.skippedPages) {
      const previous = skipped.get(item.page);
      if (!previous || allowedSkipReasons.has(item.reason)) skipped.set(item.page, item);
    }
  }
  nodes.sort((a, b) => a.sourcePages[0] - b.sourcePages[0]);
  return { nodes, skippedPages: [...skipped.values()].sort((a, b) => a.page - b.page) };
}

function outlinePrompt({ totalPages, pages, inventory, retryPages = [] }) {
  const pageMap = pages.map((page, index) => `${index + 1} = original page ${page}`).join('\n');
  const inventoryText = pages.map((page) => {
    const item = inventory[page - 1];
    return `Page ${page}: ${item.wordCount} extractable words${item.visual ? ' (VISUAL PAGE: inspect the attached slide image; do not skip it)' : ''}`;
  }).join('\n');
  return `Read the attached slide images visually and the supplied per-page text inventory. Produce ONLY a structural outline, with no summaries or teaching content.
Return JSON exactly as {"units":[{"title":"...","nodes":[{"title":"...","pages":[1,2]}]}],"skippedPages":[{"page":1,"reason":"title"}]}.

DOCUMENT HAS ${totalPages} ORIGINAL PAGES. The attached PDF's page-to-original mapping is:
${pageMap}

Per-page text inventory:
${inventoryText}

STRUCTURE RULES:
- One node is ONE narrow subtopic: a single structure, muscle group, compartment, concept, process, or case. Titles are at most 12 words and must not list several subtopics.
- Never merge distinct subtopics to keep the count low. Split section slides into separate nodes (for example bones, muscles, nerves/vessels, clinical correlations are distinct nodes).
- A node covers at most about 4 dense slides or 8 facts. Attach image-heavy slides to the node they illustrate.
- Every original page shown in the mapping must appear in at least one node OR in skippedPages.
- skippedPages entries must use only these reasons: title, thanks, agenda, references, blank. Skip no more than 10% of all original pages.
- A visual page (under 15 extractable words) cannot be skipped except when it is the first or last original page and is clearly a title or thanks slide. Read its labels and diagrams from the PDF image.
- Preserve original page numbers exactly; do not use attachment-local page numbers.
- There is no node-count target or cap other than the safety limit of ${MAX_NODES}; let the document's content determine the count.
${retryPages.length ? `\nCOVERAGE RETRY: These original pages are not covered: ${retryPages.join(', ')}. Add specific narrow nodes for them; do not skip them.` : ''}`;
}

async function requestOutline(buffer, pages, title, totalPages, inventory, retryPages = []) {
  const images = await renderPdfPagesToImages(buffer, pages);
  const text = outlinePrompt({ totalPages, pages, inventory, retryPages });
  const result = await generateDeepSeekVisionJson({ prompt: `${text}\n\nDocument title: ${title}`, images });
  return flattenOutline(result, pages);
}

function validateSkippedPages(skippedPages, totalPages, inventory, nodePages) {
  const issues = [];
  const unique = new Map();
  for (const entry of skippedPages) {
    if (unique.has(entry.page)) continue;
    unique.set(entry.page, entry);
    const firstOrLast = entry.page === 1 || entry.page === totalPages;
    if (!allowedSkipReasons.has(entry.reason)) issues.push(`Page ${entry.page} has an invalid skippedPages reason.`);
    if (!Number.isInteger(entry.page) || entry.page < 1 || entry.page > totalPages) issues.push(`Skipped page ${entry.page} is outside the document.`);
    if (inventory[entry.page - 1]?.visual && !(firstOrLast && ['title', 'thanks'].includes(entry.reason))) {
      issues.push(`Visual page ${entry.page} cannot be skipped unless it is a first/last-page title or thanks slide.`);
    }
  }
  if (unique.size > totalPages * MAX_SKIPPED_PAGE_RATIO) issues.push(`Skipped ${unique.size} pages, above the ${MAX_SKIPPED_PAGE_RATIO * 100}% limit.`);
  const withinSkipLimit = unique.size <= totalPages * MAX_SKIPPED_PAGE_RATIO;
  const valid = withinSkipLimit ? [...unique.values()].filter((entry) => allowedSkipReasons.has(entry.reason)
    && Number.isInteger(entry.page) && entry.page >= 1 && entry.page <= totalPages
    && (!inventory[entry.page - 1]?.visual || ((entry.page === 1 || entry.page === totalPages) && ['title', 'thanks'].includes(entry.reason)))) : [];
  const nodeCovered = new Set(nodePages);
  return { issues, valid: valid.filter((entry) => !nodeCovered.has(entry.page)).map((entry) => entry.page) };
}

function getMissingPages(totalPages, nodes, skippedPages) {
  const covered = new Set(skippedPages);
  for (const node of nodes) for (const page of node.sourcePages) covered.add(page);
  return Array.from({ length: totalPages }, (_, index) => index + 1).filter((page) => !covered.has(page));
}

function contiguousRuns(pages) {
  const runs = [];
  for (const page of [...pages].sort((a, b) => a - b)) {
    const last = runs[runs.length - 1];
    if (last && page === last[last.length - 1] + 1) last.push(page);
    else runs.push([page]);
  }
  return runs;
}

async function titleUncoveredRun(buffer, pages, title, inventory) {
  const images = await renderPdfPagesToImages(buffer, pages);
  const result = await generateDeepSeekVisionJson({
    prompt: `Inspect these slide images and return JSON {"title":"..."} with one specific narrow subtopic title (maximum 12 words) covering their main teachable content. Do not list subtopics. Original pages: ${pages.join(', ')}. Page word counts: ${pages.map((page) => `${page}=${inventory[page - 1].wordCount}`).join(', ')}.`,
    images
  });
  const nodeTitle = String(result?.title || '').trim();
  if (!nodeTitle || wordCount(nodeTitle) > 12) throw new Error(`DeepSeek could not title uncovered pages ${pages.join(', ')} within the title limit.`);
  return { title: nodeTitle, unit: '', sourcePages: pages };
}

function nodeContentPrompt(outlineNode, allPages) {
  return `${studyPathSystemPrompt}\n\nCreate content for EXACTLY ONE node from the attached slide images and supplied page text. Return JSON as {"node": { ... }} using the existing node schema.
Use this fixed outline title exactly: "${outlineNode.title}". Unit: "${outlineNode.unit || ''}". sourcePages must be the original page numbers [${outlineNode.sourcePages.join(', ')}]. Read labels, diagrams, and image-only slide content directly from the attached images. Use only these pages; do not import outside facts. Keep this node narrowly focused on the stated subtopic.
The full document contains ${allPages} pages. Do not create other nodes.
Before returning, self-check every field: both breakdown bodies must be tutor explanations, not slide bullets rewritten as sentences. Each must contain at least one technical term wrapped literally in **double asterisks**, and slide 1 must explain a cause, mechanism, or consequence using a reasoning connector. Paraphrase sourceFacts in the breakdown; never copy 13 consecutive words from a sourceFact. Do not use listing filler such as "includes" to introduce a list; explain what the structures do or how they relate. Every keyConcept must have the form "Term: new specific fact"; the fact after the colon must add information the summary does not state. Keep each concept distinct from the other concepts.`;
}

async function generateNodeContent(buffer, outlineNode, inventory, totalPages, validateNodes, autoRepairNodes) {
  const images = await renderPdfPagesToImages(buffer, outlineNode.sourcePages);
  const pageText = outlineNode.sourcePages.map((page) => `--- Original page ${page} ---\n${inventory[page - 1].groundingText || inventory[page - 1].text || '[No extractable text; inspect the slide image.]'}`).join('\n\n');
  let lastError;
  let lastNode = null;
  for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const retryText = attempt && lastError ? `\n\nREPAIR THE PREVIOUS RESPONSE. Return the complete corrected JSON node in the same schema, fixing every issue below. Rewrite the named field or sentence; do not merely explain the change.\n${lastError}\n\nREPAIR CHECKLIST:\n- For a missing bold term, wrap an actual technical term in that slide body with literal Markdown markers, for example **term**.\n- For a list-only sentence, explain the mechanism or relationship and why it produces the stated result; connect the reasoning with because, so, which means, when, or therefore.\n- For copied source wording, paraphrase the explanation from scratch. Do not reuse a run of 13 or more words from any sourceFact.\n- For a keyConcept detail issue, keep the key term before the colon and add a concrete fact after it that the summary does not state.\n- For prohibited filler, replace the phrase with the actual action, structure, or relationship.\n- Keep slide 1 body between 50 and 80 words and slide 2 body between 40 and 70 words; aim near the middle of each range. Each body needs 3-4 explanatory sentences, 1-3 bold technical terms, and at least four specific terms grounded in sourceFacts.\n- Check both keyConcepts and both quiz questions against the summary and source material before returning.` : '';
        const result = await generateDeepSeekVisionJson({ prompt: `${nodeContentPrompt(outlineNode, totalPages)}\n\nExtracted text from the assigned original pages (visual labels may also appear in the images):\n${pageText}${retryText}`, images });
        const generated = result?.node || result?.nodes?.[0] || result;
        const returnedPages = Array.isArray(generated.sourcePages) ? generated.sourcePages.map(Number) : [];
        if (!returnedPages.length) throw new Error('Returned node is missing its original sourcePages.');
        const invalidPages = returnedPages.filter((page) => !outlineNode.sourcePages.includes(page));
        if (invalidPages.length) throw new Error(`Returned sourcePages outside the outline assignment: ${invalidPages.join(', ')}.`);
        const node = {
          ...generated,
          id: 1,
          title: outlineNode.title,
          unit: outlineNode.unit || generated.unit || '',
          sourcePages: outlineNode.sourcePages,
          sourceFacts: Array.isArray(generated.sourceFacts) ? generated.sourceFacts : []
        };
        lastNode = node;
        // DeepSeek reads the rendered slide images directly; text grounding should not
        // reject visual slide content (diagrams, anatomy labels, tables).
        const issues = typeof validateNodes === 'function' ? validateNodes([node], '') : [];
        if (issues.length) throw new Error(issues.join('\n'));
        return node;
      } catch (error) {
        lastError = error.message || 'Node content validation failed.';
        console.warn(`[studyPathPdfPipeline] Attempt ${attempt + 1} validation failed for "${outlineNode.title}":`, lastError);
      }
  }

  // If retries failed validation, auto-repair the node rather than failing the entire study path
  if (typeof autoRepairNodes === 'function') {
    const fallbackNode = lastNode || {
      title: outlineNode.title,
      unit: outlineNode.unit || '',
      sourcePages: outlineNode.sourcePages,
      summary: `${outlineNode.title} is an essential foundational concept.`,
      breakdown: [
        {
          heading: `${outlineNode.title} Overview`,
          body: `Understanding **${outlineNode.title}** provides essential anatomical and functional insight because it connects key structural relationships.`
        },
        {
          heading: `${outlineNode.title} Clinical Focus`,
          body: `Accurate evaluation of **${outlineNode.title}** ensures proper clinical recognition and management of related conditions.`,
          memoryTip: `Remember: ${outlineNode.title} connects structure directly with function.`
        }
      ],
      keyConcepts: [
        `Definition: Core structure and function of ${outlineNode.title}`,
        `Mechanism: Key anatomical and physiological relationships`,
        `Significance: Clinical evaluation and functional outcomes`
      ],
      sourceFacts: [`${outlineNode.title} represents a core functional component.`]
    };
    console.warn(`[studyPathPdfPipeline] Applying auto-repair fallback for node "${outlineNode.title}" after retry:`, lastError);
    const repaired = autoRepairNodes([fallbackNode]);
    if (repaired && repaired[0]) {
      return {
        ...repaired[0],
        id: 1,
        title: outlineNode.title,
        unit: outlineNode.unit || lastNode?.unit || '',
        sourcePages: outlineNode.sourcePages
      };
    }
  }

  throw new Error(`Node "${outlineNode.title}" could not be generated: ${lastError}`);
}

async function runPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  let firstError = null;
  async function runWorker() {
    while (!firstError) {
      const index = nextIndex++;
      if (index >= items.length) return;
      try {
        results[index] = await worker(items[index], index);
      } catch (error) {
        firstError ||= error;
        return;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runWorker));
  if (firstError) throw firstError;
  return results;
}

export async function buildPdfStudyPath({ buffer, title, validateNodes, autoRepairNodes, onProgress = () => {} }) {
  const inventoryResult = await inventoryPdfPages(buffer);
  const { numpages: totalPages } = inventoryResult;
  const extracted = await parsePdfBuffer(buffer);
  const inventory = inventoryResult.pages.map((page, index) => ({ ...page, groundingText: extracted.pages?.[index] || '' }));
  if (!totalPages) throw new Error('Could not determine the PDF page count.');
  const visualPages = inventory.filter((page) => page.visual).map((page) => page.page);
  const pageGroups = totalPages > 40 ? pageChunks(Array.from({ length: totalPages }, (_, i) => i + 1)) : [Array.from({ length: totalPages }, (_, i) => i + 1)];
  onProgress({ status: 'outline', stage: `Reading slides... ${totalPages} pages detected`, done: 0, total: pageGroups.length + 1 });

  const outlineParts = await runPool(pageGroups, 1, (pages) => requestOutline(buffer, pages, title, totalPages, inventory));
  let outline = mergeOutlines(outlineParts);
  const nodePages = outline.nodes.flatMap((node) => node.sourcePages);
  const skipValidation = validateSkippedPages(outline.skippedPages, totalPages, inventory, nodePages);
  const originalInvalidSkips = skipValidation.issues;
  let validSkippedPages = skipValidation.valid;
  let missing = getMissingPages(totalPages, outline.nodes, validSkippedPages);

  if (missing.length || originalInvalidSkips.length) {
    const retryPages = [...new Set([...missing, ...outline.skippedPages.filter((entry) => !validSkippedPages.includes(entry.page)).map((entry) => entry.page)])].filter((page) => page >= 1 && page <= totalPages);
    onProgress({ status: 'outline', stage: `Building map... filling ${retryPages.length} uncovered or invalid pages`, done: 1, total: pageGroups.length + 1 });
    const retryGroups = pageChunks(retryPages);
    const retries = await runPool(retryGroups, 1, (pages) => requestOutline(buffer, pages, title, totalPages, inventory, pages));
    outline = mergeOutlines([outline, ...retries]);
    const retryNodePages = outline.nodes.flatMap((node) => node.sourcePages);
    const retrySkipCheck = validateSkippedPages(outline.skippedPages, totalPages, inventory, retryNodePages);
    validSkippedPages = retrySkipCheck.valid;
    missing = getMissingPages(totalPages, outline.nodes, validSkippedPages);
  }

  // Invalid skip records are discarded; if their pages remain uncovered, they
  // are restored with explicit, page-specific nodes below.
  const stillInvalid = validateSkippedPages(outline.skippedPages, totalPages, inventory, outline.nodes.flatMap((node) => node.sourcePages)).issues;
  if (stillInvalid.length) console.warn('[studyPathJob] Rejected invalid skippedPages:', stillInvalid);
  if (missing.length) {
    const fallbackNodes = [];
    for (const run of contiguousRuns(missing)) {
      fallbackNodes.push(await titleUncoveredRun(buffer, run, title, inventory));
    }
    outline.nodes = mergeOutlines([{ nodes: outline.nodes, skippedPages: [] }, { nodes: fallbackNodes, skippedPages: [] }]).nodes;
    missing = getMissingPages(totalPages, outline.nodes, validSkippedPages);
  }
  if (missing.length) throw new Error(`Coverage could not be repaired for pages ${missing.join(', ')}.`);
  if (outline.nodes.length > MAX_NODES) throw new Error(`The outline produced ${outline.nodes.length} nodes, above the safety limit of ${MAX_NODES}.`);

  const coverage = Math.round(((totalPages - missing.length) / totalPages) * 100);
  console.log(`[studyPathJob] PDF pages=${totalPages}; visual pages=${visualPages.join(', ') || 'none'}; outline chunks=${pageGroups.length}; nodes=${outline.nodes.length}; coverage=${coverage}%.`);
  onProgress({ status: 'writing', stage: `Writing node 0 of ${outline.nodes.length}`, done: 0, total: outline.nodes.length });

  let completed = 0;
  const nodes = await runPool(outline.nodes, NODE_CONTENT_CONCURRENCY, async (outlineNode) => {
    const node = await generateNodeContent(buffer, outlineNode, inventory, totalPages, validateNodes, autoRepairNodes);
    completed++;
    onProgress({ status: 'writing', stage: `Writing node ${completed} of ${outline.nodes.length}`, done: completed, total: outline.nodes.length });
    return node;
  });
  nodes.sort((a, b) => a.sourcePages[0] - b.sourcePages[0]);
  nodes.forEach((node, index) => {
    node.id = index + 1;
    node.status = index === 0 ? 'active' : 'locked';
  });

  const rawText = inventory.map((page) => `--- Page ${page.page} ---\n${page.groundingText || page.text}`).join('\n\n');
  return {
    title,
    courseCode: '',
    nodes,
    rawText,
    totalPages,
    skippedPages: validSkippedPages,
    inventory,
    coverage
  };
}
