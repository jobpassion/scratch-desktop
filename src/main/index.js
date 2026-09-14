import {spawn} from 'child_process';
import {BrowserWindow, Menu, app, dialog, ipcMain, shell, systemPreferences} from 'electron';
import ElectronStore from 'electron-store';
import fs from 'fs-extra';
import path from 'path';
import {URL} from 'url';
import {promisify} from 'util';

import argv from './argv';
import {getFilterForExtension} from './FileFilters';
import telemetry from './ScratchDesktopTelemetry';
import MacOSMenu from './MacOSMenu';
import startBoardSimulationDocker from './BoardSimulationDocker';
import log from '../common/log.js';
import packageJson from '../../package.json';

// suppress deprecation warning; this will be the default in Electron 9
app.allowRendererProcessReuse = true;
app.setName(packageJson.productName);

telemetry.appWasOpened();

// const defaultSize = {width: 1096, height: 715}; // minimum
const defaultSize = {width: 1280, height: 800}; // good for MAS screenshots

const isDevelopment = process.env.NODE_ENV !== 'production';
const devToolKey = ((process.platform === 'darwin') ?
    { // macOS: command+option+i
        alt: true, // option
        control: false,
        meta: true, // command
        shift: false,
        code: 'KeyI'
    } : { // Windows / linux: control+shift+i
        alt: false,
        control: true,
        meta: false, // Windows key
        shift: true,
        code: 'KeyI'
    }
);

// global window references prevent them from being garbage-collected
const _windows = {};
const traceBoardBluetooth = message => {
    const main = _windows.main;
    if (main && !main.isDestroyed()) {
        main.webContents.send('board-bluetooth-debug', message);
    }
};
const PORT = process.env.PORT || 8601;
const developmentIconPath = path.join(process.cwd(), 'src/icon/ScratchDesktop.png');
const projectStore = new ElectronStore({
    name: 'project-preferences'
});
const lastProjectPathKey = 'lastProjectPath';
let currentSpeechProcess = null;
let boardSimulationWindow = null;
let boardSimulationDockerPromise = null;
let osxMenu = null;
let boardSimulationMenu = null;

const captureBoardSimulation = async () => {
    if (!boardSimulationWindow || boardSimulationWindow.isDestroyed()) return null;
    if (boardSimulationWindow.webContents.isLoadingMainFrame()) return null;
    const content = await boardSimulationWindow.webContents.executeJavaScript(`
        new Promise((resolve, reject) => {
            const buttons = document.querySelectorAll('.file-explorer-header-actions button');
            const saveButton = buttons[buttons.length - 1];
            if (!saveButton) return reject(new Error('找不到 Velxio 保存按钮。'));
            const original = URL.createObjectURL;
            const originalClick = HTMLAnchorElement.prototype.click;
            const restore = () => {
                URL.createObjectURL = original;
                HTMLAnchorElement.prototype.click = originalClick;
            };
            const timer = setTimeout(() => {
                restore();
                reject(new Error('读取仿真电路超时。'));
            }, 5000);
            HTMLAnchorElement.prototype.click = function () {
                if (this.download.endsWith('.vlx')) return;
                return originalClick.call(this);
            };
            URL.createObjectURL = function (blob) {
                if (blob.type === 'application/json') {
                    blob.text().then(text => {
                        clearTimeout(timer);
                        restore();
                        resolve(text);
                    }, error => {
                        restore();
                        reject(error);
                    });
                }
                return original.call(this, blob);
            };
            try {
                saveButton.click();
            } catch (error) {
                clearTimeout(timer);
                restore();
                reject(error);
            }
        })
    `);
    return content;
};

