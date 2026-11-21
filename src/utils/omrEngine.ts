import type {
  AnswerKey,
  DetectedSheetData,
  EffectivePaperSize,
  EvaluationResult,
  GradeResultRecord,
  GradingConfig,
  OcrResult,
  OverlayMarker,
  SampleFillData,
  SheetConfig,
  SheetGeometry,
} from '../types/omr';

export const STORAGE_KEY = 'PHAMHAU_EDU_OMR_SYSTEM_V3';

export const DEFAULT_SHEET_CONFIG: SheetConfig = {
  preset: '40abcd',
  part1Count: 40,
  part2Count: 0,
  part3Count: 0,
  paperMode: 'AUTO',
  paperSize: 'A4',
  twoUpA4: true,
  codeDigits: 3,
  schoolName: 'TRƯỜNG THPT HỒNG NGỰ 3 - TỔ TOÁN',
  examTitle: 'KIỂM TRA ĐÁNH GIÁ ĐỊNH KỲ',
  subjectName: 'TOÁN HỌC',
  duration: '45 phút',
};

export const DEFAULT_GRADING_CONFIG: GradingConfig = {
  selectedCode: '101',
  answerKeys: {
    '101': {
      part1: {},
      part2: {},
      part3: {},
    },
  },
  scorePreset: 'standard',
  ptsPart1: 0.25,
  ptsPart2: 1.0,
  ptsPart3: 0.5,
  part2Mode: 'progressive',
  threshold: 45,
  soundEnabled: true,
  geminiOcrEnabled: true,
};

export function resolveEffectivePaperSize(cfg: SheetConfig): EffectivePaperSize {
  if (cfg.paperMode === 'A5' || cfg.paperMode === 'A4') return cfg.paperMode;
  const totalUnits = (cfg.part1Count || 0) + (cfg.part2Count || 0) * 4 + (cfg.part3Count || 0) * 4;
  return totalUnits <= 32 ? 'A5' : 'A4';
}

function drawRoundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, radius);
  } else {
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
    ctx.lineTo(x + w, y + h - radius);
    ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    ctx.lineTo(x + radius, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }
}

