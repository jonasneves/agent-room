// ── Auth ─────────────────────────────────────────────────────────
const GH_CLIENT_ID  = 'Ov23liv9vcDu4xC3VpWO';
const GH_MODELS_URL = 'https://models.inference.ai.azure.com/chat/completions';
const GH_STORAGE    = 'lab6-auth';

// Reuse the already-registered callback URL from aipi590-lab6.
// The popup will land on lab6, which exchanges the code and postMessages
// the auth back here — no new callback URL needed.
const GH_REDIRECT_URI = 'https://jonasneves.github.io/aipi590-lab6/';

function getGHAuth() {
  try { return JSON.parse(localStorage.getItem(GH_STORAGE)); } catch { return null; }
}

function startLogin() {
  const state = crypto.randomUUID();
  sessionStorage.setItem('oauth_state', state);
  const params = new URLSearchParams({
    client_id: GH_CLIENT_ID,
    redirect_uri: GH_REDIRECT_URI,
    scope: 'read:user',
    state,
  });

  const popup = window.open(
    'https://github.com/login/oauth/authorize?' + params,
    'gh-oauth',
    'width=600,height=700,popup=1'
  );
  if (!popup) { showToast('Allow the login popup and try again', 'error'); return; }

  function onMsg(e) {
    if (e.data?.type !== 'gh-auth') return;
    window.removeEventListener('message', onMsg);
    if (e.data.auth) {
      localStorage.setItem(GH_STORAGE, JSON.stringify(e.data.auth));
      renderAuthState();
      updateAgentAvailability();
    }
    try { popup.close(); } catch {}
  }
  window.addEventListener('message', onMsg);
}

function doLogout() {
  localStorage.removeItem(GH_STORAGE);
  renderAuthState();
  updateAgentAvailability();
}

function renderAuthState() {
  const auth = getGHAuth();
  document.getElementById('auth-logged-in').hidden  = !auth;
  document.getElementById('auth-logged-out').hidden = !!auth;
  if (auth?.user) {
    const avatar = document.getElementById('auth-avatar');
    if (avatar) { avatar.src = auth.user.avatar_url; avatar.alt = auth.user.login; }
    const name = document.getElementById('auth-username');
    if (name) name.textContent = auth.user.login;
  }
}

// ── Agents ────────────────────────────────────────────────────────
const CLAUDE_VARIANTS = [
  { id: 'claude',       label: 'claude',        model: 'claude-sonnet-4-6',         color: '#C84E00', bgColor: 'rgba(200,78,0,.15)' },
  { id: 'claude-haiku', label: 'claude·haiku', model: 'claude-haiku-4-5-20251001', color: '#D4783C', bgColor: 'rgba(212,120,60,.15)' },
  { id: 'claude-opus',  label: 'claude·opus',  model: 'claude-opus-4-6',           color: '#7A2E0E', bgColor: 'rgba(122,46,14,.15)' },
];

let agents = [
  { ...CLAUDE_VARIANTS[0], type: 'claude', endpoint: 'http://127.0.0.1:7337/claude', requiresGH: false, maxTokens: 1024 },
  {
    id: 'gpt', label: 'gpt',
    color: '#10a37f', bgColor: 'rgba(16,163,127,.15)',
    type: 'openai',
    model: 'gpt-4o-mini',
    endpoint: GH_MODELS_URL,
    requiresGH: true,
    maxTokens: 1024,
  },
  {
    id: 'gemini', label: 'gemini',
    color: '#4285f4', bgColor: 'rgba(66,133,244,.15)',
    type: 'gemini',
    model: 'gemini-2.0-flash',
    endpoint: 'http://127.0.0.1:7338',
    requiresGH: false,
    maxTokens: 1024,
  },
];

const activeAgents = new Set(['claude']);

function createAgentToggle(container, agent, insertBefore = null) {
  const btn = document.createElement('button');
  btn.id = `toggle-${agent.id}`;
  btn.className = 'agent-toggle' + (activeAgents.has(agent.id) ? ' active' : '');
  btn.style.setProperty('--agent-color', agent.color);
  btn.style.setProperty('--agent-bg', agent.bgColor);

  btn.dataset.model = agent.model;

  const dot = document.createElement('span');
  dot.className = 'agent-dot';
  btn.appendChild(dot);
  btn.appendChild(document.createTextNode(agent.label));

  btn.addEventListener('click', () => {
    if (agent.requiresGH && !getGHAuth()) {
      showToast('Sign in with GitHub to use this model', 'error');
      return;
    }
    if (activeAgents.has(agent.id)) {
      activeAgents.delete(agent.id);
      btn.classList.remove('active');
    } else {
      activeAgents.add(agent.id);
      btn.classList.add('active');
    }
  });

  if (insertBefore) container.insertBefore(btn, insertBefore);
  else container.appendChild(btn);
  return btn;
}

