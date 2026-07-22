export interface StackInfo {
  readonly languages: readonly string[]
  readonly frameworks: readonly string[]
  readonly packageManager: string | null
  readonly testFramework: string | null
  readonly runtime: string | null
}

export interface StackIndicator {
  readonly stack: string
  readonly type: "language" | "framework" | "package-manager" | "test-framework" | "runtime"
  readonly files: readonly string[]
  readonly deps?: readonly string[]
}
