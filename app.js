const toastContainer = document.getElementById("toastContainer");
const formatBtn = document.getElementById("formatBtn");
const forceUnescapeFormatBtn = document.getElementById("forceUnescapeFormatBtn");
const compressBtn = document.getElementById("compressBtn");
const validateBtn = document.getElementById("validateBtn");
const expandBtn = document.getElementById("expandBtn");
const collapseBtn = document.getElementById("collapseBtn");
const clearBtn = document.getElementById("clearBtn");
const historyBtn = document.getElementById("historyBtn");
const maximizeBtn = document.getElementById("maximizeBtn");
const controlsBar = document.querySelector(".controls");
const inputEditorContainer = document.getElementById("inputEditor");
const historyPanel = document.getElementById("historyPanel");
const historyList = document.getElementById("historyList");
const closeHistoryBtn = document.getElementById("closeHistoryBtn");

let inputEditor = null;
let inputErrorDecorations = [];
let isMaximizeMode = false;
let controlsHideTimer = null;
let wheelShowHandler = null;
let isControlsHovered = false;
const MAXIMIZE_STORAGE_KEY = "jsonFormatter.maximizeMode";
const EDITOR_CONTENT_STORAGE_KEY = "jsonFormatter.editorContent";
const HISTORY_STORAGE_KEY = "jsonFormatter.historyRecords";
const MAX_HISTORY_RECORDS = 20;
let contentSaveTimer = null;
let historyRecords = [];
let lastInsertedHistoryId = null;

function createHistoryRecord(content) {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
    content
  };
}

function setStatus(message, type = "", options = {}) {
  const silent = Boolean(options && options.silent);
  if (silent || !message || !toastContainer) {
    return;
  }

  const toast = document.createElement("div");
  toast.className = `toast ${type}`.trim();
  toast.textContent = message;
  toastContainer.appendChild(toast);

  window.requestAnimationFrame(() => {
    toast.classList.add("show");
  });

  window.setTimeout(() => {
    toast.classList.remove("show");
    window.setTimeout(() => {
      if (toast.parentElement) {
        toast.parentElement.removeChild(toast);
      }
    }, 180);
  }, 2600);
}

function clearControlsHideTimer() {
  if (!controlsHideTimer) {
    return;
  }
  window.clearTimeout(controlsHideTimer);
  controlsHideTimer = null;
}

function clearContentSaveTimer() {
  if (!contentSaveTimer) {
    return;
  }
  window.clearTimeout(contentSaveTimer);
  contentSaveTimer = null;
}

function saveEditorContent(value) {
  clearContentSaveTimer();
  contentSaveTimer = window.setTimeout(() => {
    window.localStorage.setItem(EDITOR_CONTENT_STORAGE_KEY, value);
  }, 200);
}

function loadEditorContentPreference() {
  return window.localStorage.getItem(EDITOR_CONTENT_STORAGE_KEY) || "";
}

function loadHistoryRecords() {
  try {
    const raw = window.localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    const normalized = parsed
      .filter((item) => item && typeof item.timestamp === "number" && typeof item.content === "string")
      .map((item) => ({
        id: typeof item.id === "string" && item.id ? item.id : `${item.timestamp}-${Math.random().toString(36).slice(2, 8)}`,
        timestamp: item.timestamp,
        content: item.content
      }))
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, MAX_HISTORY_RECORDS);

    return normalized;
  } catch (_err) {
    return [];
  }
}

function saveHistoryRecords() {
  window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(historyRecords));
}

function deleteHistoryRecordById(recordId, itemEl) {
  const index = historyRecords.findIndex((item) => item.id === recordId);
  if (index < 0) {
    return;
  }

  if (itemEl) {
    itemEl.classList.add("removing");
  }

  window.setTimeout(() => {
    const latestIndex = historyRecords.findIndex((item) => item.id === recordId);
    if (latestIndex < 0) {
      return;
    }
    historyRecords.splice(latestIndex, 1);
    saveHistoryRecords();
    renderHistoryPanel();
    setStatus("已删除历史记录。", "success");
  }, 220);
}

