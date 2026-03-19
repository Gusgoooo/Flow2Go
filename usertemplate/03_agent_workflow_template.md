# Agent Workflow Template

请为以下主题生成一张适合 Flow2Go 展示的 Agent Workflow 图。

【主题】
{{topic}}

【任务说明】
{{description}}

【输出目标】
生成一张多 Agent 协作工作流图，重点展示任务入口、规划、多个专长 Agent、工具/知识调用、评审校验、最终输出与反馈回路。

【强制结构要求】
1. 必须包含以下模块中的大部分：
   - User / Trigger
   - Planner / Orchestrator
   - Specialist Agents
   - Tools / APIs / Knowledge Base / Memory
   - Reviewer / Verifier
   - Final Output
2. 必须有：
   - 至少 2 个专长 Agent
   - 至少 1 个工具调用或知识检索节点
   - 至少 1 个评审节点
   - 至少 1 条反馈回路
3. 必须体现上下文如何在不同节点间流动。
4. 不要只画成简单的串行步骤，必须体现协作与编排。

【增强要求】
- 自动补齐 context builder、memory、tool routing、fallback、human review 等合理节点
- 使用清晰分组，突出 Agent 职责边界
- 连线语义明确，如规划、分发、调用、检索、验证、回写、汇总
- 结构适合大图展示和后续扩展

【输出倾向】
- 更像生产级 AI Workflow，而不是概念图
- 可继续编辑
- 可扩展为更复杂多 Agent 架构