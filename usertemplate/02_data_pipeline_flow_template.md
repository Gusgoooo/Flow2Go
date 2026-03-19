# Data Pipeline Flow Template

请为以下主题生成一张适合 Flow2Go 展示的 Data Pipeline 图。

【主题】
{{topic}}

【背景描述】
{{description}}

【输出目标】
生成一张从数据源进入，到采集、清洗、转换、存储、建模、服务、消费的完整数据管道图。

【强制结构要求】
1. 必须至少包含以下区域：
   - Data Sources
   - Ingestion
   - Processing / Transformation
   - Storage / Warehouse / Feature Store
   - Serving / BI / API / Downstream Consumers
2. 必须体现：
   - 多源输入
   - 数据加工
   - 存储沉淀
   - 指标或结果输出
   - 至少一个数据质量或监控节点
3. 必须展示至少一条主数据流和一条治理/监控辅助线。
4. 节点要体现真实数据产品结构，不要画成简单顺序框图。

【增强要求】
- 自动补齐调度、校验、去重、监控、异常告警等合理中间节点
- 数据流向要清晰
- 连线语义明确，如采集、清洗、写入、聚合、服务、消费
- 适合大画布展示，结构有层次

【输出倾向】
- 数据工程视角
- 产品级结构化
- 强分层
- 适合继续扩图