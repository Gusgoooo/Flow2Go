import { describe, expect, it } from "vitest";
import { parseMermaidFlowchart } from "../parser";

describe("parseMermaidFlowchart", () => {
  it("parses minimal graph", () => {
    const result = parseMermaidFlowchart(`flowchart LR
A --> B`);

    expect(result.success).toBe(true);
    expect(result.ir?.nodes).toHaveLength(2);
    expect(result.ir?.edges).toHaveLength(1);
    expect(result.ir?.direction).toBe("LR");
  });

  it("parses chinese labels", () => {
    const result = parseMermaidFlowchart(`flowchart LR
A[登录页] --> B[鉴权请求]`);

    expect(result.success).toBe(true);
    expect(result.ir?.nodes.find((n) => n.id === "A")?.label).toBe("登录页");
    expect(result.ir?.nodes.find((n) => n.id === "B")?.label).toBe("鉴权请求");
  });

  it("parses edge labels", () => {
    const result = parseMermaidFlowchart(`flowchart LR
A -->|提交| B`);

    expect(result.success).toBe(true);
    expect(result.ir?.edges[0].label).toBe("提交");
  });

  it("parses subgraph", () => {
    const result = parseMermaidFlowchart(`flowchart LR
subgraph Frontend
  A[登录页]
end`);

    expect(result.success).toBe(true);
    expect(result.ir?.subgraphs).toHaveLength(1);
    expect(result.ir?.nodes[0].subgraphId).toBeTruthy();
  });

  it("warns unsupported syntax", () => {
    const result = parseMermaidFlowchart(`flowchart LR
classDef red fill:#f00
A --> B`);

    expect(result.success).toBe(true);
    expect(result.warnings.some((w) => w.code === "UNSUPPORTED_SYNTAX")).toBe(true);
  });
});