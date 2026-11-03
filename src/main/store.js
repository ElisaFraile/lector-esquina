// Guarda el estado de la app (ventana, ajustes, libro actual y progreso) en
// un archivo JSON dentro de la carpeta de datos del usuario.
const fs = require('node:fs')
const path = require('node:path')

const DEFAULTS = {
    bounds: null,
    book: null,
    progress: {},
    trayHintShown: false,
    settings: {
        alwaysOnTop: true,
        opacity: 1,
        showInTaskbar: true,
        shortcut: 'CommandOrControl+Alt+L',
        escHides: true,
        closeToTray: true,
        startWithWindows: true,
        autoHideBar: true,
        fontSize: 16,
        fontFamily: 'serif',
        lineHeight: 1.45,
        margin: 10,
        theme: 'sepia',
        flow: 'paginated',
        autoAdvance: false,
        autoSeconds: 20,
        showProgress: true,
    },
}

const createStore = file => {
    let data
    try {
        const saved = JSON.parse(fs.readFileSync(file, 'utf8'))
        data = { ...DEFAULTS, ...saved, settings: { ...DEFAULTS.settings, ...saved.settings } }
    } catch {
        data = structuredClone(DEFAULTS)
    }
    let timer = null
    const flush = () => {
        clearTimeout(timer)
        timer = null
        try {
            fs.mkdirSync(path.dirname(file), { recursive: true })
            const tmp = file + '.tmp'
            fs.writeFileSync(tmp, JSON.stringify(data, null, 2))
            fs.renameSync(tmp, file)
        } catch (e) {
            console.error('No se pudo guardar el estado', e)
        }
    }
    return {
        get data() { return data },
        set(partial) {
            data = { ...data, ...partial }
            clearTimeout(timer)
            timer = setTimeout(flush, 400)
        },
        flush,
    }
}

module.exports = { createStore, DEFAULTS }
