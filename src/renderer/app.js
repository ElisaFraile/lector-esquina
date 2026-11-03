// Interfaz del lector: abre el libro guardado, aplica los ajustes, gestiona la
// navegación, el avance automático, el progreso y las conversiones.
import './vendor/foliate-js/view.js'
import { extractFoliateBook } from './convert/dom-extract.js'
import { writeEPUB } from './convert/epub-writer.js'
import { writeMOBI } from './convert/mobi-writer.js'
import { textToBook } from './convert/text-extract.js'

const api = window.lector
const $ = s => document.querySelector(s)

let state = null
let settings = null
let view = null
let currentBook = null
let autoTimer = null
let autoPaused = false
let openToken = 0

const FONTS = {
    serif: 'Georgia, "Palatino Linotype", "Times New Roman", serif',
    sans: '"Segoe UI", "Helvetica Neue", Arial, sans-serif',
    mono: 'Consolas, "Courier New", monospace',
}

// ---------- utilidades ----------

const status = {
    show(text, { error = false, progress = null, timeout = 0 } = {}) {
        clearTimeout(this.timer)
        $('#status').hidden = false
        $('#status').classList.toggle('error', error)
        $('#status-text').textContent = text
        $('#status-bar').hidden = progress == null
        if (progress != null) $('#status-bar div').style.width = `${Math.round(progress * 100)}%`
        if (timeout) this.timer = setTimeout(() => this.hide(), timeout)
    },
    hide() { $('#status').hidden = true },
}
const errorMessage = e => (e?.message ?? String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

const debounce = (fn, ms) => {
    let t
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms) }
}

const cssColor = name => getComputedStyle(document.body).getPropertyValue(name).trim()

// ---------- colores ----------

const THEMES = ['light', 'sepia', 'gray', 'dark', 'black']
const THEME_NAMES = { light: 'Blanco', sepia: 'Sepia', gray: 'Gris suave', dark: 'Oscuro', black: 'Negro', auto: 'Automático' }
const systemDark = window.matchMedia('(prefers-color-scheme: dark)')
// el tema "auto" sigue el modo claro/oscuro de Windows
const effectiveTheme = () => settings.theme === 'auto'
    ? (systemDark.matches ? 'dark' : 'light')
    : THEMES.includes(settings.theme) ? settings.theme : 'sepia'
const isDark = () => ['dark', 'black'].includes(effectiveTheme())

const setTheme = theme => {
    saveSettings({ theme })
    status.show(`Color: ${THEME_NAMES[theme]}`, { timeout: 900 })
}
const cycleTheme = () => {
    const i = THEMES.indexOf(settings.theme)
    setTheme(THEMES[(i + 1) % THEMES.length])
}
// alterna entre claro y oscuro recordando cuál de cada tipo se usó por última vez
let lastLight = 'sepia', lastDark = 'dark'
const toggleDark = () => {
    if (isDark()) setTheme(THEMES.includes(lastLight) ? lastLight : 'light')
    else setTheme(lastDark)
}
const toggleThemeMenu = force => {
    const menu = $('#themes')
    menu.hidden = !(force ?? menu.hidden)
    if (!menu.hidden) showBar()
}

// ---------- estilos del libro ----------

const bookCSS = () => {
    const { fontSize, lineHeight, fontFamily } = settings
    const family = FONTS[fontFamily]
    const bg = cssColor('--bg'), fg = cssColor('--fg'), accent = cssColor('--accent')
    const dark = isDark()
    return `
html { color-scheme: ${dark ? 'dark' : 'light'}; font-size: ${fontSize}px !important; }
html, body { background: ${bg} !important; color: ${fg} !important; }
body {
    font-size: ${fontSize}px !important;
    line-height: ${lineHeight} !important;
    ${family ? `font-family: ${family} !important;` : ''}
    margin: 0 !important;
}
body * { color: inherit !important; background-color: transparent !important; border-color: ${fg}33 !important; }
p, li, blockquote, dd, div, span, td {
    line-height: ${lineHeight} !important;
    ${family ? 'font-family: inherit !important;' : ''}
}
p, li, dd, td { font-size: 1em !important; }
a, a * { color: ${accent} !important; }
img, svg, video { max-width: 100% !important; height: auto !important; }
pre { white-space: pre-wrap !important; }
${dark ? 'img { filter: brightness(.85); }' : ''}
`
}

