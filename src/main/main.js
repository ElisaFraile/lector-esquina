// Proceso principal de Electron: ventana, bandeja del sistema, atajo global,
// biblioteca de libros y guardado del estado.
const { app, BrowserWindow, ipcMain, dialog, globalShortcut, protocol, net,
    screen, Tray, Menu, nativeImage, shell } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const crypto = require('node:crypto')
const { pathToFileURL } = require('node:url')
const { createStore } = require('./store')

const RENDERER_DIR = path.join(__dirname, '..', 'renderer')
const ICON = path.join(__dirname, '..', '..', 'build', 'icon.png')
const SUPPORTED = ['mobi', 'azw', 'azw3', 'prc', 'epub', 'pdf', 'fb2', 'txt']

// carpeta de datos alternativa (útil para pruebas)
if (process.env.LECTOR_DATA_DIR) app.setPath('userData', process.env.LECTOR_DATA_DIR)

if (!app.requestSingleInstanceLock()) {
    app.quit()
    process.exit(0)
}
if (process.platform === 'win32') app.setAppUserModelId('com.elisa.lectoresquina')

protocol.registerSchemesAsPrivileged([{
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
}])

let store
let win = null
let tray = null
let registeredShortcut = null
const libraryDir = () => path.join(app.getPath('userData'), 'libros')

// ---------- ventana ----------

const isVisibleOnSomeDisplay = b => screen.getAllDisplays().some(({ workArea: a }) =>
    b.x + 40 < a.x + a.width && b.x + b.width - 40 > a.x && b.y >= a.y - 10 && b.y + 20 < a.y + a.height)

const defaultBounds = () => {
    const { workArea } = screen.getPrimaryDisplay()
    const width = 340, height = 220
    return { width, height, x: workArea.x + workArea.width - width - 16, y: workArea.y + workArea.height - height - 16 }
}

const createWindow = () => {
    const s = store.data
    let bounds = s.bounds
    if (!bounds || !isVisibleOnSomeDisplay(bounds)) bounds = defaultBounds()

    win = new BrowserWindow({
        ...bounds,
        minWidth: 90,
        minHeight: 40,
        frame: false,
        show: false,
        alwaysOnTop: s.settings.alwaysOnTop,
        skipTaskbar: !s.settings.showInTaskbar,
        backgroundColor: '#fbf6ea',
        title: 'Lector Esquina',
        icon: ICON,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            spellcheck: false,
        },
    })
    applyWindowSettings()
    win.loadURL('app://lector/index.html')
    win.once('ready-to-show', () => win.show())

    const saveBounds = () => {
        if (!win.isMinimized() && !win.isMaximized()) store.set({ bounds: win.getBounds() })
    }
    win.on('moved', saveBounds)
    win.on('resized', saveBounds)
    win.on('move', saveBounds)
    win.on('resize', saveBounds)
    win.on('close', () => saveBounds())
    win.on('closed', () => { win = null })

    // los enlaces externos de los libros se abren en el navegador
    win.webContents.setWindowOpenHandler(({ url }) => {
        if (/^https?:/.test(url)) shell.openExternal(url)
        return { action: 'deny' }
    })
    win.webContents.on('will-navigate', e => e.preventDefault())
}

const applyWindowSettings = () => {
    if (!win) return
    const st = store.data.settings
    // 'screen-saver' mantiene la ventana encima incluso de otras ventanas "siempre encima"
    win.setAlwaysOnTop(!!st.alwaysOnTop, 'screen-saver')
    win.setOpacity(Math.min(1, Math.max(0.15, st.opacity)))
    win.setSkipTaskbar(!st.showInTaskbar)
    registerShortcut()
    updateTrayMenu()
}

const toggleDiscreet = () => {
    if (!win) return createWindow()
    if (win.isVisible() && !win.isMinimized()) win.hide()
    else {
        win.showInactive()
        if (win.isMinimized()) win.restore()
        win.setAlwaysOnTop(!!store.data.settings.alwaysOnTop, 'screen-saver')
    }
    updateTrayMenu()
}

