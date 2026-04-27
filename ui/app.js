const transcriptEl = document.getElementById('transcript');
const sessionIdEl = document.getElementById('sessionId');
const statusEl = document.getElementById('status');
const formEl = document.getElementById('chatForm');
const promptEl = document.getElementById('prompt');
const sendBtn = document.getElementById('sendBtn');
const chatViewEl = document.getElementById('chatView');
const calendarViewEl = document.getElementById('calendarView');
const centerTabButtons = document.querySelectorAll('.center-tab-btn');
const calendarEl = document.getElementById('calendarEl');
const calendarStatusEl = document.getElementById('calendarStatus');
const refreshCalendarBtn = document.getElementById('refreshCalendarBtn');

// Memory elements
const memoryListEl = document.getElementById('memoryList');
const memoryNewFormEl = document.getElementById('memoryNewForm');

const memorySaveFormEl = document.getElementById('memorySaveForm');
const memorySearchFormEl = document.getElementById('memorySearchForm');
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
let calendar = null;
let memoryRows = [];

function setCalendarStatus(text) {
  if (calendarStatusEl) {
    calendarStatusEl.textContent = text;
  }
}

async function fetchEvents() {
  const response = await fetch('/events?limit=200', {
    headers: { 'content-type': 'application/json' },
  });

  const body = await response.json();
  if (!response.ok || !body.ok) {
    throw new Error(body?.error?.message || 'Failed to load events');
  }

  return Array.isArray(body.data) ? body.data : [];
}

async function fetchMemories() {
  const response = await fetch('/memories?limit=200', {
    headers: { 'content-type': 'application/json' },
  });

  const body = await response.json();
  if (!response.ok || !body.ok) {
    throw new Error(body?.error?.message || 'Failed to load memories');
  }

  return Array.isArray(body.data) ? body.data : [];
}

async function refreshMemories() {
  memoryRows = await fetchMemories();
  refreshMemoryResults();
}

async function refreshCalendar() {
  if (!calendar) return;
  setCalendarStatus('Loading events...');
  try {
    const rows = await fetchEvents();
    const fcEvents = rows.map((row) => ({
      id: row.id,
      title: row.title,
      start: row.startsAt,
      end: row.endsAt || undefined,
      allDay: Boolean(row.allDay),
      extendedProps: {
        description: row.description || '',
        location: row.location || '',
      },
    }));

    calendar.removeAllEvents();
    calendar.addEventSource(fcEvents);
    setCalendarStatus(`Loaded ${fcEvents.length} event${fcEvents.length === 1 ? '' : 's'}.`);
  } catch (error) {
    setCalendarStatus(`Calendar load failed: ${error.message}`);
  }
}

function ensureCalendar() {
  if (calendar || !calendarEl || typeof FullCalendar === 'undefined') return;

  calendar = new FullCalendar.Calendar(calendarEl, {
    initialView: 'dayGridMonth',
    headerToolbar: {
      left: 'prev,next today',
      center: 'title',
      right: 'dayGridMonth,timeGridWeek,timeGridDay,listWeek',
    },
    eventTimeFormat: {
      hour: 'numeric',
      minute: '2-digit',
      meridiem: 'short',
    },
    height: '100%',
    nowIndicator: true,
    eventClick: (info) => {
      const desc = info.event.extendedProps.description ? `\n${info.event.extendedProps.description}` : '';
      const loc = info.event.extendedProps.location ? `\nLocation: ${info.event.extendedProps.location}` : '';
      window.alert(`${info.event.title}${desc}${loc}`);
    },
  });

  calendar.render();
}

function switchCenterTab(tab) {
  centerTabButtons.forEach((btn) => btn.classList.toggle('active', btn.dataset.tab === tab));
  const showChat = tab === 'chat';
  chatViewEl.style.display = showChat ? 'flex' : 'none';
  calendarViewEl.style.display = showChat ? 'none' : 'flex';

  if (!showChat) {
    ensureCalendar();
    refreshCalendar();
  }
}

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