const applyLayout = () => {
    const r = view?.renderer
    if (!r) return
    const w = window.innerWidth
    const side = Math.max(0, settings.margin)
    // el hueco entre columnas es un porcentaje: con una columna se reparte a ambos lados
    const gap = Math.min(40, (2 * side / Math.max(w, 1)) * 100)
    r.setAttribute('gap', `${gap.toFixed(2)}%`)
    r.setAttribute('margin', `${Math.max(4, Math.round(side * 0.6))}px`)
    r.setAttribute('max-inline-size', '1400px')
    r.setAttribute('max-block-size', '4000px')
    r.setAttribute('max-column-count', w > 1100 ? '2' : '1')
    if (r.getAttribute('flow') !== settings.flow) r.setAttribute('flow', settings.flow)
    r.setStyles?.(bookCSS())
}

// ---------- ajustes ----------

const applySettings = () => {
    const theme = effectiveTheme()
    document.body.dataset.theme = theme
    if (settings.theme !== 'auto') {
        if (isDark()) lastDark = theme
        else lastLight = theme
    }
    for (const b of document.querySelectorAll('#themes button'))
        b.classList.toggle('on', b.dataset.theme === settings.theme)
    $('#btn-theme').title = `Color de la página: ${THEME_NAMES[settings.theme] ?? ''} (T)`
    document.body.classList.toggle('bar-auto', !!settings.autoHideBar)
    document.body.classList.toggle('hide-progress', !settings.showProgress)
    $('#btn-pin').classList.toggle('on', !!settings.alwaysOnTop)
    $('#btn-pin').title = settings.alwaysOnTop ? 'Siempre encima: activado' : 'Siempre encima: desactivado'
    applyLayout()
    setupAutoAdvance()
    syncPanel()
}

const saveSettings = async partial => {
    settings = { ...settings, ...partial }
    applySettings()
    settings = await api.setSettings(partial)
}

const RANGE_FORMAT = {
    fontSize: v => `${v} px`,
    lineHeight: v => Number(v).toFixed(2),
    margin: v => `${v} px`,
    autoSeconds: v => `${v} s`,
    opacity: v => `${Math.round(v * 100)} %`,
}

const prettyShortcut = accel => !accel ? '(sin atajo)' : accel
    .replace('CommandOrControl', 'Ctrl').replace('Control', 'Ctrl').replace(/\+/g, ' + ')

const syncPanel = () => {
    for (const [key, fmt] of Object.entries(RANGE_FORMAT)) {
        const input = $(`#${key}`)
        if (document.activeElement !== input) input.value = settings[key]
        $(`#out-${key}`).textContent = fmt(settings[key])
    }
    for (const key of ['fontFamily', 'theme', 'flow']) $(`#${key}`).value = settings[key]
    for (const key of ['autoAdvance', 'showProgress', 'alwaysOnTop', 'autoHideBar', 'showInTaskbar', 'escHides'])
        $(`#${key}`).checked = !!settings[key]
    $('#autoSeconds').disabled = !settings.autoAdvance
    $('#shortcut').value = prettyShortcut(settings.shortcut)
}

