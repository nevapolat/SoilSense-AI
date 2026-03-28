import { useMemo, useState } from 'react'
import { useI18n } from '../i18n/useI18n'
import {
  Coffee,
  EggFried,
  Leaf,
  Sprout,
  TreeDeciduous,
  Trash2,
} from 'lucide-react'
import { generateCompostRecipe } from '../lib/ai'
import { createLogger, generateRunId } from '../lib/logger'

const uiLog = createLogger('ui')

const wasteOptions = [
  {
    id: 'coffee-grounds',
    labelKey: 'compostWizard.wasteLabels.coffeeGrounds',
    aiValue: 'Coffee grounds',
    icon: Coffee,
    examples: ['coffee grounds', 'used coffee', 'coffee filter'],
  },
  {
    id: 'eggshells',
    labelKey: 'compostWizard.wasteLabels.eggshells',
    aiValue: 'Eggshells',
    icon: EggFried,
    examples: ['eggshells', 'crushed eggshells'],
  },
  {
    id: 'dry-leaves',
    labelKey: 'compostWizard.wasteLabels.dryLeaves',
    aiValue: 'Dry leaves',
    icon: Leaf,
    examples: ['dry leaves', 'leaf litter', 'fallen leaves'],
  },
  {
    id: 'grass-clippings',
    labelKey: 'compostWizard.wasteLabels.grassClippings',
    aiValue: 'Grass clippings',
    icon: Sprout,
    examples: ['grass clippings', 'fresh grass', 'lawn clippings'],
  },
  {
    id: 'wood-chips',
    labelKey: 'compostWizard.wasteLabels.woodChips',
    aiValue: 'Small twigs / wood chips',
    icon: TreeDeciduous,
    examples: ['twigs', 'wood chips', 'small branches'],
  },
]

function uniqNormalized(items) {
  const cleaned = items
    .map((x) => String(x).trim())
    .filter(Boolean)
    .map((x) => x.replace(/\s+/g, ' '))

  const seen = new Set()
  const out = []
  for (const it of cleaned) {
    const k = it.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(it)
  }
  return out
}

