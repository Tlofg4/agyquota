/**
 * Next / Pick command - finds which account has a specific model available,
 * or which account is next to reset, and recommends the best option to switch to.
 */

import Table from 'cli-table3'
import { getAccountManager } from '../accounts/index.js'
import { getOrFetchAllAccountsQuota } from './quota.js'
import { formatTimeUntilReset } from '../quota/format.js'
import { error as logError, info } from '../core/logger.js'
import type { ModelQuotaInfo, QuotaSnapshot } from '../quota/types.js'

export interface NextOptions {
  switch?: boolean
  refresh?: boolean
  allModels?: boolean
  json?: boolean
}

export interface CandidateAccount {
  email: string
  isActive: boolean
  matchingModels: ModelQuotaInfo[]
  maxRemainingPercentage: number
  hasAvailableQuota: boolean
  isExhausted: boolean
  earliestResetMs?: number
}

/**
 * Format model quota badge
 */
function formatModelStatus(model: ModelQuotaInfo): string {
  if (model.isExhausted || (model.remainingPercentage !== undefined && model.remainingPercentage <= 0.001)) {
    return '🔴 Agotado'
  }
  if (model.remainingPercentage !== undefined) {
    const pct = Math.round(model.remainingPercentage * 100)
    if (pct >= 75) return `🟢 ${pct}%`
    if (pct >= 50) return `🟡 ${pct}%`
    if (pct >= 25) return `🟠 ${pct}%`
    return `🔴 ${pct}%`
  }
  // Model with no explicit percentage from API (e.g. Claude or cyclical limits)
  if (model.timeUntilResetMs !== undefined && model.timeUntilResetMs > 0) {
    return '⏳ Espera'
  }
  return '🟢 Listo'
}

/**
 * Execute next command
 */
