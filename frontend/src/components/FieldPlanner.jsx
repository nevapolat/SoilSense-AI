import { useMemo } from 'react'
import { AlertTriangle, CheckCircle2, Map as MapIcon } from 'lucide-react'

export default function FieldPlanner({ t, fieldPlan }) {
  const recommended = Array.isArray(fieldPlan?.recommendations) ? fieldPlan.recommendations : []
  const selected = Array.isArray(fieldPlan?.selectedCrops) ? fieldPlan.selectedCrops : []

  const cropNameById = useMemo(() => {
    const m = new Map()
    for (const c of selected) {
      if (!c?.id) continue
      m.set(c.id, c.custom ? c.name : t(`crops.${c.id}`))
    }
    return m
  }, [selected, t])
  const dosage = fieldPlan?.dosage || {}
  const spacing = fieldPlan?.spacing || {}
  const compatibility = fieldPlan?.compatibility || {}
  const safetyWarnings = Array.isArray(fieldPlan.safetyWarnings) ? fieldPlan.safetyWarnings : []
  const safetyWarningCodes = Array.isArray(fieldPlan.safetyWarningCodes) ? fieldPlan.safetyWarningCodes : []
  const companionPairIds = Array.isArray(compatibility.companionPairIds) ? compatibility.companionPairIds : []
  const compatibilityWarningCodes = Array.isArray(compatibility.warningCodes) ? compatibility.warningCodes : []

  function cropLabel(cropId) {
    if (cropNameById.has(cropId)) return cropNameById.get(cropId)
    return t(`crops.${cropId}`)
  }

  function renderCompatibilityWarning(item) {
    if (!item || item.code !== 'separate-crops') return ''
    return `${cropLabel(item.cropAId)} ${t('fieldPlanner.and')} ${cropLabel(item.cropBId)} ${t('fieldPlanner.shouldBeSeparated')}`
  }

  function renderSafetyWarning(code) {
    if (code === 'pesticide-over-tolerance') return t('fieldPlanner.safety.pesticideOverTolerance')
    if (code === 'no-irrigation-equipment') return t('fieldPlanner.safety.noIrrigationEquipment')
    if (code === 'insufficient-workforce') return t('fieldPlanner.safety.insufficientWorkforce')
    return ''
  }

  const translatedCompanionPairs = companionPairIds.map((pair) => `${cropLabel(pair.cropAId)} + ${cropLabel(pair.cropBId)}`)
  const translatedCompatibilityWarnings = compatibilityWarningCodes.map(renderCompatibilityWarning).filter(Boolean)
  const translatedSafetyWarnings = safetyWarningCodes.map(renderSafetyWarning).filter(Boolean)
  const displayedCompanionPairs =
    translatedCompanionPairs.length > 0 ? translatedCompanionPairs : Array.isArray(compatibility.companionPairs) ? compatibility.companionPairs : []
  const displayedCompatibilityWarnings =
    translatedCompatibilityWarnings.length > 0 ? translatedCompatibilityWarnings : Array.isArray(compatibility.warnings) ? compatibility.warnings : []
  const displayedSafetyWarnings = translatedSafetyWarnings.length > 0 ? translatedSafetyWarnings : safetyWarnings
  const spacingGuidance =
    spacing.guidanceMode === 'wide'
      ? t('fieldPlanner.rowGuidanceWide')
      : spacing.guidanceMode === 'exact'
        ? `${t('fieldPlanner.rowGuidanceExactPrefix')} ${Number(spacing.recommendedRowSpacingM || spacing.averageRowSpacingM || 0).toFixed(1)} ${t('fieldPlanner.meters')} ${t('fieldPlanner.rowGuidanceExactSuffix')}`
        : spacing.rowGuidance || '-'

  return (
    <section className="card">
      <div className="card-top">
        <div className="card-title-wrap">
          <h2 className="card-title">{t('fieldPlanner.title')}</h2>
          <MapIcon size={18} strokeWidth={1.7} className="card-accent-icon" />
        </div>
        <div className="card-hint">{t('fieldPlanner.subtitle')}</div>
      </div>

      <div className="card-body">
        <p className="muted">
          {t('fieldPlanner.context')} {fieldPlan?.context?.soilType || '-'} | {fieldPlan?.context?.climateZoneHint || '-'} |{' '}
          {(fieldPlan?.context?.areaSqm || 0).toLocaleString()} {t('fieldPlanner.squareMeters')}
        </p>

        <div className="selected-list" style={{ marginTop: 10 }}>
          <p className="selected-title">{t('fieldPlanner.recommendedCrops')}</p>
          <div className="chips">
            {recommended.map((crop) => (
              <span key={crop.id} className="chip">
                {t(`crops.${crop.id}`)}
              </span>
            ))}
          </div>
        </div>

        <div className="selected-list" style={{ marginTop: 10 }}>
          <p className="selected-title">{t('fieldPlanner.activeCrops')}</p>
          <div className="chips">
            {selected.map((crop) => (
              <span key={crop.id} className="chip">
                {crop.custom ? crop.name : t(`crops.${crop.id}`)}
              </span>
            ))}
          </div>
        </div>

        <div className="balance" style={{ marginTop: 12 }}>
          <p className="balance-line">{t('fieldPlanner.dosageTitle')}</p>
          <p className="muted" style={{ marginTop: 6 }}>
            {t('fieldPlanner.compost')}: {dosage.compostKg || 0} kg | {t('fieldPlanner.pesticide')}:{' '}
            {Number(dosage.pesticideL || 0).toFixed(2)} L | {t('fieldPlanner.tolerance')}:{' '}
            {Number(dosage.pesticideToleranceL || 0).toFixed(2)} L
          </p>
        </div>

        <div className="balance" style={{ marginTop: 12 }}>
          <p className="balance-line">{t('fieldPlanner.spacingTitle')}</p>
          <p className="muted">{spacingGuidance}</p>
        </div>

        {displayedCompanionPairs.length ? (
          <div className="selected-list" style={{ marginTop: 12 }}>
            <p className="selected-title">{t('fieldPlanner.companions')}</p>
            <ul className="ordered-list">
              {displayedCompanionPairs.map((pair) => (
                <li key={pair}>
                  <CheckCircle2 size={14} strokeWidth={1.9} /> {pair}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {displayedCompatibilityWarnings.length ? (
          <div className="selected-list" style={{ marginTop: 12 }}>
            <p className="selected-title">{t('fieldPlanner.compatibilityWarnings')}</p>
            <ul className="ordered-list">
              {displayedCompatibilityWarnings.map((warning) => (
                <li key={warning}>
                  <AlertTriangle size={14} strokeWidth={1.9} /> {warning}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {displayedSafetyWarnings.length ? (
          <div className="selected-list" style={{ marginTop: 12 }}>
            <p className="selected-title">{t('fieldPlanner.safetyWarnings')}</p>
            <ul className="ordered-list">
              {displayedSafetyWarnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  )
}
