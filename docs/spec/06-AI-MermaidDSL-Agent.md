## AI Mermaid DSL Agent 生成规范（Flow2Go）

本项目的「AI：生成整张图」采用 **Mermaid DSL 作为中间表示**：

- **模型输出**：Mermaid `flowchart`（必须含 `subgraph Frontend/Backend`）
- **本地处理**：解析 Mermaid → 映射为 Flow2Go 的 `nodes/edges` → **ELK.js（layered）** 自动布局 → 写入画布

这样可以避免模型直接输出 Flow2Go JSON 时出现“纯文字/不合规 JSON”的不稳定问题。

---

### 1. 代码位置（你要改 system prompt 就改这里）

- **system prompt / user prompt 拼接**：`src/flow/aiDiagram.ts` → `openRouterGenerateDiagram()` 内的 `system` / `user` 字符串数组
- **Mermaid 解析**：`src/flow/aiDiagram.ts` → `parseMermaidFlowchart()`
- **Mermaid → nodes/edges 映射与布局**：`src/flow/aiDiagram.ts` → `mermaidToAiDraft()`
- **查看 DSL（UI）**：`src/flow/FlowEditor.tsx`（AI 草稿区域的「查看 DSL」按钮）

---

### 2. 期望的 Mermaid 输出协议（强约束）

模型必须输出 **纯 Mermaid**，不要解释文字。建议协议如下：

1) 第一行必须是：

```text
flowchart LR
```

2) 必须包含两个 subgraph（大小写敏感）：

```text
subgraph Frontend
  ...
end
subgraph Backend
  ...
end
```

3) 节点必须显式声明为 `id[中文标签]`

- `id`：只允许小写英文/数字/下划线，并以 `fe_` / `be_` 开头
- `label`：必须中文、简短、语义明确

示例：

```text
fe_login[登录页]
be_auth[鉴权服务]
```

4) 边必须使用 `-->`，并尽量带中文动作 label：

```text
fe_login -->|提交| be_auth
```

5) 禁止输出：

- 下划线拼接噪音作为 label（例如 `_____fe_payment_____be_payment`）
- `classDef/style/link/click` 等高级 Mermaid 语法
- Markdown 围栏（```mermaid）

---

### 3. 为什么要把示例放哪？

你有两种选择：

- **少量关键示例放在 system prompt（推荐）**  
  优点：稳定、无额外工程复杂度；缺点：prompt 变长、维护成本上升。

- **把大量示例放到单独文件夹（推荐用于长期维护）**  
  优点：可维护性强、可版本化；缺点：除非你实现“把文件内容注入 prompt”的机制，否则模型并不会自动读取这些文件。

> 目前代码是“直接拼接 prompt 并调用 OpenRouter”，没有检索/索引（RAG）能力。  
> 因此：**真正影响输出的示例，必须出现在 system/user prompt 文本里**。

建议策略：

- system prompt 里放 1-2 个“最小可行”的 Mermaid few-shot
- `docs/` 或 `examples/` 里放更多示例作为人工参考（需要时复制粘贴进 prompt）

