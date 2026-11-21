import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Aperture,
  Camera,
  Check,
  CheckCircle2,
  Eye,
  FileSpreadsheet,
  Loader2,
  Plus,
  RefreshCcw,
  Search,
  Sparkles,
  SwitchCamera,
  Trash2,
  Upload,
  VideoOff,
  XCircle,
} from 'lucide-react';
import type {
  DetectedSheetData,
  GradeResultRecord,
  GradingConfig,
  OcrResult,
  Part2ScoringMode,
  ScorePreset,
  SheetConfig,
  SheetGeometry,
} from '../types/omr';
import {
  buildSheetGeometry,
  createRandomAnswerKey,
  cropExamCodeToCanvas,
  detectFourCornersFromImageData,
  evaluateStudentAnswers,
  generateSimulatedSampleCanvas,
  playBeepSound,
  recognizeExamCodeOffline,
  recognizeExamCodeViaServer,
  renderGradedOverlayCanvas,
  resolveEffectivePaperSize,
  scanBubblesFromCanvas,
} from '../utils/omrEngine';

interface GradingTabProps {
  sheetConfig: SheetConfig;
  gradingConfig: GradingConfig;
  results: GradeResultRecord[];
  activeGeometry: SheetGeometry | null;
  onChangeGrading: (updater: (prev: GradingConfig) => GradingConfig) => void;
  onAddResult: (record: GradeResultRecord) => void;
  onUpdateResult: (id: number, updater: (prev: GradeResultRecord) => GradeResultRecord) => void;
  onDeleteResult: (id: number) => void;
  onClearResults: () => void;
  onRecalculateAll: () => void;
  onExportCsv: () => void;
  onOpenReview: (record: GradeResultRecord) => void;
  onSwitchToDesign: () => void;
  onNotify: (msg: string) => void;
}

interface LastGradedContext {
  recordId: number;
  sourceCanvas: HTMLCanvasElement;
  detectedData: DetectedSheetData;
}

