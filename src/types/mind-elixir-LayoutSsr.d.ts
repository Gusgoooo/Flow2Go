declare module 'mind-elixir/LayoutSsr' {
  export function layoutSSR(
    root: unknown,
    opts?: { direction?: number },
  ): {
    root: unknown
    leftNodes: unknown[]
    rightNodes: unknown[]
    direction: number
  }
}
