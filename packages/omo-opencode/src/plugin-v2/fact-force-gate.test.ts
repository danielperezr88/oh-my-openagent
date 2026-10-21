import { describe, expect, test } from "bun:test"
import { createReadTracker, extractFilePath } from "./fact-force-gate"

describe("createReadTracker", () => {
  describe("#given a session that has not read the target file", () => {
    test("#then an edit to the existing file is reported with a block reason", () => {
      // given
      const tracker = createReadTracker()

      // when
      const reason = tracker.observe("edit", "ses_a", "src/index.ts", true)

      // then
      expect(reason).toContain("Read src/index.ts before editing")
    })
  })

  describe("#given a file that does not exist yet", () => {
    test("#then an edit is allowed without a prior read", () => {
      // given
      const tracker = createReadTracker()

      // when
      const reason = tracker.observe("write", "ses_a", "src/new-file.ts", false)

      // then
      expect(reason).toBeNull()
    })
  })

  describe("#given a session that read the file first", () => {
    test("#then the edit is allowed", () => {
      // given
      const tracker = createReadTracker()
      tracker.observe("read", "ses_a", "src/index.ts", true)

      // when
      const reason = tracker.observe("edit", "ses_a", "src/index.ts", true)

      // then
      expect(reason).toBeNull()
    })
  })

  describe("#given another session read the file", () => {
    test("#then an edit from a different session is still blocked", () => {
      // given
      const tracker = createReadTracker()
      tracker.observe("read", "ses_a", "src/index.ts", true)

      // when
      const reason = tracker.observe("edit", "ses_b", "src/index.ts", true)

      // then
      expect(reason).not.toBeNull()
    })
  })

  describe("#given the session is forgotten", () => {
    test("#then prior reads no longer count", () => {
      // given
      const tracker = createReadTracker()
      tracker.observe("read", "ses_a", "src/index.ts", true)
      tracker.forgetSession("ses_a")

      // when
      const reason = tracker.observe("edit", "ses_a", "src/index.ts", true)

      // then
      expect(reason).not.toBeNull()
    })
  })

  describe("#given a tool outside read/edit sets", () => {
    test("#then no block reason is produced", () => {
      // given
      const tracker = createReadTracker()

      // when
      const reason = tracker.observe("bash", "ses_a", "src/index.ts", true)

      // then
      expect(reason).toBeNull()
    })
  })
})

describe("extractFilePath", () => {
  describe("#given common argument key shapes", () => {
    test("#then the first matching key wins", () => {
      // given / when / then
      expect(extractFilePath({ filePath: "a.ts" })).toBe("a.ts")
      expect(extractFilePath({ path: "b.ts" })).toBe("b.ts")
      expect(extractFilePath({ file_path: "c.ts" })).toBe("c.ts")
      expect(extractFilePath({ file: "d.ts" })).toBe("d.ts")
      expect(extractFilePath({ filePath: 42 })).toBeUndefined()
      expect(extractFilePath({})).toBeUndefined()
    })
  })
})
