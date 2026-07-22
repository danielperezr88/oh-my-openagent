import type { KnowledgeFragment } from "./types"

const secretsFragment: KnowledgeFragment = {
  id: "sec-secrets",
  topic: "secrets",
  category: "security",
  content: `## Secret Management
- Never hardcode API keys, passwords, or tokens in source files
- Use environment variables or a secrets manager (vault, AWS Secrets Manager)
- Common patterns to detect: sk- (OpenAI), ghp_ (GitHub), AKIA (AWS), -----BEGIN PRIVATE KEY-----
- Scan .env files before committing; ensure .gitignore covers all secret-bearing files
- Rotate exposed credentials immediately, do not just remove them from git`,
  triggers: ["secret", "api-key", "token", "password", "credential", "env", "leak"],
}

const inputValidationFragment: KnowledgeFragment = {
  id: "sec-input-validation",
  topic: "input-validation",
  category: "security",
  content: `## Input Validation
- Validate ALL external input: HTTP params, body fields, query strings, headers
- Use schema validation (Zod, Joi, pydantic) at system boundaries
- Never trust client-side validation alone; server must re-validate
- Sanitize string inputs: trim, escape, enforce max length
- Reject unexpected fields (mass assignment prevention)`,
  triggers: ["validation", "input", "sanitize", "schema", "zod", "joi", "pydantic"],
}

const sqlInjectionFragment: KnowledgeFragment = {
  id: "sec-sql-injection",
  topic: "sql-injection",
  category: "security",
  content: `## SQL Injection Prevention
- Use parameterized queries / prepared statements exclusively
- Never concatenate user input into SQL strings
- ORMs (Prisma, TypeORM, SQLAlchemy) parameterize by default but watch raw query methods
- Validate table/column names against allowlists if dynamically constructed
- Test with sqlmap or similar automated scanners in CI`,
  triggers: ["sql", "injection", "database", "query", "sqli", "orm"],
}

const xssFragment: KnowledgeFragment = {
  id: "sec-xss",
  topic: "xss",
  category: "security",
  content: `## XSS Prevention
- Escape all dynamic content rendered in HTML
- Use framework auto-escaping (React JSX, Vue templates, Jinja2 autoescape)
- Never use dangerouslySetInnerHTML (React) or v-html (Vue) with user input
- Set Content-Security-Policy headers to restrict script sources
- Sanitize HTML with DOMPurify if rich text input is required`,
  triggers: ["xss", "html", "escape", "script", "csp", "dompurify"],
}

const csrfFragment: KnowledgeFragment = {
  id: "sec-csrf",
  topic: "csrf",
  category: "security",
  content: `## CSRF Prevention
- Use anti-CSRF tokens for state-changing operations (POST/PUT/DELETE)
- Set SameSite=Strict or SameSite=Lax on session cookies
- Verify Origin and Referer headers on cross-origin requests
- Consider double-submit cookie pattern for API-only architectures`,
  triggers: ["csrf", "cookie", "samesite", "token", "origin"],
}

const authJwtFragment: KnowledgeFragment = {
  id: "sec-auth-jwt",
  topic: "auth-jwt",
  category: "security",
  language: "typescript",
  content: `## JWT Authentication (TypeScript)
- Store tokens in httpOnly cookies, NOT localStorage (XSS risk)
- Use short-lived access tokens (15min) + long-lived refresh tokens
- Verify signature, expiration, issuer, and audience on every request
- Never put sensitive data in JWT payload (it's base64, not encrypted)
- Rotate signing keys periodically; support key overlap during rotation
- Libraries: jose, jsonwebtoken (Node), or framework built-in`,
  triggers: ["jwt", "token", "auth", "login", "session", "cookie"],
}

const authRbacFragment: KnowledgeFragment = {
  id: "sec-auth-rbac",
  topic: "auth-rbac",
  category: "security",
  content: `## Authorization (RBAC/ABAC)
- Check authorization on EVERY request, not just authentication
- Define roles with minimal permissions (principle of least privilege)
- Resource-level checks: user can only access their own resources
- Centralize authorization logic in middleware/guards, not scattered in handlers
- Log denied access attempts for audit trails`,
  triggers: ["rbac", "role", "permission", "authorize", "access", "auth", "guard", "middleware"],
}

const rateLimitingFragment: KnowledgeFragment = {
  id: "sec-rate-limiting",
  topic: "rate-limiting",
  category: "security",
  content: `## Rate Limiting
- Apply rate limiting to ALL public endpoints, especially auth
- Use sliding window or token bucket algorithms
- Per-IP and per-user limits (authenticated users get higher limits)
- Return 429 with Retry-After header
- Consider distributed rate limiting (Redis) for multi-instance deployments
- Libraries: express-rate-limit, @nestjs/throttler, slowapi (Python)`,
  triggers: ["rate", "limit", "throttle", "429", "ddos", "abuse"],
}

