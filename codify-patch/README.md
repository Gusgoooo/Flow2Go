# codify-patch：Flow2Go Routify 代理路由

## 用途

让 Flow2Go 前端通过 codify 的 Next.js 服务端代理访问 Routify AI 网关，API Key 完全在服务端，前端零密钥。

## 部署步骤

### 1. 将路由文件拷贝到 codify 项目

```bash
cp -r app/api/flow2go  <codify-repo>/app/api/flow2go
```

### 2. 在 codify 服务端环境变量中添加

```env
ROUTIFY_API_KEY=sk-xxx
```

可选（有默认值）：

```env
ROUTIFY_BASE_URL=https://routify.alibaba-inc.com/protocol/openai/v1
```

### 3. 重新部署 codify

部署后 Flow2Go 前端请求 `/api/flow2go/routify/chat/completions` 会被 codify 服务端接住并转发。
如果你要按 Vertex 文档示例走 `generateContent`，则使用 `/api/flow2go/vertex/*` 路由代理到 Routify Vertex。

## 请求流程

```
Flow2Go 前端 (pre-codify.alibaba-inc.com)
  ↓ POST /api/flow2go/routify/chat/completions
codify Next.js API Route
  ↓ POST + Authorization: Bearer sk-xxx
https://routify.alibaba-inc.com/protocol/openai/v1/chat/completions
  ↓ 响应
codify → Flow2Go 前端
```

## Vertex generateContent（图片模型）

```
Flow2Go 前端
  ↓ POST /api/flow2go/vertex/models/<model>:generateContent
codify Next.js API Route
  ↓ POST + x-goog-api-key: sk-xxx
https://routify.alibaba-inc.com/protocol/vertex/v1beta/models/<model>:generateContent
  ↓ 响应
codify → Flow2Go 前端
```

## Codex / ChatGPT CLI 配置时频繁 403？（公司网络加速下的通用解法）

### 根因（为什么 Web 端能用，CLI 验证却 403）

很多 CLI/桌面端在登录验证的最后一步会使用 `http://127.0.0.1:<port>` / `http://localhost:<port>` 做回调（OAuth/Device Flow 的本地回调）。
公司“网络加速”通常只接管外部域名流量，但**回调到 localhost 的这一跳会走本地默认网络**，导致最终验证被拦截，从而出现 `403 Forbidden`。

解决思路是：启动 CLI 前，强制它的**所有流量（包含 localhost 回调）都走代理**。

### 步骤 1：获取你的代理端口

Mac 路径：系统设置 → 网络 → Wi‑Fi/以太网 → 详细信息 → 代理（Proxies）

- 如果你看到 **HTTP/HTTPS 代理**：记下端口（常见 `7890` / `8080` / `10809`）
- 如果只看到 **SOCKS 代理**：记下 SOCKS 端口（常见 `7891` / `10808`）

### 步骤 2A：已有 HTTP/HTTPS 代理（推荐）

在**同一个终端会话**里先设置环境变量，再执行登录命令（把 `<PORT>` 换成你的端口）：

```bash
export http_proxy="http://127.0.0.1:<PORT>"
export https_proxy="http://127.0.0.1:<PORT>"

# 常见 CLI 也会读这个（可选但建议一起设）
export all_proxy="http://127.0.0.1:<PORT>"
```

然后在同一个终端里运行你要登录的 CLI（示例）：

```bash
codex login
```

### 步骤 2B：只有 SOCKS，没有 HTTP（兄弟集团/部分策略常见）

有些环境只提供 SOCKS 代理，CLI 只认 `http_proxy/https_proxy`，就会在登录回调阶段继续 403。
做法是把 SOCKS **本地转换成 HTTP 代理**，再按 2A 方式设置 `http_proxy/https_proxy`。

下面给出两个常见方案（二选一即可）。

#### 方案 B1：使用 Clash / Surge / Shadowrocket 的「端口复用/HTTP 端口」

很多客户端同时提供 HTTP 端口（例如 7890）和 SOCKS 端口（例如 7891）。
优先直接使用它提供的 HTTP 端口，回到“步骤 2A”设置即可。

#### 方案 B2：用 `privoxy` 把 SOCKS 转成 HTTP（通用）

1) 安装：

```bash
brew install privoxy
```

2) 写入最小配置（把 `<SOCKS_PORT>` 换成你的 SOCKS 端口）：

```bash
mkdir -p ~/.config/privoxy
cat > ~/.config/privoxy/config <<'EOF'
listen-address  127.0.0.1:8118
toggle          1
enable-remote-toggle  0
enable-remote-http-toggle  0
enable-edit-actions 0
forward-socks5t / 127.0.0.1:<SOCKS_PORT> .
EOF
```

3) 启动 privoxy：

```bash
privoxy --no-daemon ~/.config/privoxy/config
```

保持该进程运行，新开一个终端（或同终端另开 tab）设置代理并登录：

```bash
export http_proxy="http://127.0.0.1:8118"
export https_proxy="http://127.0.0.1:8118"
export all_proxy="http://127.0.0.1:8118"

codex login
```

### 快速自检（避免走错链路）

- 开启加速后，浏览器能访问 `chatgpt.com`：说明域名未被禁用（有继续配置的价值）
- 浏览器也访问不了：大概率公司侧直接禁用 OpenAI 相关域名，此方案无法绕过
- 浏览器能用，但 CLI 登录 403：按本文“全局代理/转换”基本可解
