import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, FileSpreadsheet, Printer, X } from 'lucide-react';
import { DesignTab } from './components/DesignTab';
import { GradingTab } from './components/GradingTab';
import type {
  AppState,
  GradeResultRecord,
  GradingConfig,
  SheetConfig,
  SheetGeometry,
} from './types/omr';
import {
  DEFAULT_GRADING_CONFIG,
  DEFAULT_SHEET_CONFIG,
  STORAGE_KEY,
  evaluateStudentAnswers,
  exportResultsToCsv,
  resolveEffectivePaperSize,
} from './utils/omrEngine';

function loadInitialState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {
        config: { ...DEFAULT_SHEET_CONFIG },
        grading: {
          ...DEFAULT_GRADING_CONFIG,
          answerKeys: {
            '101': { part1: {}, part2: {}, part3: {} },
          },
        },
        results: [],
      };
    }
    const parsed = JSON.parse(raw) as Partial<AppState>;
    const answerKeys =
      parsed.grading?.answerKeys && Object.keys(parsed.grading.answerKeys).length > 0
        ? parsed.grading.answerKeys
        : { '101': { part1: {}, part2: {}, part3: {} } };

    return {
      config: { ...DEFAULT_SHEET_CONFIG, ...(parsed.config || {}) },
      grading: {
        ...DEFAULT_GRADING_CONFIG,
        ...(parsed.grading || {}),
        answerKeys,
      },
      results: Array.isArray(parsed.results)
        ? parsed.results.map((r) => ({
            ...r,
            wrongDetails: Array.isArray(r.wrongDetails) ? r.wrongDetails : [],
          }))
        : [],
    };
  } catch {
    return {
      config: { ...DEFAULT_SHEET_CONFIG },
      grading: {
        ...DEFAULT_GRADING_CONFIG,
        answerKeys: { '101': { part1: {}, part2: {}, part3: {} } },
      },
      results: [],
    };
  }
}

