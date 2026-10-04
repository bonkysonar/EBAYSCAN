export const CAPTURE_REPAIRS: Record<string, string>;
export function researchQueryKey(value: unknown): string;
export function assessSoldCapture(page?: Record<string, any>, now?: Date): {version: number; importable: boolean; searchComplete: boolean; status: string; periodDays: number | null; windowVerified: boolean; rowCount: number; reasonCodes: string[]; repairs: string[]};
export function mergeSoldCaptures(previous?: Record<string, any>[], incoming?: Record<string, any>[], now?: Date): Record<string, any>[];
