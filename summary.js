// 返回功能
function goBack() {
  window.history.back();
}

// 开始自测功能
async function startSelfTest() {
  const teacherTextarea = document.getElementById('teacher-content');
  
  try {
    localStorage.removeItem('question_history');
    console.log('已清除之前的问答历史记录，重新开始记录');
    teacherTextarea.value = '正在生成自测内容，请稍候...';
    const API_URL = 'https://api.coze.cn/v1/workflow/stream_run';
    const API_KEY = 'pat_z67soyyw7Xphmq1QOnfZV9Kl3tfNl4qI4ZC7BWWa4W1eIVV61wvceEY1dtW8v2hK'.trim();
    const WORKFLOW_ID = '7535454942850646050';
    console.log('调用自测工作流...');
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream'
      },
      body: JSON.stringify({ parameters: { input: '光学跃迁' }, workflow_id: WORKFLOW_ID })
    });
    console.log('自测响应状态:', res.status);
    if (!res.ok) {
      const errorText = await res.text();
      console.error('自测API错误:', res.status, errorText);
      throw new Error(`API错误: ${res.status}`);
    }
    if (res.body && typeof res.body.getReader === 'function') {
      teacherTextarea.value = '';
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
          if (!data || !data.content) return;
          let textPart = '';
          try {
            const obj = JSON.parse(data.content);
            if (obj && typeof obj === 'object' && 'output' in obj) textPart = String(obj.output || '');
            else textPart = String(data.content);
          } catch (_) { textPart = String(data.content); }
          if (!textPart) return;
          const chunk = textPart.replace(/[\*#]/g, '');
          teacherTextarea.value += chunk;
          finalOutput = teacherTextarea.value;
        } catch (e) { console.log('解析自测SSE数据失败:', raw, e); }
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
      // 如果依旧没有解析到内容，尝试从 rawSseText 再解析一次
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
              if (obj && typeof obj === 'object' && 'output' in obj) textPart = String(obj.output || '');
              else textPart = String(data.content);
            } catch (_) { textPart = String(data.content); }
            if (textPart) {
              teacherTextarea.value += textPart.replace(/[\*#]/g, '');
              finalOutput = teacherTextarea.value;
            }
          } catch (_) {}
        }
      }
      if (!finalOutput) throw new Error('未获取到自测内容');
      localStorage.setItem('teacher_content', finalOutput);
      document.getElementById('student-content').value = '';
      console.log('自测内容生成成功:', finalOutput);
      return;
    }
    const responseText = await res.text();
    console.log('自测原始响应:', responseText);
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
    let selfTestContent = '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      try {
        const data = JSON.parse(line.slice(6));
        if (data.content) {
          try { const contentData = JSON.parse(data.content); if (contentData.output) { selfTestContent = contentData.output; break; } }
          catch (_) { selfTestContent = data.content; }
        }
      } catch (e) { console.log('解析自测SSE数据失败:', line, e); }
    }
    if (!selfTestContent) throw new Error('未获取到自测内容');
    teacherTextarea.value = selfTestContent.replace(/[\*#]/g, '');
    localStorage.setItem('teacher_content', teacherTextarea.value);
    document.getElementById('student-content').value = '';
    console.log('自测内容生成成功:', teacherTextarea.value);
  } catch (error) {
    console.error('生成自测内容失败:', error);
    teacherTextarea.value = `生成自测内容失败: ${error.message}`;
  }
}

