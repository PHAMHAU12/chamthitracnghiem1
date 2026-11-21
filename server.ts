import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '6mb' }));

  app.post('/api/ocr-exam-code', async (req, res) => {
    const { imageBase64, expectedDigits } = req.body ?? {};

    if (typeof imageBase64 !== 'string' || imageBase64.length < 32) {
      res.status(400).json({ error: 'Dữ liệu ảnh cắt mã đề không hợp lệ.' });
      return;
    }

    const digits = Number(expectedDigits) === 4 ? 4 : 3;
    const ai = getGeminiClient();
    if (!ai) {
      res.status(503).json({
        error: 'Chưa thiết lập GEMINI_API_KEY trong Settings > Secrets. Vui lòng kiểm tra cấu hình hoặc chuyển sang chế độ Nhận diện Offline.',
      });
      return;
    }

    const cleanedBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    const prompt = `Đây là ảnh cắt cận cảnh khung ô viết tay MÃ ĐỀ THI bằng bút mực gồm đúng ${digits} chữ số (0-9). Hãy đọc chính xác dãy ${digits} chữ số viết tay (bỏ qua các chữ số in mờ nhạt làm nền nếu có). Trả về JSON với examCode gồm đúng các chữ số đọc được và confidence là "Cao", "Trung bình", hoặc "Thấp".`;

    const retryDelays = [1000, 2000];
    let lastError: unknown = null;

    for (let attempt = 0; attempt <= retryDelays.length; attempt++) {
      try {
        const response = await ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: {
            parts: [
              {
                inlineData: {
                  mimeType: 'image/png',
                  data: cleanedBase64,
                },
              },
              { text: prompt },
            ],
          },
          config: {
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                examCode: {
                  type: Type.STRING,
                  description: `Dãy ${digits} chữ số viết tay của mã đề thi.`,
                },
                confidence: {
                  type: Type.STRING,
                  description: 'Mức độ tin cậy: Cao, Trung bình, hoặc Thấp.',
                },
              },
              required: ['examCode', 'confidence'],
            },
          },
        });

        const rawText = (response.text ?? '').trim();
        if (!rawText) {
          res.status(502).json({ error: 'Gemini AI không trả về kết quả nhận diện.' });
          return;
        }

        const parsed = JSON.parse(rawText) as { examCode?: string; confidence?: string };
        const cleanedCode = String(parsed.examCode ?? '')
          .replace(/\D/g, '')
          .slice(0, digits);

        if (!cleanedCode) {
          res.status(422).json({ error: 'Không nhận diện được chữ số viết tay rõ ràng trong ô Mã đề.' });
          return;
        }

        res.json({
          code: cleanedCode,
          source: 'Gemini AI OCR',
          confidence: parsed.confidence || 'Cao',
        });
        return;
      } catch (err: unknown) {
        lastError = err;
        const message = err instanceof Error ? err.message : String(err);
        const isTransient = /429|500|502|503|504|RESOURCE_EXHAUSTED|UNAVAILABLE/i.test(message);

        if (isTransient && attempt < retryDelays.length) {
          await new Promise((r) => setTimeout(r, retryDelays[attempt]));
          continue;
        }
        break;
      }
    }

    const errMsg = lastError instanceof Error ? lastError.message : 'Lỗi kết nối Gemini AI.';
    if (/403|400|PERMISSION_DENIED|API_KEY_INVALID/i.test(errMsg)) {
      res.status(403).json({
        error: 'Khóa API Gemini không hợp lệ hoặc thiếu quyền. Hãy kiểm tra lại trong Settings > Secrets.',
      });
      return;
    }
    if (/429|RESOURCE_EXHAUSTED/i.test(errMsg)) {
      res.status(429).json({
        error: 'Đã chạm giới hạn lượt gọi Gemini AI. Vui lòng thử lại sau giây lát hoặc chuyển sang chế độ Offline.',
      });
      return;
    }

    res.status(500).json({
      error: `Không thể gọi Gemini AI OCR: ${errMsg}`,
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
