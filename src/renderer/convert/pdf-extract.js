// Extrae el texto de un PDF y lo reconstruye como libro "fluido" (párrafos y
// títulos), para poder leerlo con cualquier tamaño de letra igual que un MOBI.
import { normalizeBook } from './book-model.js'

let pdfjsLib
const loadPDFJS = async () => {
    if (pdfjsLib) return pdfjsLib
    await import('../vendor/foliate-js/vendor/pdfjs/pdf.mjs')
    pdfjsLib = globalThis.pdfjsLib
    pdfjsLib.GlobalWorkerOptions.workerSrc =
        new URL('../vendor/foliate-js/vendor/pdfjs/pdf.worker.mjs', import.meta.url).toString()
    return pdfjsLib
}

const median = arr => {
    if (!arr.length) return 0
    const s = [...arr].sort((a, b) => a - b)
    return s[Math.floor(s.length / 2)]
}
const percentile = (arr, p) => {
    if (!arr.length) return 0
    const s = [...arr].sort((a, b) => a - b)
    return s[Math.min(s.length - 1, Math.floor(s.length * p))]
}

// Agrupa los fragmentos de texto de una página en líneas.
const pageLines = items => {
    const lines = []
    let cur = null
    for (const it of items) {
        if (typeof it.str !== 'string') continue
        const [, , c, d, x, y] = it.transform
        const size = Math.hypot(c, d) || it.height || 10
        if (!it.str.trim()) {
            if (cur && it.str.length) cur.text += ' '
            continue
        }
        if (!cur || Math.abs(y - cur.y) > size * 0.5 || x < cur.xEnd - size * 2) {
            cur = { text: '', x, xEnd: x, y, size, sizes: [] }
            lines.push(cur)
        } else if (x - cur.xEnd > size * 0.15 && !/\s$/.test(cur.text)) cur.text += ' '
        cur.text += it.str
        cur.xEnd = Math.max(cur.xEnd, x + (it.width || 0))
        cur.sizes.push(size)
        cur.size = Math.max(...cur.sizes)
    }
    for (const l of lines) l.text = l.text.replace(/\s+/g, ' ').trim()
    return lines.filter(l => l.text)
}

const isPageNumber = text => /^[-–—\s]*(\d{1,4}|[ivxlcdm]{1,7})[-–—\s]*$/i.test(text)
const normalizeForRepeat = text => text.toLowerCase().replace(/\d+/g, '#').trim()

export const extractPDF = async (data, { name = '', onProgress } = {}) => {
    const pdfjs = await loadPDFJS()
    const pdf = await pdfjs.getDocument({ data, isEvalSupported: false }).promise
    const pages = []
    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i)
        const content = await page.getTextContent()
        pages.push(pageLines(content.items))
        page.cleanup()
        onProgress?.(i, pdf.numPages)
    }
    const info = (await pdf.getMetadata().catch(() => null))?.info ?? {}
    pdf.destroy()

    const totalChars = pages.flat().reduce((s, l) => s + l.text.length, 0)
    if (totalChars < Math.min(500, 20 * pages.length))
        throw new Error('Este PDF no tiene texto seleccionable (parece escaneado), así que no se puede convertir.')

    // Cabeceras y pies de página: números de página y líneas que se repiten
    // en la parte superior o inferior de muchas páginas.
    const edgeCount = new Map()
    for (const lines of pages) {
        const edges = new Set([lines[0], lines[1], lines[lines.length - 1], lines[lines.length - 2]]
            .filter(Boolean).map(l => normalizeForRepeat(l.text)))
        for (const e of edges) edgeCount.set(e, (edgeCount.get(e) ?? 0) + 1)
    }
    const repeated = new Set([...edgeCount].filter(([, n]) => pages.length >= 4 && n >= pages.length * 0.3).map(([k]) => k))
    for (let p = 0; p < pages.length; p++) {
        const lines = pages[p]
        const isEdge = i => i < 2 || i >= lines.length - 2
        pages[p] = lines.filter((l, i) => !(isEdge(i) && (isPageNumber(l.text) || repeated.has(normalizeForRepeat(l.text)))))
    }

    const all = pages.flat()
    const bodySize = median(all.map(l => l.size)) || 10
    const bodyLines = all.filter(l => Math.abs(l.size - bodySize) < bodySize * 0.1)
    const leftX = median(bodyLines.map(l => l.x))
    const rightX = percentile(bodyLines.map(l => l.xEnd), 0.9)
    const gaps = []
    for (const lines of pages)
        for (let i = 1; i < lines.length; i++) {
            const g = lines[i - 1].y - lines[i].y
            if (g > 0) gaps.push(g)
        }
    const lineGap = median(gaps) || bodySize * 1.2

    const chapters = []
    let chapter = { title: '', blocks: [] }
    let block = null
    let prev = null
    const pushChapter = () => {
        if (chapter.blocks.length) chapters.push(chapter)
    }
    const startPara = line => {
        block = { type: 'p', runs: [{ text: line.text }] }
        chapter.blocks.push(block)
    }
    for (let p = 0; p < pages.length; p++) {
        const lines = pages[p]
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i]
            const ratio = line.size / bodySize
            const isHeading = ratio >= 1.2 && line.text.length < 150
            if (isHeading) {
                const level = ratio >= 1.6 ? 1 : 2
                if (block?.type === 'h' && prev && Math.abs(prev.size - line.size) < 1 && p === prev.page) {
                    // título que ocupa varias líneas
                    block.runs[0].text += ' ' + line.text
                } else {
                    // cada título empieza un capítulo nuevo
                    pushChapter()
                    chapter = { title: '', blocks: [] }
                    block = { type: 'h', level, runs: [{ text: line.text }] }
                    chapter.blocks.push(block)
                }
                if (block === chapter.blocks[0]) chapter.title = block.runs[0].text
            } else {
                const samePage = prev && prev.page === p
                const newPara = !block || block.type !== 'p'
                    || (samePage && prev.y - line.y > lineGap * 1.6)
                    || line.x > leftX + bodySize * 0.8
                    || (prev && prev.xEnd < rightX - bodySize * 3 && /[.!?:»”"…)]$/.test(prev.text))
                if (newPara) startPara(line)
                else {
                    const run = block.runs[0]
                    if (/[A-Za-zÀ-ÿ]-$/.test(run.text) && /^[a-zà-ÿ]/.test(line.text))
                        run.text = run.text.slice(0, -1) + line.text
                    else run.text += ' ' + line.text
                }
            }
            prev = { ...line, page: p }
        }
    }
    pushChapter()

    // Libros sin títulos detectables: dividir en partes de ~150 párrafos para
    // que el lector cargue más rápido.
    let finalChapters = chapters
    if (chapters.length === 1 && chapters[0].blocks.length > 300) {
        finalChapters = []
        const blocks = chapters[0].blocks
        for (let i = 0; i < blocks.length; i += 150)
            finalChapters.push({ title: `Parte ${finalChapters.length + 1}`, blocks: blocks.slice(i, i + 150) })
    }

    const fallbackTitle = name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ')
    return normalizeBook({
        title: info.Title?.trim() || fallbackTitle,
        author: info.Author?.trim() || '',
        language: 'es',
        chapters: finalChapters,
    })
}
