// Vercel Serverless Function: POST /api/parse-expense
// Uses GEMINI_API_KEY from Vercel Environment Variables (never exposed to browser)

const MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash'];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(503).json({
      error: 'Chưa cấu hình GEMINI_API_KEY trên Vercel. Vào Vercel Project Settings -> Environment Variables để thêm khóa miễn phí từ Google AI Studio.',
      code: 'MISSING_API_KEY',
    });
  }

  try {
    const { text = '', imageBase64 = '', mimeType = 'image/jpeg', members = [], today = '' } = req.body || {};

    if (!String(text).trim() && !imageBase64) {
      return res.status(400).json({ error: 'Hãy nhập nội dung chi tiêu hoặc chọn ảnh hóa đơn.' });
    }

    const memberListStr = members
      .map((m) => `- id: "${m.id}", name: "${m.name}"`)
      .join('\n');

    const defaultPayerId = members[0]?.id || 'm_1';
    const fallbackDate = today || new Date().toISOString().slice(0, 10);

    const prompt = `Bạn là trợ lý tách khoản chi tiêu phòng trọ tiếng Việt.
Hãy phân tích câu mô tả và/hoặc ảnh hóa đơn dưới đây thành danh sách các khoản chi tiêu (JSON).

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
2. "amount" phải là số nguyên VNĐ (VD: "120k" -> 120000, "1tr2" -> 1200000, "45.5k" -> 45500). Nếu là ảnh hóa đơn siêu thị/quán ăn, hãy gom thành 1 khoản chi theo TỔNG TIỀN thanh toán cuối cùng trên hóa đơn và ghi tóm tắt các món chính vào "note" (trừ khi người dùng yêu cầu tách riêng).
3. "category" chỉ được chọn 1 trong 5 giá trị:
   - "food" (ăn uống, đi chợ, thịt rau, cơm, nước uống, cà phê, siêu thị thực phẩm)
   - "household" (đồ dùng phòng, nước giặt, giấy vệ sinh, dầu gội, chổi, đồ gia dụng)
   - "utilities" (đổi bình nước, gas, bóng đèn, sửa vặt sinh hoạt chung)
   - "fun" (ăn chơi, lẩu, nhậu, tụ tập, xem phim)
   - "other" (khác)
4. "payerId": đối chiếu tên người trả tiền trong câu (kể cả viết tắt/không dấu) với danh sách thành viên. Nếu không nhắc tới ai trả, dùng "${defaultPayerId}".
5. "date": định dạng YYYY-MM-DD. Nếu hóa đơn có ngày thì lấy ngày đó, nếu nói "hôm qua" thì lùi 1 ngày, mặc định "${fallbackDate}".
6. Nếu có nhiều khoản trong 1 câu (VD: "Minh mua thịt 120k, đổi bình nước 40k"), tách thành nhiều phần tử trong mảng "items".

Nội dung người dùng nhập:
${String(text).trim() || '(Chỉ có ảnh hóa đơn đính kèm)'}`;

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
    let parsedJson = null;

    for (const model of MODELS) {
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
      const cleaned = rawText.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
      parsedJson = JSON.parse(cleaned);
      break;
    }

    if (!parsedJson || !Array.isArray(parsedJson.items)) {
      return res.status(502).json({
        error: lastError || 'AI không đọc được dữ liệu từ nội dung này. Bạn thử nhập rõ hơn nhé.',
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
      error: 'Có lỗi khi gọi Gemini AI: ' + (err?.message || 'Unknown error'),
    });
  }
}
