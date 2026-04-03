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
