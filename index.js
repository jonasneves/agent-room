// ── Shared state ────────────────────────────────────────────────────────
let activeLineNum = null;
let lineSelectAc  = null; // AbortController for the click-outside listener lifecycle
const codeContainer = document.getElementById('code-container');

// ── View Transitions helper (graceful fallback) ──────────────────────────
function withTransition(fn) {
  if (!document.startViewTransition) { fn(); return; }
  document.startViewTransition(fn);
}

// ── Python syntax tokenizer ──────────────────────────────────────────────
const PY_KEYWORDS = new Set([
  'False','None','True','and','as','assert','async','await','break','class',
  'continue','def','del','elif','else','except','finally','for','from',
  'global','if','import','in','is','lambda','nonlocal','not','or','pass',
  'raise','return','try','while','with','yield',
]);
const PY_BUILTINS = new Set([
  'abs','all','any','bin','bool','bytes','callable','chr','dict','dir',
  'divmod','enumerate','eval','filter','float','format','frozenset','getattr',
  'globals','hasattr','hash','hex','id','input','int','isinstance','issubclass',
  'iter','len','list','map','max','min','next','object','oct','open','ord',
  'pow','print','property','range','repr','reversed','round','set','setattr',
  'slice','sorted','staticmethod','str','sum','super','tuple','type','vars','zip',
]);

