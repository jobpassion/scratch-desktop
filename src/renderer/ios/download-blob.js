import NativeBridge from './NativeBridge';

export default (filename, blob) => {
    NativeBridge.projectDataToBytes(blob)
        .then(bytes => NativeBridge.call('exportProject', {
            filename,
            data: NativeBridge.bytesToBase64(bytes)
        }))
        .catch(error => {
            console.error('[iOS] failed to export Scratch project', error);
        });
};
