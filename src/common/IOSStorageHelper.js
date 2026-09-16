import NativeBridge from '../renderer/ios/NativeBridge';

class IOSStorageHelper {
    constructor (storageInstance) {
        this.parent = storageInstance;
    }

    async load (assetType, assetId, dataFormat) {
        const safeAssetId = String(assetId).replace(/[^a-zA-Z0-9_-]/g, '');
        const safeDataFormat = String(dataFormat).replace(/[^a-zA-Z0-9]/g, '');
        const result = await NativeBridge.call('readBundleFile', {
            path: `static/fetched/${safeAssetId}.${safeDataFormat}`
        });
        const bytes = NativeBridge.base64ToBytes(result.data);
        return new this.parent.Asset(assetType, safeAssetId, safeDataFormat, bytes);
    }
}

export default IOSStorageHelper;
