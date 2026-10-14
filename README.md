# 网页总结工具

输入公开网页网址，提取正文，调用 DeepSeek 生成中文摘要。抓取失败时可以粘贴正文再总结。

## 你需要准备

- 已安装 Node.js（18 或更高）、npm
- DeepSeek API 密钥（不要把密钥写进网页或提交到 Git）

## 申请并配置模型密钥

1. 打开 [DeepSeek 开放平台](https://platform.deepseek.com/) 注册并完成实名。
2. 进入 API Keys，创建密钥（形如 `sk-...`），立即复制保存。
3. 账户需要有余额，否则模型调用会失败。
4. 在本项目根目录执行：

```powershell
Copy-Item .env.example .env
```

5. 用 Cursor 或记事本打开 `.env`，把 `DEEPSEEK_API_KEY=` 后面改成你的真实密钥。

```
DEEPSEEK_API_KEY=sk-你的密钥
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat
PORT=3000
```

修改 `.env` 后必须重新运行 `npm start` 才会生效。不要把 `.env` 发给别人或上传到 Git。

## 启动

在 PowerShell 中：

```powershell
cd D:\AITraining\web-summary
npm install
npm start
```

浏览器打开 [http://localhost:3000](http://localhost:3000)。

停止服务：在运行窗口按 `Ctrl+C`。

## 使用说明

- 粘贴公开网页的 `http` 或 `https` 网址，点击「生成摘要」。
- 等待加载完成后可复制中文摘要。
- 若网页拒绝抓取、需要登录，或是大量脚本渲染的页面，按提示粘贴正文，再点「用粘贴内容总结」。
- 没有密钥、余额不足、或模型超时，界面会显示真实错误，不会用假摘要代替。

## 常见问题

- **未配置 DEEPSEEK_API_KEY**：检查 `.env` 是否存在、密钥是否填对，然后重启服务。
- **余额不足 / 401 / 429**：到 DeepSeek 控制台检查密钥、余额和调用频率。
- **网页抓取失败**：该站点可能有反爬或登录墙，请改用粘贴正文。
- **只支持公开网页**：本机地址和常见内网地址会被拒绝。
