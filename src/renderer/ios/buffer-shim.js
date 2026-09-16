const toUint8Array = value => {
    if (value instanceof Uint8Array) return value;
    if (ArrayBuffer.isView(value)) {
        return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    }
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (Array.isArray(value)) return new Uint8Array(value);
    throw new TypeError('Unsupported Buffer.from input on iOS.');
};

export const Buffer = {
    isBuffer: value => value instanceof Uint8Array,
    from: toUint8Array
};

export default Buffer;
