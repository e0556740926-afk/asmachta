import * as pdfjsLib from 'pdfjs-dist'
import type { TextItem } from 'pdfjs-dist/types/src/display/api'
// Vite '?url' import resolves to a hashed, bundled URL for the worker file, which pdf.js needs to
// parse off the main thread.
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import mammoth from 'mammoth'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

async function extractPdfText(file: File): Promise<string> {
  const buf = await file.arrayBuffer()
  const doc = await pdfjsLib.getDocument({ data: buf }).promise
  const pages: string[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    const text = content.items.map((it) => ('str' in it ? (it as TextItem).str : '')).join(' ')
    pages.push(text)
  }
  return pages.join('\n\n')
}

async function extractDocxText(file: File): Promise<string> {
  const buf = await file.arrayBuffer()
  const result = await mammoth.extractRawText({ arrayBuffer: buf })
  return result.value
}

/**
 * Best-effort client-side text extraction for an uploaded summary file, so the organize-summary
 * Edge Function can hand raw text straight to Gemini without parsing PDFs/DOCX itself (Deno's npm
 * compatibility for those libraries is far less battle-tested than these packages are in a
 * browser bundle). Returns null for a file type we don't know how to parse — the caller then
 * skips AI organization for that upload rather than failing the whole upload.
 */
export async function extractTextFromFile(file: File): Promise<string | null> {
  const name = file.name.toLowerCase()
  try {
    if (file.type === 'application/pdf' || name.endsWith('.pdf')) {
      return await extractPdfText(file)
    }
    if (
      file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      name.endsWith('.docx')
    ) {
      return await extractDocxText(file)
    }
    if (file.type === 'text/plain' || name.endsWith('.txt')) {
      return await file.text()
    }
  } catch (e) {
    console.error('text extraction failed', e)
    return null
  }
  return null
}