const dependencySecurityFragment: KnowledgeFragment = {
  id: "sec-dependency-security",
  topic: "dependency-security",
  category: "security",
  content: `## Dependency Security
- Run npm audit / pip-audit / cargo audit in CI
- Review transitive dependencies for known CVEs
- Pin major versions; use lockfiles
- Prefer packages with active maintenance and high download counts
- Remove unused dependencies regularly (depcheck, pipreqs)`,
  triggers: ["dependency", "audit", "cve", "vulnerability", "npm-audit", "supply-chain"],
}

const sensitiveDataFragment: KnowledgeFragment = {
  id: "sec-sensitive-data",
  topic: "sensitive-data",
  category: "security",
  content: `## Sensitive Data Exposure
- Never log sensitive data (passwords, tokens, PII, credit cards)
- Mask sensitive fields in API responses (return last 4 digits only)
- Encrypt data at rest (AES-256) and in transit (TLS 1.2+)
- Use dedicated secrets for each environment (dev/staging/prod)
- Comply with GDPR/CCPA: data minimization, retention policies, right to erasure`,
  triggers: ["pii", "gdpr", "encrypt", "log", "mask", "sensitive", "privacy"],
}

const fileUploadFragment: KnowledgeFragment = {
  id: "sec-file-upload",
  topic: "file-upload",
  category: "security",
  content: `## File Upload Security
- Validate file type by content (magic bytes), not just extension
- Enforce max file size limits
- Store uploads outside web root or in object storage (S3, GCS)
- Generate new filenames (UUID) to prevent path traversal
- Scan uploaded files for malware in production
- Never execute uploaded files as code`,
  triggers: ["upload", "file", "multer", "formdata", "attachment"],
}

const corsFragment: KnowledgeFragment = {
  id: "sec-cors",
  topic: "cors",
  category: "security",
  content: `## CORS Configuration
- Set explicit Access-Control-Allow-Origin (avoid wildcard * with credentials)
- Configure allowed methods per route, not globally permissive
- Limit allowed headers to what your API actually uses
- Set Access-Control-Max-Age to reduce preflight requests
- Never combine CORS wildcard with Allow-Credentials: true`,
  triggers: ["cors", "origin", "cross-origin", "preflight", "access-control"],
}

const immutabilityFragment: KnowledgeFragment = {
  id: "style-immutability",
  topic: "immutability",
  category: "coding-style",
  content: `## Immutability
- Prefer const over let; never use var
- Use readonly modifier on class fields that shouldn't change
- Use spread operators or Object.freeze for immutable updates
- Prefer pure functions that return new objects over mutation
- Use readonly arrays (readonly T[]) for function parameters where possible`,
  triggers: ["const", "readonly", "immutable", "freeze", "spread", "pure"],
  language: "typescript",
}

const errorHandlingFragment: KnowledgeFragment = {
  id: "style-error-handling",
  topic: "error-handling",
  category: "coding-style",
  content: `## Error Handling
- Never use empty catch blocks; always handle or rethrow
- Create custom error classes for domain-specific errors
- Return structured error responses: { error: { code, message, details? } }
- Use Result<T, E> pattern for expected errors, throw for unexpected
- Log errors with context (operation, input summary, stack trace)
- Never expose internal error details to clients in production`,
  triggers: ["catch", "error", "throw", "try", "exception", "result", "either"],
}

const fileOrganizationFragment: KnowledgeFragment = {
  id: "style-file-organization",
  topic: "file-organization",
  category: "coding-style",
  content: `## File Organization
- One responsibility per file; if you can't describe it in one phrase, split it
- kebab-case for all filenames
- index.ts as barrel export only (re-exports, no business logic)
- Maximum 200 LOC per file (excluding prompt/template strings)
- No catch-all files (utils.ts, helpers.ts, service.ts are banned)
- Co-locate tests: foo.ts + foo.test.ts in the same directory`,
  triggers: ["file", "organization", "structure", "naming", "barrel", "kebab"],
}

const namingConventionsFragment: KnowledgeFragment = {
  id: "style-naming",
  topic: "naming",
  category: "coding-style",
  language: "typescript",
  content: `## TypeScript Naming Conventions
- camelCase for variables, functions, methods
- PascalCase for classes, interfaces, types, enums
- UPPER_SNAKE_CASE for constants
- Prefix interfaces with descriptive names, not I (UserService not IUserService)
- Boolean variables: isXxx, hasXxx, canXxx (isLoading, hasPermission)
- Async functions: verb + Async suffix optional but consistent within codebase`,
  triggers: ["naming", "camelcase", "pascalcase", "convention", "variable"],
}

