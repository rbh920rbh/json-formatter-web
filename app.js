const toastContainer = document.getElementById("toastContainer");
const formatBtn = document.getElementById("formatBtn");
const forceUnescapeFormatBtn = document.getElementById("forceUnescapeFormatBtn");
const compressBtn = document.getElementById("compressBtn");
const validateBtn = document.getElementById("validateBtn");
const expandBtn = document.getElementById("expandBtn");
const collapseBtn = document.getElementById("collapseBtn");
const clearBtn = document.getElementById("clearBtn");
const openHistoryBtn = document.getElementById("openHistoryBtn");
const openFavoritesBtn = document.getElementById("openFavoritesBtn");
const maximizeBtn = document.getElementById("maximizeBtn");
const editorFavoriteBtn = document.getElementById("editorFavoriteBtn");
const controlsBar = document.querySelector(".controls");
const inputEditorContainer = document.getElementById("inputEditor");
const historyPanel = document.getElementById("historyPanel");
const recordList = document.getElementById("recordList");
const historyTabBtn = document.getElementById("historyTabBtn");
const favoritesTabBtn = document.getElementById("favoritesTabBtn");
const recordSearchInput = document.getElementById("recordSearchInput");
const clearRecordSearchBtn = document.getElementById("clearRecordSearchBtn");
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
const FAVORITES_STORAGE_KEY = "jsonFormatter.favoriteRecords";
const MAX_HISTORY_RECORDS = 20;
let contentSaveTimer = null;
let historyRecords = [];
let favoriteRecords = [];
let lastInsertedHistoryId = null;
let activeRecordTab = "history";
let recordSearchKeyword = "";
let recordSearchDebounceTimer = null;
let currentSearchMatchIndex = -1;
let draggingFavoriteRecordId = "";
let dragPlaceholderEl = null;
let dragGhostEl = null;
let dragItemHeight = 0;
let draggingFavoriteItemEl = null;
let dragMoveListener = null;
let dragUpListener = null;
let suppressNextRecordClick = false;

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

function loadFavoriteRecords() {
  try {
    const raw = window.localStorage.getItem(FAVORITES_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter((item) => item && typeof item.timestamp === "number" && typeof item.content === "string")
      .map((item) => ({
        id: typeof item.id === "string" && item.id ? item.id : `${item.timestamp}-${Math.random().toString(36).slice(2, 8)}`,
        timestamp: item.timestamp,
        content: item.content,
        name: typeof item.name === "string" ? item.name : ""
      }));
  } catch (_err) {
    return [];
  }
}

function saveFavoriteRecords() {
  window.localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(favoriteRecords));
}

function isRecordFavorited(record) {
  return favoriteRecords.some((item) => item.content === record.content);
}

function toggleFavoriteRecord(record) {
  const index = favoriteRecords.findIndex((item) => item.content === record.content);
  if (index >= 0) {
    favoriteRecords.splice(index, 1);
    saveFavoriteRecords();
    renderHistoryPanel();
    setStatus("已取消收藏。", "success");
    return;
  }

  favoriteRecords.unshift({ ...createHistoryRecord(record.content), name: "" });
  saveFavoriteRecords();
  renderHistoryPanel();
  setStatus("已加入收藏。", "success");
}

function ensureFavoriteContent(contentText) {
  const exists = favoriteRecords.some((item) => item.content === contentText);
  if (exists) {
    setStatus("该内容已在收藏中。", "success");
    return false;
  }

  favoriteRecords.unshift({ ...createHistoryRecord(contentText), name: "" });
  saveFavoriteRecords();
  renderHistoryPanel();
  setStatus("收藏成功。", "success");
  return true;
}

function updateFavoriteName(recordId, nextName) {
  const index = favoriteRecords.findIndex((item) => item.id === recordId);
  if (index < 0) {
    return;
  }

  favoriteRecords[index].name = nextName;
  saveFavoriteRecords();
  renderHistoryPanel();
}