const setupPanel = () => {
    for (const key of Object.keys(RANGE_FORMAT)) {
        const input = $(`#${key}`)
        const isFloat = ['lineHeight', 'opacity'].includes(key)
        const save = debounce(v => saveSettings({ [key]: v }), 120)
        input.addEventListener('input', () => {
            const v = isFloat ? parseFloat(input.value) : parseInt(input.value, 10)
            $(`#out-${key}`).textContent = RANGE_FORMAT[key](v)
            save(v)
        })
    }
    for (const key of ['fontFamily', 'theme', 'flow'])
        $(`#${key}`).addEventListener('change', e => saveSettings({ [key]: e.target.value }))
    for (const key of ['autoAdvance', 'showProgress', 'alwaysOnTop', 'autoHideBar', 'showInTaskbar', 'escHides'])
        $(`#${key}`).addEventListener('change', e => {
            if (key === 'autoAdvance') autoPaused = false
            saveSettings({ [key]: e.target.checked })
        })

    // captura del atajo global
    const input = $('#shortcut')
    input.addEventListener('focus', () => {
        input.value = 'Pulsa la combinación… (Supr para quitarla)'
    })
    input.addEventListener('blur', () => { input.value = prettyShortcut(settings.shortcut) })
    input.addEventListener('keydown', async e => {
        e.preventDefault()
        e.stopPropagation()
        if (e.key === 'Escape') return input.blur()
        if (e.key === 'Delete' || e.key === 'Backspace') {
            await saveSettings({ shortcut: '' })
            $('#shortcut-msg').textContent = 'Atajo eliminado.'
            return input.blur()
        }
        if (['Control', 'Alt', 'Shift', 'Meta', 'AltGraph'].includes(e.key)) return
        const mods = []
        if (e.ctrlKey) mods.push('CommandOrControl')
        if (e.altKey) mods.push('Alt')
        if (e.shiftKey) mods.push('Shift')
        if (!mods.length || (mods.length === 1 && mods[0] === 'Shift')) {
            $('#shortcut-msg').textContent = 'Usa Ctrl y/o Alt junto con otra tecla.'
            return
        }
        const key = codeToAccelerator(e.code)
        if (!key) { $('#shortcut-msg').textContent = 'Esa tecla no se puede usar.'; return }
        const accel = [...mods, key].join('+')
        const ok = await api.testShortcut(accel)
        settings = (await api.getState()).settings
        $('#shortcut-msg').textContent = ok
            ? `Atajo guardado: ${prettyShortcut(accel)}`
            : 'Esa combinación ya la usa otro programa. Prueba otra.'
        input.blur()
    })

    $('#btn-panel-close').addEventListener('click', () => togglePanel(false))
    $('#btn-open2').addEventListener('click', chooseAndOpen)
    $('#btn-remove').addEventListener('click', removeBook)
    $('#btn-export-epub').addEventListener('click', () => exportBook('epub'))
    $('#btn-export-mobi').addEventListener('click', () => exportBook('mobi'))
    $('#btn-reset-pos').addEventListener('click', () => api.resetPosition())
}

const codeToAccelerator = code => {
    if (/^Key[A-Z]$/.test(code)) return code.slice(3)
    if (/^Digit\d$/.test(code)) return code.slice(5)
    if (/^F\d{1,2}$/.test(code)) return code
    if (/^Numpad\d$/.test(code)) return 'num' + code.slice(6)
    const map = {
        Space: 'Space', Enter: 'Enter', Tab: 'Tab', ArrowUp: 'Up', ArrowDown: 'Down',
        ArrowLeft: 'Left', ArrowRight: 'Right', Home: 'Home', End: 'End', PageUp: 'PageUp',
        PageDown: 'PageDown', Insert: 'Insert', Minus: '-', Equal: '=', Comma: ',', Period: '.',
        Slash: '/', Backslash: '\\', BracketLeft: '[', BracketRight: ']', Semicolon: ';',
        Quote: "'", Backquote: '`',
    }
    return map[code] ?? null
}

const togglePanel = force => {
    const panel = $('#panel')
    const show = force ?? panel.hidden
    panel.hidden = !show
    if (show) {
        syncPanel()
        updateBookInfo()
    }
}

// ---------- barra que se oculta sola ----------

let barTimer
const showBar = () => {
    document.body.classList.add('bar-visible')
    clearTimeout(barTimer)
    barTimer = setTimeout(hideBar, 2500)
}
const hideBar = () => {
    clearTimeout(barTimer)
    if ($('#bar').matches(':hover') || !$('#themes').hidden) { barTimer = setTimeout(hideBar, 1500); return }
    document.body.classList.remove('bar-visible')
}
const watchPointer = doc => {
    doc.addEventListener('mousemove', showBar, { passive: true })
    doc.documentElement.addEventListener('mouseleave', () => {
        clearTimeout(barTimer)
        barTimer = setTimeout(hideBar, 400)
    })
}

// ---------- navegación ----------

const next = () => view?.next()
const prev = () => view?.prev()

let lastWheel = 0
const onWheel = e => {
    if (!view || settings.flow !== 'paginated' || e.ctrlKey) return
    const now = Date.now()
    if (now - lastWheel < 250) return
    if (Math.abs(e.deltaY) < 4 && Math.abs(e.deltaX) < 4) return
    lastWheel = now
    const d = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX
    d > 0 ? next() : prev()
    restartAutoTimer()
}