const tddFragment: KnowledgeFragment = {
  id: "test-tdd",
  topic: "tdd",
  category: "testing",
  content: `## Test-Driven Development
- Write the test first, watch it fail, implement, watch it pass
- Test names should describe behavior: "returns X when Y"
- One assertion concept per test (multiple related expects OK)
- Arrange-Act-Assert or given-when-then structure consistently
- Test behavior, not implementation (don't test private methods)
- Aim for high coverage on critical paths, not 100% everywhere`,
  triggers: ["test", "tdd", "spec", "assert", "mock", "jest", "vitest", "bun-test"],
}

const coverageFragment: KnowledgeFragment = {
  id: "test-coverage",
  topic: "coverage",
  category: "testing",
  content: `## Test Coverage
- Minimum 80% coverage on business logic
- Integration tests for API endpoints and database operations
- E2E tests for critical user journeys (auth, payment, data flow)
- Snapshot tests sparingly; prefer explicit assertions
- Run tests in CI on every PR; block merges on failures
- Mutation testing (Stryker) to verify test quality, not just coverage`,
  triggers: ["coverage", "integration", "e2e", "ci", "mutation", "stryker"],
}

const apiResponseFragment: KnowledgeFragment = {
  id: "pattern-api-response",
  topic: "api-response",
  category: "patterns",
  content: `## API Response Format
- Consistent envelope: { data, error, meta: { page, total, timestamp } }
- Use proper HTTP status codes (200 success, 201 created, 204 no content)
- Pagination via Link header or meta object (cursor-based preferred)
- Version your API: URL path (/v1/) or Accept header negotiation
- Include rate limit info in headers (X-RateLimit-Remaining)`,
  triggers: ["api", "response", "rest", "pagination", "status", "envelope"],
}

const repositoryPatternFragment: KnowledgeFragment = {
  id: "pattern-repository",
  topic: "repository",
  category: "patterns",
  content: `## Repository Pattern
- Abstract data access behind interfaces for testability
- Repository methods: find, findById, create, update, delete
- Inject repository into services via constructor (DI)
- Mock repositories in unit tests; use real ones in integration tests
- Keep ORM-specific logic inside repository, not leaking to services`,
  triggers: ["repository", "dao", "data-access", "di", "dependency-injection", "service"],
}

const tsAsyncFragment: KnowledgeFragment = {
  id: "style-ts-async",
  topic: "ts-async",
  category: "coding-style",
  language: "typescript",
  content: `## TypeScript Async Patterns
- Always use async/await over .then()/.catch() chains
- Type return values explicitly: async function foo(): Promise<User>
- Handle promise rejections (try/catch or .catch())
- Use Promise.all for independent async operations
- Never pass async functions as EventEmitter callbacks
- Consider p-limit for concurrency control in batch operations`,
  triggers: ["async", "await", "promise", "then", "catch", "concurrency"],
}

const reactComponentsFragment: KnowledgeFragment = {
  id: "style-react-components",
  topic: "react-components",
  category: "coding-style",
  language: "typescript",
  framework: "react",
  content: `## React Component Patterns
- Function components with hooks; no class components
- Props interface above component, named {ComponentName}Props
- Destructure props in function signature
- Memoize expensive computations with useMemo, callbacks with useCallback
- Colocate styles with components (CSS modules, styled-components)
- One component per file; file name matches component name`,
  triggers: ["react", "component", "jsx", "tsx", "props", "hook", "usememo"],
}

const reactHooksFragment: KnowledgeFragment = {
  id: "style-react-hooks",
  topic: "react-hooks",
  category: "coding-style",
  language: "typescript",
  framework: "react",
  content: `## React Hook Rules
- Never call hooks conditionally or inside loops
- useEffect cleanup: return cleanup function for subscriptions/timers
- Custom hooks for reusable stateful logic (use prefixed with "use")
- Dependencies array must include all reactive values used
- Prefer useReducer for complex state transitions over multiple useState
- Use React.memo for components that receive stable props but re-render often`,
  triggers: ["useeffect", "usestate", "usereducer", "usememo", "hook", "cleanup", "dependency"],
}

export const KNOWLEDGE_FRAGMENTS: readonly KnowledgeFragment[] = [
  secretsFragment,
  inputValidationFragment,
  sqlInjectionFragment,
  xssFragment,
  csrfFragment,
  authJwtFragment,
  authRbacFragment,
  rateLimitingFragment,
  dependencySecurityFragment,
  sensitiveDataFragment,
  fileUploadFragment,
  corsFragment,
  immutabilityFragment,
  errorHandlingFragment,
  fileOrganizationFragment,
  namingConventionsFragment,
  tddFragment,
  coverageFragment,
  apiResponseFragment,
  repositoryPatternFragment,
  tsAsyncFragment,
  reactComponentsFragment,
  reactHooksFragment,
]
