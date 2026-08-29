/** Files preview fetch policy: snapshot bytes when present, otherwise one file-read. */
export declare function shouldFetchFilePreview(path: string, snapshotPreview: string | undefined): boolean;
export declare function filesPreviewPhase(input: {
    path: string;
    preview: string | undefined;
    fetchFailed: boolean;
    canFetch: boolean;
}): 'empty' | 'loading' | 'missing' | 'ready';
//# sourceMappingURL=files-preview.d.ts.map