function tokenizePython(source) {
  // Returns array of lines; each line is an array of {type, text} tokens.
  const lines = [];
  let cur = [];
  let i = 0;
  let nextIdType = null; // 'fn-name' | 'cls-name' — set after def / class keyword

  function flush(type, text) {
    // Split multi-line tokens (triple-quoted strings) into per-line pieces.
    const parts = text.split('\n');
    parts.forEach((part, pi) => {
      if (part) cur.push({ type, text: part });
      if (pi < parts.length - 1) { lines.push(cur); cur = []; }
    });
  }

  while (i < source.length) {
    const ch = source[i];

    if (ch === '\n') { lines.push(cur); cur = []; i++; continue; }

    // Comment
    if (ch === '#') {
      const end = source.indexOf('\n', i);
      flush('comment', end === -1 ? source.slice(i) : source.slice(i, end));
      i = end === -1 ? source.length : end;
      nextIdType = null;
      continue;
    }

    // String — handles f/r/b/u prefix, triple-quoted, escaped chars
    const strM = source.slice(i).match(/^[fFrRbBuU]{0,2}("""|'''|"|')/);
    if (strM) {
      const q = strM[1];
      let j = i + strM[0].length;
      if (q.length === 3) {
        const end = source.indexOf(q, j);
        j = end === -1 ? source.length : end + 3;
      } else {
        while (j < source.length && source[j] !== q && source[j] !== '\n') {
          if (source[j] === '\\') j++;
          j++;
        }
        if (j < source.length && source[j] === q) j++;
      }
      flush('string', source.slice(i, j));
      i = j;
      nextIdType = null;
      continue;
    }

    // Decorator
    if (ch === '@') {
      let j = i + 1;
      while (j < source.length && /\w/.test(source[j])) j++;
      flush('decorator', source.slice(i, j));
      i = j;
      nextIdType = null;
      continue;
    }

    // Identifier / keyword / builtin / def-name / class-name
    if (/[a-zA-Z_]/.test(ch)) {
      let j = i;
      while (j < source.length && /\w/.test(source[j])) j++;
      const word = source.slice(i, j);
      let type;
      if (nextIdType) {
        type = nextIdType;
        nextIdType = null;
      } else if (PY_KEYWORDS.has(word)) {
        type = 'keyword';
        if (word === 'def')        nextIdType = 'fn-name';
        else if (word === 'class') nextIdType = 'cls-name';
      } else if (PY_BUILTINS.has(word)) {
        type = 'builtin';
      } else {
        type = 'default';
      }
      flush(type, word);
      i = j;
      continue;
    }

    // Number — integer, float, sci-notation, hex/oct/bin, complex
    if (/\d/.test(ch)) {
      const m = source.slice(i).match(
        /^0[xXoObB][\da-fA-F_]+|^\d[\d_]*(?:\.[\d_]*)?(?:[eE][+-]?[\d_]+)?[jJ]?/
      );
      const text = m ? m[0] : ch;
      flush('number', text);
      i += text.length;
      nextIdType = null;
      continue;
    }

    // Default — operators, punctuation, whitespace
    flush('default', ch);
    i++;
    if (ch !== ' ' && ch !== '\t') nextIdType = null;
  }

  lines.push(cur); // final line (no trailing newline)
  return lines;
}

// ── Code viewer ─────────────────────────────────────────────────────────
function buildCodeViewer(source) {
  const tokenLines = tokenizePython(source);
  const fragment   = document.createDocumentFragment();

  tokenLines.forEach((tokenLine, idx) => {
    const lineNum  = idx + 1;
    const ls       = String(lineNum);
    const lineText = tokenLine.map(t => t.text).join('');

    const codeRow = document.createElement('div');
    codeRow.className    = 'code-row clickable';
    codeRow.dataset.line = ls;

    const lineNumEl = document.createElement('div');
    lineNumEl.className   = 'line-num';
    lineNumEl.textContent = ls;

    const codeLineEl = document.createElement('div');
    codeLineEl.className = 'code-line';
    tokenLine.forEach(tok => {
      if (tok.type === 'default') {
        codeLineEl.appendChild(document.createTextNode(tok.text));
      } else {
        const span = document.createElement('span');
        span.className   = 'tok-' + tok.type;
        span.textContent = tok.text;
        codeLineEl.appendChild(span);
      }
    });

    codeRow.appendChild(lineNumEl);
    codeRow.appendChild(codeLineEl);
    fragment.appendChild(codeRow);

    codeRow.addEventListener('click', () => {
      const isActive = codeRow.classList.contains('active');
      // Capture BEFORE any state change — startViewTransition calls fn asynchronously,
      // so reading activeLineNum inside the callback would see the already-nulled value.
      const prevLine = activeLineNum;

      if (isActive) {
        deselectLine();
      } else {
        // Activate: update state, then animate prev→new using captured prevLine
        activeLineNum = ls;
        lineSelectAc?.abort();
        lineSelectAc = new AbortController();
        withTransition(() => {
          if (prevLine) codeContainer.querySelector(`.code-row[data-line="${prevLine}"]`)?.classList.remove('active');
          codeRow.classList.add('active'); // stable closure ref — safe to use async
        });

        // Click-outside: deselect the active line
        document.addEventListener('click', e => {
          if (codeContainer.contains(e.target)) return;
          deselectLine();
        }, { signal: lineSelectAc.signal });

        showLineContext(lineNum, lineText.trim());
        chatInputEl.focus();
      }
    });
  });

  codeContainer.appendChild(fragment);
}

// ── Line context pill ────────────────────────────────────────────────────
const lineContextEl     = document.getElementById('line-context');
const lineContextTextEl = document.getElementById('line-context-text');

function showLineContext(lineNum, snippet) {
  lineContextTextEl.textContent = `Line ${lineNum}${snippet ? ` · ${snippet}` : ''}`;
  lineContextEl.hidden = false;
}
function hideLineContext() {
  lineContextEl.hidden = true;
}

function deselectLine() {
  if (!activeLineNum) return;
  const prev = activeLineNum;
  activeLineNum = null;
  lineSelectAc?.abort(); lineSelectAc = null;
  hideLineContext();
  withTransition(() => {
    codeContainer.querySelector(`.code-row[data-line="${prev}"]`)?.classList.remove('active');
  });
}

document.getElementById('line-context-clear').addEventListener('click', deselectLine);

// ── Dynamic system prompt ────────────────────────────────────────────────
function buildSystem(fnMap) {
  const ln = name => fnMap[name] != null ? fnMap[name] : '?';
  return `You are an expert guide for this interactive microGPT Explorer. The user is studying a minimal GPT-style decoder-only transformer implemented in pure Python, no dependencies (~200 lines including comments).

The source is microgpt.py — it includes inline comments. Use your tools to scroll to and highlight relevant lines as you explain; keep prose tight (1–3 sentences) and let the code speak.

Architecture (function start lines auto-detected from microgpt.py):
- init_params():          line ${ln('init_params')}   — weight initialisation
- positional_encoding():  line ${ln('positional_encoding')} — sinusoidal PE
- layer_norm():           line ${ln('layer_norm')}    — normalize + affine
- softmax():              line ${ln('softmax')}       — numerically stable
- multi_head_attention(): line ${ln('multi_head_attention')} — full attention
- feed_forward():         line ${ln('feed_forward')}  — 2-layer MLP
- transformer_block():    line ${ln('transformer_block')} — pre-LN + residuals
- forward():              line ${ln('forward')}       — full forward pass

Key single lines (semantic — verify against source if file changed):
Q=172, K=173, V=174, head-split=179, scale=185, scores=186, causal-mask=190, mask-apply=191, weights=193, attended=196, head-concat=200, out-proj=203
ReLU=217, pre-norm-attn=236, residual-attn=247, pre-norm-ff=250, residual-ff=254
embed-lookup=277, PE-add=282, block-loop=285, final-LN=289, logits=293

Tools — use proactively:
- checkpoint: call between distinct concepts so the user can absorb each step. Label it as a forward-looking invitation: "Ready for the causal mask?" not "Next". Do NOT rush through multiple scroll/highlight/explain cycles without checkpointing.
- set_layout: widen chat (440–500 px) before long explanations, restore to 360 px after.
- show_viz: whenever a chart communicates better than prose. Size it for the data — attention/causal mask matrices → width:460,height:420 (near-square); PE sinusoids → width:620,height:280; simple bar/line → default 500×320 is fine. Use position:'center' for large charts that need maximum canvas space.
- set_suggestions: call after EVERY response with 2–4 relevant follow-up questions. When your response used technical terms, multi-step reasoning, or dense math, include one "simpler" chip, e.g. "Say that without the math" or "Give me an analogy instead".
- clear_selection: before highlighting specific lines to avoid competing highlights.
- save_session: after completing a topic.
- git_commit: at natural session end points — user will confirm before committing.

Formatting: use $…$ for inline math and $$…$$ for display math (KaTeX renders it). Use fenced \`\`\`python blocks for code snippets (syntax-highlighted automatically). Prefer math notation over prose when explaining formulas.

Timing: every tool result includes _duration_ms (wall-clock milliseconds). Use it to adapt:
- show_viz >2000ms → prefer simpler charts next time, or note "that chart took a moment"
- Any tool >1000ms → fewer tools per turn next time
- Cumulative slow turns → offer to pause with checkpoint before the next heavy step

Errors: if a tool result includes _page_errors, a JavaScript error fired during that tool.
- Diagnose and adapt: e.g. if show_viz failed, retry with a corrected/simpler option object.
- The option field in show_viz MUST be a JSON object (not a JSON string). Never pass it as a string.`;
}

let systemPrompt = buildSystem({});

// ── Source fetch + dynamic line map ─────────────────────────────────────
fetch('microgpt.py')
  .then(r => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.text();
  })
  .then(text => {
    const fnMap = {};
    text.split('\n').forEach((line, idx) => {
      const m = line.match(/^def (\w+)/);
      if (m) fnMap[m[1]] = idx + 1;
    });
    systemPrompt = buildSystem(fnMap);
    buildCodeViewer(text);
  })
  .catch(err => {
    codeContainer.innerHTML = `<div style="padding:24px;color:#C84E00;font-family:var(--font);font-size:13px">
      Could not load microgpt.py: ${err.message}.<br>
      Serve this file over HTTP, e.g. <code style="font-family:var(--font-mono)">python server.py</code>
    </div>`;
  });

// ── Chat constants ──────────────────────────────────────────────────────
const LOCAL_PROXY = 'http://127.0.0.1:7337/claude';
const MODEL       = 'claude-sonnet-4-6';

const TOOLS = [
  {
    name: 'highlight_line',
    description: "Visually highlight lines. color: yellow=general, blue=data flow, red=masking/constraint, green=residual/identity.",
    input_schema: {
      type: 'object',
      properties: {
        lines: { type: 'array', items: { type: 'number' }, description: 'Line numbers to highlight' },
        color: { type: 'string', enum: ['yellow', 'blue', 'red', 'green'] }
      },
      required: ['lines']
    }
  },
  {
    name: 'clear_highlights',
    description: 'Remove all line highlights.',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'scroll_to_line',
    description: 'Scroll to a line.',
    input_schema: {
      type: 'object',
      properties: { line: { type: 'number', description: '1-based line number' } },
      required: ['line']
    }
  },
  {
    name: 'clear_selection',
    description: 'Deselect the currently active (orange-highlighted) code line. Call before highlighting specific lines to avoid competing highlights.',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'set_layout',
    description: 'Resize the chat panel width smoothly. Widen for multi-paragraph explanations (440–520 px); narrow to give code more room (260–300 px); default is 360 px.',
    input_schema: {
      type: 'object',
      properties: {
        chat_width: { type: 'number', description: 'Chat panel width in pixels (240–560)' }
      },
      required: ['chat_width']
    }
  },
  {
    name: 'set_suggestions',
    description: 'Replace the suggestion chips with contextually relevant follow-up questions. Call after every response.',
    input_schema: {
      type: 'object',
      properties: {
        suggestions: { type: 'array', items: { type: 'string' }, description: '2–4 short follow-up questions' }
      },
      required: ['suggestions']
    }
  },
  {
    name: 'show_viz',
    description: 'Render an ECharts visualization in a floating panel alongside the code. Use for attention heatmaps, score distributions, PE waves, causal mask grids, etc. Pass any valid ECharts option object. Size the panel to fit the data — larger panels for data-dense charts.',
    input_schema: {
      type: 'object',
      properties: {
        title:    { type: 'string', description: 'Label shown in the panel header' },
        option:   { type: 'object', description: 'ECharts option object' },
        width:    { type: 'number', description: 'Panel width in px (default 500, range 300–800). Increase for wide charts like PE waves or multi-head bars.' },
        height:   { type: 'number', description: 'Panel height in px (default 320, range 200–600). Increase for tall matrices, heatmaps, or causal mask grids.' },
        position: { type: 'string', enum: ['bottom-left', 'bottom-right', 'top-left', 'center'], description: 'Panel placement (default: bottom-left).' }
      },
      required: ['option']
    }
  },
  {
    name: 'checkpoint',
    description: 'Pause the explanation and show the user a continue button. Use between distinct concepts so the user can absorb each step before moving on. Write the label as a short forward-looking invitation, e.g. "Ready for the causal mask?" or "Want to see softmax handle this?".',
    input_schema: {
      type: 'object',
      properties: {
        label: { type: 'string', description: 'Button label shown to the user (default: "Continue →")' }
      }
    }
  },
  {
    name: 'save_session',
    description: 'Save the current conversation to disk. Call after completing a topic or concept.',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'git_commit',
    description: 'Propose committing saved session files to git. User will see a confirm dialog with the message. Use a descriptive message summarising what was learned.',
    input_schema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Git commit message' }
      },
      required: ['message']
    }
  }
];

// ── Tool executor ────────────────────────────────────────────────────────
async function executeTool(name, args) {
  const HL = {
    yellow: { bg: 'rgba(255,217,96,.15)', fg: '#FFD960' },
    blue:   { bg: 'rgba(51,152,152,.15)', fg: '#339898' },
    red:    { bg: 'rgba(200,78,0,.15)',   fg: '#C84E00' },
    green:  { bg: 'rgba(161,183,13,.15)', fg: '#A1B70D' },
  };

  switch (name) {
    case 'highlight_line': {
      const c = HL[args.color] || HL.yellow;
      (args.lines || []).forEach(n => {
        const row = codeContainer.querySelector(`.code-row[data-line="${n}"]`);
        if (!row) return;
        row.style.setProperty('--hl-bg', c.bg);
        row.style.setProperty('--hl-fg', c.fg);
        row.classList.add('hl');
      });
      return { ok: true, highlighted: args.lines };
    }
    case 'clear_highlights':
      codeContainer.querySelectorAll('.hl').forEach(r => r.classList.remove('hl'));
      return { ok: true };
    case 'scroll_to_line': {
      const row = codeContainer.querySelector(`.code-row[data-line="${args.line}"]`);
      if (!row) return { error: `Line ${args.line} not found` };
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return { ok: true };
    }
    case 'clear_selection':
      deselectLine();
      return { ok: true };
    case 'set_layout': {
      const w = Math.round(Math.max(240, Math.min(560, args.chat_width)));
      document.querySelector('.chat-panel').style.width = w + 'px';
      return { ok: true, chat_width: w };
    }
    case 'set_suggestions': {
      suggestions = args.suggestions || [];
      const existing = chatMessages.querySelector('.suggestions');
      if (existing) existing.remove();
      renderSuggestions();
      return { ok: true };
    }
    case 'checkpoint':
      appendCheckpoint(args.label);
      return { ok: true };
    case 'show_viz': {
      let option = args.option;
      if (typeof option === 'string') {
        try { option = JSON.parse(option); }
        catch (e) { return { error: `option must be a JSON object, not a string. ${e.message}` }; }
      }
      try {
        showVizPanel(args.title || '', option, args.width, args.height, args.position);
        return { ok: true };
      } catch (e) {
        return { error: e.message };
      }
    }
    case 'save_session': {
      try {
        const res = await fetch('/api/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: conversationMessages, savedAt: new Date().toISOString() }),
        });
        return await res.json();
      } catch (e) {
        return { error: e.message };
      }
    }
    case 'git_commit': {
      const message = args.message || 'Save learning session';
      if (!confirm(`Commit to git?\n\n"${message}"`)) return { ok: false, reason: 'cancelled' };
      try {
        const res = await fetch('/api/commit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message }),
        });
        return await res.json();
      } catch (e) {
        return { error: e.message };
      }
    }
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// ── Viz panel ─────────────────────────────────────────────────────────────
let vizChart = null;

function applyVizPanelGeometry(panel, { width, height, position } = {}) {
  const chatEl  = document.querySelector('.chat-panel');
  const chatW   = chatEl ? chatEl.getBoundingClientRect().width : 360;
  const headerH = document.querySelector('.app-header')?.getBoundingClientRect().height ?? 44;
  const gap     = 24; // --space-6

  const maxW = Math.max(300, window.innerWidth - chatW - gap * 2);
  const maxH = Math.max(200, window.innerHeight - headerH - gap * 2);
  const w    = Math.min(Math.max(width  ?? 500, 300), maxW);
  const h    = Math.min(Math.max(height ?? 320, 200), maxH);

  panel.style.width  = w + 'px';
  panel.style.height = h + 'px';

  // Reset all sides before re-applying
  panel.style.top = panel.style.bottom = panel.style.left = panel.style.right = '';

  switch (position ?? 'bottom-left') {
    case 'bottom-right':
      panel.style.bottom = gap + 'px';
      panel.style.left   = (window.innerWidth - chatW - w - gap) + 'px';
      break;
    case 'top-left':
      panel.style.top  = (headerH + gap) + 'px';
      panel.style.left = gap + 'px';
      break;
    case 'center':
      panel.style.top  = Math.round(headerH + (window.innerHeight - headerH - h) / 2) + 'px';
      panel.style.left = Math.round((window.innerWidth - chatW - w) / 2) + 'px';
      break;
    default: // bottom-left
      panel.style.bottom = gap + 'px';
      panel.style.left   = gap + 'px';
  }
}

function showVizPanel(title, option, width, height, position) {
  const panel   = document.getElementById('viz-panel');
  const titleEl = document.getElementById('viz-panel-title');
  const chartEl = document.getElementById('viz-chart');

  titleEl.textContent = title;
  applyVizPanelGeometry(panel, { width, height, position });
  panel.hidden = false;

  if (!vizChart) {
    vizChart = echarts.init(chartEl, null, { renderer: 'canvas' });
  }
  vizChart.setOption(option, /* notMerge = */ true);
  vizChart.resize();
}

document.getElementById('viz-panel-close').addEventListener('click', () => {
  document.getElementById('viz-panel').hidden = true;
});

// ── Page error capture ────────────────────────────────────────────────────
// Collect JS errors so Claude can see them in tool results.
const _pageErrors = [];
window.addEventListener('error', e => {
  _pageErrors.push({ type: 'error', message: e.message,
    source: e.filename ? `${e.filename.split('/').pop()}:${e.lineno}` : undefined });
  if (_pageErrors.length > 8) _pageErrors.shift();
});
window.addEventListener('unhandledrejection', e => {
  _pageErrors.push({ type: 'unhandledrejection', message: String(e.reason).slice(0, 300) });
  if (_pageErrors.length > 8) _pageErrors.shift();
});
function flushPageErrors() { return _pageErrors.splice(0); }

// ── SSE parser ───────────────────────────────────────────────────────────
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
      if (line.startsWith('event: '))      { currentEvent = line.slice(7).trim(); }
      else if (line.startsWith('data: ') && currentEvent) {
        const raw = line.slice(6);
        if (raw === '[DONE]') return;
        try { yield { event: currentEvent, data: JSON.parse(raw) }; } catch {}
        currentEvent = null;
      }
    }
  }
}

// ── API call ─────────────────────────────────────────────────────────────
async function callAPI(messages, signal) {
  const res = await fetch(LOCAL_PROXY, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
    body: JSON.stringify({ model: MODEL, max_tokens: 2048, system: systemPrompt, messages, tools: TOOLS, stream: true }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.body;
}

// ── Toast ────────────────────────────────────────────────────────────────
function showToast(message, type = '') {
  const el = document.createElement('div');
  el.className   = 'toast' + (type ? ` ${type}` : '');
  el.textContent = message;
  toastContainer.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

// ── Markdown renderer ────────────────────────────────────────────────────
function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function setupMarked() {
  if (typeof marked === 'undefined') return;

  // Code blocks — syntax-highlight Python via the existing tokenizer
  marked.use({
    renderer: {
      code({ text, lang }) {
        const isPython = !lang || lang === 'python' || lang === 'py';
        if (isPython) {
          const lines = tokenizePython(text);
          const highlighted = lines.map(line =>
            line.map(tok =>
              tok.type === 'default'
                ? escapeHtml(tok.text)
                : `<span class="tok-${tok.type}">${escapeHtml(tok.text)}</span>`
            ).join('')
          ).join('\n');
          return `<pre><code>${highlighted}</code></pre>`;
        }
        return `<pre><code>${escapeHtml(text)}</code></pre>`;
      }
    }
  });

  // Math — block ($$…$$) and inline ($…$) via KaTeX
  if (typeof katex !== 'undefined') {
    const renderKatex = (math, displayMode) => {
      try {
        return katex.renderToString(math, { displayMode, throwOnError: false });
      } catch {
        return escapeHtml(math);
      }
    };

    marked.use({
      extensions: [
        {
          name: 'blockMath',
          level: 'block',
          start(src) { return src.indexOf('$$'); },
          tokenizer(src) {
            const m = src.match(/^\$\$([\s\S]+?)\$\$/);
            if (m) return { type: 'blockMath', raw: m[0], math: m[1].trim() };
          },
          renderer(token) {
            return `<div class="math-block">${renderKatex(token.math, true)}</div>`;
          }
        },
        {
          name: 'inlineMath',
          level: 'inline',
          start(src) { return src.indexOf('$'); },
          tokenizer(src) {
            if (src[1] === '$') return; // let blockMath handle $$
            const m = src.match(/^\$([^ \t\n][^\$\n]*?[^ \t\n]|[^ \t\n])\$/);
            if (m) return { type: 'inlineMath', raw: m[0], math: m[1] };
          },
          renderer(token) {
            return renderKatex(token.math, false);
          }
        }
      ]
    });
  }

  // Links — new tab + security attrs; images — show alt text only
  marked.use({
    renderer: {
      link({ href, title, tokens }) {
        const inner = this.parser.parseInline(tokens);
        const t = title ? ` title="${escapeHtml(title)}"` : '';
        return `<a href="${escapeHtml(href)}"${t} target="_blank" rel="noopener noreferrer">${inner}</a>`;
      },
      image({ text }) {
        return text ? `[${escapeHtml(text)}]` : '';
      }
    }
  });
}
setupMarked();

function renderMd(text) {
  if (typeof marked !== 'undefined' && typeof DOMPurify !== 'undefined') {
    return DOMPurify.sanitize(marked.parse(text), {
      ADD_ATTR: ['style', 'aria-hidden'],
    });
  }
  // Fallback: paragraphs + escaped HTML
  return text.split(/\n{2,}/).map(p =>
    `<p>${escapeHtml(p)}</p>`
  ).join('');
}

// ── Chat UI helpers ───────────────────────────────────────────────────────
const chatMessages = document.getElementById('chat-messages');
const chatInputEl  = document.getElementById('chat-input');
const chatSendBtn  = document.getElementById('chat-send');
const chatAbortBtn = document.getElementById('chat-abort');
const toastContainer = document.getElementById('toast-container');

// ── Conversation state ────────────────────────────────────────────────────
let conversationMessages = [];
let isStreaming = false;
let abortCtrl  = null;

function resetBusy() {
  abortCtrl    = null;
  isStreaming   = false;
  chatSendBtn.disabled = false;
  chatInputEl.inert    = false;
  chatAbortBtn.hidden  = true;
}

function clearChat() {
  conversationMessages = [];
  chatMessages.innerHTML = '';
  suggestions = DEFAULT_SUGGESTIONS.slice();
  renderSuggestions();
  hideLineContext();
  try { localStorage.removeItem(SESSION_KEY); } catch {}
}

chatInputEl.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
});
chatSendBtn.addEventListener('click', handleSend);
chatAbortBtn.addEventListener('click', () => { abortCtrl?.abort(); });

let lastEscTime = 0;
document.addEventListener('keydown', e => {
  // Double-ESC clears chat — works regardless of focus, guarded during streaming
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
  // Any printable key → focus textarea (when nothing interactive is focused)
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (document.activeElement?.isContentEditable) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key.length > 1) return;
  chatInputEl.focus();
});

// ── Smart auto-scroll (MutationObserver) ─────────────────────────────────
// Follows new content only when the user is already near the bottom,
// so reading earlier messages isn't interrupted.
new MutationObserver(() => {
  const { scrollTop, scrollHeight, clientHeight } = chatMessages;
  if (scrollHeight - scrollTop - clientHeight < 80) {
    chatMessages.scrollTop = scrollHeight;
  }
}).observe(chatMessages, { childList: true, subtree: true });

// Force-scroll (only for explicit moments like user sending a message)
function scrollChat() { chatMessages.scrollTop = chatMessages.scrollHeight; }

function appendUserMsg(text) {
  const el = document.createElement('div');
  el.className   = 'chat-msg chat-msg-user';
  el.textContent = text;
  chatMessages.appendChild(el);
  scrollChat();
}

function appendAssistantMsg() {
  const el = document.createElement('div');
  el.className = 'chat-msg chat-msg-assistant';
  chatMessages.appendChild(el);
  return el;
}

function appendToolCard(name, args) {
  const details = document.createElement('details');
  details.className = 'chat-tool-call';
  details.name = 'tool-calls'; // exclusive accordion — only one open at a time

  const summary = document.createElement('summary');
  summary.className = 'chat-tool-call-header';

  const nameEl   = document.createElement('span');
  nameEl.className   = 'chat-tool-call-name';
  nameEl.textContent = name;

  const argsEl   = document.createElement('span');
  argsEl.className   = 'chat-tool-call-args';
  argsEl.textContent = Object.entries(args).map(([k,v]) => `${k}:${JSON.stringify(v)}`).join(', ');

  const statusEl = document.createElement('span');
  statusEl.className   = 'chat-tool-call-status';
  statusEl.textContent = '…';

  summary.append(nameEl, argsEl, statusEl);
  details.appendChild(summary);
  chatMessages.appendChild(details);

  return {
    markSlow() { details.classList.add('slow'); },
    setResult(result) {
      details.classList.remove('slow');
      const body = document.createElement('div');
      body.className   = 'chat-tool-call-body';
      body.textContent = JSON.stringify(result, null, 2);
      details.appendChild(body);
      const ok = !result.error;
      statusEl.classList.add(ok ? 'ok' : 'error');
      statusEl.textContent = ok ? '✓' : '✗';
    }
  };
}

function appendCheckpoint(label) {
  const btn = document.createElement('button');
  btn.className   = 'checkpoint-btn';
  btn.textContent = label || 'Continue →';
  btn.addEventListener('click', () => {
    btn.disabled    = true;
    btn.textContent = '✓';
    chatInputEl.value = 'continue';
    handleSend();
  });
  chatMessages.appendChild(btn);
}

function appendThinking() {
  const el = document.createElement('div');
  el.className = 'chat-spinner';
  el.innerHTML = '<span></span><span></span><span></span>';
  chatMessages.appendChild(el);
  return el;
}

function appendPreparing(name) {
  const el = document.createElement('div');
  el.className = 'tool-preparing';
  const nameEl = document.createElement('span');
  nameEl.className   = 'tool-preparing-name';
  nameEl.textContent = name;
  const dot = document.createElement('span');
  dot.className = 'tool-preparing-dot';
  el.append(nameEl, '\u2009preparing', dot);
  chatMessages.appendChild(el);
  return el;
}

// ── Suggestions ───────────────────────────────────────────────────────────
const DEFAULT_SUGGESTIONS = [
  'Walk me through attention step by step',
  'Explain the causal mask',
  'What are residual connections for?',
  'How does positional encoding work?',
];
let suggestions = DEFAULT_SUGGESTIONS.slice();

function renderSuggestions() {
  if (!suggestions.length) return;
  const wrap = document.createElement('div');
  wrap.className = 'suggestions';
  const label = document.createElement('span');
  label.className   = 'suggestion-label';
  label.textContent = 'Try asking';
  wrap.appendChild(label);
  suggestions.forEach(text => {
    const btn = document.createElement('button');
    btn.className   = 'suggestion';
    btn.textContent = text;
    btn.addEventListener('click', () => { chatInputEl.value = text; handleSend(); });
    wrap.appendChild(btn);
  });
  chatMessages.appendChild(wrap);
}
renderSuggestions();

// ── Session persistence ───────────────────────────────────────────────────
const SESSION_KEY = 'microgpt-explorer-session';

function autoSave() {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      messages: conversationMessages,
      savedAt: new Date().toISOString(),
    }));
  } catch {}
}

function restoreMessages(messages) {
  conversationMessages = messages;
  chatMessages.querySelector('.suggestions')?.remove();
  for (const msg of messages) {
    if (msg.role === 'user' && typeof msg.content === 'string') {
      appendUserMsg(msg.content);
    } else if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      const textBlock = msg.content.find(c => c.type === 'text');
      if (textBlock?.text) {
        const el = appendAssistantMsg();
        el.innerHTML = renderMd(textBlock.text);
      }
    }
  }
}

async function tryRestoreSession() {
  // localStorage first — fast, always available, no server needed
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (data.messages?.length) { restoreMessages(data.messages); return; }
    }
  } catch {}
  // Fall back to server (session saved by a previous git-commit workflow)
  try {
    const res = await fetch('/api/session');
    if (!res.ok) return;
    const data = await res.json();
    if (data.messages?.length) restoreMessages(data.messages);
  } catch {}
}
tryRestoreSession();

// ── Agentic loop ──────────────────────────────────────────────────────────
async function runConversation(userText) {
  conversationMessages.push({ role: 'user', content: userText });
  chatMessages.querySelector('.suggestions')?.remove();
  appendUserMsg(userText);

  let continueLoop = true;
  while (continueLoop) {
    const thinkEl = appendThinking();
    let body;
    try {
      body = await callAPI(conversationMessages, abortCtrl.signal);
    } catch (err) {
      if (err.name === 'AbortError') { thinkEl.remove(); break; }
      thinkEl.remove();
      const errEl = document.createElement('div');
      errEl.className   = 'chat-msg chat-msg-error';
      errEl.textContent = err.message;
      chatMessages.appendChild(errEl);
      showToast(err.message, 'error');
      break;
    }
    thinkEl.remove();

    const allContent = [];
    let currentMsgEl = null, currentText = '';
    let currentTool  = null, currentJson  = '';
    const toolCalls  = [];

    for await (const { event, data } of parseSSE(body)) {
      if (event === 'content_block_start') {
        const cb = data.content_block;
        if (cb.type === 'text') {
          currentMsgEl = appendAssistantMsg();
          currentText  = '';
          allContent.push({ type: 'text', el: currentMsgEl, text: '' });
        } else if (cb.type === 'tool_use') {
          currentTool = { id: cb.id, name: cb.name, idx: allContent.length, preparingEl: appendPreparing(cb.name) };
          currentJson = '';
          allContent.push({ type: 'tool_use', id: cb.id, name: cb.name, input: null });
        }
      } else if (event === 'content_block_delta') {
        if (data.delta.type === 'text_delta') {
          currentText += data.delta.text;
          const blk = allContent[allContent.length - 1];
          if (blk?.type === 'text') blk.text = currentText;
          if (currentMsgEl) currentMsgEl.innerHTML = renderMd(currentText);
        } else if (data.delta.type === 'input_json_delta') {
          currentJson += data.delta.partial_json;
        }
      } else if (event === 'content_block_stop') {
        if (currentTool) {
          currentTool.preparingEl?.remove();
          let input = {};
          try { input = JSON.parse(currentJson); } catch {}
          allContent[currentTool.idx].input = input;
          toolCalls.push({ id: currentTool.id, name: currentTool.name, input });
          currentTool = null;
        }
      }
    }

    // Push assistant message to history
    const histContent = allContent.map(c =>
      c.type === 'text'
        ? { type: 'text', text: c.text }
        : { type: 'tool_use', id: c.id, name: c.name, input: c.input }
    );
    if (histContent.length) conversationMessages.push({ role: 'assistant', content: histContent });

    // Execute tools
    if (toolCalls.length) {
      const results = [];
      for (const tc of toolCalls) {
        const card = appendToolCard(tc.name, tc.input);
        await new Promise(requestAnimationFrame); // wait one paint so card renders before tool runs
        const slowTimer = setTimeout(() => card.markSlow(), 600);
        const startMs = performance.now();
        const result = await executeTool(tc.name, tc.input);
        clearTimeout(slowTimer);
        // yield one macrotask so unhandledrejection events (e.g. from ECharts) can fire
        await new Promise(r => setTimeout(r, 0));
        const pageErrs = flushPageErrors();
        const timed = { ...result, _duration_ms: Math.round(performance.now() - startMs),
          ...( pageErrs.length && { _page_errors: pageErrs }) };
        card.setResult(timed);
        results.push({ type: 'tool_result', tool_use_id: tc.id, content: JSON.stringify(timed) });
      }
      conversationMessages.push({ role: 'user', content: results });
    } else {
      continueLoop = false;
      autoSave();
    }
  }
}

// ── Theme toggle ─────────────────────────────────────────────────────────
try {
  const saved = localStorage.getItem('microgpt-theme');
  if (saved) document.documentElement.dataset.theme = saved;
} catch {}

document.getElementById('theme-toggle').addEventListener('click', () => {
  const html = document.documentElement;
  html.dataset.theme = html.dataset.theme === 'dark' ? 'light' : 'dark';
  try { localStorage.setItem('microgpt-theme', html.dataset.theme); } catch {}
});

// ── Handle send ───────────────────────────────────────────────────────────
async function handleSend() {
  const raw = chatInputEl.value.trim();
  if (!raw || isStreaming) return;
  // Prepend line context if a line is selected
  const lineSnippet = activeLineNum
    ? codeContainer.querySelector(`.code-row[data-line="${activeLineNum}"] .code-line`)?.textContent.trim()
    : null;
  const text = lineSnippet
    ? `Line ${activeLineNum}: \`${lineSnippet}\`\n${raw}`
    : raw;
  chatInputEl.value = '';
  hideLineContext();
  isStreaming = true;
  abortCtrl = new AbortController();
  chatSendBtn.disabled = true;
  chatInputEl.inert = true;   // disable textarea (no events, no keyboard, no selection)
  chatAbortBtn.hidden = false;
  try {
    await runConversation(text);
  } finally {
    resetBusy();
    chatInputEl.focus();
  }
}
