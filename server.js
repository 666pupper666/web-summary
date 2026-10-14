const path = require("path");
const dns = require("dns").promises;
const { URL } = require("url");
const express = require("express");
const { JSDOM } = require("jsdom");
const { Readability } = require("@mozilla/readability");
const iconv = require("iconv-lite");

require("dotenv").config();

const PORT = Number(process.env.PORT) || 3000;
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_BASE_URL = (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(
  /\/$/,
  ""
);
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || "deepseek-chat";
const FETCH_TIMEOUT_MS = 15000;
const MODEL_TIMEOUT_MS = 60000;
const MAX_ARTICLE_CHARS = 10000;
const MIN_ARTICLE_CHARS = 80;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

class AppError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function isPrivateIPv4(ip) {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return false;
  const [a, b] = parts;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

function isPrivateIPv6(ip) {
  const normalized = ip.toLowerCase();
  return (
    normalized === "::1" ||
    normalized === "::" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80")
  );
}

function isBlockedHostname(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host === "0.0.0.0" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".localhost")
  ) {
    return true;
  }
  if (isPrivateIPv4(host) || isPrivateIPv6(host)) return true;
  return false;
}

async function assertPublicUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new AppError(400, "INVALID_URL", "网址格式不正确，请输入完整的 http 或 https 链接。");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new AppError(400, "INVALID_URL", "只支持公开的 http 或 https 网页。");
  }

  if (isBlockedHostname(parsed.hostname)) {
    throw new AppError(400, "BLOCKED_URL", "不能抓取本机或内网地址，请使用公开网页。");
  }

  const host = parsed.hostname.replace(/^\[|\]$/g, "");
  if (isPrivateIPv4(host) || isPrivateIPv6(host)) {
    throw new AppError(400, "BLOCKED_URL", "不能抓取本机或内网地址，请使用公开网页。");
  }

  try {
    const lookup = await dns.lookup(host, { all: true });
    const blocked = lookup.some((item) =>
      item.family === 6 ? isPrivateIPv6(item.address) : isPrivateIPv4(item.address)
    );
    if (blocked) {
      throw new AppError(400, "BLOCKED_URL", "不能抓取本机或内网地址，请使用公开网页。");
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(400, "INVALID_URL", "无法解析该网址，请检查后重试。");
  }

  return parsed;
}

