export interface RealecSpellingAuditDocument {
    text: string;
    annotations: readonly {
        spans: readonly (readonly [number, number])[];
    }[];
}

export interface RealecSpellingAuditReport {
    text: string;
    diagnostics: readonly {
        ruleId: string;
        start: number;
        end: number;
        proposals?: readonly {
            edits?: readonly {
                expected: string;
                replacement: string;
            }[];
        }[];
    }[];
}

export interface RealecSpellingAuditContext {
    unigrams: Readonly<Record<string, number>>;
    bigrams: Readonly<Record<string, number>>;
    smoothing?: number;
    continuation?: Readonly<Record<string, number>>;
    followers?: Readonly<Record<string, number>>;
    totalTypes?: number;
    discount?: number;
}

export interface RealecSpellingAuditBin {
    editDistance: string;
    candidateFrequency: string;
    contextualGain: string;
    predictions: number;
    annotationOverlaps: number;
}

export interface RealecSpellingCalibration {
    scope: string;
    dimensions: Readonly<Record<string, string>>;
    bins: readonly RealecSpellingAuditBin[];
}

export function buildRealecSpellingCalibration(
    split: string,
    documents: readonly RealecSpellingAuditDocument[],
    reports: readonly RealecSpellingAuditReport[],
    frequency: Readonly<Record<string, number>>,
    contextual: RealecSpellingAuditContext,
): RealecSpellingCalibration | undefined;