export default function CompostWizard({ onRecipeGenerated, lang } = {}) {
  const { t } = useI18n()
  const [selectedIds, setSelectedIds] = useState([])
  const [customText, setCustomText] = useState('')

  const [status, setStatus] = useState('idle') // idle|loading|error|success
  const [error, setError] = useState('')
  const [recipe, setRecipe] = useState(null)
  const [shareStatus, setShareStatus] = useState('idle') // idle|sharing|shared|error

  const selectedItems = useMemo(() => {
    const fromOptions = selectedIds
      .map((id) => {
        const opt = wasteOptions.find((o) => o.id === id)
        return opt ? opt.aiValue : null
      })
      .filter(Boolean)

    const custom = customText
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)

    return uniqNormalized([...fromOptions, ...custom])
  }, [customText, selectedIds])

  async function onGenerate() {
    setError('')
    setStatus('loading')
    setRecipe(null)

    try {
      if (!selectedItems.length) {
        throw new Error(t('compostWizard.addAtLeastOneWasteItem'))
      }
      const correlationId = generateRunId()
      const json = await generateCompostRecipe(selectedItems, { lang, correlationId })
      setRecipe(json)
      setStatus('success')

      if (!json?.parseError) {
        let greenScoreAwarded = false
        if (typeof onRecipeGenerated === 'function') {
          onRecipeGenerated()
          greenScoreAwarded = true
        }
        uiLog.info(
          'ui.compost.recipeGenerated',
          {
            greenScoreAwarded,
            difficultyLevel: json?.difficultyLevel,
            greenPercent: json?.greenBrownBalance?.greenPercent,
          },
          { correlationId }
        )
      }
    } catch (err) {
      setError(err?.message ? err.message : String(err))
      setStatus('error')
    }
  }

  function localizeDifficulty(level) {
    const difficultyMap = {
      Easy: t('compostWizard.difficulty.Easy'),
      Medium: t('compostWizard.difficulty.Medium'),
      Hard: t('compostWizard.difficulty.Hard'),
    }
    return difficultyMap[level] || level || '—'
  }

  function buildShareText(rec) {
    if (!rec) return ''

    const steps = Array.isArray(rec.layeringSteps) ? rec.layeringSteps : []
    const stepsText = steps.map((s, i) => `${i + 1}. ${s}`).join('\n')

    const green = rec.greenBrownBalance?.greenPercent
    const brown = rec.greenBrownBalance?.brownPercent
    const balanceLine =
      typeof green === 'number' && typeof brown === 'number'
        ? `${t('compostWizard.greenVsBrown')}: ${green}% / ${brown}%`
        : `${t('compostWizard.greenVsBrown')}: —`

    const difficultyMap = {
      Easy: t('compostWizard.difficulty.Easy'),
      Medium: t('compostWizard.difficulty.Medium'),
      Hard: t('compostWizard.difficulty.Hard'),
    }
    const diffLabel = difficultyMap[rec.difficultyLevel] || rec.difficultyLevel || '—'

    return `${t('compostWizard.shareTitle')}

${t('compostWizard.difficultyLevel')}: ${diffLabel}
${t('compostWizard.estimatedMaturityTime')}: ${
      typeof rec.estimatedMaturityTimeMonths === 'number'
        ? `${rec.estimatedMaturityTimeMonths} ${t('common.months')}`
        : rec.estimatedMaturityTimeMonths || '—'
    }
${balanceLine}

${t('compostWizard.layeringRecipe')}:
${stepsText || '—'}

${t('compostWizard.proTip')}:
${rec.proTip || '—'}
`
  }

  async function onShare() {
    if (!recipe) return
    setShareStatus('sharing')
    const text = buildShareText(recipe)

    try {
      if (navigator.share) {
        await navigator.share({
          title: t('compostWizard.shareTitle'),
          text,
        })
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
      } else {
        // Minimal fallback if clipboard/share isn't available.
        window.prompt(t('compostWizard.copyPrompt'), text)
      }

      setShareStatus('shared')
      setTimeout(() => setShareStatus('idle'), 2000)
    } catch {
      setShareStatus('error')
      // Keep the UI minimal; error is visible via status only.
    }
  }

  return (
    <section className="compost-wizard">
      <header className="compost-wizard-header">
        <h2 className="compost-wizard-title">{t('compostWizard.wasteInventory')}</h2>
        <p className="compost-wizard-subtitle">
          {t('compostWizard.wasteInventorySubtitle')}
        </p>
      </header>

      <section className="compost-inventory">
        <div className="compost-grid">
          {wasteOptions.map((opt) => {
            const Icon = opt.icon
            const checked = selectedIds.includes(opt.id)
            return (
              <button
                key={opt.id}
                type="button"
                className={checked ? 'waste-tile waste-tile-active' : 'waste-tile'}
                onClick={() => {
                  setSelectedIds((prev) =>
                    prev.includes(opt.id)
                      ? prev.filter((x) => x !== opt.id)
                      : [...prev, opt.id]
                  )
                }}
              >
                <Icon size={20} strokeWidth={2.2} />
                <span className="waste-label">{t(opt.labelKey)}</span>
              </button>
            )
          })}

          {!wasteOptions.some((o) => selectedIds.includes(o.id)) &&
          !customText.trim() ? (
            <div className="waste-hint">
              <Trash2 size={18} strokeWidth={2.2} />
              <span>{t('compostWizard.chooseWaste')}</span>
            </div>
          ) : null}
        </div>

        <label className="field">
          <span className="field-label">{t('compostWizard.otherMaterials')}</span>
          <input
            value={customText}
            onChange={(e) => setCustomText(e.target.value)}
            placeholder={t('compostWizard.otherMaterialsPlaceholder')}
            className="field-input"
          />
        </label>

        <div className="selected-list">
          <p className="selected-title">{t('compostWizard.selectedInventory')}</p>
          {selectedItems.length ? (
            <div className="chips">
              {selectedItems.map((it) => (
                <span key={it} className="chip">
                  {it}
                </span>
              ))}
            </div>
          ) : (
            <p className="muted">{t('compostWizard.noItemsSelectedYet')}</p>
          )}
        </div>

        <button
          type="button"
          className="btn btn-accent"
          onClick={onGenerate}
          disabled={status === 'loading'}
        >
          {status === 'loading'
            ? t('compostWizard.generating')
            : t('compostWizard.generateCompostRecipe')}
        </button>
      </section>

      {status === 'error' && error ? (
        <div className="compost-result">
          <div className="card-body">
            <p className="muted">{t('compostWizard.couldNotGenerateRecipe')}</p>
            <pre className="error-pre">{error}</pre>
          </div>
        </div>
      ) : null}

      {status === 'success' && recipe ? (
        <section className="compost-result">
          <div className="card-body">
            <div className="result-top">
              <div className="result-metas">
                <p className="meta-label">{t('compostWizard.difficultyLevel')}</p>
                <p className="meta-value">{localizeDifficulty(recipe.difficultyLevel)}</p>
              </div>
              <div className="result-metas">
                <p className="meta-label">{t('compostWizard.estimatedMaturityTime')}</p>
                <p className="meta-value">
                  {typeof recipe.estimatedMaturityTimeMonths === 'number'
                    ? `${recipe.estimatedMaturityTimeMonths} ${t('common.months')}`
                    : recipe.estimatedMaturityTimeMonths
                      ? `${recipe.estimatedMaturityTimeMonths} ${t('common.months')}`
                      : '—'}
                </p>
              </div>
              <div className="pill pill-brown">{t('compostWizard.greenVsBrown')}</div>
            </div>

            {recipe.greenBrownBalance ? (
              <div className="balance">
                <p className="balance-line">
                  {t('compostWizard.green')}: <b>{recipe.greenBrownBalance.greenPercent}%</b> •{' '}
                  {t('compostWizard.brown')}: <b>{recipe.greenBrownBalance.brownPercent}%</b>
                </p>
                <div className="balance-columns">
                  <div>
                    <p className="balance-subtitle">{t('compostWizard.green')}</p>
                    <ul className="list">
                      {(recipe.greenBrownBalance.greenItems || []).map((x) => (
                        <li key={x}>{x}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <p className="balance-subtitle">{t('compostWizard.brown')}</p>
                    <ul className="list">
                      {(recipe.greenBrownBalance.brownItems || []).map((x) => (
                        <li key={x}>{x}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            ) : null}

            {recipe.layeringSteps?.length ? (
              <div className="steps">
                <p className="section-title">{t('compostWizard.layeringRecipe')}</p>
                <ol className="ordered-list">
                  {recipe.layeringSteps.map((s, idx) => (
                    <li key={idx}>{s}</li>
                  ))}
                </ol>
              </div>
            ) : null}

            {recipe.proTip ? (
              <div className="pro-tip">
                <p className="section-title">{t('compostWizard.proTip')}</p>
                <p className="pro-tip-text">{recipe.proTip}</p>
              </div>
            ) : null}

            {recipe.parseError ? (
              <div className="pro-tip">
                <p className="section-title">{t('compostWizard.rawGeminiOutput')}</p>
                <pre className="advice-pre">{recipe.rawText}</pre>
              </div>
            ) : null}

            <div className="share-wrap">
              <button
                type="button"
                className="btn btn-accent"
                onClick={onShare}
                disabled={shareStatus === 'sharing'}
              >
                {shareStatus === 'sharing'
                  ? t('compostWizard.share')
                  : shareStatus === 'shared'
                    ? t('compostWizard.shared')
                    : t('compostWizard.shareRecipe')}
              </button>
            </div>
          </div>
        </section>
      ) : null}
    </section>
  )
}