function normalizeCharset(charset) {
  const value = String(charset || "")
    .trim()
    .replace(/['"]/g, "")
    .toLowerCase();
  if (!value) return "utf-8";
  if (["gbk", "gb2312", "gb-2312", "gb_2312", "gb18030"].includes(value)) {
    return "gb18030";
  }
  if (value === "utf8" || value === "utf-8") return "utf-8";
  return value;
}

function detectCharset(contentType, buffer) {
  const headerMatch = /charset\s*=\s*([^;]+)/i.exec(contentType || "");
  if (headerMatch) return normalizeCharset(headerMatch[1]);

  const head = buffer.subarray(0, 8192).toString("latin1");
  const metaCharset = /charset\s*=\s*["']?([\w-]+)/i.exec(head);
  const xmlEncoding = /encoding\s*=\s*["']([\w-]+)/i.exec(head);
  if (metaCharset) return normalizeCharset(metaCharset[1]);
  if (xmlEncoding) return normalizeCharset(xmlEncoding[1]);
  return "utf-8";
}

function decodeHtml(buffer, contentType) {
  const charset = detectCharset(contentType, buffer);
  if (iconv.encodingExists(charset)) {
    return iconv.decode(buffer, charset);
  }
  return iconv.decode(buffer, "utf-8");
}

function cleanText(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function fallbackPageText(document) {
  const clone = document.documentElement.cloneNode(true);
  clone.querySelectorAll("script, style, noscript, iframe, svg").forEach((node) => node.remove());
  return cleanText(clone.textContent);
}

function extractArticle(html, pageUrl) {
  const dom = new JSDOM(html, { url: pageUrl });
  const document = dom.window.document;
  const reader = new Readability(document);
  const article = reader.parse();
  const title = cleanText(article?.title || document.title || "");
  let text = cleanText(article?.textContent || "");

  if (text.length < MIN_ARTICLE_CHARS) {
    text = fallbackPageText(document);
  }

  return { title, text };
}

async function fetchPage(pageUrl) {
  let response;
  try {
    response = await fetch(pageUrl, {
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      },
    });
  } catch {
    throw new AppError(
      502,
      "FETCH_FAILED",
      "网页抓取失败。该站点可能无法访问、超时或禁止抓取。你可以粘贴正文后再总结。"
    );
  }

  if (!response.ok) {
    throw new AppError(
      502,
      "FETCH_FAILED",
      `网页返回了 ${response.status}，无法抓取正文。你可以粘贴正文后再总结。`
    );
  }

  const contentType = response.headers.get("content-type") || "";
  if (contentType && !/html|xml|text\/plain/i.test(contentType)) {
    throw new AppError(400, "FETCH_FAILED", "该链接不是网页，请换一个公开文章地址，或粘贴正文后再总结。");
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  return decodeHtml(buffer, contentType);
}

function truncateText(text) {
  if (text.length <= MAX_ARTICLE_CHARS) return text;
  return `${text.slice(0, MAX_ARTICLE_CHARS)}\n\n[正文过长，已截断]`;
}

function modelErrorMessage(status, bodyText) {
  if (status === 401) return "DeepSeek 密钥无效，请检查 .env 中的 DEEPSEEK_API_KEY 后重启服务。";
  if (status === 402) return "DeepSeek 账户余额不足，请先充值后再试。";
  if (status === 429) return "DeepSeek 调用过于频繁，请稍后再试。";
  if (/insufficient|balance|quota|欠费|余额/i.test(bodyText || "")) {
    return "DeepSeek 账户余额或额度不足，请先充值后再试。";
  }
  return "调用 DeepSeek 生成摘要失败，请稍后重试。";
}

async function summarizeWithDeepSeek({ title, text, sourceUrl }) {
  if (!DEEPSEEK_API_KEY || DEEPSEEK_API_KEY.includes("your-key")) {
    throw new AppError(
      500,
      "MISSING_KEY",
      "未配置有效的 DEEPSEEK_API_KEY。请复制 .env.example 为 .env，填入密钥后重新运行 npm start。"
    );
  }

  const article = truncateText(text);
  const sourceLine = sourceUrl ? `来源网址：${sourceUrl}\n` : "";
  const titleLine = title ? `标题：${title}\n` : "";

  let response;
  try {
    response = await fetch(`${DEEPSEEK_BASE_URL}/v1/chat/completions`, {
      method: "POST",
      signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        temperature: 0.3,
        messages: [
          {
            role: "system",
            content:
              "你是网页摘要助手。请根据用户提供的正文写一段中文摘要，约 150 到 300 字，覆盖核心观点和要点。原文可能是中文或英文。不要编造正文没有的信息，不要输出英文标题翻译以外的无关内容。",
          },
          {
            role: "user",
            content: `${sourceLine}${titleLine}\n正文：\n${article}`,
          },
        ],
      }),
    });
  } catch {
    throw new AppError(504, "MODEL_ERROR", "连接 DeepSeek 超时或失败，请检查网络后重试。");
  }

  const raw = await response.text();
  if (!response.ok) {
    throw new AppError(502, "MODEL_ERROR", modelErrorMessage(response.status, raw));
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new AppError(502, "MODEL_ERROR", "DeepSeek 返回了无法解析的内容，请稍后重试。");
  }

  const summary = cleanText(data?.choices?.[0]?.message?.content || "");
  if (!summary) {
    throw new AppError(502, "MODEL_ERROR", "DeepSeek 没有返回摘要，请稍后重试。");
  }
  return summary;
}

app.post("/api/summarize", async (req, res, next) => {
  try {
    const url = typeof req.body?.url === "string" ? req.body.url.trim() : "";
    const pasted = typeof req.body?.text === "string" ? req.body.text.trim() : "";

    if (!url && !pasted) {
      throw new AppError(400, "INVALID_INPUT", "请输入网页网址，或粘贴要总结的正文。");
    }

    let title = "";
    let sourceUrl = "";
    let text = "";

    if (pasted) {
      text = cleanText(pasted);
      title = "粘贴的正文";
    } else {
      const parsed = await assertPublicUrl(url);
      sourceUrl = parsed.toString();
      const html = await fetchPage(sourceUrl);
      const article = extractArticle(html, sourceUrl);
      title = article.title;
      text = article.text;
    }

    if (text.length < 20) {
      throw new AppError(
        422,
        pasted ? "EMPTY_CONTENT" : "FETCH_FAILED",
        pasted
          ? "粘贴的正文太短，请提供更完整的内容后再总结。"
          : "未能提取到足够正文。该页面可能需要登录或由脚本渲染，请粘贴正文后再总结。"
      );
    }

    const summary = await summarizeWithDeepSeek({ title, text, sourceUrl });
    res.json({ title, sourceUrl, summary });
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  if (error instanceof AppError) {
    return res.status(error.status).json({ error: error.message, code: error.code });
  }
  if (error.type === "entity.parse.failed" || error.status === 400) {
    return res.status(400).json({ error: "请求格式不正确。", code: "INVALID_INPUT" });
  }
  console.error(error);
  res.status(500).json({ error: "服务器出错了，请稍后重试。", code: "SERVER_ERROR" });
});

app.listen(PORT, () => {
  console.log(`网页总结工具已启动：http://localhost:${PORT}`);
  if (!DEEPSEEK_API_KEY || DEEPSEEK_API_KEY.includes("your-key")) {
    console.warn("警告：尚未配置有效的 DEEPSEEK_API_KEY，摘要接口会返回错误而不是假结果。");
  }
});