const loadBoardSimulation = async (webContents, snapshot) => {
    const payload = Buffer.from(JSON.stringify(snapshot)).toString('base64');
    await webContents.executeJavaScript(`
        new Promise((resolve, reject) => {
            const dismissNotices = () => {
                document.querySelectorAll('.velxio-news-ok, .gh-star-banner__close')
                    .forEach(button => button.click());
            };
            let attempts = 0;
            const timer = setInterval(() => {
                dismissNotices();
                const input = document.querySelector('input[type="file"][accept*=".vlx"]');
                if (!input) {
                    if (++attempts < 50) return;
                    clearInterval(timer);
                    reject(new Error('Velxio 未准备好加载电路。'));
                    return;
                }
                const viewButtons = document.querySelectorAll('.view-mode-toggle button');
                if (viewButtons.length < 4) {
                    if (++attempts < 50) return;
                    clearInterval(timer);
                    reject(new Error('Velxio 未准备好切换电路视图。'));
                    return;
                }
                clearInterval(timer);
                viewButtons[viewButtons.length - 1].click();
                const bytes = Uint8Array.from(atob('${payload}'), char => char.charCodeAt(0));
                const file = new File([bytes], 'scratch-board.vlx', {type: 'application/json'});
                const transfer = new DataTransfer();
                transfer.items.add(file);
                input.files = transfer.files;
                input.dispatchEvent(new Event('change', {bubbles: true}));
                setTimeout(() => {
                    dismissNotices();
                    let runAttempts = 0;
                    const runTimer = setInterval(() => {
                        dismissNotices();
                        const boardList = document.querySelector('.file-explorer-list');
                        const runButton = document.querySelector('button.tb-btn-run');
                        if (boardList && boardList.textContent.includes('ESP32') &&
                            runButton && !runButton.disabled) {
                            clearInterval(runTimer);
                            runButton.click();
                            let startAttempts = 0;
                            const startTimer = setInterval(() => {
                                const stopButton = document.querySelector('button.tb-btn-stop');
                                if (stopButton && !stopButton.disabled) {
                                    clearInterval(startTimer);
                                    resolve();
                                } else if (++startAttempts >= 360) {
                                    clearInterval(startTimer);
                                    reject(new Error('ESP32 未进入运行状态，请检查仿真窗口中的输出和电路检查结果。'));
                                }
                            }, 250);
                        } else if (++runAttempts >= 100) {
                            clearInterval(runTimer);
                            reject(new Error('Velxio 未能载入 ESP32 程序。'));
                        }
                    }, 100);
                }, 200);
            }, 100);
        })
    `);
};

const getWindowIcon = () => {
    if (isDevelopment && fs.existsSync(developmentIconPath)) {
        return developmentIconPath;
    }
    return null;
};

const stopSpeakingText = () => {
    if (currentSpeechProcess) {
        currentSpeechProcess.kill('SIGTERM');
        currentSpeechProcess = null;
    }
};

const speakText = text => new Promise(resolve => {
    const normalizedText = String(text || '')
        .replace(/\s+/g, ' ')
        .trim();
    log.info(`[tts] speak request: "${normalizedText}"`);
    if (!normalizedText || process.platform !== 'darwin') {
        log.warn(`[tts] skipped, text empty or unsupported platform: ${process.platform}`);
        resolve({spoken: false});
        return;
    }

    stopSpeakingText();

    const args = ['-r', '185'];
    args.push(normalizedText);
    log.info('[tts] launching say with system-default voice rate=185');

    let childProcess;
    try {
        childProcess = spawn('say', args, {
            stdio: 'ignore'
        });
    } catch (error) {
        log.error(`Failed to start macOS speech: ${error.message}`);
        resolve({spoken: false, error: error.message});
        return;
    }

    currentSpeechProcess = childProcess;
    log.info(`[tts] say started pid=${childProcess.pid}`);

    childProcess.once('error', error => {
        if (currentSpeechProcess === childProcess) {
            currentSpeechProcess = null;
        }
        log.error(`macOS speech error: ${error.message}`);
        resolve({spoken: false, error: error.message});
    });

    childProcess.once('exit', code => {
        if (currentSpeechProcess === childProcess) {
            currentSpeechProcess = null;
        }
        log.info(`[tts] say exited with code=${code}`);
        resolve({spoken: code === 0, interrupted: code !== 0});
    });
});