function loadHistoryRecordToEditor(record) {
  if (!record || typeof record.content !== "string") {
    return;
  }

  try {
    const parsed = JSON.parse(record.content);
    setInputValue(JSON.stringify(parsed, null, 2));
    if (inputEditor) {
      inputEditor.trigger("keyboard", "editor.unfoldAll", null);
    }
    setStatus("已加载历史记录并完成格式化。", "success");
  } catch (_err) {
    setInputValue(record.content);
    setStatus("已加载历史记录。", "success");
  }
}

function formatHistoryTime(timestamp) {
  return new Date(timestamp).toLocaleString("zh-CN", { hour12: false });
}

function escapeHtml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

async function applyHistoryJsonHighlight(element, jsonText) {
  if (!element) {
    return;
  }

  if (!(window.monaco && monaco.editor && typeof monaco.editor.colorize === "function")) {
    element.textContent = jsonText;
    return;
  }

  try {
    const html = await monaco.editor.colorize(jsonText, "json", {});
    if (element.isConnected) {
      element.innerHTML = html;
    }
  } catch (_err) {
    element.textContent = jsonText;
  }
}

function renderHistoryPanel() {
  if (!historyList) {
    return;
  }

  historyList.innerHTML = "";

  if (!historyRecords.length) {
    const empty = document.createElement("div");
    empty.className = "history-empty";
    empty.textContent = "暂无历史记录";
    historyList.appendChild(empty);
    return;
  }

  for (const record of historyRecords) {
    const itemEl = document.createElement("div");
    itemEl.className = "history-item";
    if (record.id === lastInsertedHistoryId) {
      itemEl.classList.add("history-item-enter");
    }
    itemEl.addEventListener("click", () => {
      loadHistoryRecordToEditor(record);
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "history-item-delete";
    deleteBtn.type = "button";
    deleteBtn.title = "删除此记录";
    deleteBtn.setAttribute("aria-label", "删除此记录");
    deleteBtn.textContent = "✕";
    deleteBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      deleteHistoryRecordById(record.id, itemEl);
    });

    const dateEl = document.createElement("div");
    dateEl.className = "history-date";
    dateEl.textContent = formatHistoryTime(record.timestamp);

    const jsonEl = document.createElement("div");
    jsonEl.className = "history-json";
    jsonEl.textContent = record.content;
    void applyHistoryJsonHighlight(jsonEl, record.content);

    itemEl.appendChild(deleteBtn);
    itemEl.appendChild(dateEl);
    itemEl.appendChild(jsonEl);
    historyList.appendChild(itemEl);
  }

  lastInsertedHistoryId = null;
}

function addHistoryRecord(contentText) {
  if (!contentText) {
    return;
  }

  if (historyRecords.length > 0 && historyRecords[0].content === contentText) {
    return;
  }

  const newRecord = createHistoryRecord(contentText);
  lastInsertedHistoryId = newRecord.id;
  historyRecords.unshift(newRecord);
  historyRecords = historyRecords
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, MAX_HISTORY_RECORDS);
  saveHistoryRecords();
  renderHistoryPanel();
}

function toggleHistoryPanel(forceOpen) {
  if (!historyPanel) {
    return;
  }

  const open = typeof forceOpen === "boolean" ? forceOpen : !historyPanel.classList.contains("open");
  historyPanel.classList.toggle("open", open);
}

function showFloatingControlsTemporarily() {
  if (!isMaximizeMode) {
    return;
  }

  document.body.classList.remove("controls-hidden");
  clearControlsHideTimer();
  controlsHideTimer = window.setTimeout(() => {
    if (isControlsHovered) {
      showFloatingControlsTemporarily();
      return;
    }

    if (isMaximizeMode) {
      document.body.classList.add("controls-hidden");
    }
  }, 1000);
}

function setMaximizeMode(enabled) {
  isMaximizeMode = enabled;
  document.body.classList.toggle("maximize-mode", enabled);
  document.body.classList.toggle("controls-hidden", false);
  maximizeBtn.textContent = enabled ? "退出最大化" : "最大化显示";
  window.localStorage.setItem(MAXIMIZE_STORAGE_KEY, enabled ? "1" : "0");

  if (enabled) {
    showFloatingControlsTemporarily();
  } else {
    clearControlsHideTimer();
  }

  if (inputEditor) {
    inputEditor.layout();
  }
}