// 下一题功能
async function startAnswering() {
  const teacherTextarea = document.getElementById('teacher-content');
  const studentTextarea = document.getElementById('student-content');
  
  try {
    // 保存当前题目和回答到历史记录
    const currentQuestion = teacherTextarea.value;
    const currentAnswer = studentTextarea.value;
    
    if (currentQuestion.trim() && currentAnswer.trim()) {
      let questionHistory = JSON.parse(localStorage.getItem('question_history') || '[]');
      questionHistory.push({
        question: currentQuestion,
        answer: currentAnswer,
        timestamp: new Date().toISOString()
      });
      localStorage.setItem('question_history', JSON.stringify(questionHistory));
      console.log('保存问答对:', { question: currentQuestion, answer: currentAnswer });
    }
    
    teacherTextarea.value = '';
    studentTextarea.value = '';
    teacherTextarea.value = '正在生成下一题内容，请稍候...';
    
    const API_URL = 'https://api.coze.cn/v1/workflow/stream_run';
    const API_KEY = 'pat_z67soyyw7Xphmq1QOnfZV9Kl3tfNl4qI4ZC7BWWa4W1eIVV61wvceEY1dtW8v2hK'.trim();
    const WORKFLOW_ID = '7535454942850646050';
    
    console.log('调用下一题工作流...');
    
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream'
      },
      body: JSON.stringify({
        parameters: {
          input: '光学跃迁'
        },
        workflow_id: WORKFLOW_ID
      })
    });
    
    console.log('下一题响应状态:', res.status);
    
    if (!res.ok) {
      const errorText = await res.text();
      console.error('下一题API错误:', res.status, errorText);
      throw new Error(`API错误: ${res.status}`);
    }
    
    // 流式解析并渲染
    if (res.body && typeof res.body.getReader === 'function') {
      teacherTextarea.value = '';
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
          if (data.content) {
            let textPart = '';
            try {
              const obj = JSON.parse(data.content);
              if (obj && obj.output) textPart = String(obj.output);
            } catch (_) {
              textPart = String(data.content);
            }
            if (textPart) {
              const chunk = String(textPart).replace(/[\*#]/g, '');
              teacherTextarea.value += chunk;
              finalOutput = teacherTextarea.value;
            }
          }
        } catch (e) { console.log('解析下一题SSE数据失败:', raw, e); }
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
            try {
              const obj = JSON.parse(data.content);
              if (obj && typeof obj === 'object' && 'output' in obj) textPart = String(obj.output || '');
              else textPart = String(data.content);
            } catch (_) { textPart = String(data.content); }
            if (textPart) {
              teacherTextarea.value += textPart.replace(/[\*#]/g, '');
              finalOutput = teacherTextarea.value;
            }
          } catch (_) {}
        }
      }
      if (!finalOutput) throw new Error('未获取到下一题内容');
      localStorage.setItem('teacher_content', finalOutput);
      console.log('下一题内容生成成功:', finalOutput);
      return;
    }
    
    // 处理流式响应（回退：整块解析）
    const responseText = await res.text();
    console.log('下一题原始响应:', responseText);
    
    if (responseText.includes('event: error') || responseText.includes('event: gateway-error')) {
      const lines = responseText.split('\n');
      let errorMsg = '未知错误';
      
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const errorData = JSON.parse(line.slice(6));
            if (errorData.msg) {
              errorMsg = errorData.msg;
            } else if (errorData.message) {
              errorMsg = errorData.message;
            }
          } catch (e) {
            console.log('解析错误数据失败:', line);
          }
        }
      }
      throw new Error(errorMsg);
    }
    
    // 解析SSE响应获取下一题内容
    const lines2 = responseText.split('\n');
    let nextQuestionContent = '';
    
    for (const line of lines2) {
      if (line.startsWith('data: ')) {
        try {
          const data = JSON.parse(line.slice(6));
          console.log('下一题SSE数据:', data);
          
          if (data.content) {
            try {
              const contentData = JSON.parse(data.content);
              if (contentData.output) {
                nextQuestionContent = contentData.output;
              } else {
                nextQuestionContent = String(data.content);
              }
            } catch (e) {
              nextQuestionContent = data.content;
            }
          }
        } catch (e) {
          console.log('解析下一题SSE数据失败:', line, e);
        }
      }
    }
    
    if (!nextQuestionContent) {
      throw new Error('未获取到下一题内容');
    }
    
    teacherTextarea.value = String(nextQuestionContent).replace(/[\*#]/g, '');
    localStorage.setItem('teacher_content', teacherTextarea.value);
    console.log('下一题内容生成成功:', teacherTextarea.value);
    
  } catch (error) {
    console.error('生成下一题内容失败:', error);
    teacherTextarea.value = `生成下一题内容失败: ${error.message}`;
  }
}

