// Frontend helper for Gemini AI quick expense entry & receipt scanning

export async function compressImageToBase64(file, maxDimension = 1280, quality = 0.78) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Không thể đọc file ảnh.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('File ảnh không hợp lệ.'));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        const base64 = dataUrl.split(',')[1] || '';
        resolve({ base64, mimeType: 'image/jpeg', previewUrl: dataUrl });
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

export async function parseExpenseWithAI({ text, imageBase64, mimeType, members, today }) {
  const response = await fetch('/api/parse-expense', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: text || '',
      imageBase64: imageBase64 || '',
      mimeType: mimeType || 'image/jpeg',
      members: (members || []).map((m) => ({ id: m.id, name: m.name })),
      today: today || new Date().toISOString().slice(0, 10),
    }),
  });

  let data = null;
  try {
    data = await response.json();
  } catch {
    throw new Error('Không kết nối được máy chủ AI (hãy chạy trên Vercel).');
  }

  if (!response.ok) {
    const err = new Error(data?.error || 'Lỗi khi phân tích bằng AI.');
    err.code = data?.code;
    throw err;
  }

  return data.items || [];
}
