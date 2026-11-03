// Prueba de extremo a extremo: arranca la app en una pantalla virtual, abre
// libros y hace capturas. Uso: xvfb-run node test/e2e.cjs <carpeta-libros> <carpeta-salida>
const { _electron: electron } = require('playwright')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

const [booksDir, outDir] = process.argv.slice(2)
const sleep = ms => new Promise(r => setTimeout(r, ms))

;(async () => {
    fs.mkdirSync(outDir, { recursive: true })
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lector-'))
    const launch = () => electron.launch({
        // E2E_EXE permite probar la app ya empaquetada
        executablePath: process.env.E2E_EXE || require('electron'),
        args: process.env.E2E_EXE ? ['--no-sandbox'] : [path.join(__dirname, '..'), '--no-sandbox'],
        env: { ...process.env, LECTOR_DATA_DIR: dataDir },
    })
    let app = await launch()
    let page = await app.firstWindow()
    const logs = []
    const hook = p => {
        p.on('console', m => logs.push(`[${m.type()}] ${m.text()}`))
        p.on('pageerror', e => logs.push(`[pageerror] ${e.message}`))
    }
    hook(page)
    await page.waitForSelector('#welcome')
    await sleep(800)
    const shot = async name => { await page.screenshot({ path: path.join(outDir, name + '.png') }); console.log('captura', name) }
    await shot('01-bienvenida')

    const open = async file => {
        await app.evaluate(({ BrowserWindow }, p) => BrowserWindow.getAllWindows()[0].webContents.send('open-path', p), path.join(booksDir, file))
        await page.waitForFunction(() => document.body.classList.contains('has-book') && document.querySelector('#status').hidden, null, { timeout: 30000 })
        await sleep(1200)
    }
    const info = () => page.evaluate(() => ({ title: document.querySelector('#title').textContent, pct: document.querySelector('#percent').textContent, status: document.querySelector('#status-text').textContent }))

    await open('prueba.mobi')
    await shot('02-mobi'); console.log(await info())
    await page.keyboard.press('ArrowRight'); await sleep(400)
    await page.keyboard.press('ArrowRight'); await sleep(600)
    await shot('03-mobi-avanzado'); console.log(await info())

    // panel de ajustes
    await page.evaluate(() => document.body.classList.add('bar-visible'))
    await page.click('#btn-menu'); await sleep(300)
    await shot('04-ajustes')
    await page.selectOption('#theme', 'dark')
    await page.selectOption('#flow', 'scrolled')
    await page.click('#btn-panel-close'); await sleep(800)
    await shot('05-oscuro-scroll')

    await open('quijote.pdf')
    await shot('06-pdf-convertido'); console.log(await info())
    {
        const { unzipSync, strFromU8 } = require('fflate')
        const lib = path.join(dataDir, 'libros')
        const epub = fs.readdirSync(lib).find(f => f.endsWith('.epub'))
        const files = unzipSync(fs.readFileSync(path.join(lib, epub)))
        const caps = Object.keys(files).filter(n => /cap\d+/.test(n))
        console.log('PDF → EPUB:', caps.length, 'capítulos')
        console.log(strFromU8(files[caps[0]]).split('<body>')[1].slice(0, 700))
    }

    await open('prueba.epub')
    await shot('07-epub'); console.log(await info())
    for (let i = 0; i < 5; i++) { await page.mouse.wheel(0, 300); await sleep(150) }
    await sleep(1200)
    const before = await info()
    console.log('antes de cerrar', before)

    // ventana diminuta
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ width: 150, height: 60 }))
    await sleep(800)
    await shot('08-diminuta')
    await page.evaluate(() => document.body.classList.add('bar-visible'))
    await sleep(300)
    await shot('09-diminuta-barra')
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ width: 320, height: 200 }))
    await sleep(500)

    // exportar a MOBI y EPUB sin diálogo
    for (const ext of ['mobi', 'epub']) {
        const target = path.join(outDir, `exportado.${ext}`)
        await app.evaluate(({ dialog }, t) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: t }) }, target)
        await page.evaluate(e => document.querySelector(`#btn-export-${e}`).click(), ext)
        await sleep(1500)
        console.log('exportado', ext, fs.existsSync(target) ? fs.statSync(target).size : 'NO')
    }

    // reiniciar: debe recordar libro, posición y tamaño
    await app.close()
    app = await launch()
    page = await app.firstWindow()
    hook(page)
    await page.waitForFunction(() => document.body.classList.contains('has-book') && document.querySelector('#status').hidden, null, { timeout: 30000 })
    await sleep(1500)
    console.log('tras reiniciar', await info(), await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds()))
    await shot('10-tras-reiniciar')
    console.log(fs.readFileSync(path.join(dataDir, 'estado.json'), 'utf8'))
    await app.close()
    console.log('--- consola ---\n' + logs.filter(l => !l.includes('Electron Security Warning')).join('\n'))
})().catch(e => { console.error(e); process.exit(1) })
