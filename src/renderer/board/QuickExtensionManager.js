import {
    QUICK_EXTENSION_EXAMPLE,
    deleteQuickExtensionConfig,
    getQuickExtensionAIPrompt,
    loadQuickExtensions,
    registerQuickExtension,
    saveQuickExtensionConfig
} from './QuickExtensionRegistry';
import {syncQuickExtensionsToLibrary} from './QuickExtensionLibrary';

const BUTTON_ID = 'yiyi-quick-extension-manager-button';
const OVERLAY_ID = 'yiyi-quick-extension-manager-overlay';

const buttonStyle = button => {
    Object.assign(button.style, {
        position: 'fixed',
        top: '18px',
        right: '72px',
        zIndex: '100000',
        border: '0',
        borderRadius: '8px',
        padding: '9px 14px',
        background: '#0fbd8c',
        color: '#fff',
        fontWeight: '700',
        cursor: 'pointer',
        boxShadow: '0 2px 8px #0003'
    });
};

const actionButton = (label, primary = false, danger = false) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    Object.assign(button.style, {
        border: primary ? '0' : '1px solid #d5d8df',
        borderRadius: '7px',
        padding: '8px 12px',
        background: danger ? '#d64545' : primary ? '#0fbd8c' : '#fff',
        color: danger || primary ? '#fff' : '#333',
        fontWeight: '700',
        cursor: 'pointer'
    });
    return button;
};

const copyText = async text => {
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
            return;
        }
    } catch (error) {
        console.warn('[quick-extension] clipboard API failed, falling back', error);
    }
    const field = document.createElement('textarea');
    field.value = text;
    field.style.position = 'fixed';
    field.style.opacity = '0';
    document.body.appendChild(field);
    field.focus();
    field.select();
    document.execCommand('copy');
    field.remove();
};

const closeManager = () => {
    const overlay = document.getElementById(OVERLAY_ID);
    if (overlay) overlay.remove();
};

