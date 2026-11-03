// Convierte un archivo de texto plano (.txt) al modelo de libro.
import { normalizeBook } from './book-model.js'

const decode = bytes => {
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch {
        return new TextDecoder('windows-1252').decode(bytes)
    }
}

const CHAPTER = /^\s*(cap[ií]tulo|chapter|parte|libro|pr[oó]logo|ep[ií]logo)\b.{0,80}$/i

export const textToBook = (bytes, name = '') => {
    const text = decode(bytes).replace(/^﻿/, '').replace(/\r\n?/g, '\n')
    const blankSeparated = (text.match(/\n\s*\n/g) ?? []).length > 3
    const paragraphs = blankSeparated
        ? text.split(/\n\s*\n/).map(p => p.replace(/\s*\n\s*/g, ' ').trim())
        : text.split('\n').map(p => p.trim())

    const chapters = []
    let chapter = { title: '', blocks: [] }
    for (const p of paragraphs) {
        if (!p) continue
        if (CHAPTER.test(p)) {
            if (chapter.blocks.length) chapters.push(chapter)
            chapter = { title: p, blocks: [{ type: 'h', level: 2, runs: [{ text: p }] }] }
        } else chapter.blocks.push({ type: 'p', runs: [{ text: p }] })
        if (chapter.blocks.length >= 200) {
            chapters.push(chapter)
            chapter = { title: '', blocks: [] }
        }
    }
    if (chapter.blocks.length) chapters.push(chapter)
    return normalizeBook({
        title: name.replace(/\.[^.]+$/, '').replace(/_+/g, ' '),
        language: 'es',
        chapters,
    })
}
