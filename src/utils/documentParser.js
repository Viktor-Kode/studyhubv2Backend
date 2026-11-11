import { parsePdfBuffer } from './parsePdf.js';
import mammoth from 'mammoth';
import { parseOffice } from 'officeparser';

/**
 * Simplified document parser for the backend.
 * Focuses on PDF, DOCX, PPTX/PPT, and TXT, with robust error handling.
 */
export const parseDocumentBuffer = async (buffer, originalname, mimetype) => {
  const extension = originalname?.split('.').pop()?.toLowerCase();
  const mime = mimetype?.toLowerCase();

  try {
    // 1. PDF (Priority)
    if (extension === 'pdf' || mime?.includes('pdf')) {
      return await parsePdfBuffer(buffer);
    }

    // 2. DOCX
    if (extension === 'docx' || mime?.includes('wordprocessingml')) {
      const result = await mammoth.extractRawText({ arrayBuffer: buffer });
      return { text: result.value, numpages: 1 };
    }

    // 3. PPTX / PPT
    if (extension === 'pptx' || extension === 'ppt' || mime?.includes('powerpoint') || mime?.includes('presentationml')) {
      const text = await parseOffice(buffer);
      return { text: text || '', numpages: 1 };
    }

    // 4. TXT / MD
    // 5. Images (PNG, JPG, JPEG, WEBP) via DeepSeek Vision OCR
    if (['png', 'jpg', 'jpeg', 'webp'].includes(extension) || mime?.startsWith('image/')) {
      const { default: aiClient } = await import('./aiClient.js');
      const imageBase64 = buffer.toString('base64');
      const response = await aiClient.chatCompletion({
        model: 'deepseek-flash',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: 'Extract all study content, slide titles, diagrams, bullet points, and anatomical/conceptual relationships from this image verbatim. Return only the extracted text content.' },
            { type: 'image_url', image_url: { url: `data:${mime || 'image/jpeg'};base64,${imageBase64}`, detail: 'auto' } }
          ]
        }],
        max_tokens: 4096,
        temperature: 0.1
      });
      const extracted = response.choices?.[0]?.message?.content || '';
      return { text: extracted.trim(), numpages: 1 };
    }

    if (extension === 'txt' || extension === 'md' || mime?.startsWith('text/')) {
      return { text: buffer.toString('utf8'), numpages: 1 };
    }

    // Fallback attempt with officeparser for other office formats
    try {
      const text = await parseOffice(buffer);
      if (text && text.trim().length > 0) {
        return { text, numpages: 1 };
      }
    } catch {
      // Continue to text fallback
    }

    // Fallback for everything else: Try to treat as text if small, or error out
    if (buffer.length < 100000) {
      return { text: buffer.toString('utf8'), numpages: 1 };
    }

    throw new Error('Unsupported file format');
  } catch (err) {
    console.error('[parseDocumentBuffer] Error:', err.message);
    throw err;
  }
};