export function buildSheetGeometry(cfg: SheetConfig): SheetGeometry {
  const effectivePaper = resolveEffectivePaperSize(cfg);
  const isA5 = effectivePaper === 'A5';
  const isHalfA4 = isA5 && Boolean(cfg.twoUpA4);
  const W = isHalfA4 ? 2100 : isA5 ? 1480 : 2100;
  const H = isHalfA4 ? 1480 : isA5 ? 2100 : 2970;

  const margin = isHalfA4 ? 48 : isA5 ? 56 : 78;
  const markerSize = isHalfA4 ? 52 : isA5 ? 56 : 70;

  const scanLeft = margin + markerSize / 2;
  const scanTop = margin + markerSize / 2;
  const scanRight = W - margin - markerSize / 2;
  const scanBottom = H - margin - markerSize / 2;
  const scanW = scanRight - scanLeft;
  const scanH = scanBottom - scanTop;

  const normX = (px: number) => (px - scanLeft) / scanW;
  const normY = (py: number) => (py - scanTop) / scanH;
  const normR = (rPx: number) => rPx / scanW;

  const geo: SheetGeometry = {
    W,
    H,
    isA5,
    isLandscapeA5: isHalfA4,
    scanLeft,
    scanTop,
    scanRight,
    scanBottom,
    scanW,
    scanH,
    markerSize,
    margin,
    codeDigits: cfg.codeDigits || 3,
    codeBoxes: [],
    codeCropBox: { nx: 0, ny: 0, nw: 0, nh: 0 },
    part1Bubbles: [],
    part2Bubbles: [],
    part3Bubbles: [],
    metaDrawings: [],
  };

  const innerPadX = isHalfA4 ? 64 : isA5 ? 56 : 80;
  const innerPadY = isHalfA4 ? 40 : isA5 ? 54 : 74;
  const contentLeft = scanLeft + innerPadX;
  const contentRight = scanRight - innerPadX;
  const contentW = contentRight - contentLeft;
  let curY = scanTop + innerPadY;

  // 1. HEADER ROW: Main Exam Header (Left) + Handwritten Exam Code Block (Right)
  const codeBoxCount = cfg.codeDigits || 3;
  const cellW = isHalfA4 ? 54 : isA5 ? 50 : 66;
  const cellH = isHalfA4 ? 54 : isA5 ? 62 : 82;
  const cellGap = isHalfA4 ? 12 : isA5 ? 10 : 14;
  const cellsTotalW = codeBoxCount * cellW + (codeBoxCount - 1) * cellGap;
  const codeBlockW = Math.max(
    isHalfA4 ? 300 : isA5 ? 268 : 368,
    cellsTotalW + (isHalfA4 ? 52 : isA5 ? 44 : 64)
  );
  const codeBlockH = isHalfA4 ? 114 : isA5 ? 128 : 168;
  const topGapX = isHalfA4 ? 22 : isA5 ? 18 : 26;
  const headerLeftW = contentW - codeBlockW - topGapX;

  geo.metaDrawings.push({
    type: 'header',
    x: contentLeft,
    y: curY,
    w: headerLeftW,
    h: codeBlockH,
    school: cfg.schoolName,
    title: cfg.examTitle,
    subject: cfg.subjectName,
    duration: cfg.duration,
  });

  const codeBlockX = contentRight - codeBlockW;
  const codeBlockY = curY;
  const cellsStartX = codeBlockX + (codeBlockW - cellsTotalW) / 2;
  const cellsStartY = codeBlockY + (isHalfA4 ? 34 : isA5 ? 42 : 54);

  const codeBoxCoords: Array<{ x: number; y: number; w: number; h: number }> = [];
  for (let d = 0; d < codeBoxCount; d++) {
    const bx = cellsStartX + d * (cellW + cellGap);
    const by = cellsStartY;
    codeBoxCoords.push({ x: bx, y: by, w: cellW, h: cellH });
    geo.codeBoxes.push({
      digitIndex: d,
      nx: normX(bx),
      ny: normY(by),
      nw: cellW / scanW,
      nh: cellH / scanH,
    });
  }

  geo.codeCropBox = {
    nx: normX(cellsStartX - 12),
    ny: normY(cellsStartY - 10),
    nw: (cellsTotalW + 24) / scanW,
    nh: (cellH + 20) / scanH,
  };

  geo.metaDrawings.push({
    type: 'codeHandwritingBox',
    x: codeBlockX,
    y: codeBlockY,
    w: codeBlockW,
    h: codeBlockH,
    cells: codeBoxCoords,
  });

  curY += codeBlockH + (isHalfA4 ? 12 : isA5 ? 14 : 20);

  // 2. STUDENT INFO (Left, aligned with Header) + SCORE BOX (Right, aligned with Exam Code)
  const studentInfoH = isHalfA4 ? 68 : isA5 ? 78 : 104;
  geo.metaDrawings.push({
    type: 'studentInfoLines',
    x: contentLeft,
    y: curY,
    w: headerLeftW,
    h: studentInfoH,
    scoreBoxX: codeBlockX,
    scoreBoxW: codeBlockW,
  });

  curY += studentInfoH + (isHalfA4 ? 10 : isA5 ? 12 : 16);

  // 3. COMPACT MARKING GUIDE STRIP
  const guideH = isHalfA4 ? 30 : isA5 ? 34 : 44;
  geo.metaDrawings.push({
    type: 'markingGuide',
    x: contentLeft,
    y: curY,
    w: contentW,
    h: guideH,
  });

  curY += guideH + (isHalfA4 ? 12 : isA5 ? 14 : 20);

  // 4. INTELLIGENT VERTICAL ALLOCATION FOR PARTS I, II, III
  const bottomLimit = scanBottom - innerPadY - (isHalfA4 ? 6 : isA5 ? 8 : 12);
  const availH = Math.max(200, bottomLimit - curY);

  const hasP1 = cfg.part1Count > 0;
  const hasP2 = cfg.part2Count > 0;
  const hasP3 = cfg.part3Count > 0;
  const activeSections = (hasP1 ? 1 : 0) + (hasP2 ? 1 : 0) + (hasP3 ? 1 : 0);
  const sectionGap = isHalfA4 ? 14 : isA5 ? 16 : 24;
  const usableH = availH - Math.max(0, activeSections - 1) * sectionGap;
  const isPart1Only = hasP1 && !hasP2 && !hasP3;

  // Smart column count for Part I to maximize visual symmetry & full-page balance
  const p1Cols = (() => {
    const q = cfg.part1Count;
    if (isHalfA4) {
      if (isPart1Only) {
        if (q <= 5) return 1;
        if (q <= 20) return 2;
        if (q <= 30) return 3;
        if (q <= 40) return 4;
        return 5;
      }
      if (q <= 20) return 4;
      if (q <= 40) return 5;
      return 6;
    }
    if (isPart1Only) {
      if (q <= 5) return 1;
      if (q <= 50) return 2;
      if (q <= 75) return 3;
      return 4;
    }
    if (q <= 8) return 2;
    if (q <= 12) return q % 4 === 0 ? 4 : 3;
    if (q <= 40) return 4;
    return 5;
  })();

  const p1Rows = hasP1 ? Math.ceil(cfg.part1Count / p1Cols) : 0;
  const p1HeaderH = isHalfA4 ? 34 : isA5 ? 36 : 46;
  const p1ColHeadH = isHalfA4 ? 26 : isA5 ? 28 : 36;
  const p1PadBot = isHalfA4 ? 14 : isA5 ? 16 : 22;
  const p1Groups = hasP1 ? Math.floor((p1Rows - 1) / 5) : 0;
  const p1MaxRowStep = isHalfA4
    ? isPart1Only
      ? 74
      : 52
    : isPart1Only
      ? isA5
        ? 74
        : 88
      : isA5
        ? 54
        : 68;
  const p1IdealRowStep = isHalfA4
    ? isPart1Only
      ? 64
      : 42
    : isPart1Only
      ? isA5
        ? 62
        : 78
      : isA5
        ? 46
        : 58;
  const p1IdealH = hasP1
    ? p1HeaderH + p1ColHeadH + p1PadBot + p1Rows * p1IdealRowStep + p1Groups * (isA5 ? 14 : 20)
    : 0;

  const p2Cols = hasP2 ? Math.min(isHalfA4 ? 5 : 4, Math.max(2, cfg.part2Count)) : 1;
  const p2Rows = hasP2 ? Math.ceil(cfg.part2Count / p2Cols) : 0;
  const p2HeaderH = isHalfA4 ? 34 : isA5 ? 36 : 46;
  const p2IdealH = hasP2
    ? p2HeaderH + (isA5 ? 22 : 34) + p2Rows * (isHalfA4 ? 190 : isA5 ? 215 : 295)
    : 0;

  const p3Cols = hasP3 ? Math.min(6, Math.max(isHalfA4 ? 4 : 3, cfg.part3Count)) : 1;
  const p3Rows = hasP3 ? Math.ceil(cfg.part3Count / p3Cols) : 0;
  const p3HeaderH = isHalfA4 ? 34 : isA5 ? 36 : 46;
  const p3IdealH = hasP3
    ? p3HeaderH + (isA5 ? 22 : 34) + p3Rows * (isHalfA4 ? 375 : isA5 ? 430 : 620)
    : 0;

  const sigBoxH = isHalfA4 ? 84 : isA5 ? 92 : 124;
  const sumIdeal = p1IdealH + p2IdealH + p3IdealH || 1;
  // Reserve space for the bottom signature/review footer when the sheet has natural breathing room
  const reserveFooter = sumIdeal + sigBoxH + sectionGap <= usableH;
  const effectiveUsableH = reserveFooter ? usableH - sigBoxH - sectionGap : usableH;

  let p1H = 0;
  let p2H = 0;
  let p3H = 0;

  if (sumIdeal > effectiveUsableH) {
    const ratio = effectiveUsableH / sumIdeal;
    p1H = hasP1 ? p1IdealH * ratio : 0;
    p2H = hasP2 ? p2IdealH * ratio : 0;
    p3H = hasP3 ? p3IdealH * ratio : 0;
  } else {
    const extra = effectiveUsableH - sumIdeal;
    const p1MaxH = hasP1
      ? p1HeaderH + p1ColHeadH + p1PadBot + p1Rows * p1MaxRowStep + p1Groups * (isA5 ? 18 : 24)
      : 0;
    const p2MaxH = hasP2
      ? p2HeaderH + (isA5 ? 22 : 34) + p2Rows * (isHalfA4 ? 245 : isA5 ? 260 : 365)
      : 0;
    const p3MaxH = hasP3
      ? p3HeaderH + (isA5 ? 22 : 34) + p3Rows * (isHalfA4 ? 450 : isA5 ? 500 : 740)
      : 0;

    p1H = hasP1 ? Math.min(p1MaxH, p1IdealH + extra * (p1IdealH / sumIdeal)) : 0;
    p2H = hasP2 ? Math.min(p2MaxH, p2IdealH + extra * (p2IdealH / sumIdeal)) : 0;
    p3H = hasP3 ? Math.min(p3MaxH, p3IdealH + extra * (p3IdealH / sumIdeal)) : 0;
  }

  // Distribute leftover vertical margin gracefully into inter-section spacing for full-page harmony
  const allocatedSum = p1H + p2H + p3H;
  const leftoverForGaps = Math.max(0, effectiveUsableH - allocatedSum);
  const dynamicSectionGap =
    activeSections > 1
      ? Math.min(isHalfA4 ? 24 : isA5 ? 30 : 46, sectionGap + leftoverForGaps / (activeSections + 0.5))
      : sectionGap;

  // --- PART I: MULTIPLE CHOICE (A, B, C, D) ---
  if (hasP1) {
    const qCount = cfg.part1Count;
    const cols = p1Cols;
    const rowsPerCol = p1Rows;
    const padX = isA5 ? 18 : 26;
    const colGap = cols <= 2 ? (isA5 ? 48 : 84) : isA5 ? 18 : 26;
    const maxSingleColW = cols === 1 ? (isA5 ? 520 : 660) : cols === 2 ? (isA5 ? 450 : 620) : 9999;
    const rawColW = (contentW - padX * 2 - (cols - 1) * colGap) / cols;
    const colW = Math.min(maxSingleColW, rawColW);
    const totalColsW = cols * colW + (cols - 1) * colGap;
    const colsStartX = contentLeft + (contentW - totalColsW) / 2;

    const groups = Math.floor((rowsPerCol - 1) / 5);
    const groupGap = rowsPerCol > 5 ? (isPart1Only ? (isA5 ? 16 : 24) : isA5 ? 10 : 16) : 0;
    const bodyTop = curY + p1HeaderH + p1ColHeadH + (isA5 ? 4 : 6);
    const bodyH = Math.max(
      60,
      p1H - p1HeaderH - p1ColHeadH - (isA5 ? 4 : 6) - p1PadBot - groups * groupGap
    );
    const rowStep = Math.min(p1MaxRowStep, bodyH / Math.max(rowsPerCol, 1));

    const actualP1ContentH = rowsPerCol * rowStep + groups * groupGap;
    const finalP1H = Math.min(
      p1H,
      p1HeaderH + p1ColHeadH + (isA5 ? 4 : 6) + actualP1ContentH + p1PadBot
    );

    const numColW = cols <= 2 ? (isA5 ? 56 : 78) : isA5 ? 42 : 56;
    const optAreaPadR = cols <= 2 ? (isA5 ? 24 : 36) : isA5 ? 12 : 18;
    const optSpan = Math.max(40, colW - numColW - optAreaPadR);
    const optStep = optSpan / 4;
    const bubbleR = Math.min(
      cols <= 2 ? (isA5 ? 18 : 24) : isA5 ? 15 : 20,
      optStep * 0.36,
      rowStep * 0.36
    );

    geo.metaDrawings.push({
      type: 'sectionBox',
      x: contentLeft,
      y: curY,
      w: contentW,
      h: finalP1H,
      title: `PHẦN I. TRẮC NGHIỆM NHIỀU PHƯƠNG ÁN LỰA CHỌN`,
      subtitle: `${qCount} câu`,
    });

    const choices = ['A', 'B', 'C', 'D'];

    for (let c = 0; c < cols; c++) {
      const colX = colsStartX + c * (colW + colGap);
      const qLabelX = colX + numColW - (isA5 ? 10 : 14);
      const optXs = choices.map((_, cIdx) => colX + numColW + optStep * (cIdx + 0.5));

      geo.metaDrawings.push({
        type: 'columnHeader',
        x: colX,
        y: curY + p1HeaderH + (isA5 ? 3 : 5),
        w: colW,
        h: p1ColHeadH - (isA5 ? 4 : 6),
        qLabelX,
        optXs,
        labels: choices,
      });

      if (c > 0) {
        geo.metaDrawings.push({
          type: 'columnDivider',
          x: colX - colGap / 2,
          y1: curY + p1HeaderH + (isA5 ? 10 : 14),
          y2: curY + finalP1H - (isA5 ? 14 : 18),
        });
      }
    }

    for (let idx = 0; idx < qCount; idx++) {
      const colIdx = Math.floor(idx / rowsPerCol);
      const rowIdx = idx % rowsPerCol;
      const groupIdx = Math.floor(rowIdx / 5);
      const colX = colsStartX + colIdx * (colW + colGap);
      const rowTop = bodyTop + rowIdx * rowStep + groupIdx * groupGap;
      const cy = rowTop + rowStep * 0.5;

      if (rowIdx % 2 === 1) {
        geo.metaDrawings.push({
          type: 'rowStripe',
          x: colX + 2,
          y: rowTop + 1,
          w: colW - 4,
          h: rowStep - 2,
        });
      }

      geo.metaDrawings.push({
        type: 'qLabel',
        x: colX + numColW - (isA5 ? 10 : 14),
        y: cy,
        text: String(idx + 1).padStart(2, '0'),
      });

      const qEntry: { qNum: number; options: SheetGeometry['part1Bubbles'][number]['options'] } = {
        qNum: idx + 1,
        options: [],
      };
      choices.forEach((ch, cIdx) => {
        const bx = colX + numColW + optStep * (cIdx + 0.5);
        qEntry.options.push({
          label: ch,
          nx: normX(bx),
          ny: normY(cy),
          nr: normR(bubbleR),
          px: bx,
          py: cy,
          pr: bubbleR,
        });
      });
      geo.part1Bubbles.push(qEntry);
    }

    curY += finalP1H + dynamicSectionGap;
  }

  // --- PART II: TRUE / FALSE (ĐÚNG / SAI) ---
  if (hasP2) {
    const qCount = cfg.part2Count;
    const cols = p2Cols;
    const rowsOfCards = p2Rows;
    const padX = isA5 ? 16 : 22;
    const padBot = isA5 ? 14 : 20;
    const cardGapX = isA5 ? 14 : 20;
    const cardGapY = isA5 ? 12 : 16;
    const innerW = contentW - padX * 2;
    const cardW = (innerW - (cols - 1) * cardGapX) / cols;
    const cardH = Math.max(
      isA5 ? 130 : 175,
      (p2H - p2HeaderH - padBot - (isA5 ? 12 : 16) - (rowsOfCards - 1) * cardGapY) / rowsOfCards
    );
    const finalP2H =
      p2HeaderH + (isA5 ? 12 : 16) + rowsOfCards * cardH + (rowsOfCards - 1) * cardGapY + padBot;

    geo.metaDrawings.push({
      type: 'sectionBox',
      x: contentLeft,
      y: curY,
      w: contentW,
      h: finalP2H,
      title: `PHẦN II. CÂU TRẮC NGHIỆM ĐÚNG / SAI`,
      subtitle: `${qCount} câu`,
    });

    const subLabels: Array<'a' | 'b' | 'c' | 'd'> = ['a', 'b', 'c', 'd'];
    for (let idx = 0; idx < qCount; idx++) {
      const rCard = Math.floor(idx / cols);
      const cCard = idx % cols;
      const cardX = contentLeft + padX + cCard * (cardW + cardGapX);
      const cardY = curY + p2HeaderH + (isA5 ? 12 : 16) + rCard * (cardH + cardGapY);

      const cardTitleH = isHalfA4 ? 24 : isA5 ? 28 : 36;
      const colHeadH = isHalfA4 ? 20 : isA5 ? 22 : 28;
      const xTrue = cardX + cardW * 0.52;
      const xFalse = cardX + cardW * 0.8;

      geo.metaDrawings.push({
        type: 'subCard',
        x: cardX,
        y: cardY,
        w: cardW,
        h: cardH,
        title: `Câu ${idx + 1}`,
        subHeader: {
          xTrue,
          xFalse,
          y: cardY + cardTitleH + colHeadH * 0.5,
        },
      });

      const subStartY = cardY + cardTitleH + colHeadH;
      const subAvailH = Math.max(40, cardH - cardTitleH - colHeadH - (isA5 ? 6 : 10));
      const subStep = subAvailH / 4;
      const rBubble = Math.min(isA5 ? 13 : 17, subStep * 0.36, cardW * 0.12);

      const qObj: SheetGeometry['part2Bubbles'][number] = { qNum: idx + 1, subs: [] };
      subLabels.forEach((sub, sIdx) => {
        const rowTop = subStartY + sIdx * subStep;
        const sy = rowTop + subStep * 0.5;

        if (sIdx % 2 === 1) {
          geo.metaDrawings.push({
            type: 'rowStripe',
            x: cardX + 3,
            y: rowTop + 1,
            w: cardW - 6,
            h: subStep - 2,
          });
        }

        geo.metaDrawings.push({
          type: 'subLabel',
          x: cardX + cardW * 0.18,
          y: sy,
          text: `${sub})`,
        });

        qObj.subs.push({
          subLabel: sub,
          trueBubble: {
            label: 'Đ',
            nx: normX(xTrue),
            ny: normY(sy),
            nr: normR(rBubble),
            px: xTrue,
            py: sy,
            pr: rBubble,
          },
          falseBubble: {
            label: 'S',
            nx: normX(xFalse),
            ny: normY(sy),
            nr: normR(rBubble),
            px: xFalse,
            py: sy,
            pr: rBubble,
          },
        });
      });
      geo.part2Bubbles.push(qObj);
    }

    curY += finalP2H + dynamicSectionGap;
  }

  // --- PART III: SHORT ANSWER (TRẢ LỜI NGẮN) ---
  if (hasP3) {
    const qCount = cfg.part3Count;
    const cols = p3Cols;
    const rowsOfCards = p3Rows;
    const padX = isA5 ? 14 : 20;
    const padBot = isA5 ? 14 : 20;
    const cardGapX = isA5 ? 10 : 14;
    const cardGapY = isA5 ? 10 : 14;
    const innerW = contentW - padX * 2;
    const cardW = (innerW - (cols - 1) * cardGapX) / cols;

    const remH = Math.max(180, bottomLimit - curY - (reserveFooter ? sigBoxH + dynamicSectionGap : 0));
    const maxP3CardH = isA5 ? 500 : 740;
    const rawCardH =
      (Math.min(remH, Math.max(p3H, remH * 0.92)) -
        p3HeaderH -
        padBot -
        (isA5 ? 12 : 16) -
        (rowsOfCards - 1) * cardGapY) /
      rowsOfCards;
    const cardH = Math.min(maxP3CardH, Math.max(isA5 ? 210 : 280, rawCardH));
    const finalP3H = Math.min(
      Math.max(180, bottomLimit - curY),
      p3HeaderH + (isA5 ? 12 : 16) + rowsOfCards * cardH + (rowsOfCards - 1) * cardGapY + padBot
    );

    geo.metaDrawings.push({
      type: 'sectionBox',
      x: contentLeft,
      y: curY,
      w: contentW,
      h: finalP3H,
      title: `PHẦN III. CÂU TRẮC NGHIỆM TRẢ LỜI NGẮN`,
      subtitle: `${qCount} câu`,
    });

    const symbols = ['-', ',', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
    for (let idx = 0; idx < qCount; idx++) {
      const rCard = Math.floor(idx / cols);
      const cCard = idx % cols;
      const cardX = contentLeft + padX + cCard * (cardW + cardGapX);
      const cardY = curY + p3HeaderH + (isA5 ? 12 : 16) + rCard * (cardH + cardGapY);

      const cardTitleH = isHalfA4 ? 24 : isA5 ? 26 : 34;
      const cPadX = isA5 ? 10 : 14;
      const cSpan = cardW - cPadX * 2;
      const cStep = cSpan / 4;
      const cStart = cardX + cPadX + cStep * 0.5;

      const writeBoxSize = Math.min(isHalfA4 ? 24 : isA5 ? 28 : 38, cStep - (isA5 ? 4 : 6));
      const writeBoxY = cardY + cardTitleH + (isA5 ? 6 : 8);
      const writeInCells = [0, 1, 2, 3].map((c) => ({
        x: cStart + c * cStep - writeBoxSize / 2,
        y: writeBoxY,
        w: writeBoxSize,
        h: writeBoxSize,
      }));

      geo.metaDrawings.push({
        type: 'subCard',
        x: cardX,
        y: cardY,
        w: cardW,
        h: cardH,
        title: `Câu ${idx + 1}`,
        writeInCells,
      });

      const gridTop = writeBoxY + writeBoxSize + (isA5 ? 8 : 12);
      const gridH = Math.max(80, cardH - (gridTop - cardY) - (isA5 ? 8 : 12));
      const rStep = gridH / symbols.length;
      const rBubble = Math.min(isA5 ? 9.5 : 12.5, rStep * 0.4, cStep * 0.39);

      const qObj: SheetGeometry['part3Bubbles'][number] = {
        qNum: idx + 1,
        cols: [[], [], [], []],
      };
      symbols.forEach((sym, rIdx) => {
        const rowTop = gridTop + rIdx * rStep;
        const by = rowTop + rStep * 0.5;

        if (rIdx >= 2 && (rIdx - 2) % 2 === 1) {
          geo.metaDrawings.push({
            type: 'rowStripe',
            x: cardX + 3,
            y: rowTop + 0.5,
            w: cardW - 6,
            h: rStep - 1,
          });
        }

        for (let c = 0; c < 4; c++) {
          if ((c === 0 && sym === ',') || (c > 0 && sym === '-')) continue;
          const bx = cStart + c * cStep;
          qObj.cols[c].push({
            label: sym,
            nx: normX(bx),
            ny: normY(by),
            nr: normR(rBubble),
            px: bx,
            py: by,
            pr: rBubble,
          });
        }
      });
      geo.part3Bubbles.push(qObj);
    }

    curY += finalP3H + dynamicSectionGap;
  }

  // 5. Optional balanced Signature & Teacher Review Footer when vertical breathing room remains
  const remainingBottomSpace = bottomLimit - curY;
  if (remainingBottomSpace >= sigBoxH - 6) {
    const actualSigH = Math.min(
      isHalfA4 ? 104 : isA5 ? 116 : 156,
      Math.max(sigBoxH, remainingBottomSpace * 0.65)
    );
    geo.metaDrawings.push({
      type: 'signatureFooter',
      x: contentLeft,
      y: bottomLimit - actualSigH,
      w: contentW,
      h: actualSigH,
    });
  }

  return geo;
}

export function renderSingleOmrSheetToCanvas(
  targetCanvas: HTMLCanvasElement,
  cfg: SheetConfig,
  filledSample: SampleFillData | null = null
): SheetGeometry {
  const geo = buildSheetGeometry(cfg);
  targetCanvas.width = geo.W;
  targetCanvas.height = geo.H;
  const ctx = targetCanvas.getContext('2d');
  if (!ctx) return geo;

  // Clean paper white background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, geo.W, geo.H);

  // 1. 4 solid black fiducial corner markers (strictly high-contrast for corner detection)
  const m = geo.margin;
  const ms = geo.markerSize;
  ctx.fillStyle = '#000000';
  ctx.fillRect(m, m, ms, ms);
  ctx.fillRect(geo.W - m - ms, m, ms, ms);
  ctx.fillRect(m, geo.H - m - ms, ms, ms);
  ctx.fillRect(geo.W - m - ms, geo.H - m - ms, ms, ms);

  // Refined light outer scan boundary connecting fiducial centers
  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 2;
  ctx.strokeRect(geo.scanLeft, geo.scanTop, geo.scanW, geo.scanH);

  // Subtle rhythm timing ticks along vertical edges (inset safely away from corner ROIs)
  ctx.fillStyle = '#475569';
  const tickCount = geo.isLandscapeA5 ? 14 : geo.isA5 ? 18 : 26;
  for (let t = 3; t <= tickCount - 3; t++) {
    const ty = geo.scanTop + (geo.scanH * t) / tickCount;
    ctx.fillRect(geo.scanLeft + 10, ty - 2.5, 12, 5);
    ctx.fillRect(geo.scanRight - 22, ty - 2.5, 12, 5);
  }

  // Layer helper so base containers paint first, row stripes second, and cards/headers/labels on top
  const baseTypes = new Set([
    'header',
    'codeHandwritingBox',
    'studentInfoLines',
    'markingGuide',
    'sectionBox',
    'signatureFooter',
  ]);
  const stripeItems = geo.metaDrawings.filter((d) => d.type === 'rowStripe');
  const baseItems = geo.metaDrawings.filter((d) => baseTypes.has(d.type));
  const detailItems = geo.metaDrawings.filter(
    (d) => !baseTypes.has(d.type) && d.type !== 'rowStripe'
  );

  // PASS 1: Base Containers
  baseItems.forEach((item) => {
    if (item.type === 'header') {
      const radius = geo.isA5 ? 10 : 14;
      ctx.fillStyle = '#ffffff';
      drawRoundedRectPath(ctx, item.x, item.y, item.w, item.h, radius);
      ctx.fill();
      ctx.strokeStyle = '#1e3a8a';
      ctx.lineWidth = 2.5;
      ctx.stroke();

      ctx.save();
      drawRoundedRectPath(ctx, item.x, item.y, item.w, item.h, radius);
      ctx.clip();
      ctx.fillStyle = '#1e3a8a';
      ctx.fillRect(item.x, item.y, item.w, geo.isA5 ? 8 : 11);
      ctx.restore();

      const cx = item.x + item.w / 2;
      const maxTxtW = item.w - (geo.isA5 ? 32 : 48);

      ctx.fillStyle = '#1e3a8a';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `700 ${geo.isA5 ? 18 : 24}px "Be Vietnam Pro", Arial, sans-serif`;
      ctx.fillText((item.school || '').toUpperCase(), cx, item.y + item.h * 0.27, maxTxtW);

      const lineW = Math.min(item.w * 0.42, geo.isA5 ? 220 : 320);
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx - lineW / 2, item.y + item.h * 0.41);
      ctx.lineTo(cx + lineW / 2, item.y + item.h * 0.41);
      ctx.stroke();

      ctx.fillStyle = '#0f172a';
      ctx.font = `800 ${geo.isA5 ? 25 : 35}px "Be Vietnam Pro", Arial, sans-serif`;
      ctx.fillText('PHIẾU TRẢ LỜI TRẮC NGHIỆM', cx, item.y + item.h * 0.61, maxTxtW);

      ctx.fillStyle = '#475569';
      ctx.font = `600 ${geo.isA5 ? 16 : 21}px "Be Vietnam Pro", Arial, sans-serif`;
      const subLine = `${item.title}  •  Môn: ${item.subject}  •  ${item.duration}`;
      ctx.fillText(subLine, cx, item.y + item.h * 0.84, maxTxtW);
    } else if (item.type === 'codeHandwritingBox') {
      const radius = geo.isA5 ? 10 : 14;
      ctx.fillStyle = '#f8fafc';
      drawRoundedRectPath(ctx, item.x, item.y, item.w, item.h, radius);
      ctx.fill();
      ctx.strokeStyle = '#1e3a8a';
      ctx.lineWidth = 2.5;
      ctx.stroke();

      const codeBarH = geo.isLandscapeA5 ? 28 : geo.isA5 ? 32 : 42;
      ctx.save();
      drawRoundedRectPath(ctx, item.x, item.y, item.w, item.h, radius);
      ctx.clip();
      ctx.fillStyle = '#1e3a8a';
      ctx.fillRect(item.x, item.y, item.w, codeBarH);
      ctx.restore();

      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `700 ${geo.isA5 ? 15 : 20}px "Be Vietnam Pro", Arial, sans-serif`;
      ctx.fillText('MÃ ĐỀ THI', item.x + item.w / 2, item.y + codeBarH / 2);

      item.cells.forEach((cell, idx) => {
        ctx.fillStyle = '#ffffff';
        drawRoundedRectPath(ctx, cell.x, cell.y, cell.w, cell.h, geo.isA5 ? 6 : 8);
        ctx.fill();
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 2.4;
        ctx.stroke();

        if (filledSample && filledSample.examCode && filledSample.examCode[idx]) {
          ctx.save();
          ctx.fillStyle = '#1d4ed8';
          ctx.font = `700 ${Math.round(cell.h * 0.7)}px "JetBrains Mono", monospace`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(
            filledSample.examCode[idx],
            cell.x + cell.w / 2,
            cell.y + cell.h / 2 + 2
          );
          ctx.restore();
        } else {
          ctx.fillStyle = '#e2e8f0';
          ctx.font = `600 ${Math.round(cell.h * 0.48)}px "JetBrains Mono", monospace`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(
            String((idx + 1) % 10),
            cell.x + cell.w / 2,
            cell.y + cell.h / 2 + 1
          );
        }
      });

      ctx.fillStyle = '#64748b';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `500 ${geo.isA5 ? 12.5 : 16}px "Be Vietnam Pro", Arial, sans-serif`;
      ctx.fillText(
        'Viết rõ từng số bằng bút mực',
        item.x + item.w / 2,
        item.y + item.h - (geo.isA5 ? 12 : 16),
        item.w - 16
      );
    } else if (item.type === 'studentInfoLines') {
      const radius = geo.isA5 ? 10 : 14;
      ctx.fillStyle = '#ffffff';
      drawRoundedRectPath(ctx, item.x, item.y, item.w, item.h, radius);
      ctx.fill();
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 2;
      ctx.stroke();

      const fontSize = geo.isA5 ? 16 : 21;
      ctx.fillStyle = '#1e293b';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.font = `600 ${fontSize}px "Be Vietnam Pro", Arial, sans-serif`;

      const row1Y = item.y + item.h * 0.31;
      const row2Y = item.y + item.h * 0.72;
      const pad = geo.isA5 ? 18 : 26;
      const labelGap = geo.isA5 ? 10 : 14;
      const splitX = item.x + item.w * 0.67;

      const drawFieldWithDots = (
        label: string,
        startX: number,
        endX: number,
        yPos: number
      ) => {
        ctx.fillStyle = '#1e293b';
        ctx.fillText(label, startX, yPos);
        const lblW = ctx.measureText(label).width;
        const lineStart = startX + lblW + labelGap;
        if (endX > lineStart + 12) {
          ctx.save();
          ctx.setLineDash([4, 5]);
          ctx.strokeStyle = '#94a3b8';
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.moveTo(lineStart, yPos + (geo.isA5 ? 6 : 8));
          ctx.lineTo(endX, yPos + (geo.isA5 ? 6 : 8));
          ctx.stroke();
          ctx.restore();
        }
      };

      drawFieldWithDots('Họ và tên:', item.x + pad, splitX - (geo.isA5 ? 18 : 24), row1Y);
      drawFieldWithDots('Lớp:', splitX, item.x + item.w - pad, row1Y);
      drawFieldWithDots('Ngày kiểm tra:', item.x + pad, splitX - (geo.isA5 ? 18 : 24), row2Y);
      drawFieldWithDots('SBD:', splitX, item.x + item.w - pad, row2Y);

      ctx.fillStyle = '#ffffff';
      drawRoundedRectPath(ctx, item.scoreBoxX, item.y, item.scoreBoxW, item.h, radius);
      ctx.fill();
      ctx.strokeStyle = '#1e3a8a';
      ctx.lineWidth = 2;
      ctx.stroke();

      const scoreBarH = geo.isLandscapeA5 ? 23 : geo.isA5 ? 26 : 34;
      ctx.save();
      drawRoundedRectPath(ctx, item.scoreBoxX, item.y, item.scoreBoxW, item.h, radius);
      ctx.clip();
      ctx.fillStyle = '#eff6ff';
      ctx.fillRect(item.scoreBoxX, item.y, item.scoreBoxW, scoreBarH);
      ctx.restore();

      ctx.strokeStyle = '#bfdbfe';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(item.scoreBoxX, item.y + scoreBarH);
      ctx.lineTo(item.scoreBoxX + item.scoreBoxW, item.y + scoreBarH);
      ctx.stroke();

      ctx.fillStyle = '#1e3a8a';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `700 ${geo.isA5 ? 14 : 18}px "Be Vietnam Pro", Arial, sans-serif`;
      ctx.fillText('ĐIỂM SỐ', item.scoreBoxX + item.scoreBoxW / 2, item.y + scoreBarH / 2);
    } else if (item.type === 'markingGuide') {
      const radius = geo.isA5 ? 8 : 10;
      ctx.fillStyle = '#f8fafc';
      drawRoundedRectPath(ctx, item.x, item.y, item.w, item.h, radius);
      ctx.fill();
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      const cy = item.y + item.h / 2;
      const rDemo = geo.isA5 ? 8.5 : 11;
      const fontPx = geo.isA5 ? 13.5 : 17.5;
      const gap1 = geo.isA5 ? 18 : 26;
      const gapIcon = geo.isA5 ? 8 : 11;
      const gap2 = geo.isA5 ? 26 : 40;

      const guidePrefix = 'Lưu ý tô phiếu:';
      const goodTxt = 'Tô kín đậm (Đúng)';
      const badTxt = 'Không gạch chéo, không tô mờ hoặc tô 2 ô';

      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';

      ctx.font = `700 ${fontPx}px "Be Vietnam Pro", Arial, sans-serif`;
      const wPrefix = ctx.measureText(guidePrefix).width;
      const wGood = ctx.measureText(goodTxt).width;
      ctx.font = `500 ${fontPx}px "Be Vietnam Pro", Arial, sans-serif`;
      const wBad = ctx.measureText(badTxt).width;

      const totalGuideW =
        wPrefix + gap1 + rDemo * 2 + gapIcon + wGood + gap2 + rDemo * 2 + gapIcon + wBad;
      let cursorX = item.x + Math.max(geo.isA5 ? 14 : 20, (item.w - totalGuideW) / 2);

      ctx.fillStyle = '#1e3a8a';
      ctx.font = `700 ${fontPx}px "Be Vietnam Pro", Arial, sans-serif`;
      ctx.fillText(guidePrefix, cursorX, cy);
      cursorX += wPrefix + gap1;

      ctx.beginPath();
      ctx.arc(cursorX + rDemo, cy, rDemo, 0, Math.PI * 2);
      ctx.fillStyle = '#0f172a';
      ctx.fill();
      cursorX += rDemo * 2 + gapIcon;

      ctx.fillStyle = '#059669';
      ctx.font = `700 ${fontPx}px "Be Vietnam Pro", Arial, sans-serif`;
      ctx.fillText(goodTxt, cursorX, cy);
      cursorX += wGood + gap2;

      ctx.beginPath();
      ctx.arc(cursorX + rDemo, cy, rDemo, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.strokeStyle = '#475569';
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.strokeStyle = '#dc2626';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cursorX + rDemo * 0.45, cy - rDemo * 0.55);
      ctx.lineTo(cursorX + rDemo * 1.55, cy + rDemo * 0.55);
      ctx.moveTo(cursorX + rDemo * 1.55, cy - rDemo * 0.55);
      ctx.lineTo(cursorX + rDemo * 0.45, cy + rDemo * 0.55);
      ctx.stroke();
      cursorX += rDemo * 2 + gapIcon;

      ctx.fillStyle = '#64748b';
      ctx.font = `500 ${fontPx}px "Be Vietnam Pro", Arial, sans-serif`;
      ctx.fillText(badTxt, cursorX, cy);
    } else if (item.type === 'sectionBox') {
      const radius = geo.isA5 ? 10 : 14;
      const barH = geo.isLandscapeA5 ? 34 : geo.isA5 ? 36 : 46;

      ctx.fillStyle = '#ffffff';
      drawRoundedRectPath(ctx, item.x, item.y, item.w, item.h, radius);
      ctx.fill();

      ctx.save();
      drawRoundedRectPath(ctx, item.x, item.y, item.w, item.h, radius);
      ctx.clip();
      ctx.fillStyle = '#eff6ff';
      ctx.fillRect(item.x, item.y, item.w, barH);
      ctx.strokeStyle = '#bfdbfe';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(item.x, item.y + barH);
      ctx.lineTo(item.x + item.w, item.y + barH);
      ctx.stroke();
      ctx.restore();

      ctx.strokeStyle = '#1e3a8a';
      ctx.lineWidth = 2.4;
      drawRoundedRectPath(ctx, item.x, item.y, item.w, item.h, radius);
      ctx.stroke();

      ctx.fillStyle = '#1e3a8a';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.font = `800 ${geo.isA5 ? 15.5 : 21}px "Be Vietnam Pro", Arial, sans-serif`;
      ctx.fillText(item.title, item.x + (geo.isA5 ? 16 : 22), item.y + barH / 2);

      if (item.subtitle) {
        ctx.fillStyle = '#475569';
        ctx.textAlign = 'right';
        ctx.font = `700 ${geo.isA5 ? 14 : 18}px "JetBrains Mono", monospace`;
        ctx.fillText(item.subtitle, item.x + item.w - (geo.isA5 ? 16 : 22), item.y + barH / 2);
      }
    } else if (item.type === 'signatureFooter') {
      const radius = geo.isA5 ? 10 : 12;
      ctx.fillStyle = '#ffffff';
      drawRoundedRectPath(ctx, item.x, item.y, item.w, item.h, radius);
      ctx.fill();
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 1.8;
      ctx.stroke();

      const col1W = item.w * 0.56;
      const col2W = item.w * 0.22;
      const div1X = item.x + col1W;
      const div2X = item.x + col1W + col2W;

      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(div1X, item.y + 8);
      ctx.lineTo(div1X, item.y + item.h - 8);
      ctx.moveTo(div2X, item.y + 8);
      ctx.lineTo(div2X, item.y + item.h - 8);
      ctx.stroke();

      ctx.fillStyle = '#475569';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.font = `700 ${geo.isA5 ? 13.5 : 17.5}px "Be Vietnam Pro", Arial, sans-serif`;
      ctx.fillText(
        'Nhận xét của giáo viên:',
        item.x + (geo.isA5 ? 16 : 22),
        item.y + (geo.isA5 ? 12 : 16)
      );

      // Subtle dotted writing lines inside teacher comments area
      ctx.save();
      ctx.setLineDash([4, 5]);
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 1.4;
      const padL = item.x + (geo.isA5 ? 16 : 22);
      const padR = div1X - (geo.isA5 ? 16 : 22);
      [0.58, 0.82].forEach((ratio) => {
        ctx.beginPath();
        ctx.moveTo(padL, item.y + item.h * ratio);
        ctx.lineTo(padR, item.y + item.h * ratio);
        ctx.stroke();
      });
      ctx.restore();

      ctx.textAlign = 'center';
      ctx.fillStyle = '#334155';
      ctx.fillText(
        'Chữ ký giám thị',
        div1X + col2W / 2,
        item.y + (geo.isA5 ? 12 : 16)
      );
      ctx.fillText(
        'Chữ ký giáo viên chấm',
        div2X + (item.w - col1W - col2W) / 2,
        item.y + (geo.isA5 ? 12 : 16)
      );
    }
  });

  // PASS 2: Alternating subtle row stripes (rendered on top of section background, under cards/text/bubbles)
  stripeItems.forEach((item) => {
    if (item.type !== 'rowStripe') return;
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(item.x, item.y, item.w, item.h);
  });

  // PASS 3: Column headers, dividers, subCards, and question labels
  detailItems.forEach((item) => {
    if (item.type === 'columnHeader') {
      const cy = item.y + item.h / 2;
      ctx.fillStyle = '#64748b';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.font = `700 ${geo.isA5 ? 13 : 17}px "Be Vietnam Pro", Arial, sans-serif`;
      ctx.fillText('Câu', item.qLabelX, cy);

      ctx.textAlign = 'center';
      ctx.fillStyle = '#1e3a8a';
      ctx.font = `800 ${geo.isA5 ? 14 : 18.5}px "Be Vietnam Pro", Arial, sans-serif`;
      item.optXs.forEach((ox, i) => {
        ctx.fillText(item.labels[i], ox, cy);
      });

      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(item.x + 2, item.y + item.h);
      ctx.lineTo(item.x + item.w - 2, item.y + item.h);
      ctx.stroke();
    } else if (item.type === 'columnDivider') {
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(item.x, item.y1);
      ctx.lineTo(item.x, item.y2);
      ctx.stroke();
    } else if (item.type === 'subCard') {
      const radius = geo.isA5 ? 8 : 10;
      const headH = geo.isLandscapeA5 ? 24 : geo.isA5 ? 26 : 34;

      ctx.save();
      drawRoundedRectPath(ctx, item.x, item.y, item.w, item.h, radius);
      ctx.clip();
      ctx.fillStyle = '#f1f5f9';
      ctx.fillRect(item.x, item.y, item.w, headH);
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(item.x, item.y + headH);
      ctx.lineTo(item.x + item.w, item.y + headH);
      ctx.stroke();
      ctx.restore();

      ctx.strokeStyle = '#64748b';
      ctx.lineWidth = 1.8;
      drawRoundedRectPath(ctx, item.x, item.y, item.w, item.h, radius);
      ctx.stroke();

      ctx.fillStyle = '#0f172a';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `700 ${geo.isA5 ? 15 : 19}px "Be Vietnam Pro", Arial, sans-serif`;
      ctx.fillText(item.title, item.x + item.w / 2, item.y + headH / 2);

      if (item.subHeader) {
        ctx.fillStyle = '#1e3a8a';
        ctx.font = `700 ${geo.isA5 ? 13 : 16.5}px "Be Vietnam Pro", Arial, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText('Đúng', item.subHeader.xTrue, item.subHeader.y);
        ctx.fillText('Sai', item.subHeader.xFalse, item.subHeader.y);

        ctx.strokeStyle = '#e2e8f0';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(item.x + 6, item.subHeader.y + (geo.isA5 ? 10 : 13));
        ctx.lineTo(item.x + item.w - 6, item.subHeader.y + (geo.isA5 ? 10 : 13));
        ctx.stroke();
      }

      if (item.writeInCells) {
        item.writeInCells.forEach((cell) => {
          ctx.fillStyle = '#ffffff';
          drawRoundedRectPath(ctx, cell.x, cell.y, cell.w, cell.h, 4);
          ctx.fill();
          ctx.strokeStyle = '#334155';
          ctx.lineWidth = 1.8;
          ctx.stroke();
        });
      }
    } else if (item.type === 'qLabel') {
      ctx.fillStyle = '#0f172a';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.font = `700 ${geo.isA5 ? 16 : 21}px "JetBrains Mono", monospace`;
      ctx.fillText(item.text, item.x, item.y);
    } else if (item.type === 'subLabel') {
      ctx.fillStyle = '#0f172a';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.font = `700 ${geo.isA5 ? 15.5 : 20}px "Be Vietnam Pro", Arial, sans-serif`;
      ctx.fillText(item.text, item.x, item.y);
    }
  });

  // PASS 4: Draw all OMR answer bubbles
  const drawBubble = (
    b: { px: number; py: number; pr: number; label: string },
    isFilled: boolean
  ) => {
    ctx.beginPath();
    ctx.arc(b.px, b.py, b.pr, 0, Math.PI * 2);
    if (isFilled) {
      ctx.fillStyle = '#111827';
      ctx.fill();
    } else {
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 1.9;
      ctx.stroke();

      ctx.fillStyle = '#64748b';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `600 ${Math.round(b.pr * 1.12)}px "Be Vietnam Pro", Arial, sans-serif`;
      ctx.fillText(b.label, b.px, b.py + 0.5);
    }
  };

  geo.part1Bubbles.forEach((q) => {
    const chosen = filledSample?.part1?.[q.qNum];
    q.options.forEach((opt) => drawBubble(opt, chosen === opt.label));
  });

  geo.part2Bubbles.forEach((q) => {
    const subAns = filledSample?.part2?.[q.qNum] || {};
    q.subs.forEach((s) => {
      const val = subAns[s.subLabel];
      drawBubble(s.trueBubble, val === 'Đ');
      drawBubble(s.falseBubble, val === 'S');
    });
  });

  geo.part3Bubbles.forEach((q) => {
    const strAns = (filledSample?.part3?.[q.qNum] || '').toString();
    for (let c = 0; c < 4; c++) {
      const ch = strAns[c] || '';
      q.cols[c].forEach((b) => drawBubble(b, ch === b.label));
    }
  });

  // PASS 5: Clean centered footer safely inset between bottom fiducial markers
  const footerY = geo.H - (geo.isA5 ? 24 : 32);
  const footerInset = geo.scanLeft + geo.markerSize + (geo.isA5 ? 20 : 32);
  const footerRight = geo.scanRight - geo.markerSize - (geo.isA5 ? 20 : 32);

  ctx.fillStyle = '#64748b';
  ctx.font = `600 ${geo.isA5 ? 13 : 17}px "JetBrains Mono", monospace`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(
    `FORM-${geo.isA5 ? 'A5' : 'A4'} · P1:${cfg.part1Count} · P2:${cfg.part2Count} · P3:${cfg.part3Count}`,
    footerInset,
    footerY
  );
  ctx.textAlign = 'right';
  ctx.font = `600 ${geo.isA5 ? 13 : 17}px "Be Vietnam Pro", Arial, sans-serif`;
  ctx.fillText('PHẠM HẬU -EDU · HỆ THỐNG CHẤM THI OMR', footerRight, footerY);

  return geo;
}

export function renderSheetToCanvas(
  targetCanvas: HTMLCanvasElement,
  cfg: SheetConfig,
  filledSample: SampleFillData | null = null
): SheetGeometry {
  const effectivePaper = resolveEffectivePaperSize(cfg);
  const is2Up = effectivePaper === 'A5' && Boolean(cfg.twoUpA4) && !filledSample;

  if (!is2Up) {
    return renderSingleOmrSheetToCanvas(targetCanvas, cfg, filledSample);
  }

  const singleCanvas = document.createElement('canvas');
  const geo = renderSingleOmrSheetToCanvas(singleCanvas, cfg, null);

  const A4_PORT_W = 2100;
  const A4_PORT_H = 2970;
  targetCanvas.width = A4_PORT_W;
  targetCanvas.height = A4_PORT_H;
  const ctx = targetCanvas.getContext('2d');
  if (!ctx) return geo;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, A4_PORT_W, A4_PORT_H);

  const halfH = A4_PORT_H / 2;
  const offsetX = Math.round((A4_PORT_W - singleCanvas.width) / 2);
  const offsetTop = Math.round((halfH - singleCanvas.height) / 2);
  const offsetBottom = halfH + offsetTop;

  ctx.drawImage(singleCanvas, offsetX, offsetTop);
  ctx.drawImage(singleCanvas, offsetX, offsetBottom);

  const midY = A4_PORT_H / 2;
  ctx.save();
  ctx.setLineDash([18, 14]);
  ctx.strokeStyle = '#64748b';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(30, midY);
  ctx.lineTo(A4_PORT_W - 30, midY);
  ctx.stroke();

  ctx.setLineDash([]);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(A4_PORT_W / 2 - 42, midY - 24, 84, 48);
  ctx.fillStyle = '#475569';
  ctx.font = '700 28px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('✂', A4_PORT_W / 2, midY);
  ctx.restore();

  return geo;
}

export interface CornerPoints {
  tl: { x: number; y: number; detected: boolean };
  tr: { x: number; y: number; detected: boolean };
  bl: { x: number; y: number; detected: boolean };
  br: { x: number; y: number; detected: boolean };
}

export function detectFourCornersFromImageData(
  imgData: ImageData,
  width: number,
  height: number,
  geo: SheetGeometry
): CornerPoints {
  const data = imgData.data;
  const roiRatio = 0.22;
  const roiW = Math.floor(width * roiRatio);
  const roiH = Math.floor(height * roiRatio);
  const expectedMarkerPx = Math.max(10, Math.round((geo.markerSize / geo.W) * width));

  const findFiducialInCorner = (
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    cornerX: number,
    cornerY: number,
    defaultX: number,
    defaultY: number
  ) => {
    const step = Math.max(1, Math.floor(Math.min(width, height) / 480));
    const halfWin = Math.max(4, Math.round(expectedMarkerPx * 0.42));
    const probeStep = Math.max(2, Math.round(halfWin * 0.6));

    // Locate the densest solid black square candidate closest to the sheet corner
    let bestScore = -Infinity;
    let bestCx = defaultX;
    let bestCy = defaultY;
    let foundDense = false;

    for (let cy = y0 + halfWin; cy <= y1 - halfWin; cy += probeStep) {
      for (let cx = x0 + halfWin; cx <= x1 - halfWin; cx += probeStep) {
        let darkCount = 0;
        let total = 0;
        const innerStep = Math.max(1, Math.floor(halfWin / 3));
        for (let py = cy - halfWin; py <= cy + halfWin; py += innerStep) {
          for (let px = cx - halfWin; px <= cx + halfWin; px += innerStep) {
            const idx = (py * width + px) * 4;
            const lum = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
            if (lum < 80) darkCount++;
            total++;
          }
        }
        const density = total > 0 ? darkCount / total : 0;
        if (density >= 0.62) {
          foundDense = true;
          const distNorm = Math.hypot(cx - cornerX, cy - cornerY) / Math.hypot(roiW, roiH);
          const score = density * 2.2 - distNorm;
          if (score > bestScore) {
            bestScore = score;
            bestCx = cx;
            bestCy = cy;
          }
        }
      }
    }

    if (foundDense) {
      // Refine exact centroid tightly around the located fiducial square only
      const refineR = Math.round(expectedMarkerPx * 0.72);
      const rx0 = Math.max(x0, bestCx - refineR);
      const ry0 = Math.max(y0, bestCy - refineR);
      const rx1 = Math.min(x1, bestCx + refineR);
      const ry1 = Math.min(y1, bestCy + refineR);
      let sumX = 0;
      let sumY = 0;
      let count = 0;
      for (let y = ry0; y <= ry1; y += step) {
        for (let x = rx0; x <= rx1; x += step) {
          const idx = (y * width + x) * 4;
          const lum = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
          if (lum < 80) {
            sumX += x;
            sumY += y;
            count++;
          }
        }
      }
      if (count >= 8) {
        return { x: sumX / count, y: sumY / count, detected: true };
      }
    }

    // Fallback to pure-black centroid within inner corner zone if photo is heavily scaled/blurred
    let sumX = 0;
    let sumY = 0;
    let count = 0;
    for (let y = y0; y < y1; y += step) {
      for (let x = x0; x < x1; x += step) {
        const idx = (y * width + x) * 4;
        const lum = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
        if (lum < 50) {
          sumX += x;
          sumY += y;
          count++;
        }
      }
    }
    if (count < 12) return { x: defaultX, y: defaultY, detected: false };
    return { x: sumX / count, y: sumY / count, detected: true };
  };

  const defTL = { x: (geo.scanLeft / geo.W) * width, y: (geo.scanTop / geo.H) * height };
  const defTR = { x: (geo.scanRight / geo.W) * width, y: (geo.scanTop / geo.H) * height };
  const defBL = { x: (geo.scanLeft / geo.W) * width, y: (geo.scanBottom / geo.H) * height };
  const defBR = { x: (geo.scanRight / geo.W) * width, y: (geo.scanBottom / geo.H) * height };

  const tl = findFiducialInCorner(4, 4, roiW, roiH, 0, 0, defTL.x, defTL.y);
  const tr = findFiducialInCorner(width - roiW, 4, width - 4, roiH, width, 0, defTR.x, defTR.y);
  const bl = findFiducialInCorner(4, height - roiH, roiW, height - 4, 0, height, defBL.x, defBL.y);
  const br = findFiducialInCorner(
    width - roiW,
    height - roiH,
    width - 4,
    height - 4,
    width,
    height,
    defBR.x,
    defBR.y
  );

  return { tl, tr, bl, br };
}

export function mapNormalizedToImagePoint(nx: number, ny: number, corners: CornerPoints) {
  const topX = corners.tl.x * (1 - nx) + corners.tr.x * nx;
  const topY = corners.tl.y * (1 - nx) + corners.tr.y * nx;
  const botX = corners.bl.x * (1 - nx) + corners.br.x * nx;
  const botY = corners.bl.y * (1 - nx) + corners.br.y * nx;

  return {
    x: topX * (1 - ny) + botX * ny,
    y: topY * (1 - ny) + botY * ny,
  };
}

export function measureBubbleFillScore(
  imgData: ImageData,
  width: number,
  height: number,
  cx: number,
  cy: number,
  rPx: number
): number {
  const data = imgData.data;
  const rInner = Math.max(2, rPx * 0.65);
  const rOuterStart = rPx * 1.25;
  const rOuterEnd = rPx * 1.75;

  let innerSum = 0;
  let innerCnt = 0;
  let bgSum = 0;
  let bgCnt = 0;

  const minX = Math.max(0, Math.floor(cx - rOuterEnd));
  const maxX = Math.min(width - 1, Math.ceil(cx + rOuterEnd));
  const minY = Math.max(0, Math.floor(cy - rOuterEnd));
  const maxY = Math.min(height - 1, Math.ceil(cy + rOuterEnd));

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const idx = (y * width + x) * 4;
      const lum = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];

      if (dist <= rInner) {
        innerSum += lum;
        innerCnt++;
      } else if (dist >= rOuterStart && dist <= rOuterEnd) {
        bgSum += lum;
        bgCnt++;
      }
    }
  }

  if (innerCnt === 0) return 0;
  const innerAvg = innerSum / innerCnt;
  const bgAvg = bgCnt > 0 ? bgSum / bgCnt : 245;
  const darknessRatio = Math.max(0, (bgAvg - innerAvg) / Math.max(60, bgAvg));
  return Math.min(1, darknessRatio * 1.35);
}

export function cropExamCodeToCanvas(
  sourceCanvas: HTMLCanvasElement,
  targetCropCanvas: HTMLCanvasElement,
  geo: SheetGeometry,
  corners: CornerPoints
): string {
  const cb = geo.codeCropBox;
  const pTL = mapNormalizedToImagePoint(cb.nx, cb.ny, corners);
  const pBR = mapNormalizedToImagePoint(cb.nx + cb.nw, cb.ny + cb.nh, corners);
  const sx = Math.max(0, Math.floor(pTL.x));
  const sy = Math.max(0, Math.floor(pTL.y));
  const sw = Math.max(20, Math.floor(pBR.x - pTL.x));
  const sh = Math.max(12, Math.floor(pBR.y - pTL.y));

  targetCropCanvas.width = 240;
  targetCropCanvas.height = 88;
  const cCtx = targetCropCanvas.getContext('2d');
  if (cCtx) {
    cCtx.fillStyle = '#ffffff';
    cCtx.fillRect(0, 0, targetCropCanvas.width, targetCropCanvas.height);
    cCtx.drawImage(sourceCanvas, sx, sy, sw, sh, 0, 0, targetCropCanvas.width, targetCropCanvas.height);
  }
  return targetCropCanvas.toDataURL('image/png');
}

function classifyDigitFromBinary(bin: Uint8Array, w: number, h: number): string {
  let minX = w;
  let maxX = 0;
  let minY = h;
  let maxY = 0;
  let total = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (bin[y * w + x]) {
        total++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (total === 0) return '0';
  const bw = Math.max(1, maxX - minX + 1);
  const bh = Math.max(1, maxY - minY + 1);
  const aspect = bw / bh;
  if (aspect < 0.36) return '1';

  let topHalf = 0;
  let botHalf = 0;
  let leftHalf = 0;
  let rightHalf = 0;
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (bin[y * w + x]) {
        if (y < midY) topHalf++;
        else botHalf++;
        if (x < midX) leftHalf++;
        else rightHalf++;
      }
    }
  }

  const topRatio = topHalf / total;
  const rightRatio = rightHalf / total;
  if (topRatio > 0.62 && rightRatio > 0.56) return '7';
  if (topRatio > 0.58 && rightRatio <= 0.52) return '5';
  if (topRatio < 0.43 && leftHalf / total > 0.54) return '6';
  if (topRatio < 0.44 && rightRatio > 0.55) return '4';
  if (rightRatio > 0.6) return '3';
  if (Math.abs(topRatio - 0.5) < 0.07 && Math.abs(rightRatio - 0.5) < 0.08) {
    const cX = Math.round(midX);
    const cY = Math.round(midY);
    const centerInk = bin[cY * w + cX] || bin[cY * w + cX + 1] || bin[(cY + 1) * w + cX];
    return centerInk ? '8' : '0';
  }
  return '2';
}

export function recognizeExamCodeOffline(
  sourceCanvas: HTMLCanvasElement,
  geo: SheetGeometry,
  corners: CornerPoints,
  fallbackCode: string
): OcrResult {
  const recognizedDigits: string[] = [];
  let inkBoxesFound = 0;

  for (let i = 0; i < geo.codeBoxes.length; i++) {
    const box = geo.codeBoxes[i];
    const bTL = mapNormalizedToImagePoint(box.nx, box.ny, corners);
    const bBR = mapNormalizedToImagePoint(box.nx + box.nw, box.ny + box.nh, corners);

    const padX = (bBR.x - bTL.x) * 0.14;
    const padY = (bBR.y - bTL.y) * 0.14;
    const bx = Math.max(0, Math.floor(bTL.x + padX));
    const by = Math.max(0, Math.floor(bTL.y + padY));
    const bw = Math.max(8, Math.floor(bBR.x - bTL.x - 2 * padX));
    const bh = Math.max(10, Math.floor(bBR.y - bTL.y - 2 * padY));

    const cellCanvas = document.createElement('canvas');
    cellCanvas.width = 48;
    cellCanvas.height = 64;
    const cellCtx = cellCanvas.getContext('2d');
    if (!cellCtx) continue;
    cellCtx.fillStyle = '#ffffff';
    cellCtx.fillRect(0, 0, 48, 64);
    cellCtx.drawImage(sourceCanvas, bx, by, bw, bh, 4, 4, 40, 56);

    const dImg = cellCtx.getImageData(0, 0, 48, 64);
    const px = dImg.data;
    let inkCount = 0;
    const binary = new Uint8Array(48 * 64);

    for (let p = 0; p < binary.length; p++) {
      const r = px[p * 4];
      const g = px[p * 4 + 1];
      const b = px[p * 4 + 2];
      const isBlueInk = b - r > 22 && b > 70 && r < 175;
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      const isDarkInk = lum < 135;

      if (isBlueInk || isDarkInk) {
        binary[p] = 1;
        inkCount++;
      }
    }

    if (inkCount > 28) {
      inkBoxesFound++;
      recognizedDigits.push(classifyDigitFromBinary(binary, 48, 64));
    } else {
      recognizedDigits.push('');
    }
  }

  const rawDetected = recognizedDigits.join('');
  if (inkBoxesFound === geo.codeBoxes.length && rawDetected.length === geo.codeBoxes.length) {
    return { code: rawDetected, source: 'Nét mực Offline', confidence: 'Trung bình' };
  }

  return {
    code: fallbackCode,
    source: inkBoxesFound > 0 ? `Chưa đủ nét (${rawDetected || '?'})` : 'Mặc định',
    confidence: inkBoxesFound > 0 ? 'Cần kiểm tra' : 'Chưa viết',
  };
}

export async function recognizeExamCodeViaServer(
  croppedDataUrl: string,
  expectedDigits: number,
  fallbackCode: string
): Promise<OcrResult> {
  try {
    const res = await fetch('/api/ocr-exam-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageBase64: croppedDataUrl,
        expectedDigits,
      }),
    });

    const payload = (await res.json().catch(() => ({}))) as {
      code?: string;
      source?: string;
      confidence?: string;
      error?: string;
    };

    if (!res.ok) {
      return {
        code: fallbackCode,
        source: 'Lỗi Gemini AI',
        confidence: 'Cần kiểm tra',
        error: payload.error || `Lỗi máy chủ (${res.status})`,
      };
    }

    if (payload.code) {
      return {
        code: payload.code,
        source: payload.source || 'Gemini AI OCR',
        confidence: payload.confidence || 'Cao',
      };
    }

    return {
      code: fallbackCode,
      source: 'Gemini AI OCR',
      confidence: 'Cần kiểm tra',
      error: 'Không đọc được chữ số rõ ràng trong ô mã đề.',
    };
  } catch (err) {
    return {
      code: fallbackCode,
      source: 'Lỗi kết nối',
      confidence: 'Cần kiểm tra',
      error: err instanceof Error ? err.message : 'Không thể kết nối máy chủ OCR.',
    };
  }
}

export function scanBubblesFromCanvas(
  sourceCanvas: HTMLCanvasElement,
  geo: SheetGeometry,
  corners: CornerPoints,
  thresholdPct: number
): DetectedSheetData {
  const w = sourceCanvas.width;
  const h = sourceCanvas.height;
  const ctx = sourceCanvas.getContext('2d');
  if (!ctx) return { part1: [], part2: [], part3: [] };

  const imgData = ctx.getImageData(0, 0, w, h);
  const thresh = (thresholdPct || 45) / 100;
  const scaleX = Math.hypot(corners.tr.x - corners.tl.x, corners.tr.y - corners.tl.y) / geo.scanW;

  const detectedData: DetectedSheetData = { part1: [], part2: [], part3: [] };

  // Part I
  geo.part1Bubbles.forEach((q) => {
    const scored = q.options.map((opt) => {
      const pt = mapNormalizedToImagePoint(opt.nx, opt.ny, corners);
      const rImg = Math.max(3, opt.pr * scaleX);
      const fill = measureBubbleFillScore(imgData, w, h, pt.x, pt.y, rImg);
      return { label: opt.label, fill, px: pt.x, py: pt.y, pr: rImg };
    });
    const selected = scored.filter((s) => s.fill >= thresh);
    detectedData.part1.push({ qNum: q.qNum, selected, allOptions: scored });
  });

  // Part II
  geo.part2Bubbles.forEach((q) => {
    const subs = q.subs.map((s) => {
      const pT = mapNormalizedToImagePoint(s.trueBubble.nx, s.trueBubble.ny, corners);
      const pF = mapNormalizedToImagePoint(s.falseBubble.nx, s.falseBubble.ny, corners);
      const rImg = Math.max(3, s.trueBubble.pr * scaleX);
      const fT = measureBubbleFillScore(imgData, w, h, pT.x, pT.y, rImg);
      const fF = measureBubbleFillScore(imgData, w, h, pF.x, pF.y, rImg);

      let picked: 'Đ' | 'S' | 'DUP' | '' = '';
      if (fT >= thresh && fF < thresh) picked = 'Đ';
      else if (fF >= thresh && fT < thresh) picked = 'S';
      else if (fT >= thresh && fF >= thresh) picked = 'DUP';

      return {
        subLabel: s.subLabel,
        picked,
        trueBubble: { px: pT.x, py: pT.y, pr: rImg },
        falseBubble: { px: pF.x, py: pF.y, pr: rImg },
      };
    });
    detectedData.part2.push({ qNum: q.qNum, subs });
  });

  // Part III
  geo.part3Bubbles.forEach((q) => {
    let studentStr = '';
    const colResults: DetectedSheetData['part3'][number]['colResults'] = [];
    for (let c = 0; c < 4; c++) {
      const colBubbles = q.cols[c].map((b) => {
        const pt = mapNormalizedToImagePoint(b.nx, b.ny, corners);
        const rImg = Math.max(2.5, b.pr * scaleX);
        const fill = measureBubbleFillScore(imgData, w, h, pt.x, pt.y, rImg);
        return { label: b.label, fill, px: pt.x, py: pt.y, pr: rImg };
      });
      const pickedList = colBubbles.filter((cb) => cb.fill >= thresh);
      if (pickedList.length === 1) {
        studentStr += pickedList[0].label;
        colResults.push({ picked: pickedList[0], colBubbles });
      } else {
        colResults.push({ picked: null, colBubbles });
      }
    }
    detectedData.part3.push({ qNum: q.qNum, studentStr, colResults });
  });

  return detectedData;
}

export function evaluateStudentAnswers(
  detectedData: DetectedSheetData,
  examCode: string,
  sheetConfig: SheetConfig,
  gradingConfig: GradingConfig
): EvaluationResult {
  const keyObj: AnswerKey =
    gradingConfig.answerKeys[examCode] ||
    gradingConfig.answerKeys[gradingConfig.selectedCode] || {
      part1: {},
      part2: {},
      part3: {},
    };

  const pts1 = Number(gradingConfig.ptsPart1) || 0;
  const pts2 = Number(gradingConfig.ptsPart2) || 0;
  const pts3 = Number(gradingConfig.ptsPart3) || 0;
  const p2Mode = gradingConfig.part2Mode || 'progressive';

  let totalScore = 0;
  let maxPossibleScore = 0;
  let correctCount = 0;
  const totalQuestions =
    sheetConfig.part1Count + sheetConfig.part2Count + sheetConfig.part3Count;
  const wrongDetails: string[] = [];
  const overlays: OverlayMarker[] = [];

  // Part I
  detectedData.part1.forEach((item) => {
    maxPossibleScore += pts1;
    const truth = keyObj.part1[item.qNum] || '';
    if (item.selected.length === 1) {
      const chosen = item.selected[0];
      if (truth && chosen.label === truth) {
        correctCount++;
        totalScore += pts1;
        overlays.push({ type: 'correct', px: chosen.px, py: chosen.py, pr: chosen.pr });
      } else {
        overlays.push({ type: 'wrong', px: chosen.px, py: chosen.py, pr: chosen.pr });
        if (truth) {
          const rightOpt = item.allOptions.find((o) => o.label === truth);
          if (rightOpt) overlays.push({ type: 'truth', px: rightOpt.px, py: rightOpt.py, pr: rightOpt.pr });
        }
        wrongDetails.push(`C.${item.qNum}(${chosen.label}→${truth || '?'})`);
      }
    } else if (item.selected.length > 1) {
      item.selected.forEach((s) => overlays.push({ type: 'wrong', px: s.px, py: s.py, pr: s.pr }));
      wrongDetails.push(`C.${item.qNum}(Tô đúp)`);
    } else {
      if (truth) {
        const rightOpt = item.allOptions.find((o) => o.label === truth);
        if (rightOpt) overlays.push({ type: 'truth', px: rightOpt.px, py: rightOpt.py, pr: rightOpt.pr });
      }
      wrongDetails.push(`C.${item.qNum}(Trống)`);
    }
  });

  // Part II
  detectedData.part2.forEach((item) => {
    maxPossibleScore += pts2;
    const truthObj = keyObj.part2[item.qNum] || {};
    let subCorrect = 0;

    item.subs.forEach((s) => {
      const tVal = truthObj[s.subLabel] || '';
      if (s.picked === 'Đ' || s.picked === 'S') {
        const pickedBubble = s.picked === 'Đ' ? s.trueBubble : s.falseBubble;
        if (tVal && s.picked === tVal) {
          subCorrect++;
          overlays.push({ type: 'correct', px: pickedBubble.px, py: pickedBubble.py, pr: pickedBubble.pr });
        } else {
          overlays.push({ type: 'wrong', px: pickedBubble.px, py: pickedBubble.py, pr: pickedBubble.pr });
          if (tVal) {
            const tb = tVal === 'Đ' ? s.trueBubble : s.falseBubble;
            overlays.push({ type: 'truth', px: tb.px, py: tb.py, pr: tb.pr });
          }
        }
      } else if (s.picked === 'DUP') {
        overlays.push({ type: 'wrong', px: s.trueBubble.px, py: s.trueBubble.py, pr: s.trueBubble.pr });
        overlays.push({ type: 'wrong', px: s.falseBubble.px, py: s.falseBubble.py, pr: s.falseBubble.pr });
      } else if (tVal) {
        const tb = tVal === 'Đ' ? s.trueBubble : s.falseBubble;
        overlays.push({ type: 'truth', px: tb.px, py: tb.py, pr: tb.pr });
      }
    });

    let qScore = 0;
    if (p2Mode === 'equal') {
      qScore = pts2 * (subCorrect / 4);
    } else {
      const ratios: Record<number, number> = { 0: 0, 1: 0.1, 2: 0.25, 3: 0.5, 4: 1.0 };
      qScore = pts2 * (ratios[subCorrect] || 0);
    }

    totalScore += qScore;
    if (subCorrect === 4) correctCount++;
    else wrongDetails.push(`P2.C${item.qNum}(${subCorrect}/4 ý)`);
  });

  // Part III
  detectedData.part3.forEach((item) => {
    maxPossibleScore += pts3;
    const truthStr = (keyObj.part3[item.qNum] || '').toString().trim();

    item.colResults.forEach((cr, c) => {
      const tChar = truthStr[c] || '';
      if (cr.picked) {
        if (tChar && cr.picked.label === tChar) {
          overlays.push({ type: 'correct', px: cr.picked.px, py: cr.picked.py, pr: cr.picked.pr });
        } else {
          overlays.push({ type: 'wrong', px: cr.picked.px, py: cr.picked.py, pr: cr.picked.pr });
          if (tChar) {
            const tb = cr.colBubbles.find((b) => b.label === tChar);
            if (tb) overlays.push({ type: 'truth', px: tb.px, py: tb.py, pr: tb.pr });
          }
        }
      } else if (tChar) {
        const tb = cr.colBubbles.find((b) => b.label === tChar);
        if (tb) overlays.push({ type: 'truth', px: tb.px, py: tb.py, pr: tb.pr });
      }
    });

    if (truthStr && item.studentStr === truthStr) {
      correctCount++;
      totalScore += pts3;
    } else {
      wrongDetails.push(`P3.C${item.qNum}("${item.studentStr || '∅'}"→"${truthStr || '?'}")`);
    }
  });

  return {
    score: Math.round(totalScore * 100) / 100,
    maxPossibleScore: Math.round(maxPossibleScore * 100) / 100,
    correctCount,
    totalQuestions,
    wrongDetails,
    overlays,
  };
}

export function renderGradedOverlayCanvas(
  outCanvas: HTMLCanvasElement,
  sourceCanvas: HTMLCanvasElement,
  overlays: OverlayMarker[],
  examCode: string,
  scoreText: string
): string {
  outCanvas.width = sourceCanvas.width;
  outCanvas.height = sourceCanvas.height;
  const outCtx = outCanvas.getContext('2d');
  if (!outCtx) return '';

  outCtx.drawImage(sourceCanvas, 0, 0);

  overlays.forEach((ov) => {
    outCtx.beginPath();
    outCtx.arc(ov.px, ov.py, ov.pr * 1.18, 0, Math.PI * 2);
    if (ov.type === 'correct') {
      outCtx.fillStyle = 'rgba(5, 150, 105, 0.35)';
      outCtx.fill();
      outCtx.strokeStyle = '#059669';
      outCtx.lineWidth = Math.max(2.5, ov.pr * 0.25);
      outCtx.stroke();
    } else if (ov.type === 'wrong') {
      outCtx.fillStyle = 'rgba(220, 38, 38, 0.35)';
      outCtx.fill();
      outCtx.strokeStyle = '#dc2626';
      outCtx.lineWidth = Math.max(2.5, ov.pr * 0.25);
      outCtx.stroke();
    } else if (ov.type === 'truth') {
      outCtx.strokeStyle = '#2563eb';
      outCtx.lineWidth = Math.max(2.5, ov.pr * 0.25);
      outCtx.stroke();
    }
  });

  const badgeW = Math.max(280, outCanvas.width * 0.25);
  const badgeH = Math.max(80, outCanvas.height * 0.056);
  outCtx.fillStyle = 'rgba(30, 58, 138, 0.94)';
  outCtx.beginPath();
  if (typeof outCtx.roundRect === 'function') {
    outCtx.roundRect(18, 18, badgeW, badgeH, 12);
  } else {
    outCtx.rect(18, 18, badgeW, badgeH);
  }
  outCtx.fill();

  outCtx.fillStyle = '#ffffff';
  outCtx.textAlign = 'left';
  outCtx.textBaseline = 'middle';
  outCtx.font = `800 ${Math.round(badgeH * 0.4)}px "Be Vietnam Pro", Arial, sans-serif`;
  outCtx.fillText(`ĐIỂM: ${scoreText}`, 34, 18 + badgeH * 0.38);

  outCtx.fillStyle = '#6ee7b7';
  outCtx.font = `700 ${Math.round(badgeH * 0.24)}px "JetBrains Mono", monospace`;
  outCtx.fillText(`MÃ ĐỀ: ${examCode}`, 34, 18 + badgeH * 0.76);

  return outCanvas.toDataURL('image/jpeg', 0.85);
}

export function createRandomAnswerKey(sheetConfig: SheetConfig): AnswerKey {
  const opts = ['A', 'B', 'C', 'D'];
  const part1: Record<number, string> = {};
  const part2: AnswerKey['part2'] = {};
  const part3: Record<number, string> = {};

  for (let q = 1; q <= sheetConfig.part1Count; q++) {
    part1[q] = opts[Math.floor(Math.random() * 4)];
  }
  for (let q = 1; q <= sheetConfig.part2Count; q++) {
    part2[q] = {
      a: Math.random() > 0.5 ? 'Đ' : 'S',
      b: Math.random() > 0.5 ? 'Đ' : 'S',
      c: Math.random() > 0.5 ? 'Đ' : 'S',
      d: Math.random() > 0.5 ? 'Đ' : 'S',
    };
  }
  const samples3 = ['-2,5', '12', '0,75', '105', '-8', '3,14', '24', '1,5', '40', '-1,2'];
  for (let q = 1; q <= sheetConfig.part3Count; q++) {
    part3[q] = samples3[(q - 1) % samples3.length];
  }
  return { part1, part2, part3 };
}

export function generateSimulatedSampleCanvas(
  sheetConfig: SheetConfig,
  answerKey: AnswerKey,
  examCode: string
): HTMLCanvasElement {
  const opts = ['A', 'B', 'C', 'D'];
  const sampleFill: SampleFillData = {
    examCode,
    part1: {},
    part2: {},
    part3: {},
  };

  for (let q = 1; q <= sheetConfig.part1Count; q++) {
    const truth = answerKey.part1[q] || 'A';
    sampleFill.part1[q] = Math.random() < 0.85 ? truth : opts[(opts.indexOf(truth) + 1) % 4];
  }
  for (let q = 1; q <= sheetConfig.part2Count; q++) {
    const tObj = answerKey.part2[q] || { a: 'Đ', b: 'S', c: 'Đ', d: 'S' };
    sampleFill.part2[q] = {
      a: Math.random() < 0.85 ? tObj.a || 'Đ' : tObj.a === 'Đ' ? 'S' : 'Đ',
      b: Math.random() < 0.85 ? tObj.b || 'S' : tObj.b === 'Đ' ? 'S' : 'Đ',
      c: Math.random() < 0.85 ? tObj.c || 'Đ' : tObj.c === 'Đ' ? 'S' : 'Đ',
      d: Math.random() < 0.85 ? tObj.d || 'S' : tObj.d === 'Đ' ? 'S' : 'Đ',
    };
  }
  for (let q = 1; q <= sheetConfig.part3Count; q++) {
    const tStr = answerKey.part3[q] || '12';
    sampleFill.part3[q] = Math.random() < 0.85 ? tStr : '99';
  }

  const simCanvas = document.createElement('canvas');
  renderSingleOmrSheetToCanvas(simCanvas, sheetConfig, sampleFill);
  return simCanvas;
}

export function exportResultsToCsv(results: GradeResultRecord[]): boolean {
  if (results.length === 0) return false;

  const headers = [
    'STT',
    'Họ và tên / Mã bài',
    'Mã đề',
    'Số câu đúng',
    'Tổng số câu',
    'Điểm số',
    'Thang điểm',
    'Chi tiết sai',
  ];
  const rows = results.map((r, i) => [
    i + 1,
    `"${(r.studentName || '').replace(/"/g, '""')}"`,
    `"${r.examCode}"`,
    r.correctCount,
    r.totalQuestions,
    Number(r.score).toFixed(2).replace('.', ','),
    Number(r.maxScore || 10).toFixed(2).replace('.', ','),
    `"${(r.wrongSummary || '').replace(/"/g, '""')}"`,
  ]);

  const csvContent = '\uFEFF' + [headers.join(';'), ...rows.map((r) => r.join(';'))].join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Bang_Diem_Trac_Nghiem_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  return true;
}

export function playBeepSound(enabled: boolean): void {
  if (!enabled) return;
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const audioCtx = new AudioCtx();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, audioCtx.currentTime);
    gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.14);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.14);
  } catch {
    // Ignore autoplay restrictions
  }
}