function loadMaximizeModePreference() {
  return window.localStorage.getItem(MAXIMIZE_STORAGE_KEY) === "1";
}

function getInputValue() {
  return inputEditor ? inputEditor.getValue() : "";
}

function setInputValue(value, useUndo = true) {
  if (!inputEditor) {
    return;
  }

  if (!useUndo || !window.monaco) {
    inputEditor.setValue(value);
    return;
  }

  const model = inputEditor.getModel();
  if (!model) {
    inputEditor.setValue(value);
    return;
  }

  inputEditor.pushUndoStop();
  inputEditor.executeEdits("json-formatter", [
    {
      range: model.getFullModelRange(),
      text: value,
      forceMoveMarkers: true
    }
  ]);
  inputEditor.pushUndoStop();
}

function clearInputErrorHighlight() {
  if (!inputEditor || !window.monaco) {
    return;
  }

  const model = inputEditor.getModel();
  if (!model) {
    return;
  }

  inputErrorDecorations = inputEditor.deltaDecorations(inputErrorDecorations, []);
  monaco.editor.setModelMarkers(model, "json-parse", []);
}

function positionToLineColumn(text, position) {
  const safePos = Math.max(0, Math.min(position, text.length));
  const before = text.slice(0, safePos);
  const lines = before.split("\n");
  const lineNumber = lines.length;
  const column = lines[lines.length - 1].length + 1;
  return { lineNumber, column };
}

function highlightInputError(raw, errorMessage) {
  if (!inputEditor || !window.monaco) {
    return;
  }

  clearInputErrorHighlight();
  const positionMatch = /position\s+(\d+)/i.exec(errorMessage);
  const parsedPosition = positionMatch ? Number(positionMatch[1]) : 0;
  const { lineNumber, column } = positionToLineColumn(raw, Number.isNaN(parsedPosition) ? 0 : parsedPosition);
  const model = inputEditor.getModel();

  if (!model) {
    return;
  }

  const lineLength = model.getLineLength(lineNumber);
  const startColumn = Math.min(column, Math.max(1, lineLength + 1));
  const endColumn = Math.min(startColumn + 1, Math.max(startColumn + 1, lineLength + 1));

  inputErrorDecorations = inputEditor.deltaDecorations([], [
    {
      range: new monaco.Range(lineNumber, 1, lineNumber, lineLength + 1),
      options: {
        isWholeLine: true,
        className: "line-error-bg"
      }
    }
  ]);

  monaco.editor.setModelMarkers(model, "json-parse", [
    {
      startLineNumber: lineNumber,
      startColumn,
      endLineNumber: lineNumber,
      endColumn,
      message: errorMessage,
      severity: monaco.MarkerSeverity.Error
    }
  ]);

  inputEditor.revealLineInCenter(lineNumber);
}

function parseEscapedJsonString(parsedValue) {
  if (typeof parsedValue !== "string") {
    return null;
  }

  const inner = parsedValue.trim();
  if (!inner) {
    return null;
  }

  try {
    const unescaped = JSON.parse(inner);
    if (typeof unescaped === "object" && unescaped !== null) {
      return unescaped;
    }
  } catch (_err) {
    return null;
  }

  return null;
}

function tryParseRawEscapedJson(raw) {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  // 识别这类输入：{\"a\":1}（无外层引号，内部为一次转义）
  const looksLikeRawEscaped = /^[\[{]/.test(trimmed) && /\\"/.test(trimmed);
  if (!looksLikeRawEscaped) {
    return null;
  }

  const unescapedQuotes = trimmed.replace(/\\"/g, "\"");
  try {
    const parsed = JSON.parse(unescapedQuotes);
    if (typeof parsed === "object" && parsed !== null) {
      return parsed;
    }
  } catch (_err) {
    return null;
  }

  return null;
}

function parseStringToJsonObject(value) {
  if (typeof value !== "string") {
    return null;
  }

  const parsedFromString = parseEscapedJsonString(value);
  if (parsedFromString) {
    return parsedFromString;
  }

  const parsedFromRawEscaped = tryParseRawEscapedJson(value);
  if (parsedFromRawEscaped) {
    return parsedFromRawEscaped;
  }

  return null;
}

function normalizeNestedEscapedJson(value, depth = 0) {
  if (depth > 30) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeNestedEscapedJson(item, depth + 1));
  }

  if (value && typeof value === "object") {
    const output = {};
    for (const [key, item] of Object.entries(value)) {
      output[key] = normalizeNestedEscapedJson(item, depth + 1);
    }
    return output;
  }

  if (typeof value === "string") {
    const parsed = parseStringToJsonObject(value);
    if (parsed) {
      return normalizeNestedEscapedJson(parsed, depth + 1);
    }
  }

  return value;
}

