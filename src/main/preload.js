// Puente seguro entre la interfaz y el proceso principal.
const { contextBridge, ipcRenderer, webUtils } = require('electron')

contextBridge.exposeInMainWorld('lector', {
    getState: () => ipcRenderer.invoke('state:get'),
    setSettings: partial => ipcRenderer.invoke('settings:set', partial),
    testShortcut: accel => ipcRenderer.invoke('shortcut:test', accel),
    setProgress: (id, progress) => ipcRenderer.invoke('progress:set', id, progress),

    chooseBook: () => ipcRenderer.invoke('book:choose'),
    importBook: filePath => ipcRenderer.invoke('book:import', filePath),
    readBook: name => ipcRenderer.invoke('book:read', name),
    saveConverted: (id, bytes) => ipcRenderer.invoke('book:save-converted', id, bytes),
    updateBook: (id, partial) => ipcRenderer.invoke('book:update', id, partial),
    removeBook: () => ipcRenderer.invoke('book:remove'),
    exportBook: options => ipcRenderer.invoke('book:export', options),
    showFile: p => ipcRenderer.invoke('book:show-file', p),
    pathForFile: file => webUtils.getPathForFile(file),

    hide: () => ipcRenderer.send('win:hide'),
    minimize: () => ipcRenderer.send('win:minimize'),
    close: () => ipcRenderer.send('win:close'),
    resetPosition: () => ipcRenderer.send('win:reset-position'),

    onSettingsChanged: cb => ipcRenderer.on('settings-changed', (_, s) => cb(s)),
    onPointer: cb => ipcRenderer.on('pointer', (_, zone) => cb(zone)),
    onOpenPath: cb => ipcRenderer.on('open-path', (_, p) => cb(p)),
})