function addClaudeVariant(variant) {
  const agent = { ...variant, type: 'claude', endpoint: 'http://127.0.0.1:7337/claude', requiresGH: false, maxTokens: 1024 };
  agents.push(agent);
  activeAgents.add(agent.id);

  // Insert new toggle right after the claude-group, before gpt
  const container = document.getElementById('agent-toggles');
  const gptToggle = document.getElementById('toggle-gpt');
  createAgentToggle(container, agent, gptToggle);

  // Remove this variant from the hover picker
  document.getElementById(`picker-opt-${variant.id}`)?.remove();

  // If all variants added, suppress the hover caret
  const pickerInner = document.querySelector('#claude-picker .claude-picker-inner');
  if (pickerInner && !pickerInner.children.length) {
    document.getElementById('claude-group')?.classList.add('no-picker');
  }
}

function buildAgentToggles() {
  const container = document.getElementById('agent-toggles');

  // Claude group: base toggle + hover picker for extra variants
  const group = document.createElement('div');
  group.className = 'claude-group';
  group.id        = 'claude-group';

  createAgentToggle(group, agents.find(a => a.id === 'claude'));

  const picker = document.createElement('div');
  picker.className = 'claude-picker';
  picker.id        = 'claude-picker';

  const pickerInner = document.createElement('div');
  pickerInner.className = 'claude-picker-inner';

  CLAUDE_VARIANTS.slice(1).forEach(variant => {
    const opt = document.createElement('button');
    opt.className = 'claude-picker-option';
    opt.id        = `picker-opt-${variant.id}`;
    opt.textContent = variant.label;
    opt.style.setProperty('--option-color', variant.color);
    opt.addEventListener('click', () => addClaudeVariant(variant));
    pickerInner.appendChild(opt);
  });

  picker.appendChild(pickerInner);
  group.appendChild(picker);
  container.appendChild(group);

  // Remaining agents
  agents.filter(a => a.type !== 'claude').forEach(agent => createAgentToggle(container, agent));
}

function updateAgentAvailability() {
  const auth = getGHAuth();
  agents.forEach(agent => {
    const btn = document.getElementById(`toggle-${agent.id}`);
    if (!btn) return;
    if (agent.requiresGH && !auth) {
      btn.classList.add('needs-auth');
      btn.title = 'Sign in with GitHub to enable';
      if (activeAgents.has(agent.id)) {
        activeAgents.delete(agent.id);
        btn.classList.remove('active');
      }
    } else {
      btn.classList.remove('needs-auth');
      btn.title = '';
    }
  });
}

// ── SSE parser ────────────────────────────────────────────────────
async function* parseSSE(body) {
  const reader  = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', currentEvent = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (line.startsWith('event: '))     { currentEvent = line.slice(7).trim(); }
      else if (line.startsWith('data: ')) {
        const raw = line.slice(6);
        if (raw === '[DONE]') return;
        try { yield { event: currentEvent, data: JSON.parse(raw) }; } catch {}
        currentEvent = null;
      }
    }
  }
}

// ── Stream helpers ────────────────────────────────────────────────
const ROOM_SYSTEM = 'You are one of several AI agents in a shared group chat room. ' +
  'When you see "[Other agents also replied: ...]" in the conversation, those are real ' +
  'responses from the other agents present — not roleplay. Engage with them naturally: ' +
  'agree, disagree, build on their points, or address them directly.';

async function streamClaude(agent, messages, onChunk, signal) {
  const res = await fetch(agent.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({ model: agent.model, max_tokens: agent.maxTokens, system: ROOM_SYSTEM, messages, stream: true }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Claude ${res.status}: ${text.slice(0, 200)}`);
  }
  let text = '';
  for await (const { event, data } of parseSSE(res.body)) {
    if (event === 'content_block_delta' && data?.delta?.type === 'text_delta') {
      text += data.delta.text;
      onChunk(text);
    }
  }
  return text;
}

async function streamGemini(agent, messages, onChunk, signal) {
  const res = await fetch(agent.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({ model: agent.model, max_tokens: agent.maxTokens, messages: [{ role: 'system', content: ROOM_SYSTEM }, ...messages], stream: true }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Gemini proxy ${res.status}`);
  }
  let text = '';
  for await (const { data } of parseSSE(res.body)) {
    const delta = data?.choices?.[0]?.delta?.content;
    if (delta) { text += delta; onChunk(text); }
  }
  return text;
}