const registerShortcut = () => {
    const accel = store.data.settings.shortcut
    if (registeredShortcut === accel) return true
    if (registeredShortcut) globalShortcut.unregister(registeredShortcut)
    registeredShortcut = null
    if (!accel) return true
    try {
        if (globalShortcut.register(accel, toggleDiscreet)) {
            registeredShortcut = accel
            return true
        }
    } catch { /* atajo no válido */ }
    return false
}
// ---------- posición del puntero ----------
// En Windows la barra superior es una zona de arrastre y la página no recibe
// eventos del ratón sobre ella, así que el proceso principal comprueba dónde
// está el puntero y avisa a la interfaz: 'out' (fuera), 'top' (sobre la barra)
// o 'in' (sobre el texto).
const watchPointer = () => {
    let last = null
    setInterval(() => {
        if (!win || win.isDestroyed() || !win.isVisible()) return
        const p = screen.getCursorScreenPoint()
        const b = win.getBounds()
        const inside = p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height
        const zone = !inside ? 'out' : p.y - b.y < 36 ? 'top' : 'in'
        if (zone !== last) {
            last = zone
            win.webContents.send('pointer', zone)
        }
    }, 100)
}

// ---------- bandeja del sistema ----------

const createTray = () => {
    const image = nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 })
    tray = new Tray(image)
    tray.setToolTip('Lector Esquina')
    tray.on('click', toggleDiscreet)
    updateTrayMenu()
}

const updateTrayMenu = () => {
    if (!tray) return
    const st = store.data.settings
    tray.setContextMenu(Menu.buildFromTemplate([
        { label: win?.isVisible() ? 'Ocultar (modo discreto)' : 'Mostrar', click: toggleDiscreet },
        {
            label: 'Siempre encima', type: 'checkbox', checked: !!st.alwaysOnTop,
            click: item => setSettings({ alwaysOnTop: item.checked }),
        },
        { label: 'Volver a la esquina', click: resetPosition },
        { type: 'separator' },
        { label: 'Salir', click: () => { app.quit() } },
    ]))
}

const resetPosition = () => {
    if (!win) return
    win.setBounds(defaultBounds())
    win.show()
}

const setSettings = partial => {
    store.set({ settings: { ...store.data.settings, ...partial } })
    applyWindowSettings()
    win?.webContents.send('settings-changed', store.data.settings)
    return store.data.settings
}

// ---------- biblioteca ----------

const extOf = file => path.extname(file).slice(1).toLowerCase()

const importBook = async filePath => {
    const ext = extOf(filePath)
    if (!SUPPORTED.includes(ext)) throw new Error(`Formato no compatible: .${ext || '?'}`)
    const data = await fs.promises.readFile(filePath)
    const id = crypto.createHash('sha1').update(data).digest('hex').slice(0, 16)
    fs.mkdirSync(libraryDir(), { recursive: true })
    const stored = `${id}.${ext}`
    await fs.promises.writeFile(path.join(libraryDir(), stored), data)
    const book = {
        id,
        name: path.basename(filePath),
        title: path.basename(filePath, path.extname(filePath)),
        source: stored, // copia del archivo original
        file: ext === 'pdf' ? null : stored, // archivo que se muestra (los PDF se convierten a EPUB)
        format: ext,
        added: Date.now(),
    }
    removeCurrentFiles(id)
    store.set({ book })
    return book
}

const removeCurrentFiles = (exceptId) => {
    const book = store.data.book
    if (!book || book.id === exceptId) return
    for (const f of new Set([book.source, book.file]))
        if (f) fs.rm(path.join(libraryDir(), f), { force: true }, () => {})
}

const safeLibraryPath = name => {
    const p = path.join(libraryDir(), path.basename(name))
    if (!p.startsWith(libraryDir())) throw new Error('Ruta no válida')
    return p
}

