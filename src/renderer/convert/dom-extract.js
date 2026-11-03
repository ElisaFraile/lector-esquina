// Convierte un libro abierto con foliate-js (MOBI, AZW3, EPUB...) al modelo de
// book-model.js, conservando el texto, los títulos, la negrita y la cursiva.
import { normalizeBook } from './book-model.js'

const BLOCK = new Set(['p', 'div', 'section', 'article', 'header', 'footer', 'aside', 'main',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'li', 'dd', 'dt', 'pre', 'figure',
    'figcaption', 'table', 'tr', 'td', 'th', 'center', 'address', 'ul', 'ol', 'dl', 'body'])
const SKIP = new Set(['script', 'style', 'head', 'title', 'svg', 'math', 'img', 'image',
    'video', 'audio', 'object', 'iframe', 'noscript', 'template', 'button', 'input'])
const BOLD = new Set(['b', 'strong'])
const ITALIC = new Set(['i', 'em', 'cite', 'var', 'dfn'])

const formatLanguageMap = x => !x ? '' : typeof x === 'string' ? x : Object.values(x)[0] ?? ''
const formatContributor = c => Array.isArray(c) ? c.map(formatContributor).join(', ')
    : typeof c === 'string' ? c : formatLanguageMap(c?.name)

export const documentToBlocks = doc => {
    const blocks = []
    let current = null
    const flush = () => {
        if (current && current.runs.some(r => r.br || r.text.trim())) blocks.push(current)
        current = null
    }
    const ensure = type => current ??= { type: type.type, level: type.level, runs: [] }

    const walk = (node, ctx) => {
        if (node.nodeType === 3) {
            const text = ctx.pre ? node.nodeValue : node.nodeValue.replace(/\s+/g, ' ')
            if (!text) return
            ensure(ctx.block).runs.push({ text, b: ctx.b || undefined, i: ctx.i || undefined })
            return
        }
        if (node.nodeType !== 1) return
        const tag = node.localName?.toLowerCase()
        if (SKIP.has(tag)) return
        if (node.getAttribute?.('hidden') != null) return
        if (tag === 'br') { ensure(ctx.block).runs.push({ br: true }); return }
        if (tag === 'hr') { flush(); blocks.push({ type: 'hr' }); return }
        // las notas al pie de EPUB 3 se omiten
        const epubType = node.getAttributeNS?.('http://www.idpf.org/2007/ops', 'type') ?? ''
        if (/\b(footnote|endnote|rearnote|note|pagebreak)\b/.test(epubType)) return

        const next = { ...ctx }
        if (BOLD.has(tag)) next.b = true
        if (ITALIC.has(tag)) next.i = true
        const isBlock = BLOCK.has(tag)
        if (isBlock) {
            flush()
            if (/^h[1-6]$/.test(tag)) next.block = { type: 'h', level: Number(tag[1]) }
            else if (tag === 'li') next.block = { type: 'li' }
            else if (tag === 'blockquote') next.block = { type: 'quote' }
            else if (tag === 'pre') { next.block = { type: 'p' }; next.pre = true }
            // un <p> o <div> dentro de un título, cita o lista conserva ese tipo
            else next.block = ctx.block.type === 'p' ? { type: 'p' } : ctx.block
        }
        for (const child of node.childNodes) walk(child, next)
        if (isBlock) flush()
    }
    const root = doc.body ?? doc.documentElement
    if (root) walk(root, { block: { type: 'p' } })
    flush()
    return blocks
}

const firstHeading = blocks => {
    const h = blocks.find(b => b.type === 'h')
    return h ? h.runs.map(r => r.br ? ' ' : r.text).join('').replace(/\s+/g, ' ').trim().slice(0, 120) : ''
}

export const extractFoliateBook = async (book, { onProgress } = {}) => {
    const chapters = []
    const sections = book.sections ?? []
    for (let i = 0; i < sections.length; i++) {
        const section = sections[i]
        onProgress?.(i + 1, sections.length)
        if (!section.createDocument) continue
        try {
            const doc = await section.createDocument()
            const blocks = documentToBlocks(doc)
            if (blocks.length) chapters.push({ title: firstHeading(blocks), blocks })
        } catch (e) {
            console.warn('No se pudo leer la sección', i, e)
        }
    }
    const meta = book.metadata ?? {}
    const lang = formatLanguageMap(Array.isArray(meta.language) ? meta.language[0] : meta.language)
    return normalizeBook({
        title: formatLanguageMap(meta.title),
        author: formatContributor(meta.author),
        language: lang || 'es',
        chapters,
    })
}
