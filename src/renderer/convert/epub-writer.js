// Genera un archivo EPUB 3 (compatible también con lectores EPUB 2) a partir
// del modelo de libro de book-model.js.
import { zipSync, strToU8 } from '../vendor/fflate.js'
import { escapeXML, blocksToHTML, normalizeBook } from './book-model.js'

const uuid = () => globalThis.crypto?.randomUUID?.()
    ?? 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
    })

const CSS = `body { margin: 0 4%; line-height: 1.45; }
p { margin: 0 0 0.6em; text-indent: 0; }
h1, h2, h3, h4, h5, h6 { line-height: 1.2; margin: 1em 0 0.6em; }
blockquote { margin: 0.6em 1.5em; font-style: italic; }
hr { border: 0; border-top: 1px solid #999; margin: 1.2em 20%; }
`

const xhtmlPage = (title, lang, body) => `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${escapeXML(lang)}" xml:lang="${escapeXML(lang)}">
<head>
<meta charset="utf-8"/>
<title>${escapeXML(title)}</title>
<link rel="stylesheet" type="text/css" href="estilo.css"/>
</head>
<body>
${body}
</body>
</html>
`

export const writeEPUB = input => {
    const book = normalizeBook(input)
    const { title, author, language } = book
    const id = `urn:uuid:${uuid()}`
    const modified = new Date().toISOString().replace(/\.\d+Z$/, 'Z')

    const chapters = book.chapters.map((ch, i) => {
        const label = ch.title || (book.chapters.length === 1 ? title : `Parte ${i + 1}`)
        // si el capítulo no empieza con un título, añadimos uno solo si lo tiene
        const body = blocksToHTML(ch.blocks, { xhtml: true })
        return { file: `cap${String(i + 1).padStart(4, '0')}.xhtml`, id: `cap${i + 1}`, label, body }
    })

    const files = {
        mimetype: [strToU8('application/epub+zip'), { level: 0 }],
        'META-INF/container.xml': strToU8(`<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>
`),
        'OEBPS/estilo.css': strToU8(CSS),
    }

    for (const ch of chapters)
        files[`OEBPS/${ch.file}`] = strToU8(xhtmlPage(ch.label, language, ch.body))

    files['OEBPS/nav.xhtml'] = strToU8(xhtmlPage('Índice', language,
        `<nav epub:type="toc" id="toc"><h1>Índice</h1><ol>
${chapters.map(ch => `<li><a href="${ch.file}">${escapeXML(ch.label)}</a></li>`).join('\n')}
</ol></nav>`))

    files['OEBPS/toc.ncx'] = strToU8(`<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
<head><meta name="dtb:uid" content="${escapeXML(id)}"/></head>
<docTitle><text>${escapeXML(title)}</text></docTitle>
<navMap>
${chapters.map((ch, i) => `<navPoint id="np${i + 1}" playOrder="${i + 1}"><navLabel><text>${escapeXML(ch.label)}</text></navLabel><content src="${ch.file}"/></navPoint>`).join('\n')}
</navMap>
</ncx>
`)

    files['OEBPS/content.opf'] = strToU8(`<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="${escapeXML(language)}">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="bookid">${escapeXML(id)}</dc:identifier>
<dc:title>${escapeXML(title)}</dc:title>
${author ? `<dc:creator>${escapeXML(author)}</dc:creator>` : ''}
<dc:language>${escapeXML(language)}</dc:language>
<meta property="dcterms:modified">${modified}</meta>
</metadata>
<manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
<item id="css" href="estilo.css" media-type="text/css"/>
${chapters.map(ch => `<item id="${ch.id}" href="${ch.file}" media-type="application/xhtml+xml"/>`).join('\n')}
</manifest>
<spine toc="ncx">
${chapters.map(ch => `<itemref idref="${ch.id}"/>`).join('\n')}
</spine>
</package>
`)

    return zipSync(files, { level: 6 })
}
