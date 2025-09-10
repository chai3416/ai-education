document.addEventListener('DOMContentLoaded', async function() {
  const textarea = document.getElementById('suggest-output');
  const combinedInput = localStorage.getItem('suggest_input') || '';
  if (!combinedInput.trim()) {
    textarea.value = '暂无问答日志，无法生成建议。';
    return;
  }

  textarea.value = '正在生成建议，请稍候...';

  const API_URL = 'https://api.coze.cn/v1/workflow/stream_run';
  const API_KEY = 'pat_z67soyyw7Xphmq1QOnfZV9Kl3tfNl4qI4ZC7BWWa4W1eIVV61wvceEY1dtW8v2hK'.trim();
  const WORKFLOW_ID = '7543582111891226670';

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream'
      },
      body: JSON.stringify({ parameters: { input: combinedInput }, workflow_id: WORKFLOW_ID })
    });

    if (!res.ok) {
      const errorText = await res.text();
      textarea.value = `生成失败：HTTP ${res.status}\n${errorText}`;
      return;
    }

    if (res.body && typeof res.body.getReader === 'function') {
      textarea.value = '';
      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let finalOutput = '';
      let rawSseText = '';

      const processLine = (line) => {
        const raw = line.trimStart();
        if (!raw.startsWith('data:')) return;
        const payload = raw.replace(/^data:\s*/, '');
        try {
          const data = JSON.parse(payload);
          if (!data.content) return;
          let textPart = '';
          try { const obj = JSON.parse(data.content); if (obj && obj.output) textPart = String(obj.output); else textPart = String(data.content); }
          catch (_) { textPart = String(data.content); }
          if (!textPart) return;
          textarea.value += textPart.replace(/[\*#]/g, '');
          finalOutput = textarea.value;
        } catch (_) {}
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const decoded = decoder.decode(value, { stream: true });
        rawSseText += decoded;
        buffer += decoded;
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) processLine(line);
      }
      if (buffer) { const rest = buffer.split('\n'); for (const line of rest) processLine(line); }

      if (!finalOutput && rawSseText) {
        const lines = rawSseText.split('\n');
        for (const line of lines) {
          const raw = line.trimStart();
          if (!raw.startsWith('data:')) continue;
          const payload = raw.replace(/^data:\s*/, '');
          try {
            const data = JSON.parse(payload);
            if (!data || !data.content) continue;
            let textPart = '';
            try { const obj = JSON.parse(data.content); if (obj && obj.output) textPart = String(obj.output); else textPart = String(data.content); }
            catch (_) { textPart = String(data.content); }
            if (textPart) {
              textarea.value += textPart.replace(/[\*#]/g, '');
              finalOutput = textarea.value;
            }
          } catch (_) {}
        }
      }

      if (!finalOutput) textarea.value = '未获取到建议内容';
      return;
    }

    const responseText = await res.text();
    const lines = responseText.split('\n');
    let content = '';
    for (const line of lines) {
      const raw = line.trimStart();
      if (!raw.startsWith('data:')) continue;
      const payload = raw.replace(/^data:\s*/, '');
      try {
        const data = JSON.parse(payload);
        if (data.content) {
          try { const obj = JSON.parse(data.content); if (obj && obj.output) { content = obj.output; } else { content = String(data.content); } }
          catch (_) { content = data.content; }
        }
      } catch (_) {}
    }
    textarea.value = (content || '未获取到建议内容').replace(/[\*#]/g, '');
  } catch (err) {
    textarea.value = `生成失败：${err.message}`;
  }
});

