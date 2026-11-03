export const DUMMY_KEY: string;
export const FIGURE: string;
export interface ModelCall { operation: string; marker: string; hasImage: boolean; completed: boolean; failed: boolean }
export interface MockState { id: string; calls: ModelCall[]; inflight: number; hold: boolean; partial: boolean; gradeError: boolean; failNext: number; distinctAnalysis: boolean }
export const PAGE_QUESTIONS: Array<{ label: string; text: string; regions: Array<{ x: number; y: number; w: number; h: number }>; hasFigure: boolean }>;
export function startMockAI(): Promise<{ origin: string; cases: Map<string, MockState>; violations: unknown[]; close(): Promise<void> }>;
