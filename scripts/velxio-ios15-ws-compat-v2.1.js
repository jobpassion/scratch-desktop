/* Velxio WebSocket URL compatibility for iOS 15.4.1 (v2.1).
 * Load before the editor app bundle. Do not patch fetch/XHR or other APIs.
 */
(function () {
    'use strict';
    if (window.__velxioIOS15WSHotfixV21) return;
    var NativeWebSocket = window.WebSocket;
    if (typeof NativeWebSocket !== 'function') return;

    function CompatibleWebSocket(url, protocols) {
        if (!(this instanceof CompatibleWebSocket)) {
            throw new TypeError("Failed to construct 'WebSocket': Please use the 'new' operator");
        }
        // Velxio passes /api/simulation/ws/... (a relative URL). Older WebKit
        // cannot resolve relative or http(s) URLs in the WebSocket constructor.
        var resolved = new URL(String(url), window.location.href);
        if (resolved.protocol === 'http:') {
            resolved.protocol = 'ws:';
        } else if (resolved.protocol === 'https:') {
            resolved.protocol = 'wss:';
        }
        var normalized = resolved.href;
        if (arguments.length > 1) return new NativeWebSocket(normalized, protocols);
        return new NativeWebSocket(normalized);
    }
    CompatibleWebSocket.prototype = NativeWebSocket.prototype;
    Object.setPrototypeOf(CompatibleWebSocket, NativeWebSocket);
    window.WebSocket = CompatibleWebSocket;
    window.__velxioIOS15WSHotfixV21 = true;
    console.info('[Velxio iOS15 WS hotfix v2.1] active');
})();
