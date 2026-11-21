import React, { useEffect, useRef } from 'react';
import {
  ArrowRight,
  FileImage,
  Printer,
  Rows2,
  Scissors,
} from 'lucide-react';
import type { PaperMode, PresetMode, SheetConfig, SheetGeometry } from '../types/omr';
import {
  renderSheetToCanvas,
  renderSingleOmrSheetToCanvas,
  resolveEffectivePaperSize,
} from '../utils/omrEngine';

interface DesignTabProps {
  config: SheetConfig;
  onChangeConfig: (updater: (prev: SheetConfig) => SheetConfig) => void;
  onGeometryUpdated: (geo: SheetGeometry) => void;
  onPrintSheet: (canvasDataUrl: string) => void;
  onSwitchToGrading: () => void;
  onNotify: (msg: string) => void;
  previewCanvasRef: React.RefObject<HTMLCanvasElement | null>;
}

export const DesignTab: React.FC<DesignTabProps> = ({
  config,
  onChangeConfig,
  onGeometryUpdated,
  onPrintSheet,
  onSwitchToGrading,
  onNotify,
  previewCanvasRef,
}) => {
  const localGeoRef = useRef<SheetGeometry | null>(null);

  const effectivePaper = resolveEffectivePaperSize(config);
  const isA5 = effectivePaper === 'A5';
  const is2Up = isA5 && Boolean(config.twoUpA4);
  const totalQuestions = config.part1Count + config.part2Count + config.part3Count;

  useEffect(() => {
    const canvas = previewCanvasRef.current;
    if (!canvas) return;
    const render = () => {
      const geo = renderSheetToCanvas(canvas, config, null);
      localGeoRef.current = geo;
      onGeometryUpdated(geo);
    };
    render();
    let cancelled = false;
    if (typeof document !== 'undefined' && document.fonts?.ready) {
      document.fonts.ready.then(() => {
        if (!cancelled && previewCanvasRef.current) {
          render();
        }
      });
    }
    return () => {
      cancelled = true;
    };
  }, [config, onGeometryUpdated, previewCanvasRef]);

  const handlePresetChange = (preset: PresetMode) => {
    onChangeConfig((prev) => {
      if (preset === '40abcd') {
        return { ...prev, preset, part1Count: 40, part2Count: 0, part3Count: 0 };
      }
      if (preset === '50abcd') {
        return { ...prev, preset, part1Count: 50, part2Count: 0, part3Count: 0 };
      }
      if (preset === 'bgd2025') {
        return { ...prev, preset, part1Count: 12, part2Count: 4, part3Count: 6 };
      }
      return { ...prev, preset };
    });
  };

  const handleCountChange = (field: 'part1Count' | 'part2Count' | 'part3Count', raw: string) => {
    const max = field === 'part1Count' ? 100 : 10;
    const val = Math.max(0, Math.min(max, parseInt(raw, 10) || 0));
    onChangeConfig((prev) => ({
      ...prev,
      preset: 'custom',
      [field]: val,
    }));
  };

  const handlePrint = () => {
    const canvas = previewCanvasRef.current;
    if (!canvas) return;
    onPrintSheet(canvas.toDataURL('image/png'));
  };

  const handleDownloadSinglePng = () => {
    const singleCanvas = document.createElement('canvas');
    renderSingleOmrSheetToCanvas(singleCanvas, config, null);
    const link = document.createElement('a');
    link.download = `Phieu_OMR_Don_${effectivePaper}_${totalQuestions}cau.png`;
    link.href = singleCanvas.toDataURL('image/png');
    link.click();
    onNotify(`Đã tải ảnh phiếu đơn ${effectivePaper} chuẩn tọa độ.`);
  };

  const handleDownload2UpPng = () => {
    const canvas = previewCanvasRef.current;
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = `Phieu_OMR_2xA5_A4_Doc_${totalQuestions}cau.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
    onNotify('Đã tải tờ A4 dọc ghép 2 phiếu A5.');
  };

  const previewMeta = is2Up
    ? '2 phiếu A5 xếp trên – dưới trên 1 tờ A4 dọc (210 × 297 mm) · Có đường cắt ngang giữa'
    : isA5
      ? 'Bản vẽ độ phân giải cao · Khổ A5 dọc (148 × 210 mm)'
      : 'Bản vẽ độ phân giải cao · Khổ A4 dọc (210 × 297 mm)';

  return (
    <div className="flex-1 flex flex-col lg:flex-row lg:overflow-hidden">
      {/* Left Configuration Sidebar */}
      <aside className="w-full lg:w-[390px] xl:w-[420px] shrink-0 bg-white border-b lg:border-b-0 lg:border-r border-slate-200 flex flex-col lg:h-full">
        <div className="p-5 overflow-y-auto custom-scrollbar flex-1 space-y-6">
          {/* Section 1: Exam Structure */}
          <div className="space-y-3.5">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-900">
                Cấu trúc đề thi & Số câu
              </h2>
              <span className="text-xs font-mono-data font-semibold text-[#1e3a8a]">
                Tổng: {totalQuestions} câu
              </span>
            </div>

            <div>
              <label
                htmlFor="presetSelect"
                className="block text-xs font-medium text-slate-600 mb-1.5"
              >
                Mẫu cấu trúc nhanh
              </label>
              <select
                id="presetSelect"
                value={config.preset}
                onChange={(e) => handlePresetChange(e.target.value as PresetMode)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900 focus:border-[#1e3a8a] focus:outline-none focus:ring-2 focus:ring-[#1e3a8a]/15"
              >
                <option value="custom">Tùy chỉnh số câu tự do</option>
                <option value="40abcd">Mẫu chuẩn: 40 câu ABCD</option>
                <option value="50abcd">Mẫu chuẩn: 50 câu ABCD</option>
                <option value="bgd2025">Cấu trúc Bộ GD&amp;ĐT (12 ABCD + 4 Đ/S + 6 TLN)</option>
              </select>
            </div>

            <div className="grid grid-cols-3 gap-2.5">
              <div>
                <label
                  htmlFor="numPart1"
                  className="block text-xs font-medium text-slate-600 mb-1"
                >
                  Phần I (ABCD)
                </label>
                <input
                  id="numPart1"
                  type="number"
                  min={0}
                  max={100}
                  value={config.part1Count}
                  onChange={(e) => handleCountChange('part1Count', e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-slate-50 focus:bg-white px-2.5 py-2 text-center font-mono-data font-semibold text-sm text-[#1e3a8a] focus:border-[#1e3a8a] focus:outline-none focus:ring-2 focus:ring-[#1e3a8a]/15"
                />
                <span className="block text-[11px] text-slate-400 text-center mt-1 font-mono-data">
                  0 – 100
                </span>
              </div>

              <div>
                <label
                  htmlFor="numPart2"
                  className="block text-xs font-medium text-slate-600 mb-1"
                >
                  Phần II (Đ/S)
                </label>
                <input
                  id="numPart2"
                  type="number"
                  min={0}
                  max={10}
                  value={config.part2Count}
                  onChange={(e) => handleCountChange('part2Count', e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-slate-50 focus:bg-white px-2.5 py-2 text-center font-mono-data font-semibold text-sm text-emerald-700 focus:border-[#1e3a8a] focus:outline-none focus:ring-2 focus:ring-[#1e3a8a]/15"
                />
                <span className="block text-[11px] text-slate-400 text-center mt-1 font-mono-data">
                  0 – 10
                </span>
              </div>

              <div>
                <label
                  htmlFor="numPart3"
                  className="block text-xs font-medium text-slate-600 mb-1"
                >
                  Phần III (TLN)
                </label>
                <input
                  id="numPart3"
                  type="number"
                  min={0}
                  max={10}
                  value={config.part3Count}
                  onChange={(e) => handleCountChange('part3Count', e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-slate-50 focus:bg-white px-2.5 py-2 text-center font-mono-data font-semibold text-sm text-amber-700 focus:border-[#1e3a8a] focus:outline-none focus:ring-2 focus:ring-[#1e3a8a]/15"
                />
                <span className="block text-[11px] text-slate-400 text-center mt-1 font-mono-data">
                  0 – 10
                </span>
              </div>
            </div>
          </div>

          <hr className="border-slate-200" />

          {/* Section 2: Smart Paper Size & Exam Code */}
          <div className="space-y-3.5">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-900">
                Khổ giấy & Ô Mã đề viết tay
              </h2>
              <span className="text-xs font-mono-data font-medium text-slate-600">
                {config.paperMode === 'AUTO' ? 'Tự động' : 'Cố định'} · {effectivePaper}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="paperSizeSelect"
                  className="block text-xs font-medium text-slate-600 mb-1.5"
                >
                  Chế độ khổ giấy
                </label>
                <select
                  id="paperSizeSelect"
                  value={config.paperMode}
                  onChange={(e) =>
                    onChangeConfig((prev) => ({
                      ...prev,
                      paperMode: e.target.value as PaperMode,
                    }))
                  }
                  className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs sm:text-sm font-medium text-slate-900 focus:border-[#1e3a8a] focus:outline-none focus:ring-2 focus:ring-[#1e3a8a]/15"
                >
                  <option value="AUTO">Tự động (A5 / A4)</option>
                  <option value="A5">Khổ A5 (148 × 210 mm)</option>
                  <option value="A4">Khổ A4 (210 × 297 mm)</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="examCodeDigitsSelect"
                  className="block text-xs font-medium text-slate-600 mb-1.5"
                >
                  Số ô viết Mã đề
                </label>
                <select
                  id="examCodeDigitsSelect"
                  value={config.codeDigits}
                  onChange={(e) =>
                    onChangeConfig((prev) => ({
                      ...prev,
                      codeDigits: (parseInt(e.target.value, 10) === 4 ? 4 : 3) as 3 | 4,
                    }))
                  }
                  className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs sm:text-sm font-medium text-slate-900 focus:border-[#1e3a8a] focus:outline-none focus:ring-2 focus:ring-[#1e3a8a]/15"
                >
                  <option value={3}>3 ô viết tay (101)</option>
                  <option value={4}>4 ô viết tay (1001)</option>
                </select>
              </div>
            </div>

            {isA5 && (
              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-1.5">
                <label className="flex items-center justify-between gap-3 cursor-pointer select-none">
                  <span className="text-xs font-semibold text-slate-800 flex items-center gap-2">
                    <Scissors className="w-4 h-4 text-slate-600 shrink-0" />
                    <span>Xếp 2 phiếu A5 trên 1 tờ A4 dọc</span>
                  </span>
                  <input
                    type="checkbox"
                    checked={config.twoUpA4}
                    onChange={(e) =>
                      onChangeConfig((prev) => ({ ...prev, twoUpA4: e.target.checked }))
                    }
                    className="w-4 h-4 rounded accent-[#1e3a8a] cursor-pointer"
                  />
                </label>
                <p className="text-xs text-slate-500 leading-relaxed">
                  In 2 phiếu xếp trên – dưới theo chiều dọc tờ A4, có đường cắt ngang ở giữa. Mỗi nửa A5 giữ nguyên 4 điểm neo OMR độc lập.
                </p>
              </div>
            )}

            <p className="text-xs text-slate-500 leading-relaxed">
              Khi đề ít câu (≤ 32 đơn vị), chế độ tự động chuyển sang khổ A5 để tiết kiệm giấy. Học sinh viết Mã đề bằng bút mực vào khung góc phải.
            </p>
          </div>

          <hr className="border-slate-200" />

          {/* Section 3: Administrative Header */}
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-slate-900">
              Thông tin tiêu đề phiếu
            </h2>

            <div>
              <label
                htmlFor="schoolInput"
                className="block text-xs font-medium text-slate-600 mb-1"
              >
                Tên trường / Đơn vị
              </label>
              <input
                id="schoolInput"
                type="text"
                value={config.schoolName}
                onChange={(e) =>
                  onChangeConfig((prev) => ({ ...prev, schoolName: e.target.value }))
                }
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-[#1e3a8a] focus:outline-none focus:ring-2 focus:ring-[#1e3a8a]/15"
              />
            </div>

            <div>
              <label
                htmlFor="examTitleInput"
                className="block text-xs font-medium text-slate-600 mb-1"
              >
                Tiêu đề kỳ thi
              </label>
              <input
                id="examTitleInput"
                type="text"
                value={config.examTitle}
                onChange={(e) =>
                  onChangeConfig((prev) => ({ ...prev, examTitle: e.target.value }))
                }
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-[#1e3a8a] focus:outline-none focus:ring-2 focus:ring-[#1e3a8a]/15"
              />
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label
                  htmlFor="subjectInput"
                  className="block text-xs font-medium text-slate-600 mb-1"
                >
                  Môn thi
                </label>
                <input
                  id="subjectInput"
                  type="text"
                  value={config.subjectName}
                  onChange={(e) =>
                    onChangeConfig((prev) => ({ ...prev, subjectName: e.target.value }))
                  }
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-[#1e3a8a] focus:outline-none focus:ring-2 focus:ring-[#1e3a8a]/15"
                />
              </div>

              <div>
                <label
                  htmlFor="durationInput"
                  className="block text-xs font-medium text-slate-600 mb-1"
                >
                  Thời gian
                </label>
                <input
                  id="durationInput"
                  type="text"
                  value={config.duration}
                  onChange={(e) =>
                    onChangeConfig((prev) => ({ ...prev, duration: e.target.value }))
                  }
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-[#1e3a8a] focus:outline-none focus:ring-2 focus:ring-[#1e3a8a]/15"
                />
              </div>
            </div>

            <p className="text-xs text-slate-500 pt-1">
              Mọi thay đổi cấu trúc phiếu tự động đồng bộ tọa độ với hệ thống chấm bài ở Tab 2.
            </p>
          </div>
        </div>

        {/* Sticky Bottom Print & Export Actions */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 space-y-2.5 shrink-0">
          <button
            type="button"
            onClick={handlePrint}
            className="w-full py-2.5 px-4 bg-[#1e3a8a] hover:bg-blue-900 active:bg-blue-950 text-white font-semibold text-sm rounded-lg flex items-center justify-center gap-2 transition-colors cursor-pointer whitespace-nowrap"
          >
            <Printer className="w-4 h-4 shrink-0" />
            <span>
              {is2Up
                ? 'In 2 Phiếu A5 / Tờ A4 Dọc (1:1)'
                : `In Phiếu ${effectivePaper} / Lưu PDF (1:1)`}
            </span>
          </button>

          <div className={`grid gap-2 ${is2Up ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1'}`}>
            <button
              type="button"
              onClick={handleDownloadSinglePng}
              className="w-full py-2 px-3 bg-white hover:bg-slate-100 text-slate-800 font-medium text-xs rounded-lg border border-slate-300 flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
            >
              <FileImage className="w-3.5 h-3.5 text-slate-600 shrink-0" />
              <span>{isA5 ? 'Tải phiếu đơn A5 (.PNG)' : 'Tải phiếu A4 (.PNG)'}</span>
            </button>

            {is2Up && (
              <button
                type="button"
                onClick={handleDownload2UpPng}
                className="w-full py-2 px-3 bg-white hover:bg-slate-100 text-[#1e3a8a] font-semibold text-xs rounded-lg border border-blue-200 flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
              >
                <Rows2 className="w-3.5 h-3.5 shrink-0" />
                <span>Tải A4 dọc ghép đôi (.PNG)</span>
              </button>
            )}
          </div>
        </div>
      </aside>

      {/* Right Preview Stage */}
      <main className="flex-1 bg-slate-100 overflow-y-auto custom-scrollbar p-5 sm:p-8 flex flex-col items-center">
        <div className="w-full max-w-[960px] flex flex-wrap items-center justify-between gap-3 mb-4">
          <p className="text-xs font-medium text-slate-600">{previewMeta}</p>
          <button
            type="button"
            onClick={onSwitchToGrading}
            className="text-xs font-semibold text-[#1e3a8a] hover:underline flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0"
          >
            <span>Chuyển sang Chấm bài</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div
          className={`w-full pb-10 transition-all duration-200 ${
            is2Up ? 'max-w-[760px]' : isA5 ? 'max-w-[540px]' : 'max-w-[760px]'
          }`}
        >
          <canvas
            ref={previewCanvasRef}
            className="bg-white shadow-lg border border-slate-200 max-w-full h-auto block mx-auto"
          />
        </div>
      </main>
    </div>
  );
};