export const GradingTab: React.FC<GradingTabProps> = ({
  sheetConfig,
  gradingConfig,
  results,
  activeGeometry,
  onChangeGrading,
  onAddResult,
  onUpdateResult,
  onDeleteResult,
  onClearResults,
  onRecalculateAll,
  onExportCsv,
  onOpenReview,
  onSwitchToDesign,
  onNotify,
}) => {
  const [cameraActive, setCameraActive] = useState(false);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [autoCapture, setAutoCapture] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  const [latestRecord, setLatestRecord] = useState<GradeResultRecord | null>(null);
  const [latestOcr, setLatestOcr] = useState<OcrResult | null>(null);
  const [manualCodeInput, setManualCodeInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const gradedCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const croppedCodeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastGradedCtxRef = useRef<LastGradedContext | null>(null);

  const effectivePaper = resolveEffectivePaperSize(sheetConfig);
  const is2Up = effectivePaper === 'A5' && sheetConfig.twoUpA4;

  const examCodes = Object.keys(gradingConfig.answerKeys);
  const currentKey = gradingConfig.answerKeys[gradingConfig.selectedCode] || {
    part1: {},
    part2: {},
    part3: {},
  };

  const partsDesc = useMemo(() => {
    const arr: string[] = [];
    if (sheetConfig.part1Count > 0) arr.push(`${sheetConfig.part1Count} ABCD`);
    if (sheetConfig.part2Count > 0) arr.push(`${sheetConfig.part2Count} Đ/S`);
    if (sheetConfig.part3Count > 0) arr.push(`${sheetConfig.part3Count} TLN`);
    return arr.join(' + ') || '0 câu';
  }, [sheetConfig.part1Count, sheetConfig.part2Count, sheetConfig.part3Count]);

  // Part I quick string representation
  const part1FilledCount = useMemo(() => {
    let count = 0;
    for (let q = 1; q <= sheetConfig.part1Count; q++) {
      if (currentKey.part1[q]) count++;
    }
    return count;
  }, [currentKey.part1, sheetConfig.part1Count]);

  const part1QuickString = useMemo(() => {
    let str = '';
    for (let q = 1; q <= sheetConfig.part1Count; q++) {
      str += currentKey.part1[q] || '-';
    }
    return str.replace(/-+$/g, '');
  }, [currentKey.part1, sheetConfig.part1Count]);

  // Configured total score calculation
  const totalConfiguredScore = useMemo(() => {
    const total =
      sheetConfig.part1Count * (Number(gradingConfig.ptsPart1) || 0) +
      sheetConfig.part2Count * (Number(gradingConfig.ptsPart2) || 0) +
      sheetConfig.part3Count * (Number(gradingConfig.ptsPart3) || 0);
    return Math.round(total * 100) / 100;
  }, [
    sheetConfig.part1Count,
    sheetConfig.part2Count,
    sheetConfig.part3Count,
    gradingConfig.ptsPart1,
    gradingConfig.ptsPart2,
    gradingConfig.ptsPart3,
  ]);

  const showScoreWarning = useMemo(() => {
    if (totalConfiguredScore <= 0) return false;
    const isStandard10 = Math.abs(totalConfiguredScore - 10) < 0.01;
    const isStandard100 =
      gradingConfig.scorePreset === 'even100' && Math.abs(totalConfiguredScore - 100) < 0.05;
    return !isStandard10 && !isStandard100;
  }, [totalConfiguredScore, gradingConfig.scorePreset]);

  // Class summary stats
  const classStats = useMemo(() => {
    if (results.length === 0) return null;
    const scores = results.map((r) => Number(r.score) || 0);
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    const max = Math.max(...scores);
    const min = Math.min(...scores);
    return {
      count: results.length,
      avg: avg.toFixed(2),
      max: max.toFixed(2),
      min: min.toFixed(2),
    };
  }, [results]);

  const filteredResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return results;
    return results.filter(
      (r) =>
        r.studentName.toLowerCase().includes(q) ||
        r.examCode.toLowerCase().includes(q)
    );
  }, [results, searchQuery]);

  // Cleanup camera on unmount
  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
    setAutoCapture(false);
  }, []);

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  const startCamera = useCallback(
    async (mode: 'environment' | 'user') => {
      try {
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((t) => t.stop());
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: mode, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        streamRef.current = stream;
        setCameraActive(true);
        setTimeout(() => {
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
          }
        }, 40);
        onNotify('Camera đã sẵn sàng. Căn 4 ô vuông đen của phiếu khớp vào khung.');
      } catch {
        onNotify('Không thể mở Camera. Kiểm tra quyền truy cập camera của trình duyệt.');
      }
    },
    [onNotify]
  );

  const handleToggleCamera = () => {
    if (cameraActive) {
      stopCamera();
    } else {
      void startCamera(facingMode);
    }
  };

  const handleSwitchCamera = () => {
    const nextMode = facingMode === 'environment' ? 'user' : 'environment';
    setFacingMode(nextMode);
    if (cameraActive) {
      void startCamera(nextMode);
    }
  };

  // Core grading pipeline
  const processCanvasImage = useCallback(
    async (sourceCanvas: HTMLCanvasElement, labelPrefix: string, overrideGrading?: GradingConfig) => {
      const gCfg = overrideGrading || gradingConfig;
      setIsProcessing(true);
      try {
        const w = sourceCanvas.width;
        const h = sourceCanvas.height;
        const ctx = sourceCanvas.getContext('2d');
        if (!ctx) return;

        const imgData = ctx.getImageData(0, 0, w, h);
        const geo = activeGeometry || buildSheetGeometry(sheetConfig);
        const corners = detectFourCornersFromImageData(imgData, w, h, geo);

        const fallbackCode =
          gCfg.selectedCode || Object.keys(gCfg.answerKeys)[0] || '101';

        // Crop handwritten exam code box
        let croppedDataUrl = '';
        if (croppedCodeCanvasRef.current) {
          croppedDataUrl = cropExamCodeToCanvas(
            sourceCanvas,
            croppedCodeCanvasRef.current,
            geo,
            corners
          );
        }

        // Recognize exam code via Server-Side Gemini AI OR local offline ink heuristic
        let ocrRes: OcrResult;
        if (gCfg.geminiOcrEnabled && croppedDataUrl) {
          ocrRes = await recognizeExamCodeViaServer(
            croppedDataUrl,
            geo.codeBoxes.length,
            fallbackCode
          );
          if (ocrRes.error) {
            onNotify(ocrRes.error);
          }
        } else {
          ocrRes = recognizeExamCodeOffline(sourceCanvas, geo, corners, fallbackCode);
        }

        const detectedData = scanBubblesFromCanvas(
          sourceCanvas,
          geo,
          corners,
          gCfg.threshold
        );

        const evalRes = evaluateStudentAnswers(
          detectedData,
          ocrRes.code,
          sheetConfig,
          gCfg
        );

        const scoreStr = `${evalRes.score.toFixed(2)}/${evalRes.maxPossibleScore.toFixed(2)}`;
        let previewDataUrl = '';
        if (gradedCanvasRef.current) {
          previewDataUrl = renderGradedOverlayCanvas(
            gradedCanvasRef.current,
            sourceCanvas,
            evalRes.overlays,
            ocrRes.code,
            scoreStr
          );
        }

        const recordId = Date.now() + Math.floor(Math.random() * 1000);
        const record: GradeResultRecord = {
          id: recordId,
          studentName: `${labelPrefix} #${results.length + 1}`,
          examCode: ocrRes.code,
          correctCount: evalRes.correctCount,
          totalQuestions: evalRes.totalQuestions,
          score: evalRes.score,
          maxScore: evalRes.maxPossibleScore,
          wrongSummary:
            evalRes.wrongDetails.length > 0
              ? evalRes.wrongDetails.slice(0, 6).join(', ') +
                (evalRes.wrongDetails.length > 6 ? '...' : '')
              : 'Chính xác tuyệt đối',
          wrongDetails: evalRes.wrongDetails,
          detectedData,
          previewDataUrl,
        };

        lastGradedCtxRef.current = {
          recordId,
          sourceCanvas,
          detectedData,
        };

        setLatestRecord(record);
        setLatestOcr(ocrRes);
        setManualCodeInput(record.examCode);
        onAddResult(record);
        playBeepSound(gCfg.soundEnabled);
      } finally {
        setIsProcessing(false);
      }
    },
    [activeGeometry, gradingConfig, onAddResult, onNotify, results.length, sheetConfig]
  );

  const handleCaptureCamera = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || isProcessing) return;
    const capCanvas = document.createElement('canvas');
    capCanvas.width = video.videoWidth;
    capCanvas.height = video.videoHeight;
    const ctx = capCanvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    await processCanvasImage(capCanvas, 'Camera');
  }, [isProcessing, processCanvasImage]);

  // Auto capture timer
  useEffect(() => {
    if (!cameraActive || !autoCapture) return;
    const timer = window.setInterval(() => {
      void handleCaptureCamera();
    }, 2500);
    return () => window.clearInterval(timer);
  }, [cameraActive, autoCapture, handleCaptureCamera]);

  const handleBatchUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    onNotify(`Đang xử lý ${files.length} ảnh phiếu...`);
    for (const file of files) {
      await new Promise<void>((resolve) => {
        const img = new Image();
        img.onload = async () => {
          const c = document.createElement('canvas');
          c.width = img.width;
          c.height = img.height;
          c.getContext('2d')?.drawImage(img, 0, 0);
          const baseName = file.name.replace(/\.[^/.]+$/, '');
          await processCanvasImage(c, baseName);
          URL.revokeObjectURL(img.src);
          resolve();
        };
        img.onerror = () => resolve();
        img.src = URL.createObjectURL(file);
      });
    }
    e.target.value = '';
    onNotify(`Hoàn tất chấm ${files.length} phiếu.`);
  };

  const handleSimulatedSample = async () => {
    let activeKey = currentKey;
    let effectiveGrading = gradingConfig;

    const hasAnyKey =
      Object.values(activeKey.part1).some(Boolean) ||
      Object.keys(activeKey.part2).length > 0 ||
      Object.values(activeKey.part3).some(Boolean);

    if (!hasAnyKey) {
      const randomKey = createRandomAnswerKey(sheetConfig);
      activeKey = randomKey;
      effectiveGrading = {
        ...gradingConfig,
        answerKeys: {
          ...gradingConfig.answerKeys,
          [gradingConfig.selectedCode]: randomKey,
        },
      };
      onChangeGrading(() => effectiveGrading);
      onNotify(`Đã tạo nhanh đáp án mẫu cho Mã đề ${gradingConfig.selectedCode}.`);
    }

    const simCanvas = generateSimulatedSampleCanvas(
      sheetConfig,
      activeKey,
      effectiveGrading.selectedCode
    );
    await processCanvasImage(simCanvas, 'Phiếu mẫu', effectiveGrading);
  };

  const handleApplyManualCode = () => {
    const newCode = manualCodeInput.trim();
    if (!newCode) {
      onNotify('Vui lòng nhập Mã đề hợp lệ.');
      return;
    }
    const ctxObj = lastGradedCtxRef.current;
    if (!ctxObj) {
      onNotify('Chưa có bài chấm nào để cập nhật.');
      return;
    }

    const evalRes = evaluateStudentAnswers(
      ctxObj.detectedData,
      newCode,
      sheetConfig,
      gradingConfig
    );
    const scoreStr = `${evalRes.score.toFixed(2)}/${evalRes.maxPossibleScore.toFixed(2)}`;
    let newPreview = '';
    if (gradedCanvasRef.current) {
      newPreview = renderGradedOverlayCanvas(
        gradedCanvasRef.current,
        ctxObj.sourceCanvas,
        evalRes.overlays,
        newCode,
        scoreStr
      );
    }

    const wrongSummary =
      evalRes.wrongDetails.length > 0
        ? evalRes.wrongDetails.slice(0, 6).join(', ') +
          (evalRes.wrongDetails.length > 6 ? '...' : '')
        : 'Chính xác tuyệt đối';

    onUpdateResult(ctxObj.recordId, (prev) => ({
      ...prev,
      examCode: newCode,
      score: evalRes.score,
      maxScore: evalRes.maxPossibleScore,
      correctCount: evalRes.correctCount,
      wrongSummary,
      wrongDetails: evalRes.wrongDetails,
      previewDataUrl: newPreview || prev.previewDataUrl,
    }));

    setLatestRecord((prev) =>
      prev
        ? {
            ...prev,
            examCode: newCode,
            score: evalRes.score,
            maxScore: evalRes.maxPossibleScore,
            correctCount: evalRes.correctCount,
            wrongSummary,
            wrongDetails: evalRes.wrongDetails,
            previewDataUrl: newPreview || prev.previewDataUrl,
          }
        : null
    );
    setLatestOcr({ code: newCode, source: 'Sửa tay', confidence: 'Xác nhận' });
    onNotify(`Đã cập nhật sang Mã đề ${newCode} và tính lại điểm.`);
  };

  // Answer Key editing helpers
  const handleAddExamCode = () => {
    const digits = sheetConfig.codeDigits || 3;
    let nextNum = digits === 4 ? 1001 : 101;
    while (examCodes.includes(String(nextNum))) nextNum++;
    const newCode = String(nextNum);
    onChangeGrading((prev) => ({
      ...prev,
      selectedCode: newCode,
      answerKeys: {
        ...prev.answerKeys,
        [newCode]: { part1: {}, part2: {}, part3: {} },
      },
    }));
    onNotify(`Đã thêm Mã đề ${newCode}.`);
  };

  const handleDeleteExamCode = () => {
    if (examCodes.length <= 1) {
      onNotify('Cần giữ lại ít nhất 1 Mã đề.');
      return;
    }
    const target = gradingConfig.selectedCode;
    onChangeGrading((prev) => {
      const nextKeys = { ...prev.answerKeys };
      delete nextKeys[target];
      return {
        ...prev,
        selectedCode: Object.keys(nextKeys)[0],
        answerKeys: nextKeys,
      };
    });
    onNotify(`Đã xóa Mã đề ${target}.`);
  };

  const handleGenerateRandomKey = () => {
    const generated = createRandomAnswerKey(sheetConfig);
    onChangeGrading((prev) => ({
      ...prev,
      answerKeys: {
        ...prev.answerKeys,
        [prev.selectedCode]: generated,
      },
    }));
    onNotify(`Đã tạo đáp án mẫu cho Mã đề ${gradingConfig.selectedCode}.`);
  };

  const handleQuickStringChange = (raw: string) => {
    const clean = raw.toUpperCase().replace(/[^ABCD-]/g, '');
    onChangeGrading((prev) => {
      const existing = prev.answerKeys[prev.selectedCode] || { part1: {}, part2: {}, part3: {} };
      const nextP1: Record<number, string> = {};
      for (let q = 1; q <= sheetConfig.part1Count; q++) {
        const ch = clean[q - 1];
        nextP1[q] = ch && 'ABCD'.includes(ch) ? ch : '';
      }
      return {
        ...prev,
        answerKeys: {
          ...prev.answerKeys,
          [prev.selectedCode]: { ...existing, part1: nextP1 },
        },
      };
    });
  };

  const handleTogglePart1 = (q: number, ch: string) => {
    onChangeGrading((prev) => {
      const existing = prev.answerKeys[prev.selectedCode] || { part1: {}, part2: {}, part3: {} };
      const cur = existing.part1[q] || '';
      return {
        ...prev,
        answerKeys: {
          ...prev.answerKeys,
          [prev.selectedCode]: {
            ...existing,
            part1: { ...existing.part1, [q]: cur === ch ? '' : ch },
          },
        },
      };
    });
  };

  const handleTogglePart2 = (q: number, sub: 'a' | 'b' | 'c' | 'd', val: 'Đ' | 'S') => {
    onChangeGrading((prev) => {
      const existing = prev.answerKeys[prev.selectedCode] || { part1: {}, part2: {}, part3: {} };
      const curQ = existing.part2[q] || {};
      const nextVal = curQ[sub] === val ? '' : val;
      return {
        ...prev,
        answerKeys: {
          ...prev.answerKeys,
          [prev.selectedCode]: {
            ...existing,
            part2: {
              ...existing.part2,
              [q]: { ...curQ, [sub]: nextVal },
            },
          },
        },
      };
    });
  };

  const handleChangePart3 = (q: number, raw: string) => {
    const clean = raw.trim().replace('.', ',').slice(0, 4);
    onChangeGrading((prev) => {
      const existing = prev.answerKeys[prev.selectedCode] || { part1: {}, part2: {}, part3: {} };
      return {
        ...prev,
        answerKeys: {
          ...prev.answerKeys,
          [prev.selectedCode]: {
            ...existing,
            part3: { ...existing.part3, [q]: clean },
          },
        },
      };
    });
  };

  const handleScorePresetChange = (mode: ScorePreset) => {
    const totalQ =
      sheetConfig.part1Count + sheetConfig.part2Count + sheetConfig.part3Count;
    onChangeGrading((prev) => {
      if (mode === 'standard') {
        return { ...prev, scorePreset: mode, ptsPart1: 0.25, ptsPart2: 1.0, ptsPart3: 0.5 };
      }
      if (mode === 'even10') {
        const perQ = totalQ > 0 ? +(10 / totalQ).toFixed(4) : 0;
        return { ...prev, scorePreset: mode, ptsPart1: perQ, ptsPart2: perQ, ptsPart3: perQ };
      }
      if (mode === 'even100') {
        const perQ = totalQ > 0 ? +(100 / totalQ).toFixed(4) : 0;
        return { ...prev, scorePreset: mode, ptsPart1: perQ, ptsPart2: perQ, ptsPart3: perQ };
      }
      return { ...prev, scorePreset: mode };
    });
    onNotify('Đã cập nhật cấu hình thang điểm.');
  };

  return (
    <div className="flex-1 flex flex-col lg:flex-row lg:overflow-hidden">
      {/* Left Sidebar: Answer Keys, Scoring Scale & Sensitivity */}
      <aside className="w-full lg:w-[390px] xl:w-[420px] shrink-0 bg-white border-b lg:border-b-0 lg:border-r border-slate-200 flex flex-col lg:h-full">
        <div className="p-5 overflow-y-auto custom-scrollbar flex-1 space-y-6">
          {/* Synced Structure Summary */}
          <div className="flex items-center justify-between gap-3 pb-4 border-b border-slate-200">
            <div className="min-w-0">
              <div className="text-xs text-slate-500">Cấu trúc đang áp dụng</div>
              <div className="text-sm font-semibold text-slate-900 truncate mt-0.5">
                {partsDesc} · {is2Up ? '2×A5 trên A4 dọc' : `Khổ ${effectivePaper}`}
              </div>
            </div>
            <button
              type="button"
              onClick={onSwitchToDesign}
              className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              Đổi cấu trúc
            </button>
          </div>

          {/* 1. Exam Code & Answer Keys */}
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-900">
                Mã đề & Đáp án chuẩn
              </h2>
              <button
                type="button"
                onClick={handleGenerateRandomKey}
                className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 hover:underline cursor-pointer whitespace-nowrap"
              >
                + Tạo đáp án mẫu
              </button>
            </div>

            <div className="flex items-center gap-2">
              <select
                aria-label="Chọn mã đề"
                value={gradingConfig.selectedCode}
                onChange={(e) =>
                  onChangeGrading((prev) => ({ ...prev, selectedCode: e.target.value }))
                }
                className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold font-mono-data text-[#1e3a8a] focus:border-[#1e3a8a] focus:outline-none"
              >
                {examCodes.map((code) => (
                  <option key={code} value={code}>
                    Mã đề: {code}
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={handleAddExamCode}
                className="px-3 py-2 rounded-lg bg-[#1e3a8a] hover:bg-blue-900 text-white text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Mã đề</span>
              </button>

              <button
                type="button"
                onClick={handleDeleteExamCode}
                title="Xóa mã đề đang chọn"
                aria-label="Xóa mã đề đang chọn"
                className="p-2 rounded-lg border border-slate-300 hover:bg-red-50 hover:text-red-600 hover:border-red-200 text-slate-500 transition-colors cursor-pointer shrink-0"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>

            {/* Part I Editor */}
            {sheetConfig.part1Count > 0 && (
              <div className="space-y-2.5 pt-1">
                <div className="flex items-baseline justify-between">
                  <label
                    htmlFor="quickKeyStringInput"
                    className="text-xs font-medium text-slate-700"
                  >
                    Phần I: Chuỗi đáp án nhanh (A, B, C, D)
                  </label>
                  <span className="text-xs font-mono-data text-slate-500">
                    {part1FilledCount}/{sheetConfig.part1Count}
                  </span>
                </div>

                <input
                  id="quickKeyStringInput"
                  type="text"
                  value={part1QuickString}
                  onChange={(e) => handleQuickStringChange(e.target.value)}
                  placeholder="Ví dụ: ABCDABCD..."
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono-data uppercase tracking-widest text-slate-900 focus:border-[#1e3a8a] focus:outline-none"
                />

                <div className="max-h-52 overflow-y-auto custom-scrollbar border border-slate-200 rounded-lg p-2 bg-slate-50 grid grid-cols-2 gap-1.5">
                  {Array.from({ length: sheetConfig.part1Count }, (_, idx) => {
                    const q = idx + 1;
                    const ans = currentKey.part1[q] || '';
                    return (
                      <div
                        key={q}
                        className="flex items-center justify-between bg-white px-2 py-1 rounded border border-slate-200"
                      >
                        <span className="font-mono-data text-xs font-semibold text-slate-600">
                          {String(q).padStart(2, '0')}
                        </span>
                        <div className="flex items-center gap-1">
                          {(['A', 'B', 'C', 'D'] as const).map((ch) => (
                            <button
                              key={ch}
                              type="button"
                              onClick={() => handleTogglePart1(q, ch)}
                              className={`w-6 h-6 rounded text-[11px] font-semibold transition-colors cursor-pointer ${
                                ans === ch
                                  ? 'bg-[#1e3a8a] text-white'
                                  : 'bg-slate-50 border border-slate-200 text-slate-600 hover:bg-blue-50'
                              }`}
                            >
                              {ch}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Part II Editor */}
            {sheetConfig.part2Count > 0 && (
              <div className="space-y-2 pt-2">
                <div className="text-xs font-medium text-slate-700">
                  Phần II: Đáp án Đúng / Sai
                </div>
                <div className="space-y-2 border border-slate-200 rounded-lg p-2.5 bg-slate-50">
                  {Array.from({ length: sheetConfig.part2Count }, (_, idx) => {
                    const q = idx + 1;
                    const qVal = currentKey.part2[q] || {};
                    return (
                      <div key={q} className="space-y-1">
                        <div className="text-xs font-semibold text-slate-800">Câu {q}</div>
                        <div className="grid grid-cols-4 gap-1">
                          {(['a', 'b', 'c', 'd'] as const).map((sub) => {
                            const val = qVal[sub] || '';
                            return (
                              <div
                                key={sub}
                                className="flex items-center justify-between gap-0.5 bg-white px-1.5 py-1 rounded border border-slate-200"
                              >
                                <span className="text-[11px] font-medium text-slate-600">
                                  {sub})
                                </span>
                                <div className="flex items-center gap-0.5">
                                  <button
                                    type="button"
                                    onClick={() => handleTogglePart2(q, sub, 'Đ')}
                                    className={`px-1.5 py-0.5 rounded text-[10px] font-semibold cursor-pointer ${
                                      val === 'Đ'
                                        ? 'bg-emerald-600 text-white'
                                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                    }`}
                                  >
                                    Đ
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleTogglePart2(q, sub, 'S')}
                                    className={`px-1.5 py-0.5 rounded text-[10px] font-semibold cursor-pointer ${
                                      val === 'S'
                                        ? 'bg-red-600 text-white'
                                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                    }`}
                                  >
                                    S
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Part III Editor */}
            {sheetConfig.part3Count > 0 && (
              <div className="space-y-2 pt-2">
                <div className="text-xs font-medium text-slate-700">
                  Phần III: Đáp án Trả lời ngắn (tối đa 4 ký tự: số, -, ,)
                </div>
                <div className="grid grid-cols-2 gap-2 border border-slate-200 rounded-lg p-2.5 bg-slate-50">
                  {Array.from({ length: sheetConfig.part3Count }, (_, idx) => {
                    const q = idx + 1;
                    return (
                      <div
                        key={q}
                        className="flex items-center justify-between gap-2 bg-white px-2 py-1.5 rounded border border-slate-200"
                      >
                        <span className="text-xs font-medium text-slate-700 shrink-0">
                          Câu {q}
                        </span>
                        <input
                          type="text"
                          maxLength={4}
                          value={currentKey.part3[q] || ''}
                          onChange={(e) => handleChangePart3(q, e.target.value)}
                          placeholder="-2,5"
                          className="w-full rounded border border-slate-300 px-2 py-1 text-right font-mono-data font-semibold text-xs text-[#1e3a8a] focus:border-[#1e3a8a] focus:outline-none"
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <hr className="border-slate-200" />

          {/* 2. Scoring Scale Configuration */}
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-900">
                Cấu hình Thang điểm
              </h2>
              <button
                type="button"
                onClick={() => handleScorePresetChange('even10')}
                className="text-xs font-semibold text-[#1e3a8a] hover:underline cursor-pointer whitespace-nowrap"
              >
                Tự chia đều 10đ
              </button>
            </div>

            <div>
              <label
                htmlFor="scorePresetSelect"
                className="block text-xs font-medium text-slate-600 mb-1"
              >
                Chế độ tính điểm
              </label>
              <select
                id="scorePresetSelect"
                value={gradingConfig.scorePreset}
                onChange={(e) => handleScorePresetChange(e.target.value as ScorePreset)}
                className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs sm:text-sm font-medium text-slate-800 focus:border-[#1e3a8a] focus:outline-none"
              >
                <option value="standard">Chuẩn từng phần (0.25 / 1.0 / 0.5)</option>
                <option value="even10">Chia đều Thang 10 cho tổng số câu</option>
                <option value="even100">Chia đều Thang 100 cho tổng số câu</option>
                <option value="custom">Tùy chỉnh điểm số từng phần</option>
              </select>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div>
                <label
                  htmlFor="ptsPart1Input"
                  className="block text-[11px] font-medium text-slate-600 mb-1"
                >
                  Điểm P.I
                </label>
                <input
                  id="ptsPart1Input"
                  type="number"
                  step="0.05"
                  min={0}
                  value={gradingConfig.ptsPart1}
                  onChange={(e) =>
                    onChangeGrading((prev) => ({
                      ...prev,
                      scorePreset: 'custom',
                      ptsPart1: Math.max(0, parseFloat(e.target.value) || 0),
                    }))
                  }
                  className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs font-mono-data font-semibold text-center text-[#1e3a8a] focus:border-[#1e3a8a] focus:outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="ptsPart2Input"
                  className="block text-[11px] font-medium text-slate-600 mb-1"
                >
                  Điểm P.II
                </label>
                <input
                  id="ptsPart2Input"
                  type="number"
                  step="0.05"
                  min={0}
                  value={gradingConfig.ptsPart2}
                  onChange={(e) =>
                    onChangeGrading((prev) => ({
                      ...prev,
                      scorePreset: 'custom',
                      ptsPart2: Math.max(0, parseFloat(e.target.value) || 0),
                    }))
                  }
                  className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs font-mono-data font-semibold text-center text-emerald-700 focus:border-[#1e3a8a] focus:outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="ptsPart3Input"
                  className="block text-[11px] font-medium text-slate-600 mb-1"
                >
                  Điểm P.III
                </label>
                <input
                  id="ptsPart3Input"
                  type="number"
                  step="0.05"
                  min={0}
                  value={gradingConfig.ptsPart3}
                  onChange={(e) =>
                    onChangeGrading((prev) => ({
                      ...prev,
                      scorePreset: 'custom',
                      ptsPart3: Math.max(0, parseFloat(e.target.value) || 0),
                    }))
                  }
                  className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs font-mono-data font-semibold text-center text-amber-700 focus:border-[#1e3a8a] focus:outline-none"
                />
              </div>
            </div>

            {sheetConfig.part2Count > 0 && (
              <div>
                <label
                  htmlFor="part2ModeSelect"
                  className="block text-xs font-medium text-slate-600 mb-1"
                >
                  Cách tính điểm Phần II (4 ý Đ/S)
                </label>
                <select
                  id="part2ModeSelect"
                  value={gradingConfig.part2Mode}
                  onChange={(e) =>
                    onChangeGrading((prev) => ({
                      ...prev,
                      part2Mode: e.target.value as Part2ScoringMode,
                    }))
                  }
                  className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs font-medium text-slate-800 focus:border-[#1e3a8a] focus:outline-none"
                >
                  <option value="progressive">Lũy tiến chuẩn BGD (10% - 25% - 50% - 100%)</option>
                  <option value="equal">Chia đều từng ý đúng (25% / ý)</option>
                </select>
              </div>
            )}

            <div className="flex items-center justify-between py-2 border-y border-slate-200">
              <span className="text-xs font-medium text-slate-600">Tổng điểm cấu hình</span>
              <span
                className={`text-sm font-mono-data font-bold ${
                  showScoreWarning ? 'text-amber-700' : 'text-[#1e3a8a]'
                }`}
              >
                {totalConfiguredScore.toFixed(2)} điểm
              </span>
            </div>

            {showScoreWarning && (
              <div className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <span>
                  Tổng điểm cấu hình hiện là {totalConfiguredScore.toFixed(2)}đ (khác thang 10.00đ).
                </span>
              </div>
            )}

            <button
              type="button"
              onClick={onRecalculateAll}
              className="w-full py-2 px-3 rounded-lg bg-white hover:bg-slate-50 text-[#1e3a8a] border border-slate-300 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
            >
              <RefreshCcw className="w-3.5 h-3.5" />
              <span>Tính lại bảng điểm theo thang mới</span>
            </button>
          </div>

          <hr className="border-slate-200" />

          {/* 3. OMR Sensitivity & OCR Mode */}
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-slate-900">
              Độ nhạy OMR & Nhận diện Mã đề
            </h2>

            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
              <button
                type="button"
                onClick={() =>
                  onChangeGrading((prev) => ({ ...prev, geminiOcrEnabled: true }))
                }
                className={`flex-1 py-1.5 px-2.5 rounded-md text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                  gradingConfig.geminiOcrEnabled
                    ? 'bg-white text-[#1e3a8a] shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Gemini AI OCR
              </button>
              <button
                type="button"
                onClick={() =>
                  onChangeGrading((prev) => ({ ...prev, geminiOcrEnabled: false }))
                }
                className={`flex-1 py-1.5 px-2.5 rounded-md text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                  !gradingConfig.geminiOcrEnabled
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Offline (Nét mực)
              </button>
            </div>

            <div>
              <div className="flex items-center justify-between text-xs font-medium text-slate-700 mb-1.5">
                <label htmlFor="thresholdSlider">Ngưỡng đậm tô chì</label>
                <span className="font-mono-data font-semibold text-[#1e3a8a]">
                  {gradingConfig.threshold}%
                </span>
              </div>
              <input
                id="thresholdSlider"
                type="range"
                min={20}
                max={80}
                value={gradingConfig.threshold}
                onChange={(e) =>
                  onChangeGrading((prev) => ({
                    ...prev,
                    threshold: parseInt(e.target.value, 10) || 45,
                  }))
                }
                className="w-full accent-[#1e3a8a] cursor-pointer"
              />
            </div>

            <label className="flex items-center justify-between cursor-pointer select-none pt-1">
              <span className="text-xs font-medium text-slate-700">
                Phát tiếng &ldquo;Tít&rdquo; khi chấm xong
              </span>
              <input
                type="checkbox"
                checked={gradingConfig.soundEnabled}
                onChange={(e) =>
                  onChangeGrading((prev) => ({ ...prev, soundEnabled: e.target.checked }))
                }
                className="w-4 h-4 rounded accent-[#1e3a8a] cursor-pointer"
              />
            </label>
          </div>
        </div>
      </aside>

      {/* Right Main Grading Workspace */}
      <main className="flex-1 bg-slate-50 overflow-y-auto custom-scrollbar p-5 sm:p-6 space-y-6">
        {/* Source Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-200">
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={handleToggleCamera}
              className={`px-4 py-2.5 rounded-lg text-xs sm:text-sm font-semibold flex items-center gap-2 transition-colors cursor-pointer whitespace-nowrap ${
                cameraActive
                  ? 'bg-red-600 hover:bg-red-700 text-white'
                  : 'bg-[#1e3a8a] hover:bg-blue-900 text-white'
              }`}
            >
              {cameraActive ? (
                <>
                  <VideoOff className="w-4 h-4 shrink-0" />
                  <span>Tắt Camera</span>
                </>
              ) : (
                <>
                  <Camera className="w-4 h-4 shrink-0" />
                  <span>Bật Camera trực tiếp</span>
                </>
              )}
            </button>

            <label className="px-4 py-2.5 rounded-lg bg-white hover:bg-slate-100 text-slate-800 border border-slate-300 text-xs sm:text-sm font-semibold flex items-center gap-2 transition-colors cursor-pointer whitespace-nowrap">
              <Upload className="w-4 h-4 shrink-0 text-slate-600" />
              <span>Tải ảnh phiếu (1 hoặc nhiều ảnh)</span>
              <input
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={handleBatchUpload}
              />
            </label>
          </div>

          <button
            type="button"
            disabled={isProcessing}
            onClick={() => void handleSimulatedSample()}
            className="px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-xs sm:text-sm font-semibold flex items-center gap-2 transition-colors cursor-pointer whitespace-nowrap"
          >
            {isProcessing ? (
              <Loader2 className="w-4 h-4 animate-spin shrink-0" />
            ) : (
              <Sparkles className="w-4 h-4 shrink-0" />
            )}
            <span>Chấm thử phiếu mẫu</span>
          </button>
        </div>

        {/* Live Camera Panel */}
        {cameraActive && (
          <div className="bg-slate-950 rounded-xl overflow-hidden border border-slate-800">
            <div className="relative w-full max-h-[500px] flex items-center justify-center bg-black overflow-hidden">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full max-h-[500px] object-contain"
              />

              {/* 4-corner alignment reticle */}
              <div className="absolute inset-0 pointer-events-none flex items-center justify-center p-6">
                <div className="relative w-[70%] max-w-[350px] aspect-[1/1.414] border border-dashed border-emerald-400/80 rounded">
                  <div className="absolute -top-1.5 -left-1.5 w-7 h-7 border-t-4 border-l-4 border-emerald-400" />
                  <div className="absolute -top-1.5 -right-1.5 w-7 h-7 border-t-4 border-r-4 border-emerald-400" />
                  <div className="absolute -bottom-1.5 -left-1.5 w-7 h-7 border-b-4 border-l-4 border-emerald-400" />
                  <div className="absolute -bottom-1.5 -right-1.5 w-7 h-7 border-b-4 border-r-4 border-emerald-400" />
                  <div className="absolute top-2.5 inset-x-0 text-center">
                    <span className="px-2.5 py-1 rounded bg-black/75 text-emerald-300 text-xs font-medium">
                      Căn 4 ô vuông đen của phiếu khớp vào 4 góc xanh
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="p-3.5 bg-slate-900 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-4">
                <button
                  type="button"
                  onClick={handleSwitchCamera}
                  className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                >
                  <SwitchCamera className="w-4 h-4" />
                  <span>Đổi Camera</span>
                </button>

                <label className="inline-flex items-center gap-2 text-xs text-slate-200 font-medium cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={autoCapture}
                    onChange={(e) => setAutoCapture(e.target.checked)}
                    className="w-4 h-4 rounded accent-emerald-500"
                  />
                  <span>Tự động chụp mỗi 2.5 giây</span>
                </label>
              </div>

              <button
                type="button"
                disabled={isProcessing}
                onClick={() => void handleCaptureCamera()}
                className="px-5 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white text-sm font-semibold flex items-center gap-2 cursor-pointer whitespace-nowrap"
              >
                {isProcessing ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Aperture className="w-4 h-4" />
                )}
                <span>Chụp &amp; Chấm ngay</span>
              </button>
            </div>
          </div>
        )}

        {/* Latest Graded Paper Visual Inspection */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-stretch">
          {/* Annotated Result Canvas */}
          <div className="xl:col-span-7 bg-white p-4 rounded-xl border border-slate-200 flex flex-col">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <h3 className="text-sm font-semibold text-slate-900">
                Ảnh phiếu đã nhận diện &amp; chấm
              </h3>
              <div className="flex items-center gap-3 text-xs font-medium">
                <span className="inline-flex items-center gap-1 text-emerald-700">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Đúng
                </span>
                <span className="inline-flex items-center gap-1 text-red-600">
                  <XCircle className="w-3.5 h-3.5" /> Tô sai
                </span>
                <span className="inline-flex items-center gap-1 text-blue-700">
                  <span className="w-3 h-3 rounded-full border-2 border-blue-600 inline-block" /> Đáp án đúng
                </span>
              </div>
            </div>

            <div className="flex-1 bg-slate-100 rounded-lg border border-slate-200 flex items-center justify-center min-h-[340px] p-2.5 overflow-hidden relative">
              <canvas
                ref={gradedCanvasRef}
                className={`max-w-full max-h-[470px] rounded bg-white shadow-xs ${
                  latestRecord ? 'block' : 'hidden'
                }`}
              />
              {!latestRecord && (
                <div className="text-center max-w-xs space-y-2 py-8">
                  <p className="text-sm font-medium text-slate-700">
                    Chưa có ảnh phiếu được chấm
                  </p>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    Bật Camera, tải ảnh phiếu làm bài hoặc nhấn &ldquo;Chấm thử phiếu mẫu&rdquo; để xem kết quả khoanh vùng trực quan.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Latest Score & Handwritten Exam Code Verification */}
          <div className="xl:col-span-5 bg-white p-5 rounded-xl border border-slate-200 flex flex-col justify-between space-y-5">
            <div className="space-y-5">
              {/* Score Display */}
              <div className="pb-4 border-b border-slate-200">
                <div className="text-xs font-medium text-slate-500">
                  Kết quả bài vừa chấm
                </div>
                <div className="flex items-baseline gap-2.5 mt-1">
                  <span className="text-4xl font-bold font-mono-data tracking-tight text-[#1e3a8a]">
                    {latestRecord ? latestRecord.score.toFixed(2) : '--'}
                  </span>
                  {latestRecord && (
                    <span className="text-sm font-mono-data text-slate-500">
                      / {latestRecord.maxScore.toFixed(2)} điểm
                    </span>
                  )}
                </div>
                <div className="text-xs text-slate-600 mt-1.5 font-mono-data">
                  {latestRecord
                    ? `Đúng ${latestRecord.correctCount}/${latestRecord.totalQuestions} câu · Mã đề ${latestRecord.examCode}`
                    : 'Sẵn sàng nhận diện phiếu OMR'}
                </div>
              </div>

              {/* Handwritten Exam Code Crop + 1-Tap Override */}
              <div className="space-y-2.5 pb-4 border-b border-slate-200">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-800">
                    Mã đề viết tay (Bút mực)
                  </span>
                  <span className="text-xs text-slate-500">
                    {latestOcr
                      ? `${latestOcr.source} · ${latestOcr.confidence}`
                      : 'Chờ quét'}
                  </span>
                </div>

                {latestOcr?.error && (
                  <div className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                    <span>{latestOcr.error}</span>
                  </div>
                )}

                <div className="flex items-center gap-2.5">
                  <div className="h-12 w-32 rounded-lg border border-slate-300 bg-slate-50 flex items-center justify-center overflow-hidden shrink-0">
                    <canvas
                      ref={croppedCodeCanvasRef}
                      width={240}
                      height={88}
                      className="max-w-full max-h-full object-contain"
                    />
                  </div>

                  <div className="flex-1 flex items-center gap-1.5">
                    <input
                      type="text"
                      maxLength={4}
                      value={manualCodeInput}
                      onChange={(e) => setManualCodeInput(e.target.value)}
                      placeholder="Mã đề"
                      aria-label="Sửa mã đề thủ công"
                      className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm font-mono-data font-bold text-center text-[#1e3a8a] focus:border-[#1e3a8a] focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={handleApplyManualCode}
                      className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shrink-0 cursor-pointer whitespace-nowrap"
                    >
                      Áp dụng
                    </button>
                  </div>
                </div>

                <p className="text-xs text-slate-500 leading-relaxed">
                  Nếu chữ viết tay khó đọc, nhập lại Mã đề vào ô trên rồi bấm Áp dụng để chấm lại ngay.
                </p>
              </div>

              {/* Per-question Breakdown */}
              <div className="space-y-1.5">
                <div className="text-xs font-semibold text-slate-800">
                  Chi tiết nhận diện
                  {latestRecord ? ` · ${latestRecord.studentName}` : ''}
                </div>
                {latestRecord ? (
                  latestRecord.wrongDetails.length === 0 ? (
                    <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                      <Check className="w-4 h-4 shrink-0" />
                      <span>Chính xác tuyệt đối, không có câu sai hoặc tô đúp.</span>
                    </div>
                  ) : (
                    <p className="text-xs text-slate-600 leading-relaxed font-mono-data break-words">
                      <span className="font-sans font-semibold text-red-600">
                        Câu sai / cần lưu ý:{' '}
                      </span>
                      {latestRecord.wrongDetails.join('; ')}
                    </p>
                  )
                ) : (
                  <p className="text-xs text-slate-500 leading-relaxed">
                    Phân tích chi tiết từng câu sai, tô đúp hoặc bỏ trống sẽ hiển thị tại đây ngay sau khi chấm.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Graded Results Table */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="p-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-0.5">
              <div className="flex items-baseline gap-2.5 flex-wrap">
                <h2 className="text-sm font-semibold text-slate-900">
                  Bảng điểm đã chấm
                </h2>
                <span className="text-xs font-mono-data text-slate-500">
                  {results.length} bài
                  {classStats && (
                    <>
                      {' · '}TB {classStats.avg}
                      {' · '}Cao nhất {classStats.max}
                      {' · '}Thấp nhất {classStats.min}
                    </>
                  )}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {results.length > 0 && (
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Tìm thí sinh / mã đề..."
                    className="pl-8 pr-3 py-1.5 rounded-lg border border-slate-300 text-xs text-slate-800 w-44 focus:border-[#1e3a8a] focus:outline-none"
                  />
                </div>
              )}

              <button
                type="button"
                onClick={onExportCsv}
                className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 shrink-0" />
                <span>Xuất Excel (.CSV)</span>
              </button>

              {results.length > 0 && (
                <button
                  type="button"
                  onClick={onClearResults}
                  className="px-3 py-1.5 rounded-lg bg-white hover:bg-red-50 text-red-600 border border-red-200 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
                >
                  <Trash2 className="w-3.5 h-3.5 shrink-0" />
                  <span>Xóa tất cả</span>
                </button>
              )}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-500">
                  <th className="py-2.5 px-4 w-12">STT</th>
                  <th className="py-2.5 px-4">Thí sinh / Mã bài (Nhấp để sửa)</th>
                  <th className="py-2.5 px-4">Mã đề</th>
                  <th className="py-2.5 px-4">Đúng</th>
                  <th className="py-2.5 px-4">Chi tiết sai / Tô đúp</th>
                  <th className="py-2.5 px-4 text-right">Điểm số</th>
                  <th className="py-2.5 px-4 text-center w-24">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs sm:text-sm">
                {filteredResults.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-10 text-center text-slate-500">
                      {results.length === 0
                        ? 'Chưa có bài chấm nào. Hãy bật Camera, tải ảnh phiếu hoặc nhấn "Chấm thử phiếu mẫu".'
                        : 'Không tìm thấy bài chấm phù hợp với từ khóa tìm kiếm.'}
                    </td>
                  </tr>
                ) : (
                  filteredResults.map((r, idx) => (
                    <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                      <td className="py-2.5 px-4 font-mono-data text-slate-500">
                        {idx + 1}
                      </td>
                      <td className="py-2.5 px-4">
                        <input
                          type="text"
                          value={r.studentName}
                          onChange={(e) =>
                            onUpdateResult(r.id, (prev) => ({
                              ...prev,
                              studentName: e.target.value,
                            }))
                          }
                          aria-label={`Tên thí sinh dòng ${idx + 1}`}
                          className="w-full max-w-[220px] rounded border border-transparent hover:border-slate-300 focus:border-[#1e3a8a] bg-transparent focus:bg-white px-2 py-1 font-medium text-slate-900 focus:outline-none"
                        />
                      </td>
                      <td className="py-2.5 px-4 font-mono-data font-semibold text-[#1e3a8a]">
                        {r.examCode}
                      </td>
                      <td className="py-2.5 px-4 font-mono-data text-slate-700">
                        {r.correctCount}/{r.totalQuestions}
                      </td>
                      <td
                        className="py-2.5 px-4 text-xs text-slate-500 max-w-[250px] truncate"
                        title={r.wrongSummary}
                      >
                        {r.wrongSummary}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono-data font-bold text-emerald-700">
                        {Number(r.score).toFixed(2)}
                      </td>
                      <td className="py-2.5 px-4 text-center">
                        <div className="inline-flex items-center gap-1">
                          {r.previewDataUrl && (
                            <button
                              type="button"
                              onClick={() => onOpenReview(r)}
                              title="Xem ảnh phiếu đã chấm"
                              aria-label="Xem ảnh phiếu đã chấm"
                              className="p-1.5 rounded-lg hover:bg-blue-50 text-[#1e3a8a] cursor-pointer"
                            >
                              <Eye className="w-4 h-4" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => onDeleteResult(r.id)}
                            title="Xóa bài chấm này"
                            aria-label="Xóa bài chấm này"
                            className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-600 cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
};