export default function App() {
  const [activeTab, setActiveTab] = useState<1 | 2>(1);
  const [state, setState] = useState<AppState>(() => loadInitialState());
  const [activeGeometry, setActiveGeometry] = useState<SheetGeometry | null>(null);
  const [printImageUrl, setPrintImageUrl] = useState<string>('');
  const [reviewRecord, setReviewRecord] = useState<GradeResultRecord | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => {
      setToastMessage(null);
    }, 3200);
  }, []);

  // Persist to localStorage (strip bulky base64 preview images from storage)
  useEffect(() => {
    try {
      const toStore: AppState = {
        config: state.config,
        grading: state.grading,
        results: state.results.map((r) => ({ ...r, previewDataUrl: null })),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toStore));
    } catch {
      // Ignore storage quota errors
    }
  }, [state]);

  // Dynamic @page size for 1:1 printing
  const effectivePaper = resolveEffectivePaperSize(state.config);
  const is2Up = effectivePaper === 'A5' && state.config.twoUpA4;

  useEffect(() => {
    let styleEl = document.getElementById('dynamicPrintPageStyle') as HTMLStyleElement | null;
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'dynamicPrintPageStyle';
      document.head.appendChild(styleEl);
    }
    styleEl.textContent = is2Up
      ? '@page { size: A4 portrait; margin: 0; }'
      : `@page { size: ${effectivePaper} portrait; margin: 0; }`;
  }, [effectivePaper, is2Up]);

  // Keep even10 / even100 scoring synced if question counts change
  const handleChangeConfig = useCallback((updater: (prev: SheetConfig) => SheetConfig) => {
    setState((prev) => {
      const nextCfg = updater(prev.config);
      nextCfg.paperSize = resolveEffectivePaperSize(nextCfg);

      let nextGrading = prev.grading;
      const totalQ = nextCfg.part1Count + nextCfg.part2Count + nextCfg.part3Count;
      if (prev.grading.scorePreset === 'even10') {
        const perQ = totalQ > 0 ? +(10 / totalQ).toFixed(4) : 0;
        nextGrading = { ...prev.grading, ptsPart1: perQ, ptsPart2: perQ, ptsPart3: perQ };
      } else if (prev.grading.scorePreset === 'even100') {
        const perQ = totalQ > 0 ? +(100 / totalQ).toFixed(4) : 0;
        nextGrading = { ...prev.grading, ptsPart1: perQ, ptsPart2: perQ, ptsPart3: perQ };
      }

      return { ...prev, config: nextCfg, grading: nextGrading };
    });
  }, []);

  const handleChangeGrading = useCallback((updater: (prev: GradingConfig) => GradingConfig) => {
    setState((prev) => ({
      ...prev,
      grading: updater(prev.grading),
    }));
  }, []);

  const handleAddResult = useCallback((record: GradeResultRecord) => {
    setState((prev) => ({
      ...prev,
      results: [record, ...prev.results],
    }));
  }, []);

  const handleUpdateResult = useCallback(
    (id: number, updater: (prev: GradeResultRecord) => GradeResultRecord) => {
      setState((prev) => ({
        ...prev,
        results: prev.results.map((r) => (r.id === id ? updater(r) : r)),
      }));
    },
    []
  );

  const handleDeleteResult = useCallback((id: number) => {
    setState((prev) => ({
      ...prev,
      results: prev.results.filter((r) => r.id !== id),
    }));
  }, []);

  const handleClearResults = useCallback(() => {
    setState((prev) => ({ ...prev, results: [] }));
    showToast('Đã xóa toàn bộ bảng điểm.');
  }, [showToast]);

  const handleRecalculateAll = useCallback(() => {
    setState((prev) => {
      if (prev.results.length === 0) return prev;
      const updated = prev.results.map((rec) => {
        if (!rec.detectedData) return rec;
        const evalRes = evaluateStudentAnswers(
          rec.detectedData,
          rec.examCode,
          prev.config,
          prev.grading
        );
        return {
          ...rec,
          score: evalRes.score,
          maxScore: evalRes.maxPossibleScore,
          correctCount: evalRes.correctCount,
          wrongDetails: evalRes.wrongDetails,
          wrongSummary:
            evalRes.wrongDetails.length > 0
              ? evalRes.wrongDetails.slice(0, 6).join(', ') +
                (evalRes.wrongDetails.length > 6 ? '...' : '')
              : 'Chính xác tuyệt đối',
        };
      });
      return { ...prev, results: updated };
    });
    showToast('Đã tính lại điểm theo thang điểm mới.');
  }, [showToast]);

  const handlePrintSheet = useCallback((dataUrl: string) => {
    setPrintImageUrl(dataUrl);
    window.setTimeout(() => {
      window.print();
    }, 80);
  }, []);

  const handleHeaderPrimaryAction = () => {
    if (activeTab === 1) {
      const canvas = previewCanvasRef.current;
      if (canvas) {
        handlePrintSheet(canvas.toDataURL('image/png'));
      }
    } else {
      const exported = exportResultsToCsv(state.results);
      if (exported) {
        showToast('Đã xuất bảng điểm Excel (.csv chuẩn UTF-8).');
      } else {
        showToast('Chưa có bài chấm nào để xuất Excel.');
      }
    }
  };

  const handleExportCsv = useCallback(() => {
    const exported = exportResultsToCsv(state.results);
    if (exported) {
      showToast('Đã xuất bảng điểm Excel (.csv chuẩn UTF-8).');
    } else {
      showToast('Chưa có bài chấm nào để xuất Excel.');
    }
  }, [showToast, state.results]);

  return (
    <>
      {/* Dedicated 1:1 Print Container */}
      <div id="printOnlyContainer">
        {printImageUrl && (
          <img
            id="printImage"
            src={printImageUrl}
            alt="Phiếu trả lời trắc nghiệm OMR"
          />
        )}
      </div>

      {/* Main Application Shell */}
      <div id="appRoot" className="min-h-screen lg:h-screen flex flex-col lg:overflow-hidden bg-slate-50">
        {/* Strict 3-Zone Top Bar */}
        <header className="h-16 bg-white border-b border-slate-200 px-4 sm:px-6 flex items-center justify-between gap-4 sm:gap-8 shrink-0 z-30">
          {/* Zone 1: Single-line Brand Wordmark */}
          <div className="text-sm sm:text-base font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0">
            Chấm Thi OMR · Phạm Hậu EDU
          </div>

          {/* Zone 2: Clean Segmented Workspace Tabs */}
          <nav
            aria-label="Điều hướng khu vực làm việc"
            className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg shrink-0"
          >
            <button
              type="button"
              onClick={() => setActiveTab(1)}
              className={`px-3 sm:px-4 py-1.5 rounded-md text-xs sm:text-sm font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                activeTab === 1
                  ? 'bg-white text-[#1e3a8a] shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              1. Thiết kế &amp; In Phiếu
            </button>
            <button
              type="button"
              onClick={() => setActiveTab(2)}
              className={`px-3 sm:px-4 py-1.5 rounded-md text-xs sm:text-sm font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                activeTab === 2
                  ? 'bg-white text-[#1e3a8a] shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              2. Chấm Bài &amp; Xuất Điểm
            </button>
          </nav>

          {/* Zone 3: Single Primary Action */}
          <div className="hidden md:flex items-center shrink-0">
            <button
              type="button"
              onClick={handleHeaderPrimaryAction}
              className="px-4 py-2 rounded-lg bg-[#1e3a8a] hover:bg-blue-900 text-white text-xs sm:text-sm font-semibold flex items-center gap-2 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              {activeTab === 1 ? (
                <>
                  <Printer className="w-4 h-4 shrink-0" />
                  <span>In Phiếu OMR</span>
                </>
              ) : (
                <>
                  <FileSpreadsheet className="w-4 h-4 shrink-0" />
                  <span>Xuất Bảng Điểm</span>
                </>
              )}
            </button>
          </div>
        </header>

        {/* Active Tab Workspace */}
        <div className={activeTab === 1 ? 'flex-1 flex flex-col lg:overflow-hidden' : 'hidden'}>
          <DesignTab
            config={state.config}
            onChangeConfig={handleChangeConfig}
            onGeometryUpdated={setActiveGeometry}
            onPrintSheet={handlePrintSheet}
            onSwitchToGrading={() => setActiveTab(2)}
            onNotify={showToast}
            previewCanvasRef={previewCanvasRef}
          />
        </div>

        <div className={activeTab === 2 ? 'flex-1 flex flex-col lg:overflow-hidden' : 'hidden'}>
          <GradingTab
            sheetConfig={state.config}
            gradingConfig={state.grading}
            results={state.results}
            activeGeometry={activeGeometry}
            onChangeGrading={handleChangeGrading}
            onAddResult={handleAddResult}
            onUpdateResult={handleUpdateResult}
            onDeleteResult={handleDeleteResult}
            onClearResults={handleClearResults}
            onRecalculateAll={handleRecalculateAll}
            onExportCsv={handleExportCsv}
            onOpenReview={setReviewRecord}
            onSwitchToDesign={() => setActiveTab(1)}
            onNotify={showToast}
          />
        </div>

        {/* Review Graded Sheet Modal */}
        {reviewRecord && reviewRecord.previewDataUrl && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Xem ảnh phiếu đã chấm"
            className="fixed inset-0 bg-slate-950/75 z-50 flex items-center justify-center p-4"
            onClick={() => setReviewRecord(null)}
          >
            <div
              className="bg-white rounded-xl max-w-3xl w-full max-h-[90vh] flex flex-col overflow-hidden shadow-2xl border border-slate-200"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-5 py-3.5 bg-slate-900 text-white flex items-center justify-between gap-4">
                <h3 className="font-semibold text-sm truncate">
                  {reviewRecord.studentName} · Mã đề {reviewRecord.examCode} · Điểm:{' '}
                  {Number(reviewRecord.score).toFixed(2)}
                </h3>
                <button
                  type="button"
                  onClick={() => setReviewRecord(null)}
                  aria-label="Đóng cửa sổ xem ảnh"
                  className="p-1.5 hover:bg-white/15 rounded-lg cursor-pointer shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-4 overflow-y-auto flex-1 bg-slate-100 flex items-center justify-center">
                <img
                  src={reviewRecord.previewDataUrl}
                  alt={`Ảnh bài chấm ${reviewRecord.studentName}`}
                  className="max-w-full max-h-[74vh] rounded border border-slate-200 bg-white"
                />
              </div>
            </div>
          </div>
        )}

        {/* Toast Notification */}
        {toastMessage && (
          <div
            role="status"
            aria-live="polite"
            className="fixed bottom-5 right-5 bg-slate-900 text-white px-4 py-3 rounded-lg shadow-lg text-xs sm:text-sm font-medium flex items-center gap-2.5 z-50 border border-slate-700 max-w-md"
          >
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{toastMessage}</span>
          </div>
        )}
      </div>
    </>
  );
}
