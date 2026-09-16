import {Buffer} from 'buffer';
import {ipcRenderer, remote} from 'electron';
import bindAll from 'lodash.bindall';
import omit from 'lodash.omit';
import PropTypes from 'prop-types';
import React from 'react';
import {connect} from 'react-redux';

import {
    GUIComponent,
    LoadingStates,
    onFetchedProjectData,
    onLoadedProject,
    defaultProjectId,
    requestNewProject,
    requestProjectUpload,
    setProjectId,
    openLoadingProject,
    closeLoadingProject,
    openTelemetryModal
} from '@scratch/scratch-gui';

import ElectronStorageHelper from '../common/ElectronStorageHelper';

import showPrivacyPolicy from './showPrivacyPolicy';
import yiyiMenuLogo from './assets/gemini-menu-logo.png';
import ESP32Extension from './board/ESP32Extension';
import compileESP32 from './board/compileESP32';
import ESP32Bluetooth from './board/ESP32Bluetooth';
import BoardSimulationProject from './board/BoardSimulationProject';
import filterBoardToolbox from './board/filterBoardToolbox';

/**
 * Higher-order component to add desktop logic to the GUI.
 * @param {Component} WrappedComponent - a GUI-like component to wrap.
 * @returns {Component} - a component similar to GUI with desktop-specific logic added.
 */