// 提交功能
function submit() {
  const classSummary = document.getElementById('class-summary').value;
  const teacherContent = document.getElementById('teacher-content').value;
  const studentContent = document.getElementById('student-content').value;
  
  if (teacherContent.trim() && studentContent.trim()) {
    let questionHistory = JSON.parse(localStorage.getItem('question_history') || '[]');
    questionHistory.push({
      question: teacherContent,
      answer: studentContent,
      timestamp: new Date().toISOString()
    });
    localStorage.setItem('question_history', JSON.stringify(questionHistory));
    console.log('保存最后一题问答对:', { question: teacherContent, answer: studentContent });
  }
  
  if (!classSummary.trim() && !teacherContent.trim() && !studentContent.trim()) {
    alert('请至少填写一个区域的内容');
    return;
  }
  
  localStorage.setItem('class_summary', classSummary);
  localStorage.setItem('teacher_content', teacherContent);
  localStorage.setItem('student_content', studentContent);
  
  window.location.href = 'score.html';
}

// 调用工作流生成课堂总结（改为流式输出）
async function generateClassSummary() {
  const classSummaryTextarea = document.getElementById('class-summary');
  try {
    classSummaryTextarea.value = '正在生成课堂总结，请稍候...';
    const API_URL = 'https://api.coze.cn/v1/workflow/stream_run';
    const API_KEY = 'pat_z67soyyw7Xphmq1QOnfZV9Kl3tfNl4qI4ZC7BWWa4W1eIVV61wvceEY1dtW8v2hK'.trim();
    const WORKFLOW_ID = '7535375671633461263';
    console.log('调用课堂总结工作流...');
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream'
      },
      body: JSON.stringify({ parameters: { input: '光学跃迁' }, workflow_id: WORKFLOW_ID })
    });
    console.log('课堂总结响应状态:', res.status);
    if (!res.ok) {
      const errorText = await res.text();
      console.error('课堂总结API错误:', res.status, errorText);
      throw new Error(`API错误: ${res.status}`);
    }
    if (res.body && typeof res.body.getReader === 'function') {
      classSummaryTextarea.value = '';
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
          const chunk = textPart.replace(/[\*#]/g, '');
          classSummaryTextarea.value += chunk;
          finalOutput = classSummaryTextarea.value;
        } catch (e) { console.log('课堂总结SSE解析失败:', raw, e); }
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
              classSummaryTextarea.value += textPart.replace(/[\*#]/g, '');
              finalOutput = classSummaryTextarea.value;
            }
          } catch (_) {}
        }
      }
      if (!finalOutput) throw new Error('未获取到课堂总结');
      localStorage.setItem('class_summary', finalOutput);
      console.log('课堂总结生成成功:', finalOutput);
      return;
    }
    const responseText = await res.text();
    console.log('课堂总结原始响应:', responseText);
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
    const lines2 = responseText.split('\n');
    let classSummary = '';
    for (const line of lines2) {
      if (!line.startsWith('data: ')) continue;
      try {
        const data = JSON.parse(line.slice(6));
        if (data.content) {
          try { const contentData = JSON.parse(data.content); if (contentData.output) { classSummary = contentData.output; break; } }
          catch (_) { classSummary = data.content; }
        }
      } catch (e) { console.log('解析课堂总结SSE数据失败:', line, e); }
    }
    if (!classSummary) throw new Error('未获取到课堂总结');
    const filteredSummary = String(classSummary).replace(/[\*#]/g, '');
    classSummaryTextarea.value = filteredSummary;
    localStorage.setItem('class_summary', filteredSummary);
    console.log('课堂总结生成成功:', filteredSummary);
  } catch (error) {
    console.error('生成课堂总结失败:', error);
    classSummaryTextarea.value = `生成课堂总结失败: ${error.message}`;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  console.log('课堂总结页面已加载');
  const savedClassSummary = localStorage.getItem('class_summary');
  if (savedClassSummary) {
    document.getElementById('class-summary').value = savedClassSummary;
  }
  document.getElementById('teacher-content').value = '';
  document.getElementById('student-content').value = '';
  const textareas = document.querySelectorAll('textarea');
  textareas.forEach(textarea => {
    textarea.addEventListener('input', function() { localStorage.setItem(this.id, this.value); });
  });
  if (savedClassSummary === '光学跃迁') { generateClassSummary(); }
}); 