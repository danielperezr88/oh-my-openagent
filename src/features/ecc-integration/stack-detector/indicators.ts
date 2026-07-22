import type { StackIndicator } from "./types"

export const STACK_INDICATORS: readonly StackIndicator[] = [
  { stack: "typescript", type: "language", files: ["tsconfig.json"] },
  { stack: "javascript", type: "language", files: ["jsconfig.json"] },
  { stack: "python", type: "language", files: ["pyproject.toml", "requirements.txt", "setup.py"] },
  { stack: "go", type: "language", files: ["go.mod"] },
  { stack: "rust", type: "language", files: ["Cargo.toml"] },
  { stack: "java", type: "language", files: ["pom.xml", "build.gradle"] },
  { stack: "ruby", type: "language", files: ["Gemfile"] },
  { stack: "csharp", type: "language", files: ["*.csproj"] },

  { stack: "react", type: "framework", files: [], deps: ["react", "react-dom"] },
  { stack: "nextjs", type: "framework", files: ["next.config.js", "next.config.mjs", "next.config.ts"], deps: ["next"] },
  { stack: "vue", type: "framework", files: [], deps: ["vue"] },
  { stack: "svelte", type: "framework", files: ["svelte.config.js"], deps: ["svelte"] },
  { stack: "express", type: "framework", files: [], deps: ["express"] },
  { stack: "nestjs", type: "framework", files: ["nest-cli.json"], deps: ["@nestjs/core"] },
  { stack: "fastapi", type: "framework", files: [], deps: ["fastapi"] },
  { stack: "django", type: "framework", files: ["manage.py"], deps: ["django"] },
  { stack: "flask", type: "framework", files: [], deps: ["flask"] },
  { stack: "rails", type: "framework", files: ["config/routes.rb"] },

  { stack: "bun", type: "runtime", files: ["bunfig.toml", "bun.lock"] },
  { stack: "deno", type: "runtime", files: ["deno.json", "deno.jsonc"] },
  { stack: "node", type: "runtime", files: ["package.json"] },

  { stack: "npm", type: "package-manager", files: ["package-lock.json"] },
  { stack: "yarn", type: "package-manager", files: ["yarn.lock"] },
  { stack: "pnpm", type: "package-manager", files: ["pnpm-lock.yaml"] },
  { stack: "bun-pm", type: "package-manager", files: ["bun.lock"] },
  { stack: "pip", type: "package-manager", files: ["requirements.txt"] },
  { stack: "poetry", type: "package-manager", files: ["poetry.lock"] },
  { stack: "cargo-pm", type: "package-manager", files: ["Cargo.lock"] },

  { stack: "jest", type: "test-framework", files: [], deps: ["jest"] },
  { stack: "vitest", type: "test-framework", files: [], deps: ["vitest"] },
  { stack: "bun-test", type: "test-framework", files: ["bunfig.toml"] },
  { stack: "pytest", type: "test-framework", files: [], deps: ["pytest"] },
  { stack: "go-test", type: "test-framework", files: ["go.mod"] },
]