const ScratchDesktopGUIHOC = function (WrappedComponent) {
    const initialProjectLoadingState = 'LOADING_VM_FILE_UPLOAD';
    const blockSpeechTriggerMode = 'click';
    const longPressDelay = 700;
    const longPressMoveTolerance = 8;
    const speechDebugPrefix = '[block-speech]';
    const categorySpeechDebugPrefix = '[category-speech]';
    const getBlocklyMainWorkspace = () => {
        if (window.Blockly && window.Blockly.getMainWorkspace) {
            return window.Blockly.getMainWorkspace();
        }
        if (window.ScratchBlocks && window.ScratchBlocks.getMainWorkspace) {
            return window.ScratchBlocks.getMainWorkspace();
        }
        return null;
    };
    const getBlocklyWorkspaces = () => {
        const mainWorkspace = getBlocklyMainWorkspace();
        if (!mainWorkspace) {
            return [];
        }
        const workspaces = [mainWorkspace];
        const flyout = mainWorkspace.getFlyout && mainWorkspace.getFlyout();
        const flyoutWorkspace = flyout && flyout.getWorkspace && flyout.getWorkspace();
        if (flyoutWorkspace) {
            workspaces.push(flyoutWorkspace);
        }
        return workspaces;
    };

    class ScratchDesktopGUIComponent extends React.Component {
        constructor (props) {
            super(props);
            bindAll(this, [
                'applyCustomMenuLogo',
                'cancelPendingBlockSpeech',
                'createSpeechTextForBlock',
                'createSpeechTextForCategory',
                'findBlockForEventTarget',
                'findCategoryElementForEventTarget',
                'handleQuickSaveProject',
                'enterBoardProgramming',
                'handleBoardConnect',
                'handleBoardSimulationImport',
                'handleBoardSimulationOpen',
                'handleBoardSimulationServer',
                'handleBoardSimulationSnapshot',
                'handleBoardSimulationStatus',
                'handleBoardUpload',
                'handleBoardOutput',
                'handleCategoryImmediateSpeech',
                'handleGlobalPointerMove',
                'handleGlobalPointerUp',
                'handleWorkspaceImmediateSpeech',
                'handleWorkspacePointerDown',
                'handleProjectTelemetryEvent',
                'removeQuickSaveButton',
                'removeQuickSaveFeedback',
                'setupBlockSpeechListeners',
                'setupCategorySpeechListeners',
                'showQuickSaveFeedback',
                'speakCategory',
                'speakText',
                'syncBoardConnection',
                'syncBoardOutput',
                'syncQuickSaveButton',
                'syncBoardToolbox',
                'speakBlock',
                'tearDownBlockSpeechListeners',
                'tearDownCategorySpeechListeners',
                'handleSetTitleFromSave',
                'handleStorageInit',
                'handleUpdateProjectTitle'
            ]);
            this.boardMode = false;
            this.boardBluetooth = new ESP32Bluetooth();
            this.boardBluetooth.onOutput = this.handleBoardOutput;
            this.boardOutput = '';
            this.boardSimulation = new BoardSimulationProject(this.props.vm,
                () => ipcRenderer.invoke('capture-board-simulation'),
                () => ipcRenderer.invoke('close-board-simulation'));
            this.boardSimulationOpening = false;
            this.boardSimulationStatus = '';
            this.boardConnectionState = 'disconnected';
            this.boardConnectPromise = null;
            this.boardNextConnectAt = 0;
            this.boardUploading = false;
            this.boardProgress = 0;
            this.boardProgressPhase = '';
            if (!this.props.vm.extensionManager.isExtensionLoaded('esp32gpio')) {
                const manager = this.props.vm.extensionManager;
                const serviceName = manager._registerInternalExtension(new ESP32Extension());
                manager._loadedExtensions.set('esp32gpio', serviceName);
            }
            this.props.onLoadingStarted();
            ipcRenderer.invoke('get-initial-project-data').then(initialProjectData => {
                const hasInitialProject = initialProjectData && (initialProjectData.length > 0);
                this.props.onHasInitialProject(hasInitialProject, this.props.loadingState);
                if (!hasInitialProject) {
                    this.props.onLoadingCompleted();
                    return;
                }
                this.props.vm.loadProject(initialProjectData).then(
                    () => {
                        this.boardMode = this.props.vm.runtime.targets.some(target =>
                            Object.values(target.blocks._blocks).some(block => block.opcode.startsWith('esp32gpio_'))
                        );
                        this.props.onLoadingCompleted();
                        this.props.onLoadedProject(initialProjectLoadingState, true);
                    },
                    e => {
                        this.props.onLoadingCompleted();
                        this.props.onLoadedProject(initialProjectLoadingState, false);
                        remote.dialog.showMessageBox(remote.getCurrentWindow(), {
                            type: 'error',
                            title: 'Failed to load project',
                            message: 'Invalid or corrupt project file.',
                            detail: e.message
                        });

                        // this effectively sets the default project ID
                        // TODO: maybe setting the default project ID should be implicit in `requestNewProject`
                        this.props.onHasInitialProject(false, this.props.loadingState);

                        // restart as if we didn't have an initial project to load
                        this.props.onRequestNewProject();
                    }
                );
            })
                .catch(error => {
                    console.error('Failed to get initial project data:', error);
                    this.props.onHasInitialProject(false, this.props.loadingState);
                    this.props.onLoadingCompleted();
                });
        }
        componentDidMount () {
            ipcRenderer.on('setTitleFromSave', this.handleSetTitleFromSave);
            ipcRenderer.on('enter-board-programming', this.enterBoardProgramming);
            ipcRenderer.on('board-simulation-snapshot', this.handleBoardSimulationSnapshot);
            ipcRenderer.on('board-simulation-status', this.handleBoardSimulationStatus);
            this.applyCustomMenuLogo();
            this.syncQuickSaveButton();
            this.syncBoardOutput();
            this.syncBoardToolbox();
            this.setupBlockSpeechListeners();
            this.setupCategorySpeechListeners();
            this.logoObserver = window.setInterval(() => {
                this.applyCustomMenuLogo();
                this.syncBoardConnection();
                this.syncQuickSaveButton();
                this.syncBoardOutput();
                this.syncBoardToolbox();
                this.setupBlockSpeechListeners();
                this.setupCategorySpeechListeners();
            }, 500);
            window.addEventListener('pointermove', this.handleGlobalPointerMove, true);
            window.addEventListener('pointerup', this.handleGlobalPointerUp, true);
        }
        componentWillUnmount () {
            ipcRenderer.removeListener('setTitleFromSave', this.handleSetTitleFromSave);
            ipcRenderer.removeListener('enter-board-programming', this.enterBoardProgramming);
            ipcRenderer.removeListener('board-simulation-snapshot', this.handleBoardSimulationSnapshot);
            ipcRenderer.removeListener('board-simulation-status', this.handleBoardSimulationStatus);
            window.clearInterval(this.logoObserver);
            window.removeEventListener('pointermove', this.handleGlobalPointerMove, true);
            window.removeEventListener('pointerup', this.handleGlobalPointerUp, true);
            this.tearDownBlockSpeechListeners();
            this.tearDownCategorySpeechListeners();
            if (this.boardToolboxWorkspace) {
                this.boardToolboxWorkspace.updateToolbox = this.originalBoardUpdateToolbox;
            }
            this.removeQuickSaveButton();
            this.removeQuickSaveFeedback();
            const output = document.getElementById('desktop-board-output');
            if (output) output.remove();
        }
        applyCustomMenuLogo () {
            const logoImage = document.getElementById('logo_img');
            if (!logoImage) return;
            if (logoImage.src !== yiyiMenuLogo) {
                logoImage.src = yiyiMenuLogo;
                logoImage.alt = '一一编程乐园';
            }
            logoImage.style.height = '3rem';
            logoImage.style.width = 'auto';
            logoImage.style.maxWidth = 'none';
        }
        handleClickAbout () {
            ipcRenderer.send('open-about-window');
        }
        handleProjectTelemetryEvent (event, metadata) {
            ipcRenderer.send(event, metadata);
        }
        setupBlockSpeechListeners () {
            const workspaces = getBlocklyWorkspaces();
            const canvasEntries = workspaces
                .map(workspace => {
                    const canvas = workspace && workspace.getCanvas && workspace.getCanvas();
                    if (!canvas) {
                        return null;
                    }
                    return {
                        canvas,
                        isFlyout: workspace.isFlyout
                    };
                })
                .filter(Boolean);
            if (!canvasEntries.length) {
                console.log(`${speechDebugPrefix} workspace canvas not ready`);
                return;
            }
            const nextCanvasMap = new Map(canvasEntries.map(entry => [entry.canvas, entry]));
            const currentCanvasMap = this.blockSpeechCanvases || new Map();
            const didCanvasSetChange = (
                currentCanvasMap.size !== nextCanvasMap.size ||
                Array.from(nextCanvasMap.keys()).some(canvas => !currentCanvasMap.has(canvas))
            );
            if (!didCanvasSetChange) {
                return;
            }
            this.tearDownBlockSpeechListeners();
            nextCanvasMap.forEach(({canvas}) => {
                if (blockSpeechTriggerMode === 'click') {
                    canvas.addEventListener('pointerdown', this.handleWorkspaceImmediateSpeech, true);
                } else {
                    canvas.addEventListener('pointerdown', this.handleWorkspacePointerDown, true);
                }
            });
            this.blockSpeechCanvases = nextCanvasMap;
            console.log(`${speechDebugPrefix} listeners attached`, nextCanvasMap.size, blockSpeechTriggerMode);
        }
        tearDownBlockSpeechListeners () {
            this.cancelPendingBlockSpeech();
            if (this.blockSpeechCanvases) {
                this.blockSpeechCanvases.forEach(({canvas}) => {
                    canvas.removeEventListener('pointerdown', this.handleWorkspaceImmediateSpeech, true);
                    canvas.removeEventListener('pointerdown', this.handleWorkspacePointerDown, true);
                });
                this.blockSpeechCanvases = null;
                console.log(`${speechDebugPrefix} listeners detached`);
            }
        }
        setupCategorySpeechListeners () {
            const toolboxElement = document.querySelector('.blocklyToolboxDiv');
            if (!toolboxElement) {
                console.log(`${categorySpeechDebugPrefix} toolbox not ready`);
                return;
            }
            if (this.categorySpeechToolbox === toolboxElement) {
                return;
            }
            this.tearDownCategorySpeechListeners();
            toolboxElement.addEventListener('pointerdown', this.handleCategoryImmediateSpeech, true);
            this.categorySpeechToolbox = toolboxElement;
            console.log(`${categorySpeechDebugPrefix} listener attached`);
        }
        tearDownCategorySpeechListeners () {
            if (this.categorySpeechToolbox) {
                this.categorySpeechToolbox.removeEventListener('pointerdown', this.handleCategoryImmediateSpeech, true);
                this.categorySpeechToolbox = null;
                console.log(`${categorySpeechDebugPrefix} listener detached`);
            }
        }
        handleWorkspaceImmediateSpeech (event) {
            if (event.button !== 0) {
                console.log(`${speechDebugPrefix} ignored non-left immediate speech`);
                return;
            }
            const block = this.findBlockForEventTarget(event.target);
            if (!block) {
                console.log(`${speechDebugPrefix} immediate speech ignored, no workspace block`);
                return;
            }
            console.log(`${speechDebugPrefix} immediate speech triggered`, block.type, block.id);
            this.speakBlock(block);
        }
        handleCategoryImmediateSpeech (event) {
            if (event.button !== 0) {
                console.log(`${categorySpeechDebugPrefix} ignored non-left click`);
                return;
            }
            const categoryElement = this.findCategoryElementForEventTarget(event.target);
            if (!categoryElement) {
                console.log(`${categorySpeechDebugPrefix} ignored, no category item`);
                return;
            }
            console.log(`${categorySpeechDebugPrefix} speech triggered`);
            this.speakCategory(categoryElement);
        }
        handleWorkspacePointerDown (event) {
            if (event.button !== 0) {
                console.log(`${speechDebugPrefix} ignored non-left click`);
                return;
            }
            const block = this.findBlockForEventTarget(event.target);
            if (!block) {
                console.log(`${speechDebugPrefix} pointer down ignored, no workspace block`);
                return;
            }
            console.log(`${speechDebugPrefix} pointer down on block`, block.type, block.id);
            this.cancelPendingBlockSpeech();
            this.pendingBlockSpeech = {
                block: block,
                startX: event.clientX,
                startY: event.clientY
            };
            this.pendingBlockSpeech.timer = window.setTimeout(() => {
                const currentPendingSpeech = this.pendingBlockSpeech;
                this.cancelPendingBlockSpeech();
                if (currentPendingSpeech && currentPendingSpeech.block) {
                    console.log(
                        `${speechDebugPrefix} long press triggered`,
                        currentPendingSpeech.block.type,
                        currentPendingSpeech.block.id
                    );
                    this.speakBlock(currentPendingSpeech.block);
                }
            }, longPressDelay);
        }
        handleGlobalPointerMove (event) {
            if (!this.pendingBlockSpeech) {
                return;
            }
            const movedX = Math.abs(event.clientX - this.pendingBlockSpeech.startX);
            const movedY = Math.abs(event.clientY - this.pendingBlockSpeech.startY);
            if (movedX > longPressMoveTolerance || movedY > longPressMoveTolerance) {
                console.log(`${speechDebugPrefix} canceled by move`, {movedX, movedY});
                this.cancelPendingBlockSpeech();
            }
        }
        handleGlobalPointerUp () {
            if (this.pendingBlockSpeech) {
                console.log(`${speechDebugPrefix} canceled by pointer up`);
            }
            this.cancelPendingBlockSpeech();
        }
        cancelPendingBlockSpeech () {
            if (this.pendingBlockSpeech && this.pendingBlockSpeech.timer) {
                window.clearTimeout(this.pendingBlockSpeech.timer);
            }
            this.pendingBlockSpeech = null;
        }
        findBlockForEventTarget (target) {
            if (!target || !target.closest) {
                return null;
            }
            const blockElement = target.closest('[data-id]');
            if (!blockElement) {
                return null;
            }
            const workspaces = getBlocklyWorkspaces();
            for (const workspace of workspaces) {
                const block = workspace.getBlockById(blockElement.dataset.id);
                if (block) {
                    return block;
                }
            }
            console.log(`${speechDebugPrefix} workspace missing while resolving block`);
            return null;
        }
        findCategoryElementForEventTarget (target) {
            if (!target || !target.closest) {
                return null;
            }
            return target.closest('.scratchCategoryMenuItem');
        }
        createSpeechTextForBlock (block) {
            const rawText = block.toString(null, '空白')
                .replace(/\s+/g, ' ')
                .trim();
            if (!rawText || rawText === '???') {
                return '';
            }

            const replacements = [
                [/^重复执行 (.+)$/u, '重复$1次'],
                [/^如果 (.+) 那么$/u, '如果$1，就执行下面的积木'],
                [/^如果 (.+) 那么 否则$/u, '如果$1，就执行前一部分，否则执行后一部分'],
                [/^将 (.+) 增加 (.+)$/u, '把$1加$2'],
                [/^将 (.+) 设为 (.+)$/u, '把$1设为$2']
            ];
            const normalizedText = replacements.reduce(
                (text, [pattern, replacement]) => text.replace(pattern, replacement),
                rawText
            );
            const speechText = normalizedText
                .replace(/空白/gu, '空白内容')
                .replace(/\s+/g, ' ')
                .trim();
            console.log(`${speechDebugPrefix} text generated`, {
                blockType: block.type,
                blockId: block.id,
                rawText,
                speechText
            });
            return speechText;
        }
        createSpeechTextForCategory (categoryElement) {
            const labelElement = categoryElement &&
                categoryElement.querySelector('.scratchCategoryMenuItemLabel');
            const rawText = labelElement && labelElement.textContent ?
                labelElement.textContent.replace(/\s+/g, ' ').trim() :
                '';
            if (!rawText) {
                return '';
            }
            const speechText = rawText
                .replace(/扩展$/u, '扩展积木')
                .replace(/\s+/g, ' ')
                .trim();
            console.log(`${categorySpeechDebugPrefix} text generated`, {
                rawText,
                speechText
            });
            return speechText;
        }
        speakText (text, debugPrefix) {
            console.log(`${debugPrefix} invoking ipc`, text);
            ipcRenderer.invoke('speak-block-text', {text})
                .then(result => {
                    console.log(`${debugPrefix} ipc result`, result);
                })
                .catch(error => {
                    console.error(`${debugPrefix} ipc failed`, error);
                });
        }
        speakBlock (block) {
            const text = this.createSpeechTextForBlock(block);
            if (!text) {
                console.log(`${speechDebugPrefix} skipped empty text`, block.type, block.id);
                return;
            }
            this.speakText(text, speechDebugPrefix);
        }
        speakCategory (categoryElement) {
            const text = this.createSpeechTextForCategory(categoryElement);
            if (!text) {
                console.log(`${categorySpeechDebugPrefix} skipped empty text`);
                return;
            }
            this.speakText(text, categorySpeechDebugPrefix);
        }
        removeQuickSaveButton () {
            const quickSaveButton = document.getElementById('desktop-quick-save-button');
            if (quickSaveButton) {
                quickSaveButton.remove();
            }
            const boardProgrammingButton = document.getElementById('desktop-board-programming-button');
            if (boardProgrammingButton) {
                boardProgrammingButton.remove();
            }
            ['desktop-board-connect-button', 'desktop-board-upload-button', 'desktop-board-simulation-button',
                'desktop-board-simulation-server-button',
                'desktop-board-simulation-import-button',
                'desktop-board-status'].forEach(id => {
                const button = document.getElementById(id);
                if (button) button.remove();
            });
        }
        removeQuickSaveFeedback () {
            if (this.quickSaveFeedbackTimer) {
                window.clearTimeout(this.quickSaveFeedbackTimer);
                this.quickSaveFeedbackTimer = null;
            }
            const quickSaveFeedback = document.getElementById('desktop-quick-save-feedback');
            if (quickSaveFeedback) {
                quickSaveFeedback.remove();
            }
        }
        showQuickSaveFeedback (message, detail, isError = false) {
            const quickSaveButton = document.getElementById('desktop-quick-save-button');
            if (!quickSaveButton || !quickSaveButton.parentElement) {
                return;
            }

            this.removeQuickSaveFeedback();

            const quickSaveFeedback = document.createElement('div');
            quickSaveFeedback.id = 'desktop-quick-save-feedback';
            quickSaveFeedback.textContent = message;
            if (detail) {
                quickSaveFeedback.title = detail;
            }
            Object.assign(quickSaveFeedback.style, {
                flexShrink: '0',
                padding: '0 10px',
                borderRadius: '999px',
                height: '32px',
                lineHeight: '32px',
                fontSize: '13px',
                fontWeight: '700',
                color: '#fff',
                backgroundColor: isError ? 'rgba(230, 77, 0, 0.85)' : 'rgba(15, 189, 140, 0.85)'
            });
            quickSaveButton.parentElement.appendChild(quickSaveFeedback);

            this.quickSaveFeedbackTimer = window.setTimeout(() => {
                quickSaveFeedback.remove();
                this.quickSaveFeedbackTimer = null;
            }, isError ? 8000 : 2500);
        }
        syncQuickSaveButton () {
            const titleInput = document.querySelector('div[class*="menu-bar_menu-bar"] input');
            if (!titleInput) {
                return;
            }
            const titleFieldContainer = titleInput.parentElement;
            const titleRowContainer = titleFieldContainer && titleFieldContainer.parentElement;
            if (!titleFieldContainer || !titleRowContainer) {
                return;
            }

            titleRowContainer.style.display = 'flex';
            titleRowContainer.style.alignItems = 'center';
            titleRowContainer.style.gap = '8px';
            titleRowContainer.style.width = '100%';
            titleFieldContainer.style.flex = '1';
            titleFieldContainer.style.minWidth = '0';

            let quickSaveButton = document.getElementById('desktop-quick-save-button');
            if (!quickSaveButton) {
                quickSaveButton = document.createElement('button');
                quickSaveButton.id = 'desktop-quick-save-button';
                quickSaveButton.type = 'button';
                quickSaveButton.textContent = '保存';
                quickSaveButton.addEventListener('click', this.handleQuickSaveProject);
                titleRowContainer.appendChild(quickSaveButton);
            } else if (quickSaveButton.parentElement !== titleRowContainer) {
                titleRowContainer.appendChild(quickSaveButton);
            }

            Object.assign(quickSaveButton.style, {
                flexShrink: '0',
                border: '0',
                borderRadius: '8px',
                height: '40px',
                padding: '0 16px',
                backgroundColor: 'rgba(255, 255, 255, 0.15)',
                color: '#fff',
                fontWeight: '700',
                fontSize: '14px',
                cursor: 'pointer'
            });

            let boardProgrammingButton = document.getElementById('desktop-board-programming-button');
            if (!boardProgrammingButton) {
                boardProgrammingButton = document.createElement('button');
                boardProgrammingButton.id = 'desktop-board-programming-button';
                boardProgrammingButton.type = 'button';
                boardProgrammingButton.addEventListener('click', this.enterBoardProgramming);
                titleRowContainer.appendChild(boardProgrammingButton);
            } else if (boardProgrammingButton.parentElement !== titleRowContainer) {
                titleRowContainer.appendChild(boardProgrammingButton);
            }
            Object.assign(boardProgrammingButton.style, {
                flexShrink: '0',
                border: '0',
                borderRadius: '8px',
                height: '40px',
                padding: '0 16px',
                backgroundColor: 'rgba(15, 189, 140, 0.9)',
                color: '#fff',
                fontWeight: '700',
                fontSize: '14px',
                cursor: 'pointer'
            });
            boardProgrammingButton.textContent = this.boardMode ? '返回普通编程' : '板上编程';
            const connected = this.boardBluetooth.connected;
            const connecting = this.boardConnectionState === 'connecting';
            const boardButtons = [
                ['desktop-board-connect-button', connected ? 'ESP32 已连接' : connecting ? '连接中…' : '立即连接',
                    this.handleBoardConnect],
                ['desktop-board-upload-button', this.boardUploading ? `发送中 ${this.boardProgress}%` :
                    connected ? '发送到板上' : '连接后发送', this.handleBoardUpload],
                ['desktop-board-simulation-button', this.boardSimulationStatus || '仿真板运行',
                    this.handleBoardSimulationOpen],
                ['desktop-board-simulation-server-button', '仿真服务设置', this.handleBoardSimulationServer],
                ['desktop-board-simulation-import-button', '导入电路',
                    this.handleBoardSimulationImport]
            ];
            boardButtons.forEach(([id, label, onClick]) => {
                let button = document.getElementById(id);
                if (!this.boardMode) {
                    if (button) button.remove();
                    return;
                }
                if (!button) {
                    button = document.createElement('button');
                    button.id = id;
                    button.type = 'button';
                    button.addEventListener('click', onClick);
                }
                button.textContent = label;
                if (id === 'desktop-board-connect-button') {
                    button.disabled = connected || connecting || this.boardUploading;
                } else if (id === 'desktop-board-simulation-button') {
                    button.disabled = this.boardSimulationOpening;
                } else if (id === 'desktop-board-upload-button') {
                    button.disabled = !connected || this.boardUploading;
                } else {
                    button.disabled = this.boardUploading;
                }
                Object.assign(button.style, {
                    flexShrink: '0',
                    border: '0',
                    borderRadius: '8px',
                    height: '40px',
                    padding: '0 12px',
                    backgroundColor: '#0c956f',
                    color: '#fff',
                    fontWeight: '700',
                    cursor: button.disabled ? 'default' : 'pointer',
                    opacity: button.disabled ? 0.7 : 1
                });
                if (button.parentElement !== titleRowContainer) titleRowContainer.appendChild(button);
            });
            let status = document.getElementById('desktop-board-status');
            if (this.boardMode) {
                if (!status) {
                    status = document.createElement('div');
                    status.id = 'desktop-board-status';
                    status.setAttribute('role', 'status');
                    status.setAttribute('aria-live', 'polite');
                }
                status.textContent = this.boardUploading ?
                    `ESP32：${this.boardProgressPhase} ${this.boardProgress}%` :
                    connected ? 'ESP32：已连接' : connecting ? 'ESP32：连接中…' :
                        this.boardConnectionError && !this.boardBluetooth.canAutoReconnect ?
                            'ESP32：连接失败，请点立即连接' :
                            this.boardBluetooth.canAutoReconnect ?
                                'ESP32：未连接，自动重试中' : 'ESP32：未连接，请点立即连接';
                status.title = this.boardConnectionError || status.textContent;
                Object.assign(status.style, {
                    flexShrink: '0',
                    color: '#fff',
                    fontSize: '13px',
                    fontWeight: '700',
                    whiteSpace: 'nowrap',
                    borderRadius: '6px',
                    padding: '6px 8px',
                    background: this.boardUploading ?
                        `linear-gradient(to right, #0c956f ${this.boardProgress}%, ` +
                        `rgba(255, 255, 255, 0.16) ${this.boardProgress}%)` : 'transparent'
                });
                if (status.parentElement !== titleRowContainer) titleRowContainer.appendChild(status);
            } else if (status) {
                status.remove();
            }
            document.body.classList.toggle('desktop-board-mode', this.boardMode);
        }
        handleBoardOutput (chunk) {
            this.boardOutput = (this.boardOutput + chunk).slice(-20000);
            const content = document.getElementById('desktop-board-output-content');
            if (content) {
                content.textContent = this.boardOutput;
                content.scrollTop = content.scrollHeight;
            }
        }
        syncBoardOutput () {
            let panel = document.getElementById('desktop-board-output');
            if (!this.boardMode) {
                if (panel) panel.remove();
                return;
            }
            if (panel) return;
            panel = document.createElement('section');
            panel.id = 'desktop-board-output';
            Object.assign(panel.style, {
                position: 'fixed',
                right: '16px',
                bottom: '16px',
                zIndex: '1000',
                width: '360px',
                maxWidth: 'calc(100vw - 32px)',
                height: '180px',
                display: 'flex',
                flexDirection: 'column',
                background: '#20232a',
                color: '#fff',
                borderRadius: '8px',
                boxShadow: '0 3px 15px #0005',
                overflow: 'hidden'
            });
            const header = document.createElement('div');
            header.textContent = '板上输出';
            Object.assign(header.style, {
                padding: '8px 12px', fontWeight: '700', background: '#343842'
            });
            const clear = document.createElement('button');
            clear.type = 'button';
            clear.textContent = '清空';
            clear.setAttribute('aria-label', '清空板上输出');
            Object.assign(clear.style, {
                float: 'right', border: '0', background: 'transparent', color: '#fff', cursor: 'pointer'
            });
            clear.addEventListener('click', () => {
                this.boardOutput = '';
                const content = document.getElementById('desktop-board-output-content');
                if (content) content.textContent = '';
            });
            header.appendChild(clear);
            const content = document.createElement('pre');
            content.id = 'desktop-board-output-content';
            content.textContent = this.boardOutput;
            Object.assign(content.style, {
                flex: '1',
                margin: '0',
                padding: '10px 12px',
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere',
                fontSize: '12px'
            });
            panel.appendChild(header);
            panel.appendChild(content);
            document.body.appendChild(panel);
        }
        syncBoardToolbox () {
            const workspace = getBlocklyMainWorkspace();
            if (!workspace || !this.props.toolboxXML) return;
            if (this.boardToolboxWorkspace !== workspace) {
                if (this.boardToolboxWorkspace) {
                    this.boardToolboxWorkspace.updateToolbox = this.originalBoardUpdateToolbox;
                }
                const updateToolbox = workspace.updateToolbox;
                workspace.updateToolbox = source =>
                    updateToolbox.call(workspace, filterBoardToolbox(source, this.boardMode));
                this.originalBoardUpdateToolbox = updateToolbox;
                this.boardToolboxWorkspace = workspace;
                this.boardToolboxKey = null;
            }
            if (this.boardVariableWorkspace !== workspace) {
                const original = workspace.getToolboxCategoryCallback('VARIABLE');
                if (original) {
                    workspace.registerToolboxCategoryCallback('BOARD_VARIABLE', target =>
                        original(target).filter(node => {
                            if (node.tagName.toLowerCase() === 'button') {
                                return node.getAttribute('callbackKey') === 'CREATE_VARIABLE';
                            }
                            return ['data_variable', 'data_setvariableto', 'data_changevariableby']
                                .includes(node.getAttribute('type'));
                        })
                    );
                    this.boardVariableWorkspace = workspace;
                }
            }
            const source = this.props.toolboxXML;
            const key = `${this.boardMode}:${source}`;
            if (this.boardToolboxKey === key) return;
            workspace.updateToolbox(source);
            this.boardToolboxKey = key;
        }
        enterBoardProgramming () {
            this.boardMode = !this.boardMode;
            if (this.boardMode) this.boardNextConnectAt = 0;
            this.syncBoardConnection();
            this.syncQuickSaveButton();
            this.syncBoardOutput();
            this.syncBoardToolbox();
            if (this.boardMode) this.showQuickSaveFeedback('板上模式：使用绿旗、控制和 ESP32 基础 IO 积木');
        }
        syncBoardConnection (requestPermission = false) {
            if (!this.boardMode || this.boardUploading) return;
            if (this.boardBluetooth.connected) {
                this.boardConnectionState = 'connected';
                return;
            }
            if (!requestPermission && !this.boardBluetooth.canAutoReconnect) return;
            if (this.boardConnectPromise) return;
            this.boardConnectionState = 'disconnected';
            if (Date.now() < this.boardNextConnectAt) return;
            this.boardConnectionState = 'connecting';
            this.boardNextConnectAt = Date.now() + 5000;
            this.boardConnectPromise = this.boardBluetooth.connect(requestPermission)
                .then(() => {
                    this.boardConnectionState = 'connected';
                    this.boardConnectionError = null;
                })
                .catch(error => {
                    this.boardConnectionState = 'disconnected';
                    this.boardConnectionError = error.message;
                    this.boardNextConnectAt = Date.now() + 5000;
                    if (requestPermission) this.showQuickSaveFeedback(`连接失败：${error.message}`, null, true);
                })
                .finally(() => {
                    this.boardConnectPromise = null;
                    this.syncQuickSaveButton();
                });
            this.syncQuickSaveButton();
        }
        handleBoardConnect () {
            this.boardNextConnectAt = 0;
            this.syncBoardConnection(true);
        }
        handleBoardSimulationImport () {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.vlx,application/json';
            input.addEventListener('change', async () => {
                if (!input.files || !input.files[0]) return;
                try {
                    const snapshot = JSON.parse(await input.files[0].text());
                    this.boardSimulation.setSnapshot(snapshot);
                    this.syncQuickSaveButton();
                    this.showQuickSaveFeedback('仿真电路已绑定，请保存 Scratch 作品');
                } catch (error) {
                    this.showQuickSaveFeedback(`导入仿真电路失败：${error.message}`, null, true);
                }
            });
            input.click();
        }
        async handleBoardSimulationServer () {
            const saved = window.localStorage.getItem('board-simulation-url') || '';
            const input = await new Promise(resolve => {
                const overlay = document.createElement('div');
                overlay.style.cssText = 'position:fixed;inset:0;background:#0009;z-index:100000;' +
                    'display:flex;align-items:center;justify-content:center';
                const form = document.createElement('form');
                form.style.cssText = 'background:white;padding:24px;border-radius:12px;' +
                    'min-width:360px;display:grid;gap:12px';
                const label = document.createElement('label');
                label.textContent = 'Velxio 服务器地址';
                const field = document.createElement('input');
                field.type = 'url';
                field.required = true;
                field.value = saved || 'http://';
                field.style.cssText = 'padding:10px;font-size:16px';
                const actions = document.createElement('div');
                actions.style.cssText = 'display:flex;justify-content:flex-end;gap:12px';
                const cancel = document.createElement('button');
                cancel.type = 'button';
                cancel.textContent = '取消';
                const local = document.createElement('button');
                local.type = 'button';
                local.textContent = '使用本机 Docker';
                const save = document.createElement('button');
                save.type = 'submit';
                save.textContent = '保存';
                const finish = value => {
                    overlay.remove();
                    resolve(value);
                };
                cancel.addEventListener('click', () => finish(null));
                local.addEventListener('click', () => finish('local'));
                form.addEventListener('submit', event => {
                    event.preventDefault();
                    finish(field.value);
                });
                actions.append(local, cancel, save);
                form.append(label, field, actions);
                overlay.append(form);
                document.body.appendChild(overlay);
                field.focus();
            });
            if (input === null) return null;
            if (input === 'local') {
                window.localStorage.removeItem('board-simulation-url');
                this.showQuickSaveFeedback('已切换到本机 Docker 仿真');
                return null;
            }
            try {
                const url = new URL(input.trim());
                if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
                    throw new Error('invalid server URL');
                }
                const normalized = url.toString().replace(/\/+$/, '');
                window.localStorage.setItem('board-simulation-url', normalized);
                this.showQuickSaveFeedback('仿真服务器已设置', normalized);
                return normalized;
            } catch (error) {
                this.showQuickSaveFeedback('服务器地址无效，请输入 http 或 https 地址', null, true);
                return null;
            }
        }
        async handleBoardSimulationOpen () {
            if (this.boardSimulationOpening) return;
            this.boardSimulationOpening = true;
            this.boardSimulationStatus = '正在启动仿真…';
            this.syncQuickSaveButton();
            try {
                const serverUrl = window.localStorage.getItem('board-simulation-url') || null;
                const source = compileESP32(this.props.vm);
                const snapshot = this.boardSimulation.buildRunSnapshot(source);
                await ipcRenderer.invoke('open-board-simulation', {snapshot, serverUrl});
            } catch (error) {
                this.showQuickSaveFeedback(`打开仿真板失败：${error.message}`, null, true);
            } finally {
                this.boardSimulationOpening = false;
                this.boardSimulationStatus = '';
                this.syncQuickSaveButton();
            }
        }
        handleBoardSimulationStatus (_event, status) {
            this.boardSimulationStatus = status;
            this.syncQuickSaveButton();
        }
        handleBoardSimulationSnapshot (_event, content, saveProject = false) {
            try {
                this.boardSimulation.setSnapshot(JSON.parse(content));
                if (saveProject) {
                    this.handleQuickSaveProject();
                } else {
                    this.showQuickSaveFeedback('仿真电路已更新，请保存 Scratch 作品');
                }
            } catch (error) {
                this.showQuickSaveFeedback(`保存仿真电路失败：${error.message}`, null, true);
            }
        }
        async handleBoardUpload () {
            if (this.boardUploading) return;
            this.boardUploading = true;
            this.boardProgress = 0;
            this.boardProgressPhase = '准备发送';
            this.syncQuickSaveButton();
            try {
                const source = compileESP32(this.props.vm);
                if (!this.boardBluetooth.connected) throw new Error('请先连接 ESP32。');
                await this.boardBluetooth.uploadMain(source, (progress, phase) => {
                    this.boardProgress = progress;
                    this.boardProgressPhase = phase;
                    this.syncQuickSaveButton();
                });
                this.showQuickSaveFeedback('已发送，开发板正在重启运行');
            } catch (error) {
                this.showQuickSaveFeedback(`发送失败：${error.message}`, null, true);
            } finally {
                this.boardUploading = false;
                this.boardNextConnectAt = 0;
                this.boardConnectionState = this.boardBluetooth.connected ? 'connected' : 'disconnected';
                this.syncQuickSaveButton();
                if (!this.boardBluetooth.connected) this.syncBoardConnection();
            }
        }
        async handleQuickSaveProject () {
            try {
                const projectContent = await this.props.vm.saveProjectSb3();
                let projectBuffer;
                if (Buffer.isBuffer(projectContent)) {
                    projectBuffer = projectContent;
                } else if (ArrayBuffer.isView(projectContent)) {
                    projectBuffer = Buffer.from(
                        projectContent.buffer,
                        projectContent.byteOffset,
                        projectContent.byteLength
                    );
                } else if (projectContent instanceof ArrayBuffer) {
                    projectBuffer = Buffer.from(projectContent);
                } else {
                    projectBuffer = Buffer.from(await projectContent.arrayBuffer());
                }
                const saveResult = await ipcRenderer.invoke('quick-save-project', {
                    projectData: projectBuffer,
                    projectTitle: this.props.projectTitle
                });
                this.handleUpdateProjectTitle(saveResult.title);
                this.showQuickSaveFeedback('已保存', saveResult.path);
            } catch (error) {
                this.showQuickSaveFeedback('保存失败', error.message, true);
                throw error;
            }
        }
        handleSetTitleFromSave (event, args) {
            this.handleUpdateProjectTitle(args.title);
        }
        handleStorageInit (storageInstance) {
            storageInstance.addHelper(new ElectronStorageHelper(storageInstance));
        }
        handleUpdateProjectTitle (newTitle) {
            this.setState({projectTitle: newTitle});
        }
        render () {
            const childProps = omit(this.props, Object.keys(ScratchDesktopGUIComponent.propTypes));

            return (<WrappedComponent
                canEditTitle
                canModifyCloudData={false}
                canSave={false}
                onQuickSaveProject={this.handleQuickSaveProject}
                onClickAbout={[
                    {
                        title: 'About',
                        onClick: () => this.handleClickAbout()
                    },
                    {
                        title: 'Privacy Policy',
                        onClick: () => showPrivacyPolicy()
                    },
                    {
                        title: 'Data Settings',
                        onClick: () => this.props.onTelemetrySettingsClicked()
                    }
                ]}
                onProjectTelemetryEvent={this.handleProjectTelemetryEvent}
                onShowPrivacyPolicy={showPrivacyPolicy}
                onStorageInit={this.handleStorageInit}
                onUpdateProjectTitle={this.handleUpdateProjectTitle}
                platform="DESKTOP"

                // allow passed-in props to override any of the above
                {...childProps}
            />);
        }
    }

    ScratchDesktopGUIComponent.propTypes = {
        loadingState: PropTypes.oneOf(LoadingStates),
        onFetchedInitialProjectData: PropTypes.func,
        onHasInitialProject: PropTypes.func,
        onLoadedProject: PropTypes.func,
        onLoadingCompleted: PropTypes.func,
        onLoadingStarted: PropTypes.func,
        onRequestNewProject: PropTypes.func,
        onTelemetrySettingsClicked: PropTypes.func,
        projectTitle: PropTypes.string,
        toolboxXML: PropTypes.string,
        vm: GUIComponent.WrappedComponent.propTypes.vm
    };
    const mapStateToProps = state => {
        const loadingState = state.scratchGui.projectState.loadingState;
        return {
            loadingState: loadingState,
            projectTitle: state.scratchGui.projectTitle,
            toolboxXML: state.scratchGui.toolbox.toolboxXML,
            vm: state.scratchGui.vm
        };
    };
    const mapDispatchToProps = dispatch => ({
        onLoadingStarted: () => dispatch(openLoadingProject()),
        onLoadingCompleted: () => dispatch(closeLoadingProject()),
        onHasInitialProject: (hasInitialProject, loadingState) => {
            if (hasInitialProject) {
                // emulate sb-file-uploader
                return dispatch(requestProjectUpload(loadingState));
            }

            // `createProject()` might seem more appropriate but it's not a valid state transition here
            // setting the default project ID is a valid transition from NOT_LOADED and acts like "create new"
            return dispatch(setProjectId(defaultProjectId));
        },
        onFetchedInitialProjectData: (projectData, loadingState) =>
            dispatch(onFetchedProjectData(projectData, loadingState)),
        onLoadedProject: (loadingState, loadSuccess) => {
            const canSaveToServer = false;
            return dispatch(onLoadedProject(loadingState, canSaveToServer, loadSuccess));
        },
        onRequestNewProject: () => dispatch(requestNewProject(false)),
        onTelemetrySettingsClicked: () => dispatch(openTelemetryModal())
    });

    return connect(mapStateToProps, mapDispatchToProps)(ScratchDesktopGUIComponent);
};

export default ScratchDesktopGUIHOC;
