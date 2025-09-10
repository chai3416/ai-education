// DOM 元素
const userInput = document.getElementById('user-input');
const teacherResponse = document.getElementById('teacher-response');
const responseStatus = document.getElementById('response-status');
const videoPlayer = document.getElementById('video-player');

// API 配置
const API_URL = 'https://api.coze.cn/v1/workflows/chat';
const API_KEY = 'pat_z67soyyw7Xphmq1QOnfZV9Kl3tfNl4qI4ZC7BWWa4W1eIVV61wvceEY1dtW8v2hK'.trim();
const WORKFLOW_ID = '7534260727356882986';

// 对话历史存储
let chatHistory = [];

// 从 localStorage 加载对话历史（后台保存，不显示）
function loadChatHistory() {
  const saved = localStorage.getItem('coze_chat_history');
  if (saved) {
    try {
      chatHistory = JSON.parse(saved);
    } catch (e) {
      console.error('加载对话历史失败:', e);
      chatHistory = [];
    }
  }
}

// 保存对话历史到 localStorage
function saveChatHistory() {
  try {
    localStorage.setItem('coze_chat_history', JSON.stringify(chatHistory));
  } catch (e) {
    console.error('保存对话历史失败:', e);
  }
}



// 添加消息到历史记录（后台保存，不显示在界面上）
function appendMessage(text, sender) {
  // 保存到对话历史
  chatHistory.push({
    text: text,
    sender: sender,
    timestamp: new Date().toISOString()
  });
  saveChatHistory();
}

// 清空老师回复区域
function clearTeacherResponse() {
  teacherResponse.innerHTML = `
    <div class="response-placeholder">
      <p>AI老师的专业解答将在这里显示</p>
    </div>
  `;
  responseStatus.textContent = '等待提问...';
}