const sanitizeProjectFileName = projectTitle => {
    const normalizedTitle = (projectTitle || '未命名作品').trim();
    const safeTitle = Array.from(normalizedTitle)
        .map(character => {
            const codePoint = character.codePointAt(0);
            if ('<>:"/\\|?*'.includes(character) || codePoint < 32) {
                return '_';
            }
            return character;
        })
        .join('')
        .replace(/\.+$/g, '')
        .trim();
    return safeTitle || '未命名作品';
};

const getLastProjectPath = () => projectStore.get(lastProjectPathKey);

const rememberProjectPath = projectPath => {
    if (projectPath) {
        projectStore.set(lastProjectPathKey, projectPath);
    }
};

const getDefaultProjectPath = projectTitle => {
    const savedProjectPath = getLastProjectPath();
    if (savedProjectPath) {
        return savedProjectPath;
    }
    const defaultDirectory = path.join(app.getPath('documents'), packageJson.productName);
    return path.join(defaultDirectory, `${sanitizeProjectFileName(projectTitle)}.sb3`);
};

// enable connecting to Scratch Link even if we DNS / Internet access is not available
// this must happen BEFORE the app ready event!
app.commandLine.appendSwitch('host-resolver-rules', 'MAP device-manager.scratch.mit.edu 127.0.0.1');

const displayPermissionDeniedWarning = (browserWindow, permissionType) => {
    let title;
    let message;
    switch (permissionType) {
    case 'camera':
        title = 'Camera Permission Denied';
        message = 'Permission to use the camera has been denied. ' +
            'Scratch will not be able to take a photo or use video sensing blocks.';
        break;
    case 'microphone':
        title = 'Microphone Permission Denied';
        message = 'Permission to use the microphone has been denied. ' +
            'Scratch will not be able to record sounds or detect loudness.';
        break;
    default: // shouldn't ever happen...
        title = 'Permission Denied';
        message = 'A permission has been denied.';
    }

    let instructions;
    switch (process.platform) {
    case 'darwin':
        instructions = 'To change Scratch permissions, please check "Security & Privacy" in System Preferences.';
        break;
    default:
        instructions = 'To change Scratch permissions, please check your system settings and restart Scratch.';
        break;
    }
    message = `${message}\n\n${instructions}`;

    dialog.showMessageBox(browserWindow, {type: 'warning', title, message});
};

/**
 * Build an absolute URL from a relative one, optionally adding search query parameters.
 * The base of the URL will depend on whether or not the application is running in development mode.
 * @param {string} url - the relative URL, like 'index.html'
 * @param {*} search - the optional "search" parameters (the part of the URL after '?'), like "route=about"
 * @returns {string} - an absolute URL as a string
 */
const makeFullUrl = (url, search = null) => {
    const baseUrl = (isDevelopment ?
        `http://localhost:${PORT}/` :
        `file://${path.join(__dirname, '../renderer')}/`
    );
    const fullUrl = new URL(url, baseUrl);
    if (search) {
        fullUrl.search = search; // automatically percent-encodes anything that needs it
    }
    return fullUrl.toString();
};

/**
 * Prompt in a platform-specific way for permission to access the microphone or camera, if Electron supports doing so.
 * Any application-level checks, such as whether or not a particular frame or document should be allowed to ask,
 * should be done before calling this function.
 * This function may return a Promise!
 *
 * @param {string} mediaType - one of Electron's media types, like 'microphone' or 'camera'
 * @returns {boolean|Promise.<boolean>} - true if permission granted, false otherwise.
 */
const askForMediaAccess = mediaType => {
    if (systemPreferences.askForMediaAccess) {
        // Electron currently only implements this on macOS
        // This returns a Promise
        return systemPreferences.askForMediaAccess(mediaType);
    }
    // For other platforms we can't reasonably do anything other than assume we have access.
    return true;
};