const onKey = e => {
    if (e.target?.closest?.('#panel') && e.key !== 'Escape') return
    if (e.target?.matches?.('input, select, textarea')) return
    const k = e.key
    if (e.ctrlKey && (k === 'o' || k === 'O')) { e.preventDefault(); chooseAndOpen(); return }
    if (e.ctrlKey && (k === '+' || k === '=')) { e.preventDefault(); changeFontSize(1); return }
    if (e.ctrlKey && k === '-') { e.preventDefault(); changeFontSize(-1); return }
    if (e.ctrlKey || e.altKey || e.metaKey) return
    switch (k) {
        case 'Escape':
            if (!$('#themes').hidden) toggleThemeMenu(false)
            else if (!$('#panel').hidden) togglePanel(false)
            else if (settings.escHides) api.hide()
            break
        case 'ArrowRight': case 'PageDown': case ' ':
            e.preventDefault(); view?.goRight?.() ?? next(); restartAutoTimer(); break
        case 'ArrowLeft': case 'PageUp':
            e.preventDefault(); view?.goLeft?.() ?? prev(); restartAutoTimer(); break
        case 'ArrowDown':
            if (settings.flow === 'paginated') { e.preventDefault(); next(); restartAutoTimer() }
            break
        case 'ArrowUp':
            if (settings.flow === 'paginated') { e.preventDefault(); prev(); restartAutoTimer() }
            break
        case '+': case '=': changeFontSize(1); break
        case '-': changeFontSize(-1); break
        case 'p': case 'P': toggleAutoPause(); break
        case 't': case 'T': cycleTheme(); break
        case 'd': case 'D': toggleDark(); break
        case 'm': case 'M': togglePanel(); break
    }
}

const onDocClick = e => {
    if (!$('#themes').hidden) { toggleThemeMenu(false); return }
    if (!view || settings.flow !== 'paginated') return
    if (e.button !== 0 || e.target.closest?.('a')) return
    const sel = e.view?.getSelection?.()
    if (sel && !sel.isCollapsed) return
    // posición del clic dentro de la ventana (funciona aunque el libro esté en un iframe)
    const x = (e.screenX - window.screenX) / window.innerWidth
    if (x < 0.3) view.goLeft()
    else view.goRight()
    restartAutoTimer()
}

const changeFontSize = delta => {
    const fontSize = Math.min(40, Math.max(8, settings.fontSize + delta))
    if (fontSize !== settings.fontSize) saveSettings({ fontSize })
    status.show(`Letra: ${fontSize} px`, { timeout: 900 })
}

// ---------- avance automático ----------

const setupAutoAdvance = () => {
    const active = !!settings.autoAdvance && !!view
    $('#btn-auto').hidden = !settings.autoAdvance
    $('#btn-auto').classList.toggle('on', active && !autoPaused)
    $('#btn-auto').title = autoPaused ? 'Reanudar avance automático (P)' : 'Pausar avance automático (P)'
    clearInterval(autoTimer)
    autoTimer = null
    if (active && !autoPaused)
        autoTimer = setInterval(() => {
            if (!$('#panel').hidden || document.hidden) return
            next()
        }, Math.max(3, settings.autoSeconds) * 1000)
}
const restartAutoTimer = () => { if (autoTimer) setupAutoAdvance() }
const toggleAutoPause = () => {
    if (!settings.autoAdvance) return
    autoPaused = !autoPaused
    setupAutoAdvance()
    status.show(autoPaused ? 'Avance automático en pausa' : 'Avance automático activado', { timeout: 1200 })
}

// ---------- progreso ----------

const saveProgress = debounce((id, detail) => {
    api.setProgress(id, { cfi: detail.cfi, fraction: detail.fraction })
}, 600)

const onRelocate = e => {
    const { fraction, cfi } = e.detail
    if (fraction != null) {
        $('#progress div').style.width = `${(fraction * 100).toFixed(2)}%`
        $('#percent').textContent = `${Math.round(fraction * 100)} %`
    }
    if (currentBook && cfi) saveProgress(currentBook.id, e.detail)
}