async function callOrchestrate(input) {
  const payload = {
    sessionId,
    history,
    input,
  };

  console.log('[CLIENT] Sending orchestrate request:', {
    input: payload.input,
    historyLength: payload.history.length,
    timestamp: new Date().toISOString(),
  });

  const response = await fetch('/orchestrate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const body = await response.json();
  
  console.log('[CLIENT] Orchestrate response:', {
    ok: body.ok,
    reply: body.data?.reply,
    toolsExecuted: body.data?.toolsExecuted,
    done: body.data?.done,
    error: body.error,
    rawResponse: body,
  });

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

centerTabButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    switchCenterTab(btn.dataset.tab || 'chat');
  });
});

if (refreshCalendarBtn) {
  refreshCalendarBtn.addEventListener('click', () => {
    ensureCalendar();
    refreshCalendar();
  });
}


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
    const memoryText = row.memory || row.value || '';
    card.innerHTML = `
      <div>
        <p class="memory-key">memory</p>
        <p class="memory-value">${memoryText}</p>
        <p class="memory-meta">tags: ${tags || '(none)'} | updated: ${row.updatedAt}</p>
      </div>
      <button type="button" class="danger" data-memory="${memoryText.replace(/"/g, '&quot;')}">Delete</button>
    `;

    memoryResultsEl.appendChild(card);
  }
}

function refreshMemoryResults() {
  const query = (memorySearchQueryEl.value || '').trim().toLowerCase();
  if (!query) {
    renderMemoryResults(memoryRows);
    return;
  }

  const filtered = memoryRows.filter((row) => {
    const text = (row.memory || '').toLowerCase();
    const tags = Array.isArray(row.tags) ? row.tags.join(' ').toLowerCase() : '';
    return text.includes(query) || tags.includes(query);
  });

  renderMemoryResults(filtered);
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

  try {
    const result = await callOrchestrate(text);
    console.log('[CLIENT] Processing orchestrate result:', result);
    
    addMessage('assistant', result.reply || '(no reply)');
    history.push({ role: 'assistant', content: result.reply || '', at: nowIso() });

    if (Array.isArray(result.toolsExecuted) && result.toolsExecuted.length > 0) {
      console.log('[CLIENT] Tools executed:', result.toolsExecuted);
      for (const tool of result.toolsExecuted) {
        markToolAsActive(tool);
        addToolToHistory(tool, true, 0);
        window.setTimeout(() => markToolAsInactive(tool), 900);
      }

      if (result.toolsExecuted.some((tool) => tool.startsWith('events.'))) {
        ensureCalendar();
        refreshCalendar();
      }

      if (result.toolsExecuted.some((tool) => tool.startsWith('memory.'))) {
        await refreshMemories();
      }
    }
  } catch (error) {
    addMessage('system', `error: ${error.message}`);
  } finally {
    setStatus('idle');
    sendBtn.disabled = false;
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

memorySaveFormEl.addEventListener('submit', async (event) => {
  event.preventDefault();

  const memory = memoryValueEl.value.trim();
  const tags = (memoryTagsEl.value || '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);

  if (!memory) {
    setMemoryStatus('Memory text is required.');
    return;
  }

  try {
    await executeTool('memory.add', { memory, tags });
    memoryValueEl.value = '';
    memoryTagsEl.value = '';
    setMemoryStatus('Memory added.');
    await refreshMemories();
  } catch (error) {
    setMemoryStatus(`Memory save failed: ${error.message}`);
  }
});

memorySearchFormEl.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    refreshMemoryResults();
    setMemoryStatus('Memory filter applied.');
  } catch (error) {
    setMemoryStatus(`Memory search failed: ${error.message}`);
  }
});

memoryResultsEl.addEventListener('click', async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement)) return;

  const memory = target.dataset.memory;
  if (!memory) return;

  try {
    await executeTool('memory.remove', { memory });
    setMemoryStatus('Memory removed.');
    await refreshMemories();
  } catch (error) {
    setMemoryStatus(`Memory delete failed: ${error.message}`);
  }
});

async function initialize() {
  addMessage('system', 'Welcome to the Family Assistant, How can I help you today?');
  promptEl.focus();

  await fetchAvailableTools();
  await refreshMemories();
  renderToolsHistory();
  switchCenterTab('chat');
}

initialize();