const handlePermissionRequest = async (webContents, permission, callback, details) => {
    if (permission === 'bluetooth' || permission === 'bluetoothScanning' || permission === 'unknown') {
        traceBoardBluetooth(`权限请求：${permission}，主窗口=${webContents === _windows.main.webContents}，` +
            `主页面=${details.isMainFrame}，URL=${details.requestingUrl}`);
    }
    if (webContents !== _windows.main.webContents) {
        // deny: request came from somewhere other than the main window's web contents
        return callback(false);
    }
    if (!details.isMainFrame) {
        // deny: request came from a subframe of the main window, not the main frame
        return callback(false);
    }
    if (permission !== 'media' && permission !== 'bluetooth' && permission !== 'bluetoothScanning') {
        // deny: request is for some other kind of access like notifications or pointerLock
        return callback(false);
    }
    const requiredBase = makeFullUrl('');
    if (details.requestingUrl.indexOf(requiredBase) !== 0) {
        // deny: request came from a URL outside of our "sandbox"
        return callback(false);
    }
    if (permission === 'bluetooth' || permission === 'bluetoothScanning') return callback(true);
    let askForMicrophone = false;
    let askForCamera = false;
    for (const mediaType of details.mediaTypes) {
        switch (mediaType) {
        case 'audio':
            askForMicrophone = true;
            break;
        case 'video':
            askForCamera = true;
            break;
        default:
            // deny: unhandled media type
            return callback(false);
        }
    }
    const parentWindow = _windows.main; // if we ever allow media in non-main windows we'll also need to change this
    if (askForMicrophone) {
        const microphoneResult = await askForMediaAccess('microphone');
        if (!microphoneResult) {
            displayPermissionDeniedWarning(parentWindow, 'microphone');
            return callback(false);
        }
    }
    if (askForCamera) {
        const cameraResult = await askForMediaAccess('camera');
        if (!cameraResult) {
            displayPermissionDeniedWarning(parentWindow, 'camera');
            return callback(false);
        }
    }
    return callback(true);
};

const createWindow = ({search = null, url = 'index.html', ...browserWindowOptions}) => {
    const window = new BrowserWindow({
        useContentSize: true,
        show: false,
        ...(getWindowIcon() ? {icon: getWindowIcon()} : {}),
        webPreferences: {
            contextIsolation: false,
            nodeIntegration: true
        },
        ...browserWindowOptions
    });
    const webContents = window.webContents;

    webContents.session.setPermissionRequestHandler(handlePermissionRequest);

    webContents.on('before-input-event', (event, input) => {
        if (input.code === devToolKey.code &&
            input.alt === devToolKey.alt &&
            input.control === devToolKey.control &&
            input.meta === devToolKey.meta &&
            input.shift === devToolKey.shift &&
            input.type === 'keyDown' &&
            !input.isAutoRepeat &&
            !input.isComposing) {
            event.preventDefault();
            webContents.openDevTools({mode: 'detach', activate: true});
        }
    });

    webContents.on('new-window', (event, newWindowUrl) => {
        shell.openExternal(newWindowUrl);
        event.preventDefault();
    });

    const fullUrl = makeFullUrl(url, search);
    window.loadURL(fullUrl);
    window.once('ready-to-show', () => {
        webContents.send('ready-to-show');
    });

    return window;
};

const createAboutWindow = () => {
    const window = createWindow({
        width: 400,
        height: 400,
        parent: _windows.main,
        search: 'route=about',
        title: `About ${packageJson.productName}`
    });
    return window;
};

const createPrivacyWindow = () => {
    const window = createWindow({
        width: _windows.main.width * 0.8,
        height: _windows.main.height * 0.8,
        parent: _windows.main,
        search: 'route=privacy',
        title: `${packageJson.productName} Privacy Policy`
    });
    return window;
};

