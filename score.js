// 返回功能
function goBack() {
  window.history.back();
}

// 前往建议页
function goSuggestion() {
  const questionHistory = JSON.parse(localStorage.getItem('question_history') || '[]');
  let combinedInput = '';
  questionHistory.forEach((item, index) => {
    combinedInput += `第${index + 1}题：\n`;
    combinedInput += `问题：${item.question}\n`;
    combinedInput += `回答：${item.answer}\n\n`;
  });
  localStorage.setItem('suggest_input', combinedInput);
  window.location.href = 'suggestion.html';
}

// 调用工作流生成学生自测评分（流式输出 + 过滤#与*）
async function generateStudentScore() {
  const studentScoreTextarea = document.getElementById('student-score');
  
  try {
    studentScoreTextarea.value = '正在生成学生自测评分，请稍候...';
    
    // 从localStorage获取问答历史记录
    const questionHistory = JSON.parse(localStorage.getItem('question_history') || '[]');
    console.log('当前问答历史记录数量:', questionHistory.length);
    if (questionHistory.length === 0) {
      studentScoreTextarea.value = '暂无问答记录，无法生成评分';
      return;
    }
    
    // 组合问答历史作为输入
    let combinedInput = '';
    questionHistory.forEach((item, index) => {
      combinedInput += `第${index + 1}题：\n`;
      combinedInput += `问题：${item.question}\n`;
      combinedInput += `回答：${item.answer}\n\n`;
    });
    
    const API_URL = 'https://api.coze.cn/v1/workflow/stream_run';
    const API_KEY = 'pat_z67soyyw7Xphmq1QOnfZV9Kl3tfNl4qI4ZC7BWWa4W1eIVV61wvceEY1dtW8v2hK'.trim();
    const WORKFLOW_ID = '7536148723107299347';
    console.log('调用学生自测评分工作流...');
    
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream'
      },
      body: JSON.stringify({
        parameters: { input: combinedInput },
        workflow_id: WORKFLOW_ID
      })
    });
    
    console.log('学生自测评分响应状态:', res.status);
    if (!res.ok) {
      const errorText = await res.text();
      console.error('学生自测评分API错误:', res.status, errorText);
      throw new Error(`API错误: ${res.status}`);
    }
    
    // 流式解析：宽松解析并直接追加，必要时对原始SSE兜底
    if (res.body && typeof res.body.getReader === 'function') {
      studentScoreTextarea.value = '';
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
          try {
            const obj = JSON.parse(data.content);
            if (obj && typeof obj === 'object' && 'output' in obj) textPart = String(obj.output || ''); else textPart = String(data.content);
          } catch (_) {
            textPart = String(data.content);
          }
          if (!textPart) return;
          const chunk = textPart.replace(/[\*#]/g, '');
          studentScoreTextarea.value += chunk;
          finalOutput = studentScoreTextarea.value;
        } catch (e) {
          console.log('解析学生自测评分SSE数据失败:', raw, e);
        }
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
      
      // 兜底：若无内容，尝试从原始SSE文本再解析一遍
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
            try {
              const obj = JSON.parse(data.content);
              if (obj && typeof obj === 'object' && 'output' in obj) textPart = String(obj.output || ''); else textPart = String(data.content);
            } catch (_) {
              textPart = String(data.content);
            }
            if (textPart) {
              studentScoreTextarea.value += textPart.replace(/[\*#]/g, '');
              finalOutput = studentScoreTextarea.value;
            }
          } catch (_) {}
        }
      }
      
      if (!finalOutput) throw new Error('未获取到学生自测评分');
      localStorage.setItem('student_score', finalOutput);
      console.log('学生自测评分生成成功:', finalOutput);
      return;
    }
    
    // 回退：整块解析
    const responseText = await res.text();
    console.log('学生自测评分原始响应:', responseText);
    if (responseText.includes('event: error') || responseText.includes('event: gateway-error')) {
      const lines = responseText.split('\n');
      let errorMsg = '未知错误';
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const errorData = JSON.parse(line.slice(6));
            if (errorData.msg) errorMsg = errorData.msg; else if (errorData.message) errorMsg = errorData.message;
          } catch (e) { console.log('解析错误数据失败:', line); }
        }
      }
      throw new Error(errorMsg);
    }
    
    const lines = responseText.split('\n');
    let scoreContent = '';
    for (const line of lines) {
      const raw = line.trimStart();
      if (!raw.startsWith('data:')) continue;
      const payload = raw.replace(/^data:\s*/, '');
      try {
        const data = JSON.parse(payload);
        if (data.content) {
          try { const contentData = JSON.parse(data.content); if (contentData.output) { scoreContent = contentData.output; } else { scoreContent = String(data.content); } }
          catch (_) { scoreContent = data.content; }
        }
      } catch (e) { console.log('解析学生自测评分SSE数据失败:', raw, e); }
    }
    if (!scoreContent) throw new Error('未获取到学生自测评分');
    const filtered = String(scoreContent).replace(/[\*#]/g, '');
    studentScoreTextarea.value = filtered;
    localStorage.setItem('student_score', filtered);
    console.log('学生自测评分生成成功:', filtered);
    
  } catch (error) {
    console.error('生成学生自测评分失败:', error);
    studentScoreTextarea.value = `生成学生自测评分失败: ${error.message}`;
  }
}

// 页面加载时初始化
document.addEventListener('DOMContentLoaded', () => {
  console.log('评分页面已加载');
  const textareas = document.querySelectorAll('textarea');
  textareas.forEach(textarea => {
    textarea.addEventListener('input', function() {
      const id = this.id;
      localStorage.setItem(id, this.value);
    });
  });
  generateStudentScore();
}); 