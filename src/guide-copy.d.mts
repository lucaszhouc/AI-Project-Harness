export const COPY_VERSION: number;
export const COPY: Record<string, { "zh-CN": string; en: string }>;
export const CONTROL_REGISTRY: Record<string, any>;
export function getCopy(locale: string, key: string): string;
export function validateCopyParity(copy?: typeof COPY): string[];