const createUsbWindow = () => {
    const window = createWindow({
        width: 400,
        height: 300,
        parent: _windows.main,
        search: 'route=usb',
        modal: true,
        frame: false
    });

    // Filters from navigator.usb.requestDevice do not appear to be available here.
    // Hard code to micro:bit since that is the only device that currently uses this api.
    const getIsMicroBit = device => device.vendorId === 0x0d28 && device.productId === 0x0204;
    let deviceList = [];
    let selectedDeviceCallback;

    _windows.main.webContents.session.on('select-usb-device', (event, details, callback) => {
        deviceList = details.deviceList.filter(getIsMicroBit);
        selectedDeviceCallback = callback;

        window.webContents.send('usb-device-list', deviceList);
        window.show();

        event.preventDefault();
    });

    _windows.main.webContents.session.on('usb-device-added', (_event, device) => {
        if (!getIsMicroBit(device)) return;
        deviceList.push(device);
        window.webContents.send('usb-device-list', deviceList);
    });

    _windows.main.webContents.session.on('usb-device-removed', (_event, device) => {
        if (!getIsMicroBit(device)) return;
        deviceList = deviceList.filter(existing => existing.deviceId !== device.deviceId);
        window.webContents.send('usb-device-list', deviceList);
    });

    ipcMain.on('usb-device-selected', (_event, message) => {
        selectedDeviceCallback(message);
        window.hide();
    });

    return window;
};

const getIsProjectSave = downloadItem => {
    switch (downloadItem.getMimeType()) {
    case 'application/x.scratch.sb3':
        return true;
    }
    return false;
};