// 显示老师回复
function showTeacherResponse(text) {
  // 过滤掉 * 和 # 符号
  const filteredText = text.replace(/[*#]/g, '');
  
  teacherResponse.innerHTML = `
    <div class="response-content">
      ${filteredText.replace(/\n/g, '<br>')}
      <div class="audio-controls">
        <button class="play-audio-btn" onclick="toggleAudioPlayback('${filteredText.replace(/'/g, "\\'")}')">
          <span class="btn-icon">🔊</span>
          <span class="btn-text">播放语音</span>
        </button>
      </div>
    </div>
  `;
  responseStatus.textContent = '回复完成';
  
  // 注意：语音播放现在在流式处理中处理，这里不再自动播放
}

// 显示加载状态
function showLoading() {
  responseStatus.innerHTML = '<span class="loading"></span> 正在思考中...';
  teacherResponse.innerHTML = `
    <div class="response-placeholder">
      <div class="loading"></div>
      <p>AI老师正在为您准备专业解答...</p>
    </div>
  `;
}

// === 流式渲染：开始/追加/结束 ===
function beginStreamResponse() {
  responseStatus.textContent = '正在回复...';
  teacherResponse.innerHTML = `
    <div class="response-content">
      <div id="response-stream"></div>
    </div>
  `;
}

function appendStreamText(chunk) {
  const el = document.getElementById('response-stream');
  if (!el || !chunk) return;
  const filtered = chunk.replace(/[*#]/g, '');
  el.innerHTML += filtered.replace(/\n/g, '<br>');
  el.scrollTop = el.scrollHeight;
}

function endStreamResponse(finalText) {
  showTeacherResponse(finalText || '');
}

// 发送消息主函数
async function sendMessage() {
  const input = userInput.value.trim();
  if (!input) {
    alert('请输入您的问题');
    return;
  }

  // 清空语音队列，停止当前播放
  voiceQueue = [];
  isPlayingVoice = false;
  if (window.currentPlayingAudio) {
    window.currentPlayingAudio.pause();
    window.currentPlayingAudio = null;
  }
  if (speechSynthesis) {
    speechSynthesis.cancel();
  }

  // 后台保存学生问题（不显示在界面上）。不清空输入框，保持可见
  appendMessage(input, 'user');
  // userInput.value = '';

  // 显示加载状态
  showLoading();

  try {
    console.log('发送请求到:', API_URL);
    console.log('使用 Token:', API_KEY.substring(0, 10) + '...');
    console.log('Token 长度:', API_KEY.length);
    console.log('Token 是否以 pat_ 开头:', API_KEY.startsWith('pat_'));

    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream'
      },
      body: JSON.stringify({
        parameters: {
          BOT_USER_INPUT: input,
          CONVERSATION_NAME: 'Default'
        },
        additional_messages: [
          {
            content_type: 'text',
            role: 'user',
            type: 'question'
          }
        ],
        workflow_id: WORKFLOW_ID
      })
    });

    console.log('响应状态:', res.status);
    console.log('响应头:', res.headers);

    if (!res.ok) {
      const errorText = await res.text();
      console.error('API 错误:', res.status, errorText);
      const errorMsg = `[API 错误: ${res.status}]`;
      appendMessage(errorMsg, 'bot');
      showTeacherResponse(errorMsg);
      return;
    }

    // 优先使用 ReadableStream 实时解析
    if (res.body && typeof res.body.getReader === 'function') {
      beginStreamResponse();

      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let reply = '';
      let currentSegment = '';

      const processLine = (line) => {
        const raw0 = line.replace(/\r$/, '');
        const raw = raw0.trimStart();
        if (!raw.startsWith('data:')) return;
        let payload = raw.replace(/^data:\\s*/, '');
        // 兜底：若仍带有 data: 前缀，再切一次
        if (payload.startsWith('data:')) payload = payload.slice(5).trimStart();
        try {
          const data = JSON.parse(payload);
          if (data && data.content) {
            let textPart = '';
            try {
              const maybeObj = JSON.parse(data.content);
              if (maybeObj && typeof maybeObj === 'object' && 'output' in maybeObj) {
                textPart = String(maybeObj.output || '');
              } else {
                textPart = String(data.content);
              }
            } catch (_) {
              textPart = String(data.content);
            }

            if (textPart) {
              reply += textPart;
              currentSegment += textPart;
              appendStreamText(textPart);

              // 遇到句号则触发语音播放（完整句）
              if (currentSegment.includes('。')) {
                const sentences = currentSegment.split('。');
                for (let i = 0; i < sentences.length - 1; i++) {
                  const sentence = sentences[i].trim();
                  if (sentence && autoVoiceEnabled) {
                    const filtered = sentence.replace(/[*#]/g, '');
                    if (filtered.trim()) {
                      console.log('播放句子:', filtered + '。');
                      playTeacherVoice(filtered + '。');
                    }
                  }
                }
                currentSegment = sentences[sentences.length - 1];
              }
            }
          }
        } catch (e) {
          console.log('解析 SSE 数据失败:', raw, e);
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // 按行处理，保留最后半行
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) processLine(line);
      }
      // 处理残余行
      if (buffer) {
        const rest = buffer.split('\n');
        for (const line of rest) processLine(line);
      }

      // 播放最后一段
      if (currentSegment.trim() && autoVoiceEnabled) {
        const filteredSegment = currentSegment.replace(/[*#]/g, '');
        if (filteredSegment.trim()) {
          const finalSentence = filteredSegment.endsWith('。') ? filteredSegment : filteredSegment + '。';
          console.log('播放最后一句:', finalSentence);
          playTeacherVoice(finalSentence);
        }
      }

      // 结束渲染与入库
      if (reply) {
        appendMessage(reply, 'bot');
        endStreamResponse(reply);
      } else {
        const noReplyMsg = '[未获取到回复]';
        appendMessage(noReplyMsg, 'bot');
        endStreamResponse(noReplyMsg);
      }
      return; // 流式路径已完成
    }

    // 回退：读取完整文本后再解析
    const responseText = await res.text();
    console.log('原始响应文本:', responseText);

    // 错误检查
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
      const fullErrorMsg = `[错误: ${errorMsg}]`;
      appendMessage(fullErrorMsg, 'bot');
      showTeacherResponse(fullErrorMsg);
      return;
    }

    // 非流式解析（原逻辑）
    const lines = responseText.split('\\n');
    let reply = '';
    let currentSegment = '';
    for (const line of lines) {
      const raw = line.trimStart();
      if (raw.startsWith('data:')) {
        try {
          const data = JSON.parse(raw.replace(/^data:\\s*/, ''));
          if (data && data.content) {
            let textPart = '';
            try {
              const maybeObj = JSON.parse(data.content);
              if (maybeObj && typeof maybeObj === 'object' && 'output' in maybeObj) {
                textPart = String(maybeObj.output || '');
              } else {
                textPart = String(data.content);
              }
            } catch (_) {
              textPart = String(data.content);
            }

            if (textPart) {
              reply += textPart;
              currentSegment += textPart;
              if (currentSegment.includes('。')) {
                const sentences = currentSegment.split('。');
                for (let i = 0; i < sentences.length - 1; i++) {
                  const sentence = sentences[i].trim();
                  if (sentence && autoVoiceEnabled) {
                    const filteredSentence = sentence.replace(/[*#]/g, '');
                    if (filteredSentence.trim()) {
                      console.log('播放句子:', filteredSentence + '。');
                      playTeacherVoice(filteredSentence + '。');
                    }
                  }
                }
                currentSegment = sentences[sentences.length - 1];
              }
            }
          }
        } catch (e) {
          console.log('解析 SSE 数据失败:', raw, e);
        }
      }
    }

    if (currentSegment.trim() && autoVoiceEnabled) {
      const filteredSegment = currentSegment.replace(/[*#]/g, '');
      if (filteredSegment.trim()) {
        const finalSentence = filteredSegment.endsWith('。') ? filteredSegment : filteredSegment + '。';
        console.log('播放最后一句:', finalSentence);
        playTeacherVoice(finalSentence);
      }
    }

    if (reply) {
      appendMessage(reply, 'bot');
      showTeacherResponse(reply);
    } else {
      const noReplyMsg = '[未获取到回复]';
      appendMessage(noReplyMsg, 'bot');
      showTeacherResponse(noReplyMsg);
    }
  } catch (err) {
    console.error('请求异常:', err);
    const errorMsg = `[请求失败: ${err.message}]`;
    appendMessage(errorMsg, 'bot');
    showTeacherResponse(errorMsg);
  } finally {
    // 恢复举手按钮状态
    updateRaiseHandButton(false);
  }
}

// 视频上传控制函数
function selectVideo() {
  document.getElementById('video-file-input').click();
}

function handleVideoUpload(event) {
  const file = event.target.files[0];
  if (file) {
    // 检查文件类型
    if (!file.type.startsWith('video/')) {
      alert('请选择视频文件');
      return;
    }
    
    // 创建视频URL
    const videoURL = URL.createObjectURL(file);
    
    // 设置视频源
    videoPlayer.src = videoURL;
    
    // 显示视频播放器，隐藏上传界面
    document.querySelector('.upload-container').style.display = 'none';
    document.getElementById('video-player-container').style.display = 'block';
    
    // 加载视频
    videoPlayer.load();
    
    console.log('视频上传成功:', file.name);
  }
}







function removeVideo() {
  // 清除视频源
  videoPlayer.src = '';
  
  // 隐藏视频播放器，显示上传界面
  document.getElementById('video-player-container').style.display = 'none';
  document.querySelector('.upload-container').style.display = 'flex';
  
  // 清除文件输入
  document.getElementById('video-file-input').value = '';
  
  console.log('视频已移除');
}

// 导出对话记录
function exportChat() {
  if (chatHistory.length === 0) {
    alert('暂无对话记录可导出');
    return;
  }

  const exportData = {
    exportTime: new Date().toISOString(),
    totalMessages: chatHistory.length,
    messages: chatHistory
  };

  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `对话记录_${new Date().toISOString().split('T')[0]}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// 切换主题
function toggleTheme() {
  document.body.classList.toggle('dark-theme');
  const isDark = document.body.classList.contains('dark-theme');
  localStorage.setItem('theme', isDark ? 'dark' : 'light');
}

// 键盘事件处理
userInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// 语音识别功能
let recognition = null;

// 初始化语音识别
function initSpeechRecognition() {
  if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
    recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'zh-CN';
    
    recognition.onstart = function() {
      console.log('语音识别开始...');
      updateRaiseHandButton(true);
    };
    
    recognition.onresult = function(event) {
      const transcript = event.results[0][0].transcript;
      console.log('识别结果:', transcript);
      userInput.value = transcript;
      updateRaiseHandButton(false);
      
      // 语音识别完成后自动发送消息
      setTimeout(() => {
        sendMessage();
      }, 500); // 延迟500ms确保文本已填入
    };
    
    recognition.onerror = function(event) {
      console.error('语音识别错误:', event.error);
      alert('语音识别失败: ' + event.error);
      updateRaiseHandButton(false);
    };
    
    recognition.onend = function() {
      console.log('语音识别结束');
      updateRaiseHandButton(false);
    };
  } else {
    console.error('浏览器不支持语音识别');
    alert('您的浏览器不支持语音识别功能');
  }
}

// 更新举手按钮状态
function updateRaiseHandButton(isListening) {
  const raiseHandBtn = document.querySelector('.raise-hand-btn');
  if (isListening) {
    raiseHandBtn.innerHTML = '<span class="btn-icon">🎤</span><span class="btn-text">正在听...</span>';
    raiseHandBtn.style.background = 'linear-gradient(135deg, #ff9800, #f57c00)';
    raiseHandBtn.disabled = true;
  } else {
    raiseHandBtn.innerHTML = '<span class="btn-icon">✋</span><span class="btn-text">举手</span>';
    raiseHandBtn.style.background = 'linear-gradient(135deg, #4CAF50, #45a049)';
    raiseHandBtn.disabled = false;
  }
}

// 举手功能
function raiseHand() {
  // 获取视频元素
  const videoPlayer = document.getElementById('video-player');
  
  // 如果视频存在且正在播放，则暂停视频
  if (videoPlayer && !videoPlayer.paused) {
    videoPlayer.pause();
    console.log('视频已暂停');
  }
  
  if (!recognition) {
    initSpeechRecognition();
  }
  
  if (recognition) {
    try {
      recognition.start();
    } catch (error) {
      console.error('启动语音识别失败:', error);
      alert('启动语音识别失败，请重试');
    }
  }
}

// 下课功能
function endClass() {
  // 准备对话历史数据
  const teacherResponses = chatHistory.filter(msg => msg.sender === 'bot').map(msg => msg.text).join('\n\n');
  const studentQuestions = chatHistory.filter(msg => msg.sender === 'user').map(msg => msg.text).join('\n\n');
  
  // 保存到localStorage
  localStorage.setItem('class_summary', '光学跃迁');
  localStorage.setItem('teacher_content', teacherResponses);
  localStorage.setItem('student_content', studentQuestions);
  
  // 直接跳转到课堂总结页面
  window.location.href = 'class-summary.html';
}

// 语音合成功能
let speechSynthesis = null;
let currentUtterance = null;
let teacherVoiceProfile = null; // 存储老师语音特征
let autoVoiceEnabled = true; // 自动播放语音开关
let voiceQueue = []; // 语音播放队列
let isPlayingVoice = false; // 是否正在播放语音

// 语音克隆配置
let voiceCloneConfig = {
  // 当前使用的平台
  currentPlatform: 'coze', // 只使用 Coze
  
  // Coze 配置
  coze: {
    apiKey: 'pat_x32hrejFAJXQZN5tkJlJQ5TSjkKON6RM0oQ51GWegVH2KYnM7dW0hHq7gvNyVlmu',
    baseUrl: 'https://api.coze.cn/v1',
    voiceId: '7484882022285049896', // 直接使用您提供的音色 ID
    isReady: true // 直接设置为可用状态
  }
};

// 语音克隆状态
let voiceCloningStatus = {
  isCloning: false,
  isReady: true, // 直接设置为可用
  voiceId: '7484882022285049896', // 直接使用音色 ID
  platform: 'coze'
};

// 初始化语音合成
function initSpeechSynthesis() {
  if ('speechSynthesis' in window) {
    speechSynthesis = window.speechSynthesis;
    console.log('语音合成功能已初始化');
    
    // 等待语音列表加载完成
    speechSynthesis.onvoiceschanged = function() {
      console.log('语音列表已加载');
      setupTeacherVoice();
    };
  } else {
    console.error('浏览器不支持语音合成');
  }
}

// 设置老师语音特征
function setupTeacherVoice() {
  const voices = speechSynthesis.getVoices();
  
  // 优先选择中文女声，模拟老师音色
  const preferredVoices = [
    // 中文女声
    voices.find(voice => voice.lang.includes('zh') && voice.name.includes('Female')),
    voices.find(voice => voice.lang.includes('zh') && voice.name.includes('女')),
    voices.find(voice => voice.lang.includes('zh') && voice.name.includes('Xiaoxiao')),
    voices.find(voice => voice.lang.includes('zh') && voice.name.includes('Yunxi')),
    // 中文声音
    voices.find(voice => voice.lang.includes('zh')),
    // 英文女声作为备选
    voices.find(voice => voice.lang.includes('en') && voice.name.includes('Female')),
    voices.find(voice => voice.lang.includes('en') && voice.name.includes('Samantha')),
    voices.find(voice => voice.lang.includes('en') && voice.name.includes('Victoria'))
  ];
  
  teacherVoiceProfile = preferredVoices.find(voice => voice) || voices[0];
  
  if (teacherVoiceProfile) {
    console.log('设置老师语音:', teacherVoiceProfile.name, teacherVoiceProfile.lang);
  } else {
    console.log('未找到合适的老师语音');
  }
}

// 播放老师语音
async function playTeacherVoice(text) {
  // 检查是否已经在队列中，避免重复添加
  if (voiceQueue.includes(text)) {
    console.log('句子已在队列中，跳过重复添加:', text.substring(0, 20) + '...');
    return;
  }
  
  // 添加到语音队列
  voiceQueue.push(text);
  console.log('添加句子到队列:', text.substring(0, 20) + '...', '队列长度:', voiceQueue.length);
  
  // 如果当前没有播放，开始播放队列
  if (!isPlayingVoice) {
    processVoiceQueue();
  }
}

// 处理语音播放队列
async function processVoiceQueue() {
  if (voiceQueue.length === 0) {
    isPlayingVoice = false;
    console.log('语音队列已清空，播放结束');
    return;
  }
  
  isPlayingVoice = true;
  const text = voiceQueue.shift();
  console.log('开始播放队列中的句子:', text.substring(0, 20) + '...', '剩余队列长度:', voiceQueue.length);
  
  // 优先使用克隆的语音
  if (voiceCloningStatus.isReady && voiceCloningStatus.voiceId) {
    try {
      await playClonedVoice(text);
      // 等待一小段时间后播放下一段
      setTimeout(() => {
        processVoiceQueue();
      }, 200);
    } catch (error) {
      console.error('克隆语音播放失败，使用默认语音:', error);
      await playDefaultVoice(text);
    }
  } else {
    await playDefaultVoice(text);
  }
}

// 播放默认语音（浏览器语音合成）
async function playDefaultVoice(text) {
  if (!speechSynthesis) {
    initSpeechSynthesis();
  }
  
  if (!speechSynthesis) {
    console.error('浏览器不支持语音合成');
    processVoiceQueue();
    return;
  }
  
  // 停止当前播放的语音
  if (currentUtterance) {
    speechSynthesis.cancel();
  }
  
  // 创建新的语音合成实例
  currentUtterance = new SpeechSynthesisUtterance(text);
  
  // 使用设置好的老师语音特征
  if (teacherVoiceProfile) {
    currentUtterance.voice = teacherVoiceProfile;
    currentUtterance.lang = teacherVoiceProfile.lang;
  } else {
    currentUtterance.lang = 'zh-CN';
  }
  
  // 设置语音参数
  currentUtterance.rate = 0.85;
  currentUtterance.pitch = 1.1;
  currentUtterance.volume = 1.0;
  
  // 播放事件处理
  currentUtterance.onstart = function() {
    console.log('开始播放语音段:', text.substring(0, 20) + '...');
  };
  
  currentUtterance.onend = function() {
    console.log('默认语音段播放结束');
    currentUtterance = null;
    // 继续播放队列中的下一段
    setTimeout(() => {
      processVoiceQueue();
    }, 100);
  };
  
  currentUtterance.onerror = function(event) {
    console.error('默认语音播放错误:', event.error);
    currentUtterance = null;
    // 继续播放队列中的下一段
    setTimeout(() => {
      processVoiceQueue();
    }, 100);
  };
  
  // 开始播放
  speechSynthesis.speak(currentUtterance);
}

// 播放克隆的语音
async function playClonedVoice(text) {
  const config = voiceCloneConfig.coze;
  
  if (!config.apiKey || !config.voiceId) {
    console.log('未配置 Coze，使用默认语音');
    throw new Error('未配置 Coze');
  }
  
  try {
    console.log('使用 Coze 克隆语音播放:', text);
    
    const response = await playCozeTTS(text, config);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('Coze TTS 错误详情:', errorText);
      throw new Error(`Coze TTS 错误: ${response.status} - ${errorText}`);
    }
    
    const audioBlob = await response.blob();
    const audioUrl = URL.createObjectURL(audioBlob);
    
    // 播放音频
    const audio = new Audio(audioUrl);
    
    // 存储当前播放的音频对象，用于暂停功能
    window.currentPlayingAudio = audio;
    
    return new Promise((resolve, reject) => {
      audio.onended = function() {
        console.log('Coze 克隆语音播放结束，准备播放下一句');
        URL.revokeObjectURL(audioUrl);
        window.currentPlayingAudio = null;
        resolve();
      };
      
      audio.onerror = function(error) {
        console.error('Coze 克隆语音播放错误:', error);
        URL.revokeObjectURL(audioUrl);
        window.currentPlayingAudio = null;
        reject(error);
      };
      
      audio.play().catch(reject);
    });
    
  } catch (error) {
    console.error('Coze 克隆语音播放失败:', error);
    throw error;
  }
}

// Coze TTS 播放函数
async function playCozeTTS(text, config) {
  // 限制文本长度，避免超出 API 限制
  const maxLength = 1000; // 设置最大长度
  const truncatedText = text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
  
  const requestBody = {
    speed: 0.9,
    voice_id: config.voiceId,
    response_format: 'mp3',
    input: truncatedText
  };
  
  const response = await fetch(`${config.baseUrl}/audio/speech`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(requestBody)
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    console.error('Coze TTS 错误详情:', errorText);
  }
  
  return response;
}

// 切换音频播放/暂停
function toggleAudioPlayback(text) {
  const playBtn = document.querySelector('.play-audio-btn');
  
  // 检查是否有正在播放的音频（Coze TTS）
  if (window.currentPlayingAudio && !window.currentPlayingAudio.paused) {
    // 暂停当前播放
    window.currentPlayingAudio.pause();
    playBtn.innerHTML = '<span class="btn-icon">🔊</span><span class="btn-text">播放语音</span>';
    playBtn.style.background = 'linear-gradient(135deg, #4CAF50, #45a049)';
    playBtn.disabled = false;
    console.log('音频已暂停');
  } else if (window.currentPlayingAudio && window.currentPlayingAudio.paused) {
    // 恢复播放
    window.currentPlayingAudio.play();
    playBtn.innerHTML = '<span class="btn-icon">⏸️</span><span class="btn-text">暂停</span>';
    playBtn.style.background = 'linear-gradient(135deg, #ff9800, #f57c00)';
    playBtn.disabled = false;
    console.log('音频已恢复播放');
  } else if (speechSynthesis && speechSynthesis.speaking) {
    // 暂停浏览器语音合成
    speechSynthesis.pause();
    playBtn.innerHTML = '<span class="btn-icon">🔊</span><span class="btn-text">播放语音</span>';
    playBtn.style.background = 'linear-gradient(135deg, #4CAF50, #45a049)';
    playBtn.disabled = false;
    console.log('浏览器语音合成已暂停');
  } else if (speechSynthesis && speechSynthesis.paused) {
    // 恢复浏览器语音合成
    speechSynthesis.resume();
    playBtn.innerHTML = '<span class="btn-icon">⏸️</span><span class="btn-text">暂停</span>';
    playBtn.style.background = 'linear-gradient(135deg, #ff9800, #f57c00)';
    playBtn.disabled = false;
    console.log('浏览器语音合成已恢复播放');
  } else {
    // 开始新的播放
    playTeacherVoice(text);
  }
}

// 更新播放按钮状态
function updatePlayButton(isPlaying) {
  const playBtn = document.querySelector('.play-audio-btn');
  if (playBtn) {
    if (isPlaying) {
      playBtn.innerHTML = '<span class="btn-icon">⏸️</span><span class="btn-text">暂停</span>';
      playBtn.style.background = 'linear-gradient(135deg, #ff9800, #f57c00)';
      playBtn.disabled = false; // 改为 false，允许点击暂停
    } else {
      playBtn.innerHTML = '<span class="btn-icon">🔊</span><span class="btn-text">播放语音</span>';
      playBtn.style.background = 'linear-gradient(135deg, #4CAF50, #45a049)';
      playBtn.disabled = false;
    }
  }
}

// 切换自动语音播放
function toggleAutoVoice() {
  autoVoiceEnabled = !autoVoiceEnabled;
  
  const voiceToggleBtn = document.getElementById('voice-toggle-btn');
  if (autoVoiceEnabled) {
    voiceToggleBtn.classList.remove('muted');
    voiceToggleBtn.innerHTML = '<span class="btn-icon">🔊</span>';
    voiceToggleBtn.title = '自动播放语音（已开启）';
    console.log('自动语音播放已开启');
  } else {
    voiceToggleBtn.classList.add('muted');
    voiceToggleBtn.innerHTML = '<span class="btn-icon">🔇</span>';
    voiceToggleBtn.title = '自动播放语音（已关闭）';
    console.log('自动语音播放已关闭');
  }
  
  // 保存设置到localStorage
  localStorage.setItem('autoVoiceEnabled', autoVoiceEnabled);
}

// 显示语音克隆配置
function showVoiceCloneConfig() {
  const modal = document.getElementById('voice-clone-config-modal');
  const platformSelect = document.getElementById('platform-select');
  
  // 设置默认选择 Coze
  platformSelect.value = 'coze';
  
  // 显示对应的配置界面
  switchPlatform();
  
  modal.style.display = 'block';
}

// 隐藏语音克隆配置
function hideVoiceCloneConfig() {
  const modal = document.getElementById('voice-clone-config-modal');
  modal.style.display = 'none';
}

// 切换平台
function switchPlatform() {
  const platformSelect = document.getElementById('platform-select');
  const platformConfigs = document.querySelectorAll('.platform-config');
  const instructions = document.getElementById('voice-instructions');
  
  const selectedPlatform = platformSelect.value;
  
  // 隐藏所有平台配置
  platformConfigs.forEach(config => config.style.display = 'none');
  
  // 显示选中的平台配置
  const selectedConfig = document.getElementById(`${selectedPlatform}-config`);
  if (selectedConfig) {
    selectedConfig.style.display = 'block';
  }
  
  // 更新说明文字
  const instructionsMap = {
    'coze': `Coze 语音合成使用说明：
1. 系统已配置好 Coze API Key 和音色 ID
2. AI 老师将直接使用 Coze 平台的音色回答问题
3. 无需上传视频进行语音克隆
4. 音色 ID: 7484882022285049896

注意：Coze 提供高质量的语音合成服务，完全免费使用`
  };
  
  instructions.value = instructionsMap[selectedPlatform] || '';
}

// 保存语音克隆配置
function saveVoiceCloneConfig() {
  const platformSelect = document.getElementById('platform-select');
  const selectedPlatform = platformSelect.value;
  
  // 获取对应平台的配置
  const config = voiceCloneConfig[selectedPlatform];
  let isValid = true;
  
  // 验证配置
  switch (selectedPlatform) {
    case 'coze':
      const apiKey = document.getElementById('coze-api-key').value.trim();
      if (!apiKey) {
        alert('请输入 Coze API Key');
        isValid = false;
      } else {
        config.apiKey = apiKey;
      }
      break;
  }
  
  if (!isValid) return;
  
  // 保存配置
  voiceCloneConfig.currentPlatform = selectedPlatform;
  
  // 保存到localStorage
  localStorage.setItem('voiceCloneConfig', JSON.stringify(voiceCloneConfig));
  
  // 检查是否有已保存的克隆语音ID
  const savedVoiceId = localStorage.getItem('cozeVoiceId');
  if (savedVoiceId && savedVoiceId.trim() !== '') {
    config.voiceId = savedVoiceId;
    voiceCloningStatus.voiceId = savedVoiceId;
    voiceCloningStatus.isReady = true;
    voiceCloningStatus.platform = selectedPlatform;
    console.log(`恢复已保存的 Coze 克隆语音ID:`, savedVoiceId);
  } else {
    // 如果没有保存的音色 ID，使用预设的
    config.voiceId = '7484882022285049896';
    voiceCloningStatus.voiceId = '7484882022285049896';
    voiceCloningStatus.isReady = true;
    voiceCloningStatus.platform = selectedPlatform;
    console.log(`使用预设的 Coze 音色 ID:`, config.voiceId);
  }
  
  hideVoiceCloneConfig();
  alert(`Coze 配置已保存！AI 老师将使用 Coze 平台的音色回答问题。`);
}

// 页面加载时初始化
document.addEventListener('DOMContentLoaded', () => {
  loadChatHistory();
  
  // 恢复主题设置
  const savedTheme = localStorage.getItem('theme');
  if (savedTheme === 'dark') {
    document.body.classList.add('dark-theme');
  }
  
  // 恢复语音设置
  const savedAutoVoice = localStorage.getItem('autoVoiceEnabled');
  if (savedAutoVoice !== null) {
    autoVoiceEnabled = savedAutoVoice === 'true';
  }
  
  // 恢复语音克隆配置
  const savedVoiceCloneConfig = localStorage.getItem('voiceCloneConfig');
  console.log('初始音色 ID:', voiceCloneConfig.coze.voiceId);
  
  if (savedVoiceCloneConfig) {
    try {
      const config = JSON.parse(savedVoiceCloneConfig);
      console.log('从 localStorage 恢复的配置:', config);
      
      // 合并配置，但保留预设的音色 ID
      voiceCloneConfig = { 
        ...voiceCloneConfig, 
        ...config,
        coze: {
          ...voiceCloneConfig.coze,
          ...config.coze,
          // 确保音色 ID 不被覆盖
          voiceId: config.coze?.voiceId || voiceCloneConfig.coze.voiceId
        }
      };
      console.log('恢复语音合成配置:', config.currentPlatform);
      console.log('合并后的音色 ID:', voiceCloneConfig.coze.voiceId);
    } catch (e) {
      console.error('恢复语音合成配置失败:', e);
    }
  }
  
  // 确保音色 ID 存在
  if (!voiceCloneConfig.coze.voiceId) {
    voiceCloneConfig.coze.voiceId = '7484882022285049896';
    voiceCloningStatus.voiceId = '7484882022285049896';
  }
  
  // 确保语音克隆状态正确
  voiceCloningStatus.isReady = true;
  voiceCloningStatus.platform = 'coze';
  voiceCloningStatus.voiceId = voiceCloneConfig.coze.voiceId;
  
  console.log('Coze 语音合成已准备就绪，音色 ID:', voiceCloneConfig.coze.voiceId);
  
  // 初始化语音识别
  initSpeechRecognition();
  
  // 初始化语音合成
  initSpeechSynthesis();
  
  // 更新语音设置按钮状态
  setTimeout(() => {
    const voiceToggleBtn = document.getElementById('voice-toggle-btn');
    if (voiceToggleBtn) {
      if (autoVoiceEnabled) {
        voiceToggleBtn.classList.remove('muted');
        voiceToggleBtn.innerHTML = '<span class="btn-icon">🔊</span>';
        voiceToggleBtn.title = '自动播放语音（已开启）';
      } else {
        voiceToggleBtn.classList.add('muted');
        voiceToggleBtn.innerHTML = '<span class="btn-icon">🔇</span>';
        voiceToggleBtn.title = '自动播放语音（已关闭）';
      }
    }
  }, 100);
});