const openManager = (vm, onActivate) => {
    closeManager();
    const overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    Object.assign(overlay.style, {
        position: 'fixed',
        inset: '0',
        zIndex: '100001',
        background: '#0009',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
        boxSizing: 'border-box'
    });

    const panel = document.createElement('section');
    Object.assign(panel.style, {
        width: 'min(1040px, calc(100vw - 40px))',
        height: 'min(760px, calc(100vh - 40px))',
        background: '#fff',
        borderRadius: '12px',
        boxShadow: '0 12px 40px #0007',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
    });

    const header = document.createElement('div');
    Object.assign(header.style, {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '16px 18px',
        borderBottom: '1px solid #e6e8ec'
    });
    const title = document.createElement('div');
    title.innerHTML = '<strong>快捷扩展管理</strong><div style="font-size:12px;color:#666;margin-top:3px">粘贴 AI 生成的 JSON，即可新增或修改 ESP32 积木与 MicroPython 代码</div>';
    const close = actionButton('关闭');
    close.addEventListener('click', closeManager);
    header.append(title, close);

    const body = document.createElement('div');
    Object.assign(body.style, {
        flex: '1',
        minHeight: '0',
        display: 'grid',
        gridTemplateColumns: '220px minmax(0, 1fr)',
        gap: '16px',
        padding: '16px'
    });

    const sidebar = document.createElement('div');
    Object.assign(sidebar.style, {
        minWidth: '0',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px'
    });
    const sidebarTitle = document.createElement('strong');
    sidebarTitle.textContent = '已保存扩展';
    const select = document.createElement('select');
    select.size = 12;
    Object.assign(select.style, {
        flex: '1',
        minHeight: '220px',
        width: '100%',
        border: '1px solid #cfd3da',
        borderRadius: '8px',
        padding: '6px',
        fontSize: '14px'
    });
    const newExample = actionButton('载入多彩 LED 示例');
    const copyRules = actionButton('复制给 AI 的生成规则');
    sidebar.append(sidebarTitle, select, newExample, copyRules);

    const editorColumn = document.createElement('div');
    Object.assign(editorColumn.style, {
        minWidth: '0',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px'
    });
    const editorLabel = document.createElement('strong');
    editorLabel.textContent = '扩展 JSON';
    const editor = document.createElement('textarea');
    editor.spellcheck = false;
    Object.assign(editor.style, {
        flex: '1',
        width: '100%',
        minHeight: '320px',
        resize: 'none',
        boxSizing: 'border-box',
        border: '1px solid #cfd3da',
        borderRadius: '8px',
        padding: '12px',
        fontFamily: 'Menlo, Monaco, Consolas, monospace',
        fontSize: '13px',
        lineHeight: '1.5'
    });
    const status = document.createElement('div');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    Object.assign(status.style, {
        minHeight: '20px',
        fontSize: '13px',
        color: '#555'
    });
    const actions = document.createElement('div');
    Object.assign(actions.style, {
        display: 'flex',
        flexWrap: 'wrap',
        gap: '8px',
        justifyContent: 'flex-end'
    });
    const copyJson = actionButton('复制当前 JSON');
    const remove = actionButton('删除', false, true);
    const save = actionButton('保存');
    const saveAndEnable = actionButton('保存并启用', true);
    actions.append(copyJson, remove, save, saveAndEnable);
    editorColumn.append(editorLabel, editor, status, actions);
    body.append(sidebar, editorColumn);
    panel.append(header, body);
    overlay.append(panel);
    document.body.append(overlay);

    const setStatus = (message, isError = false) => {
        status.textContent = message;
        status.style.color = isError ? '#bd2020' : '#3f5f50';
    };

    const refreshSelect = selectedId => {
        const configs = loadQuickExtensions();
        select.textContent = '';
        configs.forEach(config => {
            const option = document.createElement('option');
            option.value = config.id;
            option.textContent = `${config.name} (${config.id})`;
            select.appendChild(option);
        });
        if (selectedId && configs.some(config => config.id === selectedId)) {
            select.value = selectedId;
        }
    };

    const loadSelected = () => {
        const config = loadQuickExtensions().find(item => item.id === select.value);
        if (!config) return;
        editor.value = JSON.stringify(config, null, 2);
        setStatus('可以直接修改积木定义或 python 代码后保存。');
    };

    const saveEditor = async enable => {
        try {
            const parsed = JSON.parse(editor.value);
            const manager = vm && vm.extensionManager;
            const wasLoaded = Boolean(manager && parsed && parsed.id && manager.isExtensionLoaded(parsed.id));
            const config = saveQuickExtensionConfig(parsed);
            syncQuickExtensionsToLibrary();
            refreshSelect(config.id);
            editor.value = JSON.stringify(config, null, 2);
            if (enable) {
                await registerQuickExtension(vm, config);
                if (typeof onActivate === 'function') onActivate(config);
            }
            if (wasLoaded) {
                setStatus('已保存。MicroPython 生成规则立即生效；如果改了积木文字、参数或菜单，重启应用后会完整刷新。');
            } else if (enable) {
                setStatus('已保存并启用。关闭扩展页面后即可看到新的积木分类。');
            } else {
                setStatus('已保存。重新打开“选择一个扩展”页面即可看到扩展卡片。');
            }
        } catch (error) {
            setStatus(`保存失败：${error.message}`, true);
        }
    };

    select.addEventListener('change', loadSelected);
    newExample.addEventListener('click', () => {
        editor.value = JSON.stringify(QUICK_EXTENSION_EXAMPLE, null, 2);
        select.selectedIndex = -1;
        setStatus('这是可直接运行的多彩 LED 示例。修改 id、名称或积木后再保存。');
    });
    copyRules.addEventListener('click', async () => {
        try {
            await copyText(getQuickExtensionAIPrompt());
            setStatus('已复制生成规则，可以直接发给 AI，再把返回的 JSON 粘贴到这里。');
        } catch (error) {
            setStatus(`复制失败：${error.message}`, true);
        }
    });
    copyJson.addEventListener('click', async () => {
        try {
            await copyText(editor.value);
            setStatus('已复制当前 JSON。');
        } catch (error) {
            setStatus(`复制失败：${error.message}`, true);
        }
    });
    save.addEventListener('click', () => saveEditor(false));
    saveAndEnable.addEventListener('click', () => saveEditor(true));
    remove.addEventListener('click', () => {
        const id = select.value;
        if (!id) {
            setStatus('请先从左侧选择要删除的扩展。', true);
            return;
        }
        if (!window.confirm(`确定删除快捷扩展 ${id} 吗？`)) return;
        if (deleteQuickExtensionConfig(id)) {
            syncQuickExtensionsToLibrary();
            editor.value = '';
            refreshSelect();
            setStatus('已删除。若该扩展本次已经加载，当前分类会保留到应用重启。');
        }
    });
    overlay.addEventListener('pointerdown', event => {
        if (event.target === overlay) closeManager();
    });

    refreshSelect();
    if (select.options.length) {
        select.selectedIndex = 0;
        loadSelected();
    } else {
        editor.value = JSON.stringify(QUICK_EXTENSION_EXAMPLE, null, 2);
        setStatus('还没有快捷扩展。可直接从多彩 LED 示例开始，或者复制规则让 AI 生成。');
    }
};

export const syncQuickExtensionManagerEntry = (vm, onActivate) => {
    const library = document.getElementById('extensionLibrary');
    let button = document.getElementById(BUTTON_ID);
    if (!library) {
        if (button) button.remove();
        return;
    }
    if (!button) {
        button = document.createElement('button');
        button.id = BUTTON_ID;
        button.type = 'button';
        button.textContent = '快捷扩展管理';
        buttonStyle(button);
        document.body.appendChild(button);
    }
    button.onclick = () => openManager(vm, onActivate);
};

export const removeQuickExtensionManagerEntry = () => {
    const button = document.getElementById(BUTTON_ID);
    if (button) button.remove();
    closeManager();
};