function moveFavoriteRecordToIndex(dragRecordId, toIndex) {
  if (!dragRecordId || toIndex < 0) {
    return false;
  }

  const fromIndex = favoriteRecords.findIndex((item) => item.id === dragRecordId);
  if (fromIndex < 0) {
    return false;
  }

  const boundedIndex = Math.min(Math.max(toIndex, 0), favoriteRecords.length - 1);
  if (fromIndex === boundedIndex) {
    return false;
  }

  const [moved] = favoriteRecords.splice(fromIndex, 1);
  favoriteRecords.splice(boundedIndex, 0, moved);
  saveFavoriteRecords();
  return true;
}

function deleteRecordById(recordId, source, itemEl) {
  const target = source === "favorites" ? favoriteRecords : historyRecords;
  const index = target.findIndex((item) => item.id === recordId);
  if (index < 0) {
    return;
  }

  if (itemEl) {
    itemEl.classList.add("removing");
  }

  window.setTimeout(() => {
    const listRef = source === "favorites" ? favoriteRecords : historyRecords;
    const latestIndex = listRef.findIndex((item) => item.id === recordId);
    if (latestIndex < 0) {
      return;
    }
    listRef.splice(latestIndex, 1);
    if (source === "favorites") {
      saveFavoriteRecords();
    } else {
      saveHistoryRecords();
    }
    renderHistoryPanel();
    setStatus(source === "favorites" ? "已删除收藏记录。" : "已删除历史记录。", "success");
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

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlightTextInElement(element, keyword) {
  if (!element || !keyword) {
    return false;
  }

  const normalizedKeyword = keyword.replace(/\u00a0/g, " ");
  const reg = new RegExp(escapeRegExp(normalizedKeyword), "gi");
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  let hasMatch = false;
  let current = walker.nextNode();
  while (current) {
    textNodes.push(current);
    current = walker.nextNode();
  }

  for (const textNode of textNodes) {
    const source = textNode.nodeValue || "";
    const normalizedSource = source.replace(/\u00a0/g, " ");
    reg.lastIndex = 0;
    if (!reg.test(normalizedSource)) {
      continue;
    }
    hasMatch = true;

    reg.lastIndex = 0;
    const fragment = document.createDocumentFragment();
    let lastIndex = 0;
    let match = reg.exec(normalizedSource);
    while (match) {
      const matchStart = match.index;
      const matchText = match[0];
      if (matchStart > lastIndex) {
        fragment.appendChild(document.createTextNode(source.slice(lastIndex, matchStart)));
      }
      const mark = document.createElement("mark");
      mark.className = "search-highlight";
      mark.textContent = source.slice(matchStart, matchStart + matchText.length);
      fragment.appendChild(mark);
      lastIndex = matchStart + matchText.length;
      match = reg.exec(normalizedSource);
    }
    if (lastIndex < source.length) {
      fragment.appendChild(document.createTextNode(source.slice(lastIndex)));
    }
    if (textNode.parentNode) {
      textNode.parentNode.replaceChild(fragment, textNode);
    }
  }
  return hasMatch;
}

function scrollFirstHighlightIntoView(container) {
  if (!container) {
    return;
  }

  const firstMark = container.querySelector("mark.search-highlight");
  if (!firstMark) {
    return;
  }

  const containerRect = container.getBoundingClientRect();
  const markRect = firstMark.getBoundingClientRect();
  if (markRect.top < containerRect.top) {
    container.scrollTop += markRect.top - containerRect.top - 8;
    return;
  }
  if (markRect.bottom > containerRect.bottom) {
    container.scrollTop += markRect.bottom - containerRect.bottom + 8;
  }
}

function createDragPlaceholder() {
  const placeholder = document.createElement("div");
  placeholder.className = "history-item drag-placeholder";
  return placeholder;
}

function createDragGhost(itemEl) {
  const ghost = itemEl.cloneNode(true);
  ghost.classList.add("drag-ghost", "drag-ghost-follow");
  ghost.style.width = `${itemEl.offsetWidth}px`;
  ghost.style.height = `${itemEl.offsetHeight}px`;
  document.body.appendChild(ghost);
  return ghost;
}

function cleanupFavoriteDragState() {
  if (dragPlaceholderEl && dragPlaceholderEl.parentElement) {
    dragPlaceholderEl.parentElement.removeChild(dragPlaceholderEl);
  }
  dragPlaceholderEl = null;
  draggingFavoriteRecordId = "";
  dragItemHeight = 0;
  draggingFavoriteItemEl = null;
  if (dragMoveListener) {
    document.removeEventListener("mousemove", dragMoveListener);
    dragMoveListener = null;
  }
  if (dragUpListener) {
    document.removeEventListener("mouseup", dragUpListener);
    dragUpListener = null;
  }
  if (recordList) {
    recordList.classList.remove("dragging");
    const sources = recordList.querySelectorAll(".drag-source");
    for (const source of sources) {
      source.classList.remove("drag-source");
    }
    const hidden = recordList.querySelectorAll(".drag-hidden");
    for (const item of hidden) {
      item.classList.remove("drag-hidden");
    }
  }
  document.body.classList.remove("favorite-dragging");
  if (dragGhostEl && dragGhostEl.parentElement) {
    dragGhostEl.parentElement.removeChild(dragGhostEl);
  }
  dragGhostEl = null;
}

function shouldAppendPlaceholderToEndByY(clientY, listEl) {
  if (!listEl) {
    return false;
  }
  const rect = listEl.getBoundingClientRect();
  return clientY >= rect.bottom - 16;
}

function positionDragGhost(clientX, clientY) {
  if (!dragGhostEl) {
    return;
  }
  dragGhostEl.style.left = `${clientX + 12}px`;
  dragGhostEl.style.top = `${clientY + 12}px`;
}

function updateFavoritePlaceholderPosition(clientX, clientY) {
  if (!recordList || !dragPlaceholderEl || !draggingFavoriteItemEl) {
    return;
  }

  const target = document.elementFromPoint(clientX, clientY);
  const targetItem = target instanceof Element ? target.closest(".history-item") : null;
  if (
    !targetItem ||
    targetItem.classList.contains("drag-placeholder") ||
    targetItem.classList.contains("drag-source")
  ) {
    if (shouldAppendPlaceholderToEndByY(clientY, recordList)) {
      recordList.appendChild(dragPlaceholderEl);
    }
    return;
  }

  const rect = targetItem.getBoundingClientRect();
  const before = clientY < rect.top + rect.height / 2;
  const nextSibling = before ? targetItem : targetItem.nextSibling;
  if (nextSibling === dragPlaceholderEl) {
    return;
  }
  recordList.insertBefore(dragPlaceholderEl, nextSibling);
}

function commitFavoritePointerDrag() {
  if (!recordList || !dragPlaceholderEl || !draggingFavoriteRecordId) {
    cleanupFavoriteDragState();
    renderHistoryPanel();
    return;
  }

  const children = Array.from(recordList.children);
  let insertIndex = 0;
  for (const child of children) {
    if (child === dragPlaceholderEl) {
      break;
    }
    if (child.classList.contains("history-item") && !child.classList.contains("drag-source")) {
      insertIndex += 1;
    }
  }

  const moved = moveFavoriteRecordToIndex(draggingFavoriteRecordId, insertIndex);
  suppressNextRecordClick = true;
  cleanupFavoriteDragState();
  renderHistoryPanel();
  if (moved) {
    setStatus("收藏顺序已更新。", "success", { silent: true });
  }
}

function startFavoritePointerDrag(event, recordId, itemEl) {
  if (!recordList || activeRecordTab !== "favorites") {
    return;
  }
  if (typeof event.button === "number" && event.button !== 0) {
    return;
  }
  event.preventDefault();

  cleanupFavoriteDragState();
  draggingFavoriteRecordId = recordId;
  draggingFavoriteItemEl = itemEl;
  dragItemHeight = itemEl.getBoundingClientRect().height;
  dragPlaceholderEl = createDragPlaceholder();
  itemEl.classList.add("drag-source", "drag-hidden");
  itemEl.parentElement && itemEl.parentElement.insertBefore(dragPlaceholderEl, itemEl);
  recordList.classList.add("dragging");
  document.body.classList.add("favorite-dragging");
  dragGhostEl = createDragGhost(itemEl);
  positionDragGhost(event.clientX, event.clientY);

  dragMoveListener = (moveEvent) => {
    positionDragGhost(moveEvent.clientX, moveEvent.clientY);
    updateFavoritePlaceholderPosition(moveEvent.clientX, moveEvent.clientY);
  };
  dragUpListener = () => {
    commitFavoritePointerDrag();
  };
  document.addEventListener("mousemove", dragMoveListener);
  document.addEventListener("mouseup", dragUpListener);
}

function getSearchHighlightMarks() {
  if (!recordList) {
    return [];
  }
  return Array.from(recordList.querySelectorAll("mark.search-highlight"));
}

function setActiveSearchHighlight(mark) {
  if (!recordList) {
    return;
  }

  const activeMarks = recordList.querySelectorAll("mark.search-highlight.current");
  for (const activeMark of activeMarks) {
    activeMark.classList.remove("current");
  }

  if (!mark) {
    return;
  }

  mark.classList.add("current");
  mark.scrollIntoView({ block: "center", inline: "nearest" });
}

function jumpToNextSearchMatch(retryCount = 0) {
  const marks = getSearchHighlightMarks();
  if (!marks.length) {
    // Monaco colorize/highlight is async; retry briefly before giving up.
    if (retryCount < 8) {
      window.setTimeout(() => {
        jumpToNextSearchMatch(retryCount + 1);
      }, 60);
    }
    return;
  }

  currentSearchMatchIndex = (currentSearchMatchIndex + 1) % marks.length;
  setActiveSearchHighlight(marks[currentSearchMatchIndex]);
}

function matchesRecord(record, activeTab, keywordLower) {
  if (!keywordLower) {
    return true;
  }

  const content = typeof record.content === "string" ? record.content.toLowerCase() : "";
  const name = typeof record.name === "string" ? record.name.toLowerCase() : "";
  if (content.includes(keywordLower)) {
    return true;
  }
  if (activeTab === "favorites" && name.includes(keywordLower)) {
    return true;
  }
  return false;
}

async function applyHistoryJsonHighlight(element, jsonText, keyword = "") {
  if (!element) {
    return;
  }

  if (!(window.monaco && monaco.editor && typeof monaco.editor.colorize === "function")) {
    element.textContent = jsonText;
    if (highlightTextInElement(element, keyword)) {
      scrollFirstHighlightIntoView(element);
    }
    return;
  }

  try {
    const html = await monaco.editor.colorize(jsonText, "json", {});
    if (element.isConnected) {
      element.innerHTML = html;
      if (highlightTextInElement(element, keyword)) {
        scrollFirstHighlightIntoView(element);
      }
    }
  } catch (_err) {
    element.textContent = jsonText;
    if (highlightTextInElement(element, keyword)) {
      scrollFirstHighlightIntoView(element);
    }
  }
}

function renderHistoryPanel() {
  if (!recordList) {
    return;
  }

  if (historyTabBtn && favoritesTabBtn) {
    historyTabBtn.classList.toggle("active", activeRecordTab === "history");
    favoritesTabBtn.classList.toggle("active", activeRecordTab === "favorites");
  }

  const records = activeRecordTab === "favorites" ? favoriteRecords : historyRecords;
  const keyword = recordSearchKeyword.trim();
  const keywordLower = keyword.toLowerCase();
  currentSearchMatchIndex = -1;
  const filteredRecords = records.filter((record) => matchesRecord(record, activeRecordTab, keywordLower));
  recordList.innerHTML = "";

  if (!filteredRecords.length) {
    const empty = document.createElement("div");
    empty.className = "history-empty";
    if (keyword) {
      empty.textContent = "未找到匹配记录";
    } else {
      empty.textContent = activeRecordTab === "favorites" ? "暂无收藏记录" : "暂无历史记录";
    }
    recordList.appendChild(empty);
    return;
  }

  for (const record of filteredRecords) {
    const itemEl = document.createElement("div");
    itemEl.className = "history-item";
    if (record.id === lastInsertedHistoryId) {
      itemEl.classList.add("history-item-enter");
    }
    itemEl.addEventListener("click", () => {
      if (suppressNextRecordClick) {
        suppressNextRecordClick = false;
        return;
      }
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
      deleteRecordById(record.id, activeRecordTab, itemEl);
    });

    const favoriteBtn = document.createElement("button");
    favoriteBtn.className = "history-item-favorite";
    favoriteBtn.type = "button";
    favoriteBtn.title = isRecordFavorited(record) ? "取消收藏" : "加入收藏";
    favoriteBtn.setAttribute("aria-label", isRecordFavorited(record) ? "取消收藏" : "加入收藏");
    favoriteBtn.textContent = "★";
    if (isRecordFavorited(record)) {
      favoriteBtn.classList.add("active");
    }
    favoriteBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleFavoriteRecord(record);
    });

    const dateEl = document.createElement("div");
    dateEl.className = "history-date";
    dateEl.textContent = formatHistoryTime(record.timestamp);

    const jsonEl = document.createElement("div");
    jsonEl.className = "history-json";
    jsonEl.textContent = record.content;
    void applyHistoryJsonHighlight(jsonEl, record.content, keyword);

    const headEl = document.createElement("div");
    headEl.className = "history-item-head";
    const actionsEl = document.createElement("div");
    actionsEl.className = "history-item-actions";
    actionsEl.appendChild(favoriteBtn);
    actionsEl.appendChild(deleteBtn);
    if (activeRecordTab === "favorites") {
      itemEl.classList.add("favorite-draggable-item");

      const metaEl = document.createElement("div");
      metaEl.className = "favorite-meta";
      metaEl.addEventListener("mousedown", (event) => {
        event.stopPropagation();
      });
      metaEl.addEventListener("click", (event) => {
        event.stopPropagation();
      });

      const nameBtn = document.createElement("button");
      nameBtn.className = `favorite-name ${record.name ? "filled" : ""}`.trim();
      nameBtn.type = "button";
      nameBtn.textContent = record.name || "点击添加名称";
      if (record.name && keyword) {
        highlightTextInElement(nameBtn, keyword);
      }
      nameBtn.addEventListener("click", (event) => {
        event.stopPropagation();

        const input = document.createElement("input");
        input.className = "favorite-name-input";
        input.type = "text";
        input.value = record.name || "";
        input.placeholder = "请输入名称";
        input.addEventListener("mousedown", (mouseEvent) => {
          mouseEvent.stopPropagation();
        });
        input.addEventListener("click", (clickEvent) => {
          clickEvent.stopPropagation();
        });

        const commit = () => {
          updateFavoriteName(record.id, input.value.trim());
        };

        input.addEventListener("keydown", (keyEvent) => {
          if (keyEvent.key === "Enter") {
            keyEvent.preventDefault();
            commit();
          }
          if (keyEvent.key === "Escape") {
            keyEvent.preventDefault();
            renderHistoryPanel();
          }
        });

        input.addEventListener("blur", commit, { once: true });
        nameBtn.replaceWith(input);
        input.focus();
        input.select();
      });

      const dragHandle = document.createElement("button");
      dragHandle.className = "favorite-drag-handle";
      dragHandle.type = "button";
      dragHandle.title = "按住拖拽排序";
      dragHandle.setAttribute("aria-label", "按住拖拽排序");
      dragHandle.textContent = "☰";
      dragHandle.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      dragHandle.addEventListener("mousedown", (event) => {
        event.stopPropagation();
        startFavoritePointerDrag(event, record.id, itemEl);
      });

      metaEl.appendChild(nameBtn);
      metaEl.appendChild(dateEl);
      headEl.classList.add("favorite-head");
      headEl.appendChild(metaEl);
      headEl.appendChild(dragHandle);
      headEl.appendChild(actionsEl);
    } else {
      headEl.appendChild(dateEl);
      headEl.appendChild(actionsEl);
    }

    itemEl.appendChild(headEl);
    itemEl.appendChild(jsonEl);
    recordList.appendChild(itemEl);
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

function openRecordPanel(tab) {
  activeRecordTab = tab === "favorites" ? "favorites" : "history";
  renderHistoryPanel();
  toggleHistoryPanel(true);
}

function clearRecordSearchDebounceTimer() {
  if (!recordSearchDebounceTimer) {
    return;
  }
  window.clearTimeout(recordSearchDebounceTimer);
  recordSearchDebounceTimer = null;
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
  maximizeBtn.textContent = enabled ? "退出最大化" : "最大化";
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

    // Use a JSON-only Monaco setup to avoid loading unused language bundles.
    window.MonacoEnvironment = {
      getWorker(_moduleId, label) {
        if (label === "json") {
          return new Worker("./vendor/vs/assets/json.worker-DKiEKt88.js");
        }
        return new Worker("./vendor/vs/assets/editor.worker-Be8ye1pW.js");
      }
    };

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

function favoriteFromEditor() {
  try {
    const result = parseInputDetailed();
    const normalized = JSON.stringify(result.parsed, null, 2);
    ensureFavoriteContent(normalized);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "收藏失败";
    setStatus(msg, "error");
  }
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
if (openHistoryBtn) {
  openHistoryBtn.addEventListener("click", () => {
    openRecordPanel("history");
  });
}
if (openFavoritesBtn) {
  openFavoritesBtn.addEventListener("click", () => {
    openRecordPanel("favorites");
  });
}
if (editorFavoriteBtn) {
  editorFavoriteBtn.addEventListener("click", favoriteFromEditor);
}
maximizeBtn.addEventListener("click", () => {
  setMaximizeMode(!isMaximizeMode);
});
if (closeHistoryBtn) {
  closeHistoryBtn.addEventListener("click", () => {
    toggleHistoryPanel(false);
  });
}
if (historyTabBtn) {
  historyTabBtn.addEventListener("click", () => {
    activeRecordTab = "history";
    renderHistoryPanel();
  });
}
if (favoritesTabBtn) {
  favoritesTabBtn.addEventListener("click", () => {
    activeRecordTab = "favorites";
    renderHistoryPanel();
  });
}
if (recordSearchInput) {
  recordSearchInput.addEventListener("input", () => {
    const nextKeyword = recordSearchInput.value.trim();
    clearRecordSearchDebounceTimer();
    recordSearchDebounceTimer = window.setTimeout(() => {
      recordSearchKeyword = nextKeyword;
      renderHistoryPanel();
    }, 500);
  });

  recordSearchInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    const nextKeyword = recordSearchInput.value.trim();
    clearRecordSearchDebounceTimer();

    if (!nextKeyword) {
      return;
    }

    if (recordSearchKeyword !== nextKeyword) {
      recordSearchKeyword = nextKeyword;
      renderHistoryPanel();
    }

    jumpToNextSearchMatch();
  });
}
if (clearRecordSearchBtn) {
  clearRecordSearchBtn.addEventListener("click", () => {
    clearRecordSearchDebounceTimer();
    recordSearchKeyword = "";
    currentSearchMatchIndex = -1;
    if (recordSearchInput) {
      recordSearchInput.value = "";
      recordSearchInput.focus();
    }
    renderHistoryPanel();
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

document.addEventListener("mousedown", (event) => {
  if (!historyPanel || !historyPanel.classList.contains("open")) {
    return;
  }

  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }

  if (historyPanel.contains(target)) {
    return;
  }

  if (
    (openHistoryBtn && openHistoryBtn.contains(target)) ||
    (openFavoritesBtn && openFavoritesBtn.contains(target))
  ) {
    return;
  }

  toggleHistoryPanel(false);
});

initEditors()
  .then(() => {
    historyRecords = loadHistoryRecords();
    favoriteRecords = loadFavoriteRecords();
    renderHistoryPanel();
    setMaximizeMode(loadMaximizeModePreference());
    setStatus("准备就绪。", "success", { silent: true });
  })
  .catch((err) => {
    const msg = err instanceof Error ? err.message : "编辑器初始化失败。";
    setStatus(msg, "error");
  });
