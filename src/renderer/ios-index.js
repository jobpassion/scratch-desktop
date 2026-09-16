import './MenuBarCleanup';
import './BoardControlsDropdown';
import './ios/FileSync';
import './ios/DynamicControlFontFix';
import './ios/MenuBarLayoutFix';
import ReactDOM from 'react-dom';
import iosApp from './ios-app.jsx';

const appTarget = document.getElementById('app');

const showStartupError = error => {
    const message = error && error.stack ? error.stack : String(error || 'Unknown startup error');
    console.error('Error rendering iOS app:', error);
    if (!appTarget) return;
    appTarget.innerHTML = `
        <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:#fff;color:#222;padding:32px;box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif;">
            <div style="max-width:900px;width:100%;">
                <h2 style="margin:0 0 16px;">iOS Web 启动失败</h2>
                <pre style="white-space:pre-wrap;word-break:break-word;font-size:14px;line-height:1.5;">${message.replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]))}</pre>
            </div>
        </div>`;
};

try {
    if (!appTarget) {
        throw new Error('Missing #app mount element');
    }
    if (document.activeElement && document.activeElement.blur) {
        document.activeElement.blur();
    }
    ReactDOM.render(iosApp, appTarget);
} catch (error) {
    showStartupError(error);
}
