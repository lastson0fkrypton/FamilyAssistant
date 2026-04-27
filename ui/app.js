const transcriptEl = document.getElementById('transcript');
const sessionIdEl = document.getElementById('sessionId');
const statusEl = document.getElementById('status');
const formEl = document.getElementById('chatForm');
const promptEl = document.getElementById('prompt');
const sendBtn = document.getElementById('sendBtn');
const interruptBtn = document.getElementById('interruptBtn');

// Memory elements
const memoryListEl = document.getElementById('memoryList');
const memoryNewFormEl = document.getElementById('memoryNewForm');

const memorySaveFormEl = document.getElementById('memorySaveForm');
const memorySearchFormEl = document.getElementById('memorySearchForm');
const memoryNamespaceEl = document.getElementById('memoryNamespace');
const memoryKeyEl = document.getElementById('memoryKey');
const memoryValueEl = document.getElementById('memoryValue');
const memoryTagsEl = document.getElementById('memoryTags');
const memorySearchQueryEl = document.getElementById('memorySearchQuery');
const memoryResultsEl = document.getElementById('memoryResults');
const memoryStatusEl = document.getElementById('memoryStatus');

const memoryTabButtons = document.querySelectorAll('.memory-tab-btn');


// Tools panel elements
const toolsListEl = document.getElementById('toolsList');
const toolsHistoryEl = document.getElementById('toolsHistory');
const toolsHistoryPanel = document.getElementById('toolsHistoryPanel');
const panelTabButtons = document.querySelectorAll('.panel-tab-btn');

const sessionId = crypto.randomUUID();
const history = [];
const toolsExecutionHistory = [];
let availableTools = [];

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

async function executeTool(tool, args) {
  const response = await fetch('/tools/execute', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      correlationId: crypto.randomUUID(),
      tool,
      args,
    }),
  });

  const body = await response.json();
  if (!response.ok || !body.ok) {
    const message = body?.error?.message || 'Tool request failed';
    throw new Error(message);
  }

  return body.result;
}

async function fetchAvailableTools() {
  try {
    const response = await fetch('/tools', {
      headers: { 'content-type': 'application/json' },
    });

    const body = await response.json();
    if (!response.ok || !body.ok) {
      console.error('Failed to fetch tools');
      return [];
    }

    availableTools = body.data || [];
    renderToolsList();
  } catch (err) {
    console.error('Error fetching tools:', err);
  }
}

function renderToolsList() {
  toolsListEl.innerHTML = '';

  if (!availableTools || availableTools.length === 0) {
    toolsListEl.innerHTML = '<p class="tools-loading">No tools available</p>';
    return;
  }

  for (const tool of availableTools) {
    const item = document.createElement('div');
    item.className = 'tool-item';
    item.id = `tool-${tool.name.replace(/\./g, '-')}`;
    item.innerHTML = `
      <p class="tool-name">${tool.name}</p>
      <p class="tool-desc">${tool.description.substring(0, 80)}...</p>
    `;
    toolsListEl.appendChild(item);
  }
}

function markToolAsActive(toolName) {
  const id = `tool-${toolName.replace(/\./g, '-')}`;
  const el = document.getElementById(id);
  if (el) {
    el.classList.add('active');
  }
}

function markToolAsInactive(toolName) {
  const id = `tool-${toolName.replace(/\./g, '-')}`;
  const el = document.getElementById(id);
  if (el) {
    el.classList.remove('active');
  }
}

function addToolToHistory(toolName, success, durationMs, error = null) {
  const timestamp = nowIso();
  const entry = {
    tool: toolName,
    success,
    durationMs,
    error,
    timestamp,
  };

  toolsExecutionHistory.unshift(entry);
  renderToolsHistory();
}

function renderToolsHistory() {
  toolsHistoryEl.innerHTML = '';

  if (toolsExecutionHistory.length === 0) {
    toolsHistoryEl.innerHTML = '<p class="tools-loading">No tool executions yet</p>';
    return;
  }

  for (const entry of toolsExecutionHistory.slice(0, 20)) {
    const item = document.createElement('div');
    item.className = `tool-history-item ${entry.success ? 'success' : 'error'}`;

    const time = new Date(entry.timestamp);
    const timeStr = time.toLocaleTimeString('en-US', { hour12: false });

    let statusHtml = `<p class="tool-history-status ${entry.success ? 'ok' : 'error'}">
      ${entry.success ? '✓ Success' : '✗ Error'}
    </p>`;

    if (entry.error) {
      statusHtml += `<p class="tool-history-status error" style="font-size: 0.68rem; margin-top: 0.1rem;">
        ${entry.error.substring(0, 60)}${entry.error.length > 60 ? '...' : ''}
      </p>`;
    }

    item.innerHTML = `
      <p class="tool-history-name">${entry.tool}</p>
      <p class="tool-history-time">${timeStr} (${entry.durationMs}ms)</p>
      ${statusHtml}
    `;
    toolsHistoryEl.appendChild(item);
  }
}

panelTabButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    panelTabButtons.forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');

    if (tab === 'tools') {
      toolsListEl.style.display = 'block';
      toolsHistoryPanel.style.display = 'none';
    } else if (tab === 'history') {
      toolsListEl.style.display = 'none';
      toolsHistoryPanel.style.display = 'flex';
    }
  });
});


memoryTabButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    memoryTabButtons.forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');

    if (tab === 'list') {
      memoryListEl.style.display = 'block';
      memoryNewFormEl.style.display = 'none';
    } else if (tab === 'new') {
      memoryListEl.style.display = 'none';
      memoryNewFormEl.style.display = 'block';
    }
  });
});


function setMemoryStatus(text) {
  memoryStatusEl.textContent = text;
}

function renderMemoryResults(rows) {
  memoryResultsEl.innerHTML = '';

  if (!Array.isArray(rows) || rows.length === 0) {
    memoryResultsEl.innerHTML = '<p class="memory-empty">No memories found.</p>';
    return;
  }

  for (const row of rows) {
    const card = document.createElement('article');
    card.className = 'memory-row';

    const tags = Array.isArray(row.tags) ? row.tags.join(', ') : '';
    card.innerHTML = `
      <div>
        <p class="memory-key">${row.namespace}/${row.key}</p>
        <p class="memory-value">${row.value}</p>
        <p class="memory-meta">tags: ${tags || '(none)'} | updated: ${row.updatedAt}</p>
      </div>
      <button type="button" class="danger" data-namespace="${row.namespace}" data-key="${row.key}">Delete</button>
    `;

    memoryResultsEl.appendChild(card);
  }
}

async function refreshMemoryResults() {
  const namespace = (memoryNamespaceEl.value || 'household').trim() || 'household';
  const query = (memorySearchQueryEl.value || '').trim();

  const rows = await executeTool('memory.kv.search', {
    namespace,
    query,
    limit: 20,
  });

  renderMemoryResults(rows);
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
      for (const tool of result.toolsExecuted) {
        markToolAsActive(tool);
        addToolToHistory(tool, true, 0);
        window.setTimeout(() => markToolAsInactive(tool), 900);
      }
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

memorySaveFormEl.addEventListener('submit', async (event) => {
  event.preventDefault();

  const namespace = (memoryNamespaceEl.value || 'household').trim() || 'household';
  const key = memoryKeyEl.value.trim();
  const value = memoryValueEl.value.trim();
  const tags = (memoryTagsEl.value || '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);

  if (!key || !value) {
    setMemoryStatus('Memory key and value are required.');
    return;
  }

  try {
    await executeTool('memory.kv.save', { namespace, key, value, tags });
    memoryKeyEl.value = '';
    memoryValueEl.value = '';
    memoryTagsEl.value = '';
    setMemoryStatus(`Saved memory: ${namespace}/${key}`);
    await refreshMemoryResults();
  } catch (error) {
    setMemoryStatus(`Memory save failed: ${error.message}`);
  }
});

memorySearchFormEl.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await refreshMemoryResults();
    setMemoryStatus('Memory search complete.');
  } catch (error) {
    setMemoryStatus(`Memory search failed: ${error.message}`);
  }
});

memoryResultsEl.addEventListener('click', async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement)) return;

  const namespace = target.dataset.namespace;
  const key = target.dataset.key;
  if (!namespace || !key) return;

  try {
    await executeTool('memory.kv.delete', { namespace, key });
    setMemoryStatus(`Deleted memory: ${namespace}/${key}`);
    await refreshMemoryResults();
  } catch (error) {
    setMemoryStatus(`Memory delete failed: ${error.message}`);
  }
});

async function initialize() {
  addMessage('system', 'Welcome to the Family Assistant, How can I help you today?');
  interruptBtn.disabled = true;
  promptEl.focus();

  await fetchAvailableTools();
  renderToolsHistory();
  await refreshMemoryResults();
}

initialize();
