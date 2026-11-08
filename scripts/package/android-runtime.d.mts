export interface TermuxPackage {
    Package: string;
    Version?: string;
    Depends?: string;
    Filename?: string;
    SHA256?: string;
    [field: string]: string | undefined;
}

export const TERMUX_ARCH: string;
export const ANDROID_ABI: string;
export const NODE_PACKAGE: string;
export function parseTermuxPackages(text: string): Map<string, TermuxPackage>;
export function resolveTermuxDependencies(index: Map<string, TermuxPackage>, name: string): TermuxPackage[];
export function compareDebianVersions(left: string, right: string): number;
export function androidLibraryName(soname: string): string;
export function extractDebData(buffer: Buffer): { name: string; data: Buffer };
export function buildAndroidRuntime(options: {
    bundleDir: string;
    enginesDir: string;
    outDir: string;
    workDir: string;
    version: string;
    log?: (message: string) => void;
}): Promise<void>;