const createMainWindow = () => {
    const window = createWindow({
        width: defaultSize.width,
        height: defaultSize.height,
        title: `${packageJson.productName} ${packageJson.version}` // something like "Scratch 3.14"
    });
    const webContents = window.webContents;
    webContents.session.setPermissionCheckHandler((requestingWebContents, permission) => {
        const allowed = requestingWebContents === webContents &&
            (permission === 'bluetooth' || permission === 'bluetoothScanning' || permission === 'media');
        if (permission === 'bluetooth' || permission === 'bluetoothScanning' || permission === 'unknown') {
            traceBoardBluetooth(`权限检查：${permission}，主窗口=${requestingWebContents === webContents}，` +
                `结果=${allowed ? '允许' : '拒绝'}`);
        }
        return allowed;
    });
    let bluetoothChoice = null;
    webContents.on('select-bluetooth-device', (event, devices, callback) => {
        event.preventDefault();
        traceBoardBluetooth(`设备选择事件：发现 ${devices.length} 个设备`);
        if (!bluetoothChoice) {
            bluetoothChoice = {devices: new Map(), callback, timer: null, showing: false};
            bluetoothChoice.timer = setTimeout(() => {
                const choice = bluetoothChoice;
                if (!choice || choice.showing) return;
                choice.showing = true;
                const available = [...choice.devices.values()].filter(device => device.deviceName && (
                    device.deviceName.startsWith('YY-Board') || device.deviceName.startsWith('MPY ESP32')
                ));
                if (bluetoothChoice === choice) {
                    bluetoothChoice = null;
                    traceBoardBluetooth(available.length ? '设备选择：已找到 ESP32' : '设备选择：10 秒内未找到 ESP32');
                    choice.callback(available.length ? available[0].deviceId : '');
                }
            }, 10000);
        }
        devices.forEach(device => bluetoothChoice.devices.set(device.deviceId, device));
        const board = devices.find(device => device.deviceName && (
            device.deviceName.startsWith('YY-Board') || device.deviceName.startsWith('MPY ESP32')
        ));
        if (board && !bluetoothChoice.showing) {
            const choice = bluetoothChoice;
            clearTimeout(choice.timer);
            bluetoothChoice = null;
            traceBoardBluetooth(`设备选择：已找到 ${board.deviceName}`);
            choice.callback(board.deviceId);
        }
    });
    window.on('closed', () => {
        if (bluetoothChoice) {
            clearTimeout(bluetoothChoice.timer);
            bluetoothChoice.callback('');
            bluetoothChoice = null;
        }
    });

    webContents.session.on('will-download', (willDownloadEvent, downloadItem, sourceWebContents) => {
        if (boardSimulationWindow && !boardSimulationWindow.isDestroyed() &&
            sourceWebContents === boardSimulationWindow.webContents &&
            path.extname(downloadItem.getFilename()).toLowerCase() === '.vlx') {
            willDownloadEvent.preventDefault();
            captureBoardSimulation().then(content => {
                if (_windows.main && !_windows.main.isDestroyed()) {
                    _windows.main.webContents.send('board-simulation-snapshot', content, true);
                }
            })
                .catch(error => log.warn(`Cannot save board simulation: ${error.message}`));
            return;
        }
        const isProjectSave = getIsProjectSave(downloadItem);
        const itemPath = downloadItem.getFilename();
        const baseName = path.basename(itemPath);
        const extName = path.extname(baseName);
        const options = {
            defaultPath: baseName
        };
        if (extName) {
            const extNameNoDot = extName.replace(/^\./, '');
            options.filters = [getFilterForExtension(extNameNoDot)];
        }
        const userChosenPath = dialog.showSaveDialogSync(window, options);
        // this will be falsy if the user canceled the save
        if (userChosenPath) {
            const userBaseName = path.basename(userChosenPath);
            const tempPath = path.join(app.getPath('temp'), userBaseName);

            // WARNING: `setSavePath` on this item is only valid during the `will-download` event. Calling the async
            // version of `showSaveDialog` means the event will finish before we get here, so `setSavePath` will be
            // ignored. For that reason we need to call `showSaveDialogSync` above.
            downloadItem.setSavePath(tempPath);

            downloadItem.on('done', async (doneEvent, doneState) => {
                try {
                    if (doneState !== 'completed') {
                        // The download was canceled or interrupted. Cancel the telemetry event and delete the file.
                        throw new Error(`save ${doneState}`); // "save cancelled" or "save interrupted"
                    }
                    await fs.move(tempPath, userChosenPath, {overwrite: true});
                    if (isProjectSave) {
                        rememberProjectPath(userChosenPath);
                        const newProjectTitle = path.basename(userChosenPath, extName);
                        webContents.send('setTitleFromSave', {title: newProjectTitle});

                        // "setTitleFromSave" will set the project title but GUI has already reported the telemetry
                        // event using the old title. This call lets the telemetry client know that the save was
                        // actually completed and the event should be committed to the event queue with this new title.
                        telemetry.projectSaveCompleted(newProjectTitle);
                    }
                } catch (e) {
                    if (isProjectSave) {
                        telemetry.projectSaveCanceled();
                    }
                    // don't clean up until after the message box to allow troubleshooting / recovery
                    await dialog.showMessageBox(window, {
                        type: 'error',
                        title: 'Failed to save project',
                        message: `Save failed:\n${userChosenPath}`,
                        detail: e.message
                    });
                    fs.exists(tempPath).then(exists => {
                        if (exists) {
                            fs.unlink(tempPath);
                        }
                    });
                }
            });
        } else {
            downloadItem.cancel();
            if (isProjectSave) {
                telemetry.projectSaveCanceled();
            }
        }
    });

    webContents.on('will-prevent-unload', ev => {
        const choice = dialog.showMessageBoxSync(window, {
            title: packageJson.productName,
            type: 'question',
            message: `离开${packageJson.productName}？`,
            detail: 'Any unsaved changes will be lost.',
            buttons: ['Stay', 'Leave'],
            cancelId: 0, // closing the dialog means "stay"
            defaultId: 0 // pressing enter or space without explicitly selecting something means "stay"
        });
        const shouldQuit = (choice === 1);
        if (shouldQuit) {
            ev.preventDefault();
        }
    });

    window.once('ready-to-show', () => {
        window.show();
    });

    return window;
};

if (process.platform === 'darwin') {
    const onBoardProgramming = () => {
        if (_windows.main) _windows.main.webContents.send('enter-board-programming');
    };
    osxMenu = Menu.buildFromTemplate(MacOSMenu(app, onBoardProgramming));
    const simulationTemplate = MacOSMenu(app, onBoardProgramming);
    simulationTemplate[1].submenu = simulationTemplate[1].submenu.slice(3);
    boardSimulationMenu = Menu.buildFromTemplate(simulationTemplate);
    Menu.setApplicationMenu(osxMenu);
} else {
    // disable menu for other platforms
    Menu.setApplicationMenu(null);
}

