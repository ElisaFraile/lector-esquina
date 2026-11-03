// Genera un archivo MOBI (Mobipocket 6, el formato clásico de Kindle) a partir
// del modelo de libro de book-model.js. El texto se guarda sin comprimir en
// UTF-8, con un índice enlazado al principio del libro.
import { escapeXML, blocksToHTML, normalizeBook } from './book-model.js'

const RECORD_SIZE = 4096
const enc = new TextEncoder()

const u16 = n => [(n >>> 8) & 0xff, n & 0xff]
const u32 = n => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]
const NULL32 = 0xffffffff

const concat = arrays => {
    const total = arrays.reduce((s, a) => s + a.length, 0)
    const out = new Uint8Array(total)
    let off = 0
    for (const a of arrays) { out.set(a, off); off += a.length }
    return out
}

// Códigos de idioma de Mobipocket (los más habituales).
const LANG = { es: 10, en: 9, fr: 12, de: 7, it: 16, pt: 22, ca: 3, nl: 19 }

// Los enlaces de MOBI usan posiciones en bytes con ancho fijo para poder
// rellenarlas después de calcular el tamaño de todo el libro.
const pos = n => String(n).padStart(10, '0')
const PLACEHOLDER = /filepos=(\d{10})/g

const buildText = book => {
    const chapters = book.chapters.map((ch, i) => ({
        label: ch.title || (book.chapters.length === 1 ? book.title : `Parte ${i + 1}`),
        html: blocksToHTML(ch.blocks, { xhtml: false }),
    }))
    const head = `<html><head><guide><reference type="toc" title="Índice" filepos=${pos(0)} /></guide></head><body>`
    const toc = '<h2>Índice</h2>'
        + chapters.map((ch, i) => `<p><a filepos=${pos(i + 1)}>${escapeXML(ch.label)}</a></p>`).join('')
    const parts = [head, `<a name="indice"></a>`, toc]
    const marks = [] // índice en `parts` donde empieza cada destino
    marks.push(1) // el índice
    for (const ch of chapters) {
        parts.push('<mbp:pagebreak/>')
        marks.push(parts.length)
        parts.push(ch.html)
    }
    parts.push('</body></html>')

    // calcular la posición en bytes de cada destino
    const sizes = parts.map(p => enc.encode(p).length)
    const offsets = marks.map(m => sizes.slice(0, m).reduce((a, b) => a + b, 0))
    // sustituir los marcadores (el número dentro es el índice del destino);
    // solo en la cabecera y el índice, nunca en el texto del libro
    const fill = s => s.replace(PLACEHOLDER, (_, n) => `filepos=${pos(offsets[Number(n)])}`)
    parts[0] = fill(parts[0])
    parts[2] = fill(parts[2])
    return enc.encode(parts.join(''))
}

const splitRecords = text => {
    const records = []
    for (let off = 0; off < text.length; off += RECORD_SIZE) {
        const end = Math.min(off + RECORD_SIZE, text.length)
        const chunk = text.subarray(off, end)
        // Si un carácter UTF-8 queda partido entre dos registros, se copian los
        // bytes que faltan al final (entrada "multibyte" de los registros).
        let n = 0
        while (end + n < text.length && n < 3 && (text[end + n] & 0xc0) === 0x80) n++
        const rec = new Uint8Array(chunk.length + n + 1)
        rec.set(chunk)
        rec.set(text.subarray(end, end + n), chunk.length)
        rec[rec.length - 1] = n
        records.push(rec)
    }
    return records
}

const exthRecord = (type, value) => {
    const data = typeof value === 'string' ? enc.encode(value) : Uint8Array.from(value)
    return Uint8Array.from([...u32(type), ...u32(data.length + 8), ...data])
}

const FLIS = Uint8Array.from([
    0x46, 0x4c, 0x49, 0x53, 0, 0, 0, 8, 0, 0x41, 0, 0, 0, 0, 0, 0,
    0xff, 0xff, 0xff, 0xff, 0, 1, 0, 3, 0, 0, 0, 3, 0, 0, 0, 1, 0xff, 0xff, 0xff, 0xff])
const FCIS = textLength => Uint8Array.from([
    0x46, 0x43, 0x49, 0x53, 0, 0, 0, 0x14, 0, 0, 0, 0x10, 0, 0, 0, 2, 0, 0, 0, 0,
    ...u32(textLength),
    0, 0, 0, 0, 0, 0, 0, 0x28, 0, 0, 0, 0, 0, 0, 0,
    0x28, 0, 0, 0, 8, 0, 1, 0, 1, 0, 0, 0, 0])
