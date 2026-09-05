import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderAllQuotaTable, type AllAccountsQuotaResult } from '../../src/render/table.js'

describe('renderAllQuotaTable', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { })
  })

  afterEach(() => {
    consoleSpy.mockRestore()
  })

  it('should render overview table with Resets In column', () => {
    const mockResults: AllAccountsQuotaResult[] = [
      {
        email: 'test1@gmail.com',
        isActive: true,
        status: 'success',
        snapshot: {
          timestamp: '2026-09-05T12:00:00.000Z',
          method: 'google',
          models: [
            {
              label: 'Gemini 3.8 Flash',
              modelId: 'gemini-3.8-flash',
              remainingPercentage: 0.55,
              isExhausted: false,
              timeUntilResetMs: 3600000 // 1h 0m
            }
          ]
        }
      }
    ]

    renderAllQuotaTable(mockResults)

    const allOutput = consoleSpy.mock.calls.map(c => c[0]).join('\n')
    expect(allOutput).toContain('test1@gmail.com')
    expect(allOutput).toContain('Resets In')
    expect(allOutput).toContain('1h 0m')
    expect(allOutput).toContain('55%')
  })

  it('should render detailed breakdown when detailed option is true', () => {
    const mockResults: AllAccountsQuotaResult[] = [
      {
        email: 'test2@gmail.com',
        isActive: false,
        status: 'success',
        snapshot: {
          timestamp: '2026-09-05T12:00:00.000Z',
          method: 'google',
          models: [
            {
              label: 'Claude Opus 4.6',
              modelId: 'claude-opus',
              remainingPercentage: 1.0,
              isExhausted: false,
              timeUntilResetMs: 7200000 // 2h 0m
            }
          ]
        }
      }
    ]

    renderAllQuotaTable(mockResults, { detailed: true })

    const allOutput = consoleSpy.mock.calls.map(c => c[0]).join('\n')
    expect(allOutput).toContain('Detailed Breakdown per Account')
    expect(allOutput).toContain('Claude Opus 4.6')
    expect(allOutput).toContain('2h 0m')
  })
})