// quit application when all windows are closed
app.on('window-all-closed', () => {
    app.quit();
});

app.on('will-quit', () => {
    stopSpeakingText();
    telemetry.appWillClose();
});

// work around https://github.com/MarshallOfSound/electron-devtools-installer/issues/122
// which seems to be a result of https://github.com/electron/electron/issues/19468
if (process.platform === 'win32') {
    const appUserDataPath = app.getPath('userData');
    const devToolsExtensionsPath = path.join(appUserDataPath, 'DevTools Extensions');
    try {
        fs.unlinkSync(devToolsExtensionsPath);
    } catch (_) {
        // don't complain if the file doesn't exist
    }
}

// create main BrowserWindow when electron is ready
app.on('ready', () => {
    if (process.platform === 'darwin' && fs.existsSync(developmentIconPath)) {
        app.dock.setIcon(developmentIconPath);
    }

    if (isDevelopment) {
        import('electron-devtools-installer').then(importedModule => {
            const {default: installExtension, ...devToolsExtensions} = importedModule;
            const extensionsToInstall = [
                devToolsExtensions.REACT_DEVELOPER_TOOLS,
                devToolsExtensions.REDUX_DEVTOOLS
            ];
            for (const extension of extensionsToInstall) {
                // WARNING: depending on a lot of things including the version of Electron `installExtension` might
                // return a promise that never resolves, especially if the extension is already installed.
                installExtension(extension).then(
                    extensionName => log(`Installed dev extension: ${extensionName}`),
                    errorMessage => log.error(`Error installing dev extension: ${errorMessage}`)
                );
            }
        });
    }

    _windows.main = createMainWindow();
    _windows.main.on('closed', () => {
        delete _windows.main;
    });
    _windows.about = createAboutWindow();
    _windows.about.on('close', event => {
        event.preventDefault();
        _windows.about.hide();
    });
    _windows.privacy = createPrivacyWindow();
    _windows.privacy.on('close', event => {
        event.preventDefault();
        _windows.privacy.hide();
    });

    _windows.usb = createUsbWindow();
});

ipcMain.on('open-about-window', () => {
    _windows.about.show();
});


ipcMain.on('open-privacy-policy-window', () => {
    _windows.privacy.show();
});

// start loading initial project data before the GUI needs it so the load seems faster
const initialProjectDataPromise = (async () => {
    let projectPath;
    const openedFromArgument = argv._.length > 0;
    if (argv._.length > 1) {
        log.warn(`Expected 1 command line argument but received ${argv._.length}.`);
    }
    if (openedFromArgument) {
        projectPath = argv._[argv._.length - 1];
    } else {
        projectPath = getLastProjectPath();
    }
    if (!projectPath) {
        // no command line argument or remembered project means no initial project data
        return;
    }
    try {
        const projectData = await promisify(fs.readFile)(projectPath, null);
        rememberProjectPath(projectPath);
        return projectData;
    } catch (e) {
        log.error(`Error loading project data: ${e}`);
        if (!openedFromArgument && e.code === 'ENOENT') {
            projectStore.delete(lastProjectPathKey);
            return;
        }
        app.whenReady().then(() => {
            dialog.showMessageBox(_windows.main, {
                type: 'error',
                title: 'Failed to load project',
                message: `Could not load project from file:\n${projectPath}`,
                detail: e.message
            });
        });
    }
    // load failed: initial project data undefined
})(); // IIFE