// ---------- abrir, convertir y quitar libros ----------

const fileFromBytes = (bytes, name) => new File([bytes], name)

const updateBookInfo = () => {
    const b = currentBook
    $('#book-info').textContent = b
        ? `${b.title}${b.author ? ` — ${b.author}` : ''} (${b.format.toUpperCase()})`
        : 'No hay ningún libro abierto.'
    for (const el of document.querySelectorAll('.needs-book')) el.disabled = !b || !view
}

const closeView = () => {
    if (!view) return
    try { view.close() } catch { /* nada */ }
    view.remove()
    view = null
}

// Convierte un PDF o TXT guardado en un EPUB de texto fluido.
const convertStoredBook = async book => {
    const bytes = await api.readBook(book.source)
    let model
    if (book.format === 'pdf') {
        status.show('Convirtiendo PDF…', { progress: 0 })
        const { extractPDF } = await import('./convert/pdf-extract.js')
        model = await extractPDF(bytes, {
            name: book.name,
            onProgress: (i, n) => status.show(`Convirtiendo PDF… página ${i} de ${n}`, { progress: i / n }),
        })
    } else {
        model = textToBook(bytes, book.name)
    }
    status.show('Guardando…', { progress: 1 })
    return api.saveConverted(book.id, writeEPUB(model))
}

const openCurrentBook = async () => {
    const token = ++openToken
    closeView()
    currentBook = state.book
    document.body.classList.toggle('has-book', !!currentBook)
    $('#title').textContent = currentBook?.title ?? 'Lector Esquina'
    $('#percent').textContent = ''
    $('#progress div').style.width = '0'
    updateBookInfo()
    if (!currentBook) { setupAutoAdvance(); return }

    try {
        if (!currentBook.file) {
            currentBook = state.book = await convertStoredBook(currentBook)
            if (token !== openToken) return
        }
        status.show('Abriendo…')
        const bytes = await api.readBook(currentBook.file)
        if (token !== openToken) return

        const v = document.createElement('foliate-view')
        $('#reader').append(v)
        view = v
        await v.open(fileFromBytes(bytes, currentBook.file))
        if (token !== openToken) { v.remove(); return }

        v.addEventListener('relocate', onRelocate)
        v.addEventListener('load', ({ detail: { doc } }) => {
            doc.addEventListener('keydown', onKey)
            doc.addEventListener('wheel', onWheel, { passive: true })
            doc.addEventListener('click', onDocClick)
            watchPointer(doc)
        })
        // los recursos que fallen no deben bloquear la lectura
        v.book.transformTarget?.addEventListener('data', ({ detail }) => {
            detail.data = Promise.resolve(detail.data).catch(() => '')
        })
        applyLayout()

        // título y autor del propio libro
        const meta = v.book.metadata ?? {}
        const lm = x => !x ? '' : typeof x === 'string' ? x : Object.values(x)[0] ?? ''
        const title = lm(meta.title)
        const author = [meta.author].flat().map(a => typeof a === 'string' ? a : lm(a?.name)).filter(Boolean).join(', ')
        if ((title && title !== currentBook.title) || (author && author !== currentBook.author)) {
            currentBook = state.book = await api.updateBook(currentBook.id, {
                title: title || currentBook.title, author: author || currentBook.author,
            })
        }
        $('#title').textContent = currentBook.title
        document.title = `${currentBook.title} — Lector Esquina`

        const saved = state.progress?.[currentBook.id]
        await v.init({ lastLocation: saved?.cfi, showTextStart: !saved })
        if (saved && !v.lastLocation?.cfi && saved.fraction != null) await v.goToFraction(saved.fraction)
        status.hide()
    } catch (e) {
        console.error(e)
        closeView()
        status.show(`No se pudo abrir el libro: ${errorMessage(e)}`, { error: true, timeout: 8000 })
    }
    updateBookInfo()
    setupAutoAdvance()
}

const openPath = async filePath => {
    if (!filePath) return
    try {
        togglePanel(false)
        status.show('Importando…')
        await api.importBook(filePath)
        state = await api.getState()
        settings = state.settings
        await openCurrentBook()
    } catch (e) {
        status.show(errorMessage(e), { error: true, timeout: 6000 })
    }
}