function buildPairMaps(text) {
  const pairMap = new Map();
  const quotePairMap = new Map();
  const stack = [];
  const openingToClosing = { "{": "}", "[": "]" };
  const closingToOpening = { "}": "{", "]": "[" };
  let openingQuoteIndex = -1;

  let inString = false;
  let escaping = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    if (inString) {
      if (escaping) {
        escaping = false;
        continue;
      }
      if (ch === "\\") {
        escaping = true;
        continue;
      }
      if (ch === "\"") {
        inString = false;
        quotePairMap.set(openingQuoteIndex, i);
        quotePairMap.set(i, openingQuoteIndex);
        openingQuoteIndex = -1;
      }
      continue;
    }

    if (ch === "\"") {
      inString = true;
      escaping = false;
      openingQuoteIndex = i;
      continue;
    }

    if (openingToClosing[ch]) {
      stack.push({ char: ch, index: i });
      continue;
    }

    const expectedOpening = closingToOpening[ch];
    if (!expectedOpening) {
      continue;
    }

    const top = stack[stack.length - 1];
    if (top && top.char === expectedOpening) {
      stack.pop();
      pairMap.set(top.index, i);
      pairMap.set(i, top.index);
    }
  }

  return { pairMap, quotePairMap };
}

function setupBracketDoubleClickSelect() {
  if (!inputEditor || !window.monaco) {
    return;
  }

  function findTokenOffsetNearClick(text, clickedOffset) {
    const candidates = [clickedOffset, clickedOffset - 1];
    for (const offset of candidates) {
      if (offset < 0 || offset >= text.length) {
        continue;
      }
      const ch = text[offset];
      if ("{}[]\"".includes(ch)) {
        return offset;
      }
    }
    return -1;
  }

  inputEditor.onMouseDown((mouseEvent) => {
    const isDoubleClick = mouseEvent.event && mouseEvent.event.detail === 2;
    if (!isDoubleClick) {
      return;
    }

    const position = mouseEvent.target && mouseEvent.target.position;
    if (!position) {
      return;
    }

    const model = inputEditor.getModel();
    if (!model) {
      return;
    }

    const clickedOffset = model.getOffsetAt(position);
    const fullText = model.getValue();
    const tokenOffset = findTokenOffsetNearClick(fullText, clickedOffset);
    if (tokenOffset === -1) {
      return;
    }

    const clickedChar = fullText[tokenOffset];
    if (!clickedChar || !"{}[]\"".includes(clickedChar)) {
      return;
    }

    const { pairMap, quotePairMap } = buildPairMaps(fullText);
    const matchedOffset = clickedChar === "\""
      ? quotePairMap.get(tokenOffset)
      : pairMap.get(tokenOffset);
    if (matchedOffset === undefined) {
      return;
    }

    const startOffset = Math.min(tokenOffset, matchedOffset);
    const endOffset = Math.max(tokenOffset, matchedOffset) + 1;
    const startPos = model.getPositionAt(startOffset);
    const endPos = model.getPositionAt(endOffset);

    inputEditor.setSelection(new monaco.Range(
      startPos.lineNumber,
      startPos.column,
      endPos.lineNumber,
      endPos.column
    ));
  });
}