export async function nextCommand(modelQuery?: string, options: NextOptions = {}): Promise<void> {
  const manager = getAccountManager()
  const emails = manager.getAccountEmails()
  const currentActive = manager.getActiveEmail()

  if (emails.length === 0) {
    logError('No hay cuentas configuradas. Ejecuta: antigravity-usage login')
    process.exit(1)
  }

  const query = (modelQuery || 'claude').trim().toLowerCase()

  if (options.refresh) {
    info('🔄 Actualizando cuotas de todas las cuentas...\n')
  }

  const results = await getOrFetchAllAccountsQuota({ refresh: options.refresh })

  const candidates: CandidateAccount[] = []

  for (const result of results) {
    if (result.status === 'error' || !result.snapshot) {
      continue
    }

    const snapshot: QuotaSnapshot = result.snapshot
    const models = options.allModels
      ? snapshot.models
      : snapshot.models.filter(m => !m.isAutocompleteOnly)

    // Filter models that match the query
    const matching = models.filter(m => {
      const label = m.label.toLowerCase()
      const id = m.modelId.toLowerCase()
      return label.includes(query) || id.includes(query)
    })

    if (matching.length === 0) {
      continue
    }

    // Determine highest percentage and availability
    let maxPct = 0
    let hasAvailableQuota = false
    let allExhausted = true
    let minResetMs: number | undefined = undefined

    for (const m of matching) {
      const hasExplicitQuota = m.remainingPercentage !== undefined && m.remainingPercentage > 0.001
      const isExhausted = m.isExhausted || (m.remainingPercentage !== undefined && m.remainingPercentage <= 0.001)
      const isInCooldown = m.timeUntilResetMs !== undefined && m.timeUntilResetMs > 0

      if (hasExplicitQuota) {
        hasAvailableQuota = true
        allExhausted = false
        const pct = m.remainingPercentage! * 100
        if (pct > maxPct) {
          maxPct = pct
        }
      } else if (m.remainingPercentage === undefined && !isExhausted && !isInCooldown) {
        hasAvailableQuota = true
        allExhausted = false
        if (maxPct === 0) {
          maxPct = 100
        }
      }

      if (m.timeUntilResetMs !== undefined && m.timeUntilResetMs > 0) {
        if (minResetMs === undefined || m.timeUntilResetMs < minResetMs) {
          minResetMs = m.timeUntilResetMs
        }
      }
    }

    candidates.push({
      email: result.email,
      isActive: result.isActive,
      matchingModels: matching,
      maxRemainingPercentage: maxPct,
      hasAvailableQuota,
      isExhausted: allExhausted && !hasAvailableQuota,
      earliestResetMs: minResetMs
    })
  }

  if (candidates.length === 0) {
    console.log(`\n❌ No se encontraron modelos que coincidan con "${query}".`)
    console.log('💡 Prueba con: claude, 3.8, gemini, pro, flash, etc.\n')
    return
  }

  // Sort candidates:
  // 1. Available ones first (highest percentage first)
  // 2. Others sorted by earliest reset time (soonest first)
  const available = candidates
    .filter(c => c.hasAvailableQuota)
    .sort((a, b) => b.maxRemainingPercentage - a.maxRemainingPercentage)

  const unavailable = candidates
    .filter(c => !c.hasAvailableQuota)
    .sort((a, b) => (a.earliestResetMs || Infinity) - (b.earliestResetMs || Infinity))

  if (options.json) {
    console.log(JSON.stringify({ query, available, unavailable }, null, 2))
    return
  }

  console.log(`\n🔍 Rastreador de Modelos: "${query}"`)
  console.log('═'.repeat(65))

  const totalWidth = process.stdout.columns || 80
  const isWide = totalWidth >= 95

  const table = new Table({
    head: ['Cuenta', 'Modelo', 'Estado', 'Se reinicia en'],
    colWidths: isWide ? [34, 28, 12, 16] : [30, 24, 11, 15],
    wordWrap: true,
    style: {
      head: ['cyan'],
      border: ['gray']
    }
  })

  // Add available accounts first
  for (const c of available) {
    for (const m of c.matchingModels) {
      const name = c.isActive ? `${c.email} [*]` : c.email
      table.push([
        name,
        m.label,
        formatModelStatus(m),
        formatTimeUntilReset(m.timeUntilResetMs)
      ])
    }
  }

  // Add unavailable accounts
  for (const c of unavailable) {
    for (const m of c.matchingModels) {
      const name = c.isActive ? `${c.email} [*]` : c.email
      table.push([
        name,
        m.label,
        formatModelStatus(m),
        formatTimeUntilReset(m.timeUntilResetMs)
      ])
    }
  }

  console.log(table.toString())
  console.log('[*] = cuenta activa en el sistema\n')

  // Next account to reset
  const allWithReset = [...candidates]
    .filter(c => c.earliestResetMs !== undefined && c.earliestResetMs > 0)
    .sort((a, b) => (a.earliestResetMs || 0) - (b.earliestResetMs || 0))

  const nextToReset = allWithReset[0]

  if (nextToReset) {
    console.log(`⏳ PRÓXIMA CUENTA EN REINICIARSE:`)
    console.log(`   👉 ${nextToReset.email} (Se desbloquea en: ${formatTimeUntilReset(nextToReset.earliestResetMs)})`)
    console.log()
  }

  if (available.length > 0) {
    const bestAccount = available[0]
    const isCurrent = bestAccount.email === currentActive

    console.log(`🎯 DISPONIBLE AHORA:`)
    const quotaLabel = bestAccount.maxRemainingPercentage > 0 && bestAccount.maxRemainingPercentage < 100
      ? `${Math.round(bestAccount.maxRemainingPercentage)}% de cuota restante`
      : `Cuota lista`
    console.log(`   👉 ${bestAccount.email} (${quotaLabel})`)

    if (isCurrent) {
      console.log(`   ℹ️ Ya estás usando esta cuenta activa.`)
    } else {
      if (options.switch) {
        manager.setActiveAccount(bestAccount.email)
        console.log(`   ✅ ¡Cambiado automáticamente a ${bestAccount.email}!`)
      } else {
        console.log(`   💡 Para cambiarte a esta cuenta ejecuta:`)
        console.log(`      antigravity-usage accounts switch ${bestAccount.email}`)
        console.log(`   💡 O cambia automáticamente con:`)
        console.log(`      antigravity-usage next ${query} --switch`)
      }
    }
  } else {
    console.log(`ℹ️ Todas las cuentas están en espera de reinicio para "${query}".`)
    if (nextToReset) {
      console.log(`   La primera en desbloquearse será ${nextToReset.email} (en ${formatTimeUntilReset(nextToReset.earliestResetMs)}).`)
    }
  }

  console.log()
}