async function streamOpenAI(agent, messages, onChunk, signal) {
  const auth = getGHAuth();
  if (!auth) throw new Error('Sign in with GitHub to use this model');
  const res = await fetch(agent.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${auth.token}`,
    },
    signal,
    body: JSON.stringify({ model: agent.model, max_tokens: agent.maxTokens, messages: [{ role: 'system', content: ROOM_SYSTEM }, ...messages], stream: true }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `GitHub Models ${res.status}`);
  }
  let text = '';
  for await (const { data } of parseSSE(res.body)) {
    const delta = data?.choices?.[0]?.delta?.content;
    if (delta) { text += delta; onChunk(text); }
  }
  return text;
}

// ── Conversation history ──────────────────────────────────────────
// sharedHistory holds {role:'user', content} entries.
// agentHistory[id] holds {role:'assistant', content} entries, one per user turn.
const sharedHistory = [];
const agentHistory  = {};

function buildMessages(agentId) {
  const hist = agentHistory[agentId] || [];
  const msgs = [];
  const pairs = Math.min(sharedHistory.length - 1, hist.length);
  for (let i = 0; i < pairs; i++) {
    const others = agents
      .filter(a => a.id !== agentId && agentHistory[a.id]?.[i])
      .map(a => `${a.label}: ${agentHistory[a.id][i].content}`)
      .join('\n\n');
    msgs.push({
      role: 'user',
      content: others
        ? `${sharedHistory[i].content}\n\n[Other agents also replied:\n${others}]`
        : sharedHistory[i].content,
    });
    msgs.push(hist[i]);
  }
  msgs.push(sharedHistory[sharedHistory.length - 1]);
  return msgs;
}

// ── Markdown rendering ────────────────────────────────────────────
function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderMd(text) {
  if (typeof marked !== 'undefined' && typeof DOMPurify !== 'undefined') {
    return DOMPurify.sanitize(marked.parse(text));
  }
  return text.split(/\n{2,}/).map(p => `<p>${escapeHtml(p)}</p>`).join('');
}

// ── UI helpers ────────────────────────────────────────────────────
const roomMessages   = document.getElementById('room-messages');
const toastContainer = document.getElementById('toast-container');

function showToast(msg, type = '') {
  const el = document.createElement('div');
  el.className   = 'toast' + (type ? ` ${type}` : '');
  el.textContent = msg;
  toastContainer.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

function scrollRoom() {
  const { scrollHeight, scrollTop, clientHeight } = roomMessages;
  if (scrollHeight - scrollTop - clientHeight < 120) roomMessages.scrollTop = scrollHeight;
}

function removeEmpty() {
  roomMessages.querySelector('.room-empty')?.remove();
}

function appendUserMsg(text) {
  removeEmpty();
  const wrap   = document.createElement('div');
  wrap.className = 'room-msg room-msg-user';
  const bubble = document.createElement('div');
  bubble.className   = 'room-bubble';
  bubble.textContent = text;
  wrap.appendChild(bubble);
  roomMessages.appendChild(wrap);
  scrollRoom();
}

function appendAgentMsg(agent) {
  const wrap   = document.createElement('div');
  wrap.className = 'room-msg room-msg-agent';

  const avatar = document.createElement('div');
  avatar.className = 'agent-avatar';
  avatar.textContent = agent.label[0];
  avatar.style.setProperty('--agent-color', agent.color);
  avatar.style.setProperty('--agent-bg',    agent.bgColor);

  const body   = document.createElement('div');
  body.className = 'agent-body';

  const nameEl = document.createElement('span');
  nameEl.className   = 'agent-name';
  nameEl.textContent = agent.label;
  nameEl.style.color = agent.color;

  const bubble = document.createElement('div');
  bubble.className = 'room-bubble agent-bubble';
  bubble.innerHTML  = '<span class="room-spinner"><span></span><span></span><span></span></span>';

  body.appendChild(nameEl);
  body.appendChild(bubble);
  wrap.appendChild(avatar);
  wrap.appendChild(body);
  roomMessages.appendChild(wrap);
  scrollRoom();

  let rafPending = false;
  return {
    update(text) {
      if (!rafPending) {
        rafPending = true;
        requestAnimationFrame(() => {
          rafPending = false;
          bubble.innerHTML = renderMd(text);
          scrollRoom();
        });
      }
    },
    finalize(text) { bubble.innerHTML = renderMd(text); scrollRoom(); },
    error(msg)     { bubble.textContent = '\u26a0 ' + msg; bubble.classList.add('error'); },
  };
}

// ── Send flow ─────────────────────────────────────────────────────
let isStreaming = false;
let abortCtrl   = null;

async function handleSend() {
  const inputEl  = document.getElementById('room-input');
  const sendBtn  = document.getElementById('room-send');
  const abortBtn = document.getElementById('room-abort');
  const text = inputEl.value.trim();
  if (!text || isStreaming) return;

  const selected = agents.filter(a => activeAgents.has(a.id));
  if (!selected.length) { showToast('Select at least one agent', 'error'); return; }

  inputEl.value    = '';
  isStreaming      = true;
  abortCtrl        = new AbortController();
  sendBtn.disabled = true;
  inputEl.inert    = true;
  abortBtn.hidden  = false;

  sharedHistory.push({ role: 'user', content: text });
  appendUserMsg(text);

  const promises = selected.map(async agent => {
    const msgs = buildMessages(agent.id);
    const ui   = appendAgentMsg(agent);
    try {
      const fn   = agent.type === 'claude' ? streamClaude : agent.type === 'gemini' ? streamGemini : streamOpenAI;
      const full = await fn(agent, msgs, t => ui.update(t), abortCtrl.signal);
      if (!agentHistory[agent.id]) agentHistory[agent.id] = [];
      agentHistory[agent.id].push({ role: 'assistant', content: full });
    } catch (err) {
      if (err.name !== 'AbortError') ui.error(err.message);
    }
  });

  try {
    await Promise.all(promises);
  } finally {
    isStreaming      = false;
    abortCtrl        = null;
    sendBtn.disabled = false;
    inputEl.inert    = false;
    abortBtn.hidden  = true;
    autoSave();
    inputEl.focus();
  }
}

// ── Session persistence ───────────────────────────────────────────
const SESSION_KEY = 'agent-room-session';

function autoSave() {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ sharedHistory, agentHistory }));
  } catch {}
}

function clearChat() {
  sharedHistory.length = 0;
  for (const k in agentHistory) delete agentHistory[k];
  roomMessages.innerHTML = '';
  const empty = document.createElement('div');
  empty.className = 'room-empty';
  empty.innerHTML = '<div class="room-empty-title">Dev Chat Room</div>' +
    '<div class="room-empty-hint">Toggle agents above, then type a message to start</div>';
  roomMessages.appendChild(empty);
  try { localStorage.removeItem(SESSION_KEY); } catch {}
}

function tryRestoreSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return;
    const { sharedHistory: sh, agentHistory: ah } = JSON.parse(raw);
    if (!sh?.length) return;
    sh.forEach(m => sharedHistory.push(m));
    Object.keys(ah).forEach(k => { agentHistory[k] = ah[k]; });
    removeEmpty();
    const banner = document.createElement('div');
    banner.className = 'session-banner';
    banner.textContent = '— session restored —';
    roomMessages.appendChild(banner);
    sh.forEach((userMsg, i) => {
      appendUserMsg(userMsg.content);
      agents.forEach(agent => {
        const resp = agentHistory[agent.id]?.[i];
        if (resp) appendAgentMsg(agent).finalize(resp.content);
      });
    });
  } catch {}
}

// ── Init ──────────────────────────────────────────────────────────
(async function init() {
  renderAuthState();
  buildAgentToggles();
  updateAgentAvailability();

  document.getElementById('auth-login-btn').addEventListener('click', startLogin);
  document.getElementById('auth-logout-btn').addEventListener('click', doLogout);

  const inputEl  = document.getElementById('room-input');
  const sendBtn  = document.getElementById('room-send');
  const abortBtn = document.getElementById('room-abort');

  sendBtn.addEventListener('click',  handleSend);
  abortBtn.addEventListener('click', () => abortCtrl?.abort());
  inputEl.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  });

  // ESC×2 clears chat; any printable key outside a field focuses input
  let lastEscTime = 0;
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      const now = Date.now();
      if (now - lastEscTime < 600 && !isStreaming) {
        lastEscTime = 0;
        if (confirm('Clear chat history?')) clearChat();
      } else {
        lastEscTime = now;
      }
      return;
    }
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (document.activeElement?.isContentEditable) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key.length > 1) return;
    inputEl.focus();
  });

  tryRestoreSession();

  // Theme toggle
  try {
    const saved = localStorage.getItem('agent-room-theme');
    if (saved) document.documentElement.dataset.theme = saved;
  } catch {}
  document.getElementById('theme-toggle').addEventListener('click', () => {
    const html = document.documentElement;
    html.dataset.theme = html.dataset.theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('agent-room-theme', html.dataset.theme); } catch {}
  });
})();
