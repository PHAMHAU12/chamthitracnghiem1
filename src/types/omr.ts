export type PresetMode = 'custom' | '40abcd' | '50abcd' | 'bgd2025';
export type PaperMode = 'AUTO' | 'A5' | 'A4';
export type EffectivePaperSize = 'A5' | 'A4';
export type ScorePreset = 'standard' | 'even10' | 'even100' | 'custom';
export type Part2ScoringMode = 'progressive' | 'equal';

export interface SheetConfig {
  preset: PresetMode;
  part1Count: number;
  part2Count: number;
  part3Count: number;
  paperMode: PaperMode;
  paperSize: EffectivePaperSize;
  twoUpA4: boolean;
  codeDigits: 3 | 4;
  schoolName: string;
  examTitle: string;
  subjectName: string;
  duration: string;
}

export interface Part2AnswerItem {
  a?: 'Đ' | 'S' | '';
  b?: 'Đ' | 'S' | '';
  c?: 'Đ' | 'S' | '';
  d?: 'Đ' | 'S' | '';
}

export interface AnswerKey {
  part1: Record<number, string>;
  part2: Record<number, Part2AnswerItem>;
  part3: Record<number, string>;
}

export interface GradingConfig {
  selectedCode: string;
  answerKeys: Record<string, AnswerKey>;
  scorePreset: ScorePreset;
  ptsPart1: number;
  ptsPart2: number;
  ptsPart3: number;
  part2Mode: Part2ScoringMode;
  threshold: number;
  soundEnabled: boolean;
  geminiOcrEnabled: boolean;
}

export interface BubbleCoord {
  label: string;
  nx: number;
  ny: number;
  nr: number;
  px: number;
  py: number;
  pr: number;
}

export interface NormalizedBox {
  digitIndex?: number;
  nx: number;
  ny: number;
  nw: number;
  nh: number;
}

export type MetaDrawing =
  | {
      type: 'header';
      x: number;
      y: number;
      w: number;
      h: number;
      school: string;
      title: string;
      subject: string;
      duration: string;
    }
  | {
      type: 'codeHandwritingBox';
      x: number;
      y: number;
      w: number;
      h: number;
      cells: Array<{ x: number; y: number; w: number; h: number }>;
    }
  | {
      type: 'studentInfoLines';
      x: number;
      y: number;
      w: number;
      h: number;
      scoreBoxX: number;
      scoreBoxW: number;
    }
  | {
      type: 'markingGuide';
      x: number;
      y: number;
      w: number;
      h: number;
    }
  | {
      type: 'sectionBox';
      x: number;
      y: number;
      w: number;
      h: number;
      title: string;
      subtitle?: string;
    }
  | {
      type: 'columnHeader';
      x: number;
      y: number;
      w: number;
      h: number;
      qLabelX: number;
      optXs: number[];
      labels: string[];
    }
  | {
      type: 'columnDivider';
      x: number;
      y1: number;
      y2: number;
    }
  | {
      type: 'rowStripe';
      x: number;
      y: number;
      w: number;
      h: number;
    }
  | {
      type: 'subCard';
      x: number;
      y: number;
      w: number;
      h: number;
      title: string;
      subHeader?: { xTrue: number; xFalse: number; y: number };
      writeInCells?: Array<{ x: number; y: number; w: number; h: number }>;
    }
  | {
      type: 'qLabel';
      x: number;
      y: number;
      text: string;
    }
  | {
      type: 'subLabel';
      x: number;
      y: number;
      text: string;
    }
  | {
      type: 'signatureFooter';
      x: number;
      y: number;
      w: number;
      h: number;
    };

export interface SheetGeometry {
  W: number;
  H: number;
  isA5: boolean;
  isLandscapeA5?: boolean;
  scanLeft: number;
  scanTop: number;
  scanRight: number;
  scanBottom: number;
  scanW: number;
  scanH: number;
  markerSize: number;
  margin: number;
  codeDigits: number;
  codeBoxes: NormalizedBox[];
  codeCropBox: NormalizedBox;
  part1Bubbles: Array<{ qNum: number; options: BubbleCoord[] }>;
  part2Bubbles: Array<{
    qNum: number;
    subs: Array<{
      subLabel: 'a' | 'b' | 'c' | 'd';
      trueBubble: BubbleCoord;
      falseBubble: BubbleCoord;
    }>;
  }>;
  part3Bubbles: Array<{ qNum: number; cols: BubbleCoord[][] }>;
  metaDrawings: MetaDrawing[];
}

export interface DetectedBubblePoint {
  label: string;
  fill: number;
  px: number;
  py: number;
  pr: number;
}

export interface DetectedSheetData {
  part1: Array<{
    qNum: number;
    selected: DetectedBubblePoint[];
    allOptions: DetectedBubblePoint[];
  }>;
  part2: Array<{
    qNum: number;
    subs: Array<{
      subLabel: 'a' | 'b' | 'c' | 'd';
      picked: 'Đ' | 'S' | 'DUP' | '';
      trueBubble: { px: number; py: number; pr: number };
      falseBubble: { px: number; py: number; pr: number };
    }>;
  }>;
  part3: Array<{
    qNum: number;
    studentStr: string;
    colResults: Array<{
      picked: DetectedBubblePoint | null;
      colBubbles: DetectedBubblePoint[];
    }>;
  }>;
}

export interface OverlayMarker {
  type: 'correct' | 'wrong' | 'truth';
  px: number;
  py: number;
  pr: number;
}

export interface EvaluationResult {
  score: number;
  maxPossibleScore: number;
  correctCount: number;
  totalQuestions: number;
  wrongDetails: string[];
  overlays: OverlayMarker[];
}

export interface OcrResult {
  code: string;
  source: string;
  confidence: string;
  error?: string;
}

export interface GradeResultRecord {
  id: number;
  studentName: string;
  examCode: string;
  correctCount: number;
  totalQuestions: number;
  score: number;
  maxScore: number;
  wrongSummary: string;
  wrongDetails: string[];
  detectedData?: DetectedSheetData;
  previewDataUrl?: string | null;
}

export interface SampleFillData {
  examCode: string;
  part1: Record<number, string>;
  part2: Record<number, Part2AnswerItem>;
  part3: Record<number, string>;
}

export interface AppState {
  config: SheetConfig;
  grading: GradingConfig;
  results: GradeResultRecord[];
}