const chooseAndOpen = async () => openPath(await api.chooseBook())

const removeBook = async () => {
    if (!currentBook) return
    if (!confirm(`¿Quitar «${currentBook.title}» del lector?\n\nSe guardará por dónde ibas por si lo vuelves a abrir.`)) return
    await api.removeBook()
    state = await api.getState()
    togglePanel(false)
    await openCurrentBook()
}

const exportBook = async ext => {
    if (!currentBook || !view) return
    const baseName = (currentBook.title || 'libro').replace(/[\\/:*?"<>|]+/g, '').trim().slice(0, 100) || 'libro'
    try {
        let bytes
        if (currentBook.format === ext) {
            // mismo formato que el original: se guarda una copia sin cambios
            bytes = await api.readBook(currentBook.source)
        } else {
            status.show(`Convirtiendo a ${ext.toUpperCase()}…`, { progress: 0 })
            const model = await extractFoliateBook(view.book, {
                onProgress: (i, n) => status.show(`Convirtiendo a ${ext.toUpperCase()}…`, { progress: i / n }),
            })
            bytes = ext === 'epub' ? writeEPUB(model) : writeMOBI(model)
        }
        status.hide()
        const saved = await api.exportBook({ bytes, defaultName: `${baseName}.${ext}`, ext })
        if (saved) status.show(`Guardado: ${saved}`, { timeout: 4000 })
    } catch (e) {
        console.error(e)
        status.show(`No se pudo convertir: ${errorMessage(e)}`, { error: true, timeout: 8000 })
    }
}

// ---------- arrastrar y soltar ----------

const setupDragDrop = () => {
    let depth = 0
    const hasFiles = e => [...(e.dataTransfer?.types ?? [])].includes('Files')
    document.addEventListener('dragenter', e => {
        if (!hasFiles(e)) return
        depth++
        $('#drop').hidden = false
    })
    document.addEventListener('dragleave', () => {
        if (--depth <= 0) { depth = 0; $('#drop').hidden = true }
    })
    document.addEventListener('dragover', e => e.preventDefault())
    document.addEventListener('drop', e => {
        e.preventDefault()
        depth = 0
        $('#drop').hidden = true
        const file = e.dataTransfer.files[0]
        if (file) openPath(api.pathForFile(file))
    })
}

// ---------- inicio ----------

const init = async () => {
    state = await api.getState()
    settings = state.settings

    $('#btn-menu').addEventListener('click', () => togglePanel())
    $('#btn-open').addEventListener('click', chooseAndOpen)
    $('#btn-open-welcome').addEventListener('click', chooseAndOpen)
    $('#btn-smaller').addEventListener('click', () => changeFontSize(-1))
    $('#btn-bigger').addEventListener('click', () => changeFontSize(1))
    $('#btn-auto').addEventListener('click', toggleAutoPause)
    $('#btn-theme').addEventListener('click', e => { e.stopPropagation(); toggleThemeMenu() })
    $('#btn-theme').addEventListener('contextmenu', e => { e.preventDefault(); toggleDark() })
    for (const b of document.querySelectorAll('#themes button'))
        b.addEventListener('click', () => { setTheme(b.dataset.theme); toggleThemeMenu(false) })
    document.addEventListener('click', e => {
        if (!e.target.closest('#themes, #btn-theme')) toggleThemeMenu(false)
    })
    systemDark.addEventListener('change', () => { if (settings.theme === 'auto') applySettings() })
    $('#btn-pin').addEventListener('click', () => saveSettings({ alwaysOnTop: !settings.alwaysOnTop }))
    $('#btn-hide').addEventListener('click', () => api.hide())
    $('#btn-close').addEventListener('click', () => api.close())
    $('#bar').addEventListener('dblclick', e => e.preventDefault())

    document.addEventListener('keydown', onKey)
    document.addEventListener('wheel', e => { if (!e.target.closest('#panel')) onWheel(e) }, { passive: true })
    watchPointer(document)
    setupPanel()
    setupDragDrop()
    window.addEventListener('resize', debounce(applyLayout, 150))

    api.onSettingsChanged(s => { settings = s; applySettings() })
    api.onOpenPath(openPath)

    applySettings()
    await openCurrentBook()
}

init()
