# System Architecture Template

请为以下主题生成一张适合 Flow2Go 展示的 System Architecture 图。

【系统主题】
{{topic}}

【系统描述】
{{description}}

【输出目标】
生成一张层次分明的系统架构图，体现用户入口、接入层、核心服务、平台能力、数据层、基础设施和外部依赖之间的关系。

【强制结构要求】
1. 必须采用系统分层结构，至少包含：
   - Users / Entry Points
   - Access Layer
   - Core Business Services
   - Platform Capabilities
   - Data Layer
   - Infrastructure / External Systems
2. 必须包含至少 3 个核心服务模块。
3. 必须体现至少 1 条主访问链路和 1 条底层支撑链路。
4. 必须使用分组清楚表达职责边界，不要画成简单流程步骤图。

【增强要求】
- 自动补齐 auth、cache、queue、storage、monitoring、third-party integration 等合理模块
- 连线要体现访问、调用、存储、订阅、同步、支撑等关系
- 节点命名专业简洁
- 适合大画布展示与继续扩图

【输出倾向】
- 产品级架构图
- 更偏系统设计，不偏业务流程
- 可读性强
- 模块边界清晰