const openFromArgs = argv => {
    const file = argv.slice(app.isPackaged ? 1 : 2).find(a => SUPPORTED.includes(extOf(a)) && fs.existsSync(a))
    if (file && win) win.webContents.send('open-path', file)
    return file
}

// ---------- IPC ----------

const registerIPC = () => {
    ipcMain.handle('state:get', () => store.data)
    ipcMain.handle('settings:set', (_, partial) => setSettings(partial))
    ipcMain.handle('shortcut:test', (_, accel) => {
        const prev = store.data.settings.shortcut
        setSettings({ shortcut: accel })
        if (registeredShortcut !== accel) {
            setSettings({ shortcut: prev })
            return false
        }
        return true
    })
    ipcMain.handle('progress:set', (_, id, progress) => {
        store.set({ progress: { ...store.data.progress, [id]: { ...progress, at: Date.now() } } })
    })

    ipcMain.handle('book:choose', async () => {
        const { canceled, filePaths } = await dialog.showOpenDialog(win, {
            title: 'Abrir libro',
            properties: ['openFile'],
            filters: [
                { name: 'Libros', extensions: SUPPORTED },
                { name: 'Todos los archivos', extensions: ['*'] },
            ],
        })
        return canceled ? null : filePaths[0]
    })
    ipcMain.handle('book:import', (_, filePath) => importBook(filePath))
    ipcMain.handle('book:read', async (_, name) => {
        const data = await fs.promises.readFile(safeLibraryPath(name))
        return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    })
    ipcMain.handle('book:save-converted', async (_, id, bytes) => {
        const book = store.data.book
        if (!book || book.id !== id) throw new Error('El libro ha cambiado')
        const file = `${id}.epub`
        await fs.promises.writeFile(safeLibraryPath(file), Buffer.from(bytes))
        store.set({ book: { ...book, file } })
        return store.data.book
    })
    ipcMain.handle('book:update', (_, id, partial) => {
        const book = store.data.book
        if (book?.id === id) store.set({ book: { ...book, ...partial } })
        return store.data.book
    })
    ipcMain.handle('book:remove', () => {
        removeCurrentFiles(null)
        store.set({ book: null })
    })
    ipcMain.handle('book:export', async (_, { bytes, defaultName, ext }) => {
        const { canceled, filePath } = await dialog.showSaveDialog(win, {
            title: `Guardar como ${ext.toUpperCase()}`,
            defaultPath: path.join(app.getPath('documents'), defaultName),
            filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
        })
        if (canceled || !filePath) return null
        await fs.promises.writeFile(filePath, Buffer.from(bytes))
        return filePath
    })
    ipcMain.handle('book:show-file', (_, p) => shell.showItemInFolder(p))

    ipcMain.on('win:hide', () => { win?.hide(); updateTrayMenu() })
    ipcMain.on('win:minimize', () => win?.minimize())
    ipcMain.on('win:close', () => { app.quit() })
    ipcMain.on('win:reset-position', resetPosition)
}

// ---------- arranque ----------

app.whenReady().then(() => {
    store = createStore(path.join(app.getPath('userData'), 'estado.json'))

    protocol.handle('app', req => {
        const { pathname } = new URL(req.url)
        const file = path.normalize(path.join(RENDERER_DIR, decodeURIComponent(pathname)))
        if (!file.startsWith(RENDERER_DIR)) return new Response('Prohibido', { status: 403 })
        return net.fetch(pathToFileURL(file).toString())
    })

    registerIPC()
    createWindow()
    createTray()
    watchPointer()
    win.webContents.once('did-finish-load', () => openFromArgs(process.argv))
})

app.on('second-instance', (_, argv) => {
    if (!win) return
    if (!openFromArgs(argv)) {
        win.show()
        if (win.isMinimized()) win.restore()
    }
})

app.on('before-quit', () => { store?.flush() })
app.on('will-quit', () => globalShortcut.unregisterAll())
app.on('window-all-closed', () => app.quit())
