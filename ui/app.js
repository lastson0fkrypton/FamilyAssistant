const transcriptEl = document.getElementById('transcript');
const sessionIdEl = document.getElementById('sessionId');
const statusEl = document.getElementById('status');
const formEl = document.getElementById('chatForm');
const promptEl = document.getElementById('prompt');
const sendBtn = document.getElementById('sendBtn');
const interruptBtn = document.getElementById('interruptBtn');

const sessionId = crypto.randomUUID();
const history = [];

sessionIdEl.textContent = `session ${sessionId.slice(0, 8)}...`;

function setStatus(value) {
  statusEl.textContent = value;
}

function addMessage(role, content) {
  const row = document.createElement('article');
  row.className = `msg ${role}`;
  row.textContent = content;
  transcriptEl.appendChild(row);
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
}

function nowIso() {
  return new Date().toISOString();
}

async function callOrchestrate(input, isInterrupt = false) {
  const payload = {
    sessionId,
    history,
    input,
    isInterrupt,
  };

  const response = await fetch('/orchestrate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const body = await response.json();
  if (!response.ok || !body.ok) {
    const message = body?.error?.message || 'Request failed';
    throw new Error(message);
  }

  return body.data;
}

formEl.addEventListener('submit', async (event) => {
  event.preventDefault();
  const text = promptEl.value.trim();
  if (!text) return;

  promptEl.value = '';
  addMessage('user', text);
  history.push({ role: 'user', content: text, at: nowIso() });

  setStatus('thinking');
  sendBtn.disabled = true;
  interruptBtn.disabled = false;

  try {
    const result = await callOrchestrate(text, false);
    addMessage('assistant', result.reply || '(no reply)');
    history.push({ role: 'assistant', content: result.reply || '', at: nowIso() });

    if (Array.isArray(result.toolsExecuted) && result.toolsExecuted.length > 0) {
      addMessage('system', `tools: ${result.toolsExecuted.join(', ')}`);
    }
  } catch (error) {
    addMessage('system', `error: ${error.message}`);
  } finally {
    setStatus('idle');
    sendBtn.disabled = false;
    interruptBtn.disabled = true;
    promptEl.focus();
  }
});

promptEl.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' || event.shiftKey) {
    return;
  }

  event.preventDefault();
  formEl.requestSubmit();
});

interruptBtn.addEventListener('click', async () => {
  const text = promptEl.value.trim() || 'User interruption: update current plan with new guidance.';
  promptEl.value = '';

  addMessage('user', `(interrupt) ${text}`);
  history.push({ role: 'user', content: text, at: nowIso() });

  setStatus('replanning');
  sendBtn.disabled = true;
  interruptBtn.disabled = true;

  try {
    const result = await callOrchestrate(text, true);
    addMessage('assistant', result.reply || '(no reply)');
    history.push({ role: 'assistant', content: result.reply || '', at: nowIso() });
  } catch (error) {
    addMessage('system', `error: ${error.message}`);
  } finally {
    setStatus('idle');
    sendBtn.disabled = false;
    promptEl.focus();
  }
});

addMessage('system', 'Welcome to the Family Assistant, How can I help you today?');
interruptBtn.disabled = true;
promptEl.focus();