function parseInputDetailed() {
  const raw = getInputValue();
  const trimmed = raw.trim();

  clearInputErrorHighlight();

  if (!trimmed) {
    throw new Error("请输入 JSON 内容后再操作。");
  }

  try {
    const parsed = JSON.parse(raw);
    const unescaped = parseEscapedJsonString(parsed);
    if (unescaped) {
      return { mode: "quotedEscaped", parsed, unescaped };
    }
    return { mode: "normal", parsed };
  } catch (err) {
    const rawEscapedParsed = tryParseRawEscapedJson(raw);
    if (rawEscapedParsed) {
      return { mode: "rawEscaped", parsed: rawEscapedParsed };
    }

    const msg = err instanceof Error ? err.message : "JSON 解析失败";
    highlightInputError(raw, msg);
    throw new Error(`JSON 无效：${msg}`);
  }
}

function initEditors() {
  return new Promise((resolve, reject) => {
    if (!window.require) {
      reject(new Error("编辑器加载失败：Monaco loader 不可用。"));
      return;
    }

    window.require.config({
      paths: {
        vs: "./vendor/vs"
      }
    });

    window.require(["vs/editor/editor.main"], () => {
      inputEditor = monaco.editor.create(inputEditorContainer, {
        value: loadEditorContentPreference(),
        language: "json",
        theme: "vs",
        readOnly: false,
        automaticLayout: true,
        wordWrap: "on",
        minimap: { enabled: false },
        folding: true,
        lineNumbers: "on",
        scrollBeyondLastLine: false
      });

      inputEditor.onDidChangeModelContent(() => {
        clearInputErrorHighlight();
        saveEditorContent(inputEditor.getValue());
      });

      inputEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
        formatJson();
      });

      setupBracketDoubleClickSelect();
      wheelShowHandler = () => {
        showFloatingControlsTemporarily();
      };
      const editorDomNode = inputEditor.getDomNode();
      if (editorDomNode) {
        editorDomNode.addEventListener("wheel", wheelShowHandler, { passive: true });
      }

      resolve();
    });
  });
}

function formatJson() {
  try {
    const result = parseInputDetailed();
    applyFormatResult(result, { forceUnescape: false });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "格式化失败";
    setStatus(msg, "error");
  }
}

