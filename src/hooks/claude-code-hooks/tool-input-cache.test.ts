import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { unsafeTestValue } from "../../../test-support/unsafe-test-value"
import {
  cacheToolInput,
  getToolInput,
  clearToolInputCache,
  stopToolInputCacheCleanup,
  _testReset,
} from "./tool-input-cache"

describe("tool-input-cache", () => {
  beforeEach(() => {
    _testReset()
  })

  afterEach(() => {
    _testReset()
  })

  test("#given cached entries from multiple sessions #when clearing one session #then only matching entries are removed", async () => {
    //#given
    cacheToolInput("ses_a", "Read", "call-1", { path: "a" })
    cacheToolInput("ses_b", "Read", "call-2", { path: "b" })

    //#when
    clearToolInputCache("ses_a")

    //#then
    expect(getToolInput("ses_a", "Read", "call-1")).toBeNull()
    expect(getToolInput("ses_b", "Read", "call-2")).toEqual({ path: "b" })
  })

  test("#given cleanup timer started #when stop cleanup runs #then interval is cleared and cache is emptied", async () => {
    //#given
    const intervalHandle = unsafeTestValue<ReturnType<typeof setInterval>>({ unref: mock(() => {}) })
    const setIntervalMock = mock(() => intervalHandle)
    const clearIntervalMock = mock(() => {})
    globalThis.setInterval = unsafeTestValue<typeof setInterval>(setIntervalMock)
    globalThis.clearInterval = unsafeTestValue<typeof clearInterval>(clearIntervalMock)

    try {
      cacheToolInput("ses_stop", "Read", "call-stop", { path: "stop" })

      //#when
      stopToolInputCacheCleanup()

      //#then
      expect(setIntervalMock).toHaveBeenCalledTimes(1)
      expect(clearIntervalMock).toHaveBeenCalledWith(intervalHandle)
      expect(getToolInput("ses_stop", "Read", "call-stop")).toBeNull()
    } finally {
      globalThis.setInterval = unsafeTestValue<typeof setInterval>(() => intervalHandle)
    }
  })
})