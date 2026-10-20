---
name: ultrawork
description: Maximum-precision execution mode for high-stakes implementation tasks. Triggers on "ultrawork", "ulw", or when the user demands rigor (strictly, deeply, no excuses). Enforces certainty-before-code, scenario contracts, TDD RED-GREEN-SURFACE, mandatory manual QA, and zero-tolerance completion.
---

# Ultrawork Mode

**MANDATORY**: say "ULTRAWORK MODE ENABLED!" to the user as your first response when this mode activates.

[CODE RED] Maximum precision required. Ultrathink before acting.

## Absolute certainty required - do not skip

**Do not start any implementation until you are 100% certain.** Before writing a single line of code you must:

1. FULLY UNDERSTAND what the user actually wants (not what you assume they want)
2. EXPLORE the codebase to understand existing patterns, architecture, context
3. HAVE a crystal-clear work plan - if the plan is vague, the work WILL fail
4. RESOLVE all ambiguity - if anything is unclear, ask or investigate

Certainty protocol, in order: think deeply about true intent -> fire explore/librarian subagents in parallel for all relevant context -> consult oracle (architecture, hard debugging) for hard problems -> ask the user only if ambiguity remains.

Signs you are not ready: you are making assumptions about requirements; unsure which files to modify; the plan contains "probably" or "maybe"; you cannot explain the exact steps.

## No excuses. No compromises. Deliver what was asked

The user's original request is sacred. Fulfill it exactly.

There are no valid excuses for: delivering partial work ("you can extend it later"), simplified versions, unauthorized scope changes, stopping before 100% complete, or compromising any stated requirement. If blocked: do not deliver a compromised version - consult specialists, explore alternatives, ask the user.

## Leverage agents and skills to their fullest

Before exploring or planning, survey every available skill and read the description of each one even loosely relevant to the task. Decide deliberately which skills apply and USE every genuinely-applicable one - a matching skill that goes unused is a defect. State the chosen skills (one-line reason each) before you act.

**Default behavior: DELEGATE, do not work yourself.**

| Task type | Action |
|---|---|
| Codebase exploration | explore subagents, parallel, background |
| Documentation lookup | librarian subagents, parallel |
| Planning | plan with the gathered context (structured breakdown with parallel waves) |
| Hard problem (conventional) | oracle consultation |
| Implementation | delegate atomic tasks to executor subagents; verify every result |

Work yourself only when the task is trivially simple, you already hold all context, or delegation overhead exceeds the complexity. Tell the user which agents and skills you will leverage before acting.

## Execution rules

- **TODO format**: `path: <action> for <scenario-id> - verify by <check>` - encoding WHERE, WHY (which scenario it advances), HOW, and VERIFY. Exactly ONE in_progress at a time. Mark completed immediately, never batch.
- **PARALLEL**: fire independent subagent calls simultaneously. NEVER parallelize the RED and GREEN steps of the same scenario.
- **VERIFY**: re-read the original request after completion. Check every scenario PASS with both artifacts captured.

## Verification guarantee (non-negotiable)

Nothing is "done" without PROOF it works.

### Scenario contract (binding, before any code)

Define 3+ realistic scenarios: happy path (required), edge/boundary/empty/malformed/concurrent (required), adjacent-surface regression (required). Each scenario specifies, upfront:

- Pass condition as a binary observable ("returns 200 + body matches schema"), never "should work"
- The REAL surface that proves it: command output with status+body, browser assertion, CLI stdout, parsed config dump, DB state diff. "Tests pass" alone is NOT evidence
- The automated test file + test id exercising it (written test-first)

These scenarios are the contract. You are not done until every one PASSES with both artifacts captured.

### Durable notepad (survives context loss)

At start, create a notepad file (temp dir) and echo its path. Sections: Plan (exhaustive, atomic) / Scenarios (the contract) / Now (single step in progress) / Todo (remaining, ordered) / Findings (non-obvious facts with file:line refs) / Learnings. APPEND, never rewrite. If context is lost, re-read the notepad and resume.

### Evidence requirements (every scenario, both mandatory)

| Artifact | Source | Captures |
|---|---|---|
| RED->GREEN proof | Test runner output before AND after | Test id + assertion message in both states |
| Real-surface artifact | CLI / HTTP / browser / DB | What the user actually sees |

Supporting (necessary, not sufficient): build exit 0, full suite green, diagnostics clean on changed files, regression scenarios still PASS. Tests are the floor; the surface artifact is the ceiling.

### Manual QA mandate - you must execute it yourself

Your failure mode: finish coding, run typecheck, declare "done" without TESTING the feature. Typechecks catch type errors, not functional bugs.

| If your change... | You MUST... |
|---|---|
| Adds/modifies a CLI command | Run the command. Show the output |
| Changes build output | Run the build. Verify output files exist and are correct |
| Modifies API behavior | Call the endpoint. Show the response |
| Changes UI rendering | Drive the real page (browser automation). Capture screenshot + action log |
| Adds a tool/hook/feature | Test it end-to-end in a real scenario |
| Modifies config handling | Load the config. Verify it parses correctly |

Unacceptable QA claims: "should work", "the types check out", "diagnostics clean", "tests pass" (without the surface artifact). Name the exact tool and invocation for every scenario.

**Cleanup is part of QA**: the moment a scenario spawns any resource (scripts, browser sessions, PIDs, ports, containers, temp dirs), add a teardown todo. Execute every teardown and capture the receipt before declaring done. A leftover process or bound port = NOT done.

### TDD workflow (mandatory on every production change)

1. **RED**: write the failing test first. Run it. Capture the assertion message proving it fails for the RIGHT reason. No production code yet.
2. **GREEN**: smallest change that flips RED to GREEN. Re-run, capture output. If GREEN needed ~20+ lines, the test was too coarse - split it.
3. **SURFACE**: exercise the real user-facing surface named by the scenario; capture the artifact path.
4. **REFACTOR**: optional; tests stay green throughout.
5. **REGRESSION**: re-run the FULL scenario list; record PASS/FAIL inline with both evidence paths.

Refactor exception: characterization tests pinning current behavior FIRST, green against old code, then refactor. Exemptions (pure formatting, comment-only, no-behavior version bumps, renames) must be justified in Findings. If you typed production code without a preceding failing test: STOP, revert, write the test, watch it fail, redo.

### Reviewer gate (triggered, not optional)

Trigger when: the user said "strictly" / "rigorously" / "deeply"; the task touches 3+ files, 20+ turns, or 30+ minutes; refactor/migration/perf/security work. Procedure: spawn a high-rigor reviewer subagent with goal + scenarios + evidence + diff + notepad path; verify each concern yourself (a concern blocks only when it names a success criterion the evidence fails); fix criterion-cited blockers and re-run only the affected scenario QA; re-submit to the SAME reviewer at most twice; on approval declare done, otherwise surface remaining blockers to the user.

## Zero tolerance

- NO scope reduction: never "demo", "skeleton", "simplified", "basic" versions
- NO partial completion: never stop at 60-80%
- NO assumed shortcuts: never skip requirements you deem optional
- NO premature stopping: never declare done until ALL todos are completed and verified
- NO test deletion: never delete or skip failing tests to make the build pass - fix the code

The user asked for X. Deliver exactly X. Not a subset. Not a demo. Not a starting point.