function formatJsonForceUnescape() {
  try {
    const result = parseInputDetailed();
    applyFormatResult(result, { forceUnescape: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "格式化失败";
    setStatus(msg, "error");
  }
}

function compressJson() {
  try {
    const result = parseInputDetailed();
    let outputData = result.parsed;

    if (result.mode === "quotedEscaped") {
      outputData = normalizeNestedEscapedJson(result.unescaped);
      setInputValue(JSON.stringify(outputData));
      setStatus("压缩成功，已去除转义并压缩。", "success");
      return;
    }

    if (result.mode === "rawEscaped") {
      outputData = normalizeNestedEscapedJson(result.parsed);
      setInputValue(JSON.stringify(outputData));
      setStatus("压缩成功，已自动识别转义并压缩。", "success");
      return;
    }

    setInputValue(JSON.stringify(outputData));
    setStatus("压缩成功。", "success");
  } catch (err) {
    const msg = err instanceof Error ? err.message : "压缩失败";
    setStatus(msg, "error");
  }
}

function applyFormatResult(result, options) {
  const forceUnescape = Boolean(options && options.forceUnescape);
  let outputData = result.parsed;
  let shouldNormalizeNestedEscaped = false;
  let topLevelUnescaped = false;

  if (result.mode === "quotedEscaped") {
    if (forceUnescape) {
      outputData = result.unescaped;
      shouldNormalizeNestedEscaped = true;
      topLevelUnescaped = true;
    } else {
      const shouldUnescape = window.confirm(
        "检测到这是被转义包裹的 JSON 字符串。\n点击“确定”去除转义并格式化为标准 JSON；点击“取消”保留原始转义字符串格式。"
      );

      if (shouldUnescape) {
        outputData = result.unescaped;
        shouldNormalizeNestedEscaped = true;
        topLevelUnescaped = true;
      }
    }
  }

  if (result.mode === "rawEscaped" && !forceUnescape) {
    const shouldUnescape = window.confirm(
      "检测到这是转义 JSON（如 {\\\"a\\\":1}）。\n点击“确定”去除转义并格式化；点击“取消”保持原内容不变。"
    );
    if (!shouldUnescape) {
      setStatus("已取消去除转义，内容未修改。");
      return;
    }
    shouldNormalizeNestedEscaped = true;
  }

  if (result.mode === "rawEscaped" && forceUnescape) {
    shouldNormalizeNestedEscaped = true;
  }

  if (result.mode === "normal" && forceUnescape) {
    shouldNormalizeNestedEscaped = true;
  }

  if (shouldNormalizeNestedEscaped) {
    outputData = normalizeNestedEscapedJson(outputData);
  }

  setInputValue(JSON.stringify(outputData, null, 2));
  if (inputEditor) {
    inputEditor.trigger("keyboard", "editor.unfoldAll", null);
  }
  addHistoryRecord(getInputValue());

  if (result.mode === "quotedEscaped") {
    if (topLevelUnescaped) {
      if (forceUnescape) {
        setStatus("格式化成功，已直接去除转义并处理嵌套转义字段。", "success");
      } else {
        setStatus("格式化成功，已去除转义并处理嵌套转义字段。", "success");
      }
    } else {
      setStatus("格式化成功，已保留转义字符串格式。", "success");
    }
    return;
  }

  if (result.mode === "rawEscaped") {
    if (forceUnescape) {
      setStatus("格式化成功，已直接去除转义并处理嵌套转义字段。", "success");
    } else {
      setStatus("格式化成功，已自动识别并去除转义 JSON，同时处理嵌套转义字段。", "success");
    }
    return;
  }

  if (forceUnescape) {
    setStatus("格式化成功，已处理可识别的嵌套转义字段。", "success");
    return;
  }

  setStatus("格式化成功，JSON 校验通过。", "success");
}

function validateJson() {
  try {
    const result = parseInputDetailed();
    if (result.mode === "quotedEscaped") {
      setStatus("校验通过。检测到转义 JSON 字符串，可点击“格式化”选择是否去除转义。", "success");
      return;
    }

    if (result.mode === "rawEscaped") {
      setStatus("校验通过。检测到转义 JSON（如 {\\\"a\\\":1}），可点击“格式化”一键去除转义。", "success");
      return;
    }

    setStatus("校验通过，JSON 格式有效。", "success");
  } catch (err) {
    const msg = err instanceof Error ? err.message : "校验失败";
    setStatus(msg, "error");
  }
}

function clearAll() {
  setInputValue("");
  clearInputErrorHighlight();
  setStatus("已清空编辑器。");
}

formatBtn.addEventListener("click", formatJson);
forceUnescapeFormatBtn.addEventListener("click", formatJsonForceUnescape);
compressBtn.addEventListener("click", compressJson);
validateBtn.addEventListener("click", validateJson);

expandBtn.addEventListener("click", () => {
  if (inputEditor) {
    inputEditor.trigger("keyboard", "editor.unfoldAll", null);
  }
  setStatus("已全部展开。");
});

collapseBtn.addEventListener("click", () => {
  if (inputEditor) {
    inputEditor.trigger("keyboard", "editor.foldAll", null);
  }
  setStatus("已全部折叠。");
});

clearBtn.addEventListener("click", clearAll);
historyBtn.addEventListener("click", () => {
  toggleHistoryPanel();
});
maximizeBtn.addEventListener("click", () => {
  setMaximizeMode(!isMaximizeMode);
});
if (closeHistoryBtn) {
  closeHistoryBtn.addEventListener("click", () => {
    toggleHistoryPanel(false);
  });
}

if (controlsBar) {
  controlsBar.addEventListener("mouseenter", () => {
    isControlsHovered = true;
    clearControlsHideTimer();
    if (isMaximizeMode) {
      document.body.classList.remove("controls-hidden");
    }
  });

  controlsBar.addEventListener("mouseleave", () => {
    isControlsHovered = false;
    showFloatingControlsTemporarily();
  });
}

initEditors()
  .then(() => {
    historyRecords = loadHistoryRecords();
    renderHistoryPanel();
    setMaximizeMode(loadMaximizeModePreference());
    setStatus("准备就绪。", "success", { silent: true });
  })
  .catch((err) => {
    const msg = err instanceof Error ? err.message : "编辑器初始化失败。";
    setStatus(msg, "error");
  });
