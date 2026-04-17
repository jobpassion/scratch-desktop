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
                'findBlockForEventTarget',
                'handleQuickSaveProject',
                'handleGlobalPointerMove',
                'handleGlobalPointerUp',
                'handleWorkspaceImmediateSpeech',
                'handleWorkspacePointerDown',
                'handleProjectTelemetryEvent',
                'removeQuickSaveButton',
                'removeQuickSaveFeedback',
                'setupBlockSpeechListeners',
                'showQuickSaveFeedback',
                'syncQuickSaveButton',
                'speakBlock',
                'tearDownBlockSpeechListeners',
                'handleSetTitleFromSave',
                'handleStorageInit',
                'handleUpdateProjectTitle'
            ]);
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
            });
        }
        componentDidMount () {
            ipcRenderer.on('setTitleFromSave', this.handleSetTitleFromSave);
            this.applyCustomMenuLogo();
            this.syncQuickSaveButton();
            this.setupBlockSpeechListeners();
            this.logoObserver = window.setInterval(() => {
                this.applyCustomMenuLogo();
                this.syncQuickSaveButton();
                this.setupBlockSpeechListeners();
            }, 500);
            window.addEventListener('mousemove', this.handleGlobalPointerMove, true);
            window.addEventListener('mouseup', this.handleGlobalPointerUp, true);
        }
        componentWillUnmount () {
            ipcRenderer.removeListener('setTitleFromSave', this.handleSetTitleFromSave);
            window.clearInterval(this.logoObserver);
            window.removeEventListener('mousemove', this.handleGlobalPointerMove, true);
            window.removeEventListener('mouseup', this.handleGlobalPointerUp, true);
            this.tearDownBlockSpeechListeners();
            this.removeQuickSaveButton();
            this.removeQuickSaveFeedback();
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
                    canvas.addEventListener('mousedown', this.handleWorkspaceImmediateSpeech, true);
                } else {
                    canvas.addEventListener('mousedown', this.handleWorkspacePointerDown, true);
                }
            });
            this.blockSpeechCanvases = nextCanvasMap;
            console.log(`${speechDebugPrefix} listeners attached`, nextCanvasMap.size, blockSpeechTriggerMode);
        }
        tearDownBlockSpeechListeners () {
            this.cancelPendingBlockSpeech();
            if (this.blockSpeechCanvases) {
                this.blockSpeechCanvases.forEach(({canvas}) => {
                    canvas.removeEventListener('mousedown', this.handleWorkspaceImmediateSpeech, true);
                    canvas.removeEventListener('mousedown', this.handleWorkspacePointerDown, true);
                });
                this.blockSpeechCanvases = null;
                console.log(`${speechDebugPrefix} listeners detached`);
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
        speakBlock (block) {
            const text = this.createSpeechTextForBlock(block);
            if (!text) {
                console.log(`${speechDebugPrefix} skipped empty text`, block.type, block.id);
                return;
            }
            console.log(`${speechDebugPrefix} invoking ipc`, text);
            ipcRenderer.invoke('speak-block-text', {text})
                .then(result => {
                    console.log(`${speechDebugPrefix} ipc result`, result);
                })
                .catch(error => {
                    console.error(`${speechDebugPrefix} ipc failed`, error);
                });
        }
        removeQuickSaveButton () {
            const quickSaveButton = document.getElementById('desktop-quick-save-button');
            if (quickSaveButton) {
                quickSaveButton.remove();
            }
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
            }, 2500);
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
        vm: GUIComponent.WrappedComponent.propTypes.vm
    };
    const mapStateToProps = state => {
        const loadingState = state.scratchGui.projectState.loadingState;
        return {
            loadingState: loadingState,
            projectTitle: state.scratchGui.projectTitle,
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
