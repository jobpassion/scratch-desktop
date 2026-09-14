// Include the standard keyboard shortcuts in the edit menu
// so they can be used within the app. Only needed on Mac.
export default (app, enterBoardProgramming) => ([
    {
        label: 'App', // Always overridden by app name
        submenu: [{
            label: '板上编程',
            click: enterBoardProgramming
        }, {
            type: 'separator'
        }, {
            label: 'Quit',
            accelerator: 'CmdOrCtrl+Q',
            click: () => app.quit()
        }]
    },
    {
        label: 'File',
        submenu: [{
            label: '复制电路数据',
            click: (_menuItem, browserWindow) => {
                if (!browserWindow || browserWindow.isDestroyed()) return;
                browserWindow.webContents.executeJavaScript(
                    'window.__SCRATCH_COPY_VLX__ ? window.__SCRATCH_COPY_VLX__() : Promise.resolve(false)'
                ).catch(() => {});
            }
        }]
    },
    {
        label: 'Edit',
        submenu: [
            {
                label: 'Undo',
                accelerator: 'CmdOrCtrl+Z',
                role: 'undo'
            },
            {
                label: 'Redo',
                accelerator: 'Shift+CmdOrCtrl+Z',
                role: 'redo'
            },
            {
                type: 'separator'
            },
            {
                label: 'Cut',
                accelerator: 'CmdOrCtrl+X',
                role: 'cut'
            },
            {
                label: 'Copy',
                accelerator: 'CmdOrCtrl+C',
                role: 'copy'
            },
            {
                label: 'Paste',
                accelerator: 'CmdOrCtrl+V',
                role: 'paste'
            },
            {
                label: 'Select All',
                accelerator: 'CmdOrCtrl+A',
                role: 'selectall'
            }
        ]
    }
]);
