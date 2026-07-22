import { describe, test, expect } from "bun:test"
import { unsafeTestValue } from "../../../test-support/unsafe-test-value"
import {
  startPendingCallCleanup,
  stopPendingCallCleanup,
  _testReset,
} from "./pending-calls"

describe("pending-calls cleanup interval", () => {
  test("starts cleanup once and unrefs timer", async () => {
    //#given
    const originalSetInterval = globalThis.setInterval
    const setIntervalCalls: number[] = []
    let unrefCalled = 0

    globalThis.setInterval = unsafeTestValue<typeof setInterval>(((
      _handler: TimerHandler,
      timeout?: number,
      ..._args: unknown[]
    ) => {
      setIntervalCalls.push(timeout as number)
      return unsafeTestValue<ReturnType<typeof setInterval>>({
        unref: () => {
          unrefCalled += 1
        },
      })
    }))

    try {
      _testReset()

      //#when
      startPendingCallCleanup()
      startPendingCallCleanup()

      //#then
      expect(setIntervalCalls).toEqual([10_000])
      expect(unrefCalled).toBe(1)
    } finally {
      globalThis.setInterval = originalSetInterval
      _testReset()
    }
  })

  test("#given cleanup timer already started #when stop cleanup runs #then interval state resets for future reuse", async () => {
    //#given
    const originalSetInterval = globalThis.setInterval
    const originalClearInterval = globalThis.clearInterval
    let intervalHandle: ReturnType<typeof setInterval> | undefined
    let clearCalls = 0

    globalThis.setInterval = unsafeTestValue<typeof setInterval>(((
      _handler: TimerHandler,
      _timeout?: number,
      ..._args: unknown[]
    ) => {
      intervalHandle = unsafeTestValue<ReturnType<typeof setInterval>>({ unref: () => {} })
      return intervalHandle
    }))

    globalThis.clearInterval = unsafeTestValue<typeof clearInterval>(((handle?: ReturnType<typeof setInterval>) => {
      if (handle === intervalHandle) {
        clearCalls += 1
      }
    }))

    try {
      _testReset()
      startPendingCallCleanup()

      //#when
      stopPendingCallCleanup()
      startPendingCallCleanup()

      //#then
      expect(clearCalls).toBe(1)
    } finally {
      globalThis.setInterval = originalSetInterval
      globalThis.clearInterval = originalClearInterval
      _testReset()
    }
  })
})