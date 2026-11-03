// Modelo intermedio de libro que usan todos los conversores.
//
// Libro:     { title, author, language, chapters: Capitulo[] }
// Capitulo:  { title, blocks: Bloque[] }
// Bloque:    { type: 'p' | 'h' | 'quote' | 'li' | 'hr', level?: 1-6, runs: Tramo[] }
// Tramo:     { text: string, b?: true, i?: true } | { br: true }
//
// Los lectores (PDF, MOBI, EPUB) producen este modelo y los escritores
// (EPUB, MOBI) lo convierten en un archivo. Solo se conserva el texto y el
// formato básico (negrita, cursiva, títulos); las imágenes se descartan.

export const escapeXML = s => String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

const runsToHTML = (runs, br) => runs.map(r => {
    if (r.br) return br
    let s = escapeXML(r.text)
    if (r.i) s = `<i>${s}</i>`
    if (r.b) s = `<b>${s}</b>`
    return s
}).join('')

// Devuelve el HTML del cuerpo de un capítulo. `xhtml` decide si las etiquetas
// vacías se cierran al estilo XML (EPUB) o HTML clásico (MOBI).
export const blocksToHTML = (blocks, { xhtml = true } = {}) => {
    const br = xhtml ? '<br/>' : '<br>'
    const hr = xhtml ? '<hr/>' : '<hr>'
    const out = []
    let inList = false
    for (const block of blocks) {
        if (block.type !== 'li' && inList) { out.push('</ul>'); inList = false }
        const inner = runsToHTML(block.runs ?? [], br)
        switch (block.type) {
            case 'h': {
                const n = Math.min(Math.max(block.level ?? 2, 1), 6)
                out.push(`<h${n}>${inner}</h${n}>`)
                break
            }
            case 'quote': out.push(`<blockquote><p>${inner}</p></blockquote>`); break
            case 'li':
                if (!inList) { out.push('<ul>'); inList = true }
                out.push(`<li>${inner}</li>`)
                break
            case 'hr': out.push(hr); break
            default: out.push(`<p>${inner}</p>`)
        }
    }
    if (inList) out.push('</ul>')
    return out.join('\n')
}

export const blockText = block => (block.runs ?? []).map(r => r.br ? '\n' : r.text).join('')

// Quita capítulos y bloques vacíos y une tramos contiguos con el mismo formato.
export const normalizeBook = book => {
    const chapters = []
    for (const ch of book.chapters ?? []) {
        const blocks = []
        for (const block of ch.blocks ?? []) {
            if (block.type === 'hr') { blocks.push(block); continue }
            const runs = []
            for (const r of block.runs ?? []) {
                if (r.br) { runs.push(r); continue }
                if (!r.text) continue
                const prev = runs[runs.length - 1]
                if (prev && !prev.br && !!prev.b === !!r.b && !!prev.i === !!r.i)
                    prev.text += r.text
                else runs.push({ ...r })
            }
            // recortar espacios al principio y al final del bloque
            while (runs.length && runs[0].br) runs.shift()
            while (runs.length && runs[runs.length - 1].br) runs.pop()
            if (runs.length) {
                runs[0].text = runs[0].text.replace(/^\s+/, '')
                const last = runs[runs.length - 1]
                last.text = last.text.replace(/\s+$/, '')
            }
            if (runs.some(r => r.br || r.text)) blocks.push({ ...block, runs })
        }
        if (blocks.some(b => b.type !== 'hr')) chapters.push({ title: ch.title || '', blocks })
    }
    return {
        title: (book.title || 'Sin título').trim(),
        author: (book.author || '').trim(),
        language: book.language || 'es',
        chapters: chapters.length ? chapters
            : [{ title: '', blocks: [{ type: 'p', runs: [{ text: '(Libro vacío)' }] }] }],
    }
}
