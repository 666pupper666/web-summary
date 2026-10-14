const urlForm = document.querySelector("#url-form");
const urlInput = document.querySelector("#url-input");
const urlSubmit = document.querySelector("#url-submit");
const pastePanel = document.querySelector("#paste-panel");
const pasteInput = document.querySelector("#paste-input");
const pasteSubmit = document.querySelector("#paste-submit");
const statusEl = document.querySelector("#status");
const errorEl = document.querySelector("#error");
const resultEl = document.querySelector("#result");
const resultTitle = document.querySelector("#result-title");
const resultSource = document.querySelector("#result-source");
const resultSummary = document.querySelector("#result-summary");
const copyButton = document.querySelector("#copy-button");
const copyHint = document.querySelector("#copy-hint");

function setHidden(el, hidden) {
  el.hidden = hidden;
}

function setLoading(isLoading, message) {
  urlSubmit.disabled = isLoading;
  pasteSubmit.disabled = isLoading;
  urlInput.disabled = isLoading;
  pasteInput.disabled = isLoading;

  if (isLoading) {
    statusEl.textContent = message;
    setHidden(statusEl, false);
    setHidden(errorEl, true);
    setHidden(resultEl, true);
    setHidden(copyHint, true);
  } else {
    setHidden(statusEl, true);
  }
}

function showError(message, showPaste) {
  errorEl.textContent = message;
  setHidden(errorEl, false);
  setHidden(statusEl, true);
  setHidden(resultEl, true);
  if (showPaste) setHidden(pastePanel, false);
}

function showResult({ title, sourceUrl, summary }) {
  resultTitle.textContent = title || "摘要";
  resultSummary.textContent = summary;
  if (sourceUrl) {
    resultSource.href = sourceUrl;
    resultSource.textContent = sourceUrl;
    setHidden(resultSource, false);
  } else {
    resultSource.removeAttribute("href");
    resultSource.textContent = "";
    setHidden(resultSource, true);
  }
  setHidden(resultEl, false);
  setHidden(errorEl, true);
  setHidden(copyHint, true);
}

async function requestSummary(payload) {
  const response = await fetch("/api/summarize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  let data = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (!response.ok) {
    const error = new Error(data.error || "总结失败，请稍后重试。");
    error.code = data.code;
    throw error;
  }
  return data;
}

function shouldShowPaste(code) {
  return code === "FETCH_FAILED" || code === "EMPTY_CONTENT";
}

async function summarize(payload, loadingMessage) {
  setLoading(true, loadingMessage);
  try {
    const data = await requestSummary(payload);
    showResult(data);
  } catch (error) {
    showError(error.message || "总结失败，请稍后重试。", shouldShowPaste(error.code));
  } finally {
    setLoading(false);
  }
}

urlForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const url = urlInput.value.trim();
  if (!url) {
    showError("请输入网页网址。", false);
    return;
  }
  summarize({ url }, "正在抓取网页并生成摘要…");
});

pasteSubmit.addEventListener("click", () => {
  const text = pasteInput.value.trim();
  if (!text) {
    showError("请先粘贴要总结的正文。", true);
    return;
  }
  summarize({ text }, "正在根据粘贴正文生成摘要…");
});

copyButton.addEventListener("click", async () => {
  const summary = resultSummary.textContent || "";
  if (!summary) return;
  try {
    await navigator.clipboard.writeText(summary);
    copyHint.textContent = "已复制到剪贴板";
    setHidden(copyHint, false);
  } catch {
    copyHint.textContent = "复制失败，请手动选择摘要文字。";
    setHidden(copyHint, false);
  }
});