ipcMain.handle('get-initial-project-data', () => initialProjectDataPromise);
ipcMain.handle('open-board-simulation', async (_event, {snapshot, serverUrl}) => {
    if (!serverUrl) {
        if (!boardSimulationDockerPromise) {
            boardSimulationDockerPromise = startBoardSimulationDocker(status => {
                if (_windows.main && !_windows.main.isDestroyed()) {
                    _windows.main.webContents.send('board-simulation-status', status);
                }
            }).finally(() => {
                boardSimulationDockerPromise = null;
            });
        }
        serverUrl = await boardSimulationDockerPromise;
    }
    let editorUrl;
    try {
        const baseUrl = new URL(`${serverUrl.replace(/\/+$/, '')}/`);
        if (!['http:', 'https:'].includes(baseUrl.protocol) || baseUrl.username || baseUrl.password) {
            throw new Error('invalid server URL');
        }
        editorUrl = new URL('editor?from=scratch', baseUrl).toString();
    } catch (error) {
        throw new Error('仿真服务器地址无效，请输入 http 或 https 地址。');
    }
    if (boardSimulationWindow && !boardSimulationWindow.isDestroyed()) {
        boardSimulationWindow.focus();
        return;
    }
    const simulationWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        show: false,
        parent: _windows.main,
        title: 'ESP32 仿真板',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            preload: path.join(__dirname, 'BoardSimulationPreload.js')
        }
    });
    simulationWindow.webContents.setUserAgent(
        simulationWindow.webContents.getUserAgent().replace(packageJson.productName, 'ScratchDesktop')
    );
    simulationWindow.webContents.on('before-input-event', (event, input) => {
        if (input.code === devToolKey.code &&
            input.alt === devToolKey.alt &&
            input.control === devToolKey.control &&
            input.meta === devToolKey.meta &&
            input.shift === devToolKey.shift &&
            input.type === 'keyDown' &&
            !input.isAutoRepeat &&
            !input.isComposing) {
            event.preventDefault();
            simulationWindow.webContents.openDevTools({mode: 'detach', activate: true});
        }
    });
    boardSimulationWindow = simulationWindow;
    if (process.platform === 'darwin') {
        simulationWindow.on('focus', () => Menu.setApplicationMenu(boardSimulationMenu));
        simulationWindow.on('blur', () => Menu.setApplicationMenu(osxMenu));
    }
    let closing = false;
    simulationWindow.on('close', event => {
        if (closing) return;
        event.preventDefault();
        closing = true;
        captureBoardSimulation().then(content => {
            if (_windows.main && !_windows.main.isDestroyed()) {
                _windows.main.webContents.send('board-simulation-snapshot', content);
            }
        })
            .catch(error => log.warn(`Cannot save board simulation: ${error.message}`))
            .finally(() => {
                simulationWindow.destroy();
            });
    });
    simulationWindow.on('closed', () => {
        if (boardSimulationWindow === simulationWindow) boardSimulationWindow = null;
        if (process.platform === 'darwin') Menu.setApplicationMenu(osxMenu);
    });
    try {
        const response = await fetch(editorUrl, {
            signal: AbortSignal.timeout(3000)
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
    } catch (error) {
        simulationWindow.destroy();
        throw new Error('无法连接 Velxio 服务器，请检查地址和服务状态。');
    }
    try {
        await simulationWindow.loadURL(editorUrl);
        simulationWindow.show();
        _windows.main.webContents.send('board-simulation-status', '正在加载电路并启动 ESP32…');
        await loadBoardSimulation(simulationWindow.webContents, snapshot);
        simulationWindow.setTitle('ESP32 仿真板 · 运行中');
    } catch (error) {
        if (!simulationWindow.isVisible()) simulationWindow.destroy();
        throw new Error(`仿真启动失败：${error.message}`);
    }
});
ipcMain.handle('capture-board-simulation', () => captureBoardSimulation());
ipcMain.handle('close-board-simulation', () => {
    if (boardSimulationWindow && !boardSimulationWindow.isDestroyed()) boardSimulationWindow.destroy();
});
ipcMain.handle('quick-save-project', async (_event, {projectData, projectTitle}) => {
    const savePath = getDefaultProjectPath(projectTitle);
    await fs.ensureDir(path.dirname(savePath));
    await fs.writeFile(savePath, Buffer.from(projectData));
    rememberProjectPath(savePath);

    return {
        path: savePath,
        title: path.basename(savePath, path.extname(savePath))
    };
});
ipcMain.handle('speak-block-text', (_event, {text}) => {
    log.info('[tts] ipc speak-block-text received');
    return speakText(text);
});
