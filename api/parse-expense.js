// Vercel Serverless Function: POST /api/parse-expense
// Supports OPENROUTER_API_KEY (recommended) or GEMINI_API_KEY from Vercel Environment Variables

const OPENROUTER_MODELS = [
  'google/gemini-2.0-flash-001',
  'google/gemini-2.5-flash',
  'google/gemini-2.0-flash-exp:free',
  'openrouter/free',
];

const GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash'];

function buildPrompt({ text, members, fallbackDate, defaultPayerId }) {
  const memberListStr = members
    .map((m) => `- id: "${m.id}", name: "${m.name}"`)
    .join('\n');

  return `Bạn là trợ lý tách khoản chi tiêu phòng trọ tiếng Việt.
Hãy phân tích câu mô tả và/hoặc ảnh hóa đơn dưới đây thành danh sách các khoản chi tiêu (CHỈ trả về JSON hợp lệ, không kèm giải thích).

Danh sách thành viên trong phòng:
${memberListStr || '- id: "m_1", name: "Bạn A"'}

Ngày hôm nay: ${fallbackDate}

Quy tắc bắt buộc:
1. Trả về đúng định dạng JSON:
{
  "items": [
    {
      "title": "Tên khoản chi ngắn gọn, rõ ràng bằng tiếng Việt",
      "amount": 120000,
      "category": "food",
      "payerId": "${defaultPayerId}",
      "date": "${fallbackDate}",
      "note": ""
    }
  ]
}
2. "amount" phải là số nguyên VNĐ (VD: "120k" -> 120000, "1tr2" -> 1200000, "45.5k" -> 45500). Nếu là ảnh hóa đơn siêu thị/quán ăn, gom thành 1 khoản chi theo TỔNG TIỀN thanh toán cuối cùng và ghi tóm tắt các món chính vào "note".
3. "category" chỉ chọn 1 trong 5 giá trị: "food", "household", "utilities", "fun", "other".
4. "payerId": đối chiếu tên người trả tiền trong câu (kể cả viết tắt/không dấu) với danh sách thành viên. Nếu không nhắc tới, dùng "${defaultPayerId}".
5. "date": định dạng YYYY-MM-DD. Mặc định "${fallbackDate}".
6. Nếu có nhiều khoản trong 1 câu, tách thành nhiều phần tử trong mảng "items".

Nội dung người dùng nhập:
${String(text).trim() || '(Chỉ có ảnh hóa đơn đính kèm)'}`;
}

function extractJsonObject(rawText) {
  const cleaned = String(rawText || '')
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start !== -1 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    throw new Error('JSON không hợp lệ từ AI');
  }
}

async function callOpenRouter({ apiKey, prompt, imageBase64, mimeType }) {
  const customModel = (process.env.OPENROUTER_MODEL || '').trim();
  const models = customModel
    ? [customModel, ...OPENROUTER_MODELS.filter((m) => m !== customModel)]
    : OPENROUTER_MODELS;

  const userContent = [{ type: 'text', text: prompt }];
  if (imageBase64) {
    userContent.push({
      type: 'image_url',
      image_url: {
        url: `data:${mimeType || 'image/jpeg'};base64,${imageBase64}`,
      },
    });
  }

  let lastError = null;
  for (const model of models) {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://chiatienphong.vercel.app',
        'X-Title': 'TroShare',
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        messages: [{ role: 'user', content: userContent }],
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      lastError = data?.error?.message || `OpenRouter HTTP ${response.status} (${model})`;
      continue;
    }

    const rawText = data?.choices?.[0]?.message?.content || '';
    return extractJsonObject(rawText);
  }

  throw new Error(lastError || 'OpenRouter không trả về dữ liệu hợp lệ.');
}

async function callGemini({ apiKey, prompt, imageBase64, mimeType }) {
  const parts = [{ text: prompt }];
  if (imageBase64) {
    parts.push({
      inlineData: {
        mimeType: mimeType || 'image/jpeg',
        data: imageBase64,
      },
    });
  }

  let lastError = null;
  for (const model of GEMINI_MODELS) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: 'application/json',
        },
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      lastError = data?.error?.message || `Gemini HTTP ${response.status}`;
      continue;
    }

    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return extractJsonObject(rawText);
  }

  throw new Error(lastError || 'Gemini không trả về dữ liệu hợp lệ.');
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const openRouterKey = (process.env.OPENROUTER_API_KEY || '').trim();
  const geminiKey = (process.env.GEMINI_API_KEY || '').trim();

  if (!openRouterKey && !geminiKey) {
    return res.status(503).json({
      error: 'Chưa cấu hình OPENROUTER_API_KEY (hoặc GEMINI_API_KEY) trong Vercel Environment Variables.',
      code: 'MISSING_API_KEY',
    });
  }

  try {
    const { text = '', imageBase64 = '', mimeType = 'image/jpeg', members = [], today = '' } = req.body || {};

    if (!String(text).trim() && !imageBase64) {
      return res.status(400).json({ error: 'Hãy nhập nội dung chi tiêu hoặc chọn ảnh hóa đơn.' });
    }

    const defaultPayerId = members[0]?.id || 'm_1';
    const fallbackDate = today || new Date().toISOString().slice(0, 10);
    const prompt = buildPrompt({ text, members, fallbackDate, defaultPayerId });

    const parsedJson = openRouterKey
      ? await callOpenRouter({ apiKey: openRouterKey, prompt, imageBase64, mimeType })
      : await callGemini({ apiKey: geminiKey, prompt, imageBase64, mimeType });

    if (!parsedJson || !Array.isArray(parsedJson.items)) {
      return res.status(502).json({
        error: 'AI không đọc được dữ liệu từ nội dung này. Bạn thử nhập rõ hơn nhé.',
      });
    }

    const validCategories = new Set(['food', 'household', 'utilities', 'fun', 'other']);
    const validMemberIds = new Set(members.map((m) => m.id));

    const items = parsedJson.items
      .map((item) => ({
        title: String(item.title || 'Khoản chi chung').trim().slice(0, 120),
        amount: Math.max(0, Math.round(Number(item.amount) || 0)),
        category: validCategories.has(item.category) ? item.category : 'other',
        payerId: validMemberIds.has(item.payerId) ? item.payerId : defaultPayerId,
        date: /^\d{4}-\d{2}-\d{2}$/.test(String(item.date || '')) ? item.date : fallbackDate,
        note: String(item.note || '').trim().slice(0, 200),
      }))
      .filter((item) => item.amount > 0);

    return res.status(200).json({ items });
  } catch (err) {
    return res.status(500).json({
      error: 'Có lỗi khi gọi AI: ' + (err?.message || 'Unknown error'),
    });
  }
};
