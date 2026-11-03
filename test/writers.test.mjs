import { test } from 'node:test'
import assert from 'node:assert/strict'
import { unzipSync, strFromU8 } from '../src/renderer/vendor/fflate.js'
import { writeEPUB } from '../src/renderer/convert/epub-writer.js'
import { writeMOBI } from '../src/renderer/convert/mobi-writer.js'
import { sampleBook } from './fixtures.mjs'

test('EPUB: estructura válida', () => {
    const files = unzipSync(writeEPUB(sampleBook()))
    const names = Object.keys(files)
    assert.equal(names[0], 'mimetype')
    assert.equal(strFromU8(files.mimetype), 'application/epub+zip')
    assert.ok(names.includes('OEBPS/content.opf'))
    assert.equal(names.filter(n => /cap\d+\.xhtml$/.test(n)).length, 4)
    const ch = strFromU8(files['OEBPS/cap0001.xhtml'])
    assert.match(ch, /&lt;etiqueta&gt; &amp; fin\./)
    assert.match(ch, /<i>cursiva<\/i>/)
})

test('MOBI: cabeceras y texto recuperable', () => {
    const data = writeMOBI(sampleBook())
    const dv = new DataView(data.buffer)
    assert.equal(new TextDecoder().decode(data.slice(60, 68)), 'BOOKMOBI')
    const n = dv.getUint16(76)
    const rec0 = dv.getUint32(78)
    assert.equal(new TextDecoder().decode(data.slice(rec0 + 16, rec0 + 20)), 'MOBI')
    const nText = dv.getUint16(rec0 + 8)
    assert.equal(n, nText + 4)
    // reconstruir el texto quitando las entradas finales
    const parts = []
    for (let i = 1; i <= nText; i++) {
        const start = dv.getUint32(78 + i * 8), end = dv.getUint32(78 + (i + 1) * 8)
        const rec = data.slice(start, end)
        parts.push(rec.slice(0, rec.length - ((rec[rec.length - 1] & 3) + 1)))
    }
    const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts))
    assert.equal(Buffer.byteLength(text), dv.getUint32(rec0 + 4))
    assert.match(text, /emojis 📚/)
    // los enlaces del índice apuntan a los saltos de página de cada capítulo
    const bytes = Buffer.from(text)
    for (const m of text.matchAll(/<a filepos=(\d{10})>/g)) {
        const at = bytes.subarray(Number(m[1]), Number(m[1]) + 4).toString()
        assert.equal(at, '<h2>')
    }
})