const EOF = Uint8Array.from([0xe9, 0x8e, 0x0d, 0x0a])

export const writeMOBI = input => {
    const book = normalizeBook(input)
    const text = buildText(book)
    const textRecords = splitRecords(text)
    const nText = textRecords.length
    const flisIndex = nText + 1
    const fcisIndex = nText + 2
    const uid = (Math.random() * 0xffffffff) >>> 0
    const lang = LANG[book.language.slice(0, 2).toLowerCase()] ?? 0

    // EXTH: metadatos (autor, título, idioma)
    const exthRecords = [
        ...(book.author ? [exthRecord(100, book.author)] : []),
        exthRecord(503, book.title),
        exthRecord(524, book.language),
    ]
    const exthBody = concat(exthRecords)
    const exthLen = 12 + exthBody.length
    const exthPad = (4 - (exthLen % 4)) % 4
    const exth = concat([
        enc.encode('EXTH'), Uint8Array.from(u32(exthLen)), Uint8Array.from(u32(exthRecords.length)),
        exthBody, new Uint8Array(exthPad),
    ])

    const MOBI_HEADER_LEN = 232
    const fullName = enc.encode(book.title)
    const fullNameOffset = 16 + MOBI_HEADER_LEN + exth.length

    const header = new Uint8Array(16 + MOBI_HEADER_LEN)
    const put = (offset, bytes) => header.set(bytes, offset)
    // cabecera PalmDOC
    put(0, u16(1)) // sin compresión
    put(4, u32(text.length))
    put(8, u16(nText))
    put(10, u16(RECORD_SIZE))
    // cabecera MOBI
    put(16, enc.encode('MOBI'))
    put(20, u32(MOBI_HEADER_LEN))
    put(24, u32(2)) // libro Mobipocket
    put(28, u32(65001)) // UTF-8
    put(32, u32(uid))
    put(36, u32(6)) // versión del formato
    for (let o = 40; o < 80; o += 4) put(o, u32(NULL32)) // índices no usados
    put(80, u32(flisIndex)) // primer registro que no es texto
    put(84, u32(fullNameOffset))
    put(88, u32(fullName.length))
    put(92, u32(lang))
    put(104, u32(6)) // versión mínima del lector
    put(108, u32(flisIndex)) // primer registro de imágenes (no hay)
    put(128, u32(0x50)) // hay bloque EXTH
    put(164, u32(NULL32))
    put(168, u32(NULL32)) // sin DRM
    put(192, u16(1)) // primer registro de contenido
    put(194, u16(nText)) // último registro de contenido
    put(196, u32(1))
    put(200, u32(fcisIndex))
    put(204, u32(1))
    put(208, u32(flisIndex))
    put(212, u32(1))
    put(224, u32(NULL32))
    put(232, u32(NULL32))
    put(236, u32(NULL32))
    put(240, u32(1)) // registros con entrada final "multibyte"
    put(244, u32(NULL32)) // sin índice NCX

    const namePad = 4 - (fullName.length % 4) + 4
    const record0 = concat([header, exth, fullName, new Uint8Array(namePad)])

    const records = [record0, ...textRecords, FLIS, FCIS(text.length), EOF]

    // cabecera de base de datos Palm (PDB)
    const n = records.length
    const pdbHeader = new Uint8Array(78 + n * 8 + 2)
    const pdbName = enc.encode(book.title.normalize('NFKD').replace(/[^\x20-\x7e]/g, '')
        .replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 31) || 'libro')
    pdbHeader.set(pdbName, 0)
    const now = Math.floor(Date.now() / 1000)
    pdbHeader.set(u32(now), 36)
    pdbHeader.set(u32(now), 40)
    pdbHeader.set(enc.encode('BOOKMOBI'), 60)
    pdbHeader.set(u32(2 * n - 1), 68)
    pdbHeader.set(u16(n), 76)
    let offset = pdbHeader.length
    records.forEach((rec, i) => {
        pdbHeader.set(u32(offset), 78 + i * 8)
        pdbHeader.set(u32(2 * i), 78 + i * 8 + 4) // atributos = 0 + id único
        offset += rec.length
    })
    return concat([pdbHeader, ...records])
}
