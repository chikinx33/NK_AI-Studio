// fflate.bundle.js 의 타입 선언(최소).
export declare function unzipSync(data: Uint8Array, options?: any): Record<string, Uint8Array>;
export declare function zipSync(data: Record<string, any>, options?: any): Uint8Array;
export declare function strFromU8(data: Uint8Array, latin1?: boolean): string;
export declare function strToU8(str: string, latin1?: boolean): Uint8Array;
