import { AlertTriangle, CheckCircle2, Map } from 'lucide-react'

export default function FieldPlanner({ t, fieldPlan }) {
  if (!fieldPlan) return null

  const recommended = Array.isArray(fieldPlan.recommendations) ? fieldPlan.recommendations : []
  const selected = Array.isArray(fieldPlan.selectedCrops) ? fieldPlan.selectedCrops : []
  const dosage = fieldPlan.dosage || {}
  const spacing = fieldPlan.spacing || {}
  const compatibility = fieldPlan.compatibility || {}
  const safetyWarnings = Array.isArray(fieldPlan.safetyWarnings) ? fieldPlan.safetyWarnings : []

  return (
    <section className="card">
      <div className="card-top">
        <div className="card-title-wrap">
          <h2 className="card-title">{t('fieldPlanner.title')}</h2>
          <Map size={18} strokeWidth={1.7} className="card-accent-icon" />
        </div>
        <div className="card-hint">{t('fieldPlanner.subtitle')}</div>
      </div>

      <div className="card-body">
        <p className="muted">
          {t('fieldPlanner.context')} {fieldPlan?.context?.soilType || '-'} | {fieldPlan?.context?.climateZoneHint || '-'} |{' '}
          {(fieldPlan?.context?.areaSqm || 0).toLocaleString()} m2
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
                {t(`crops.${crop.id}`)}
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
          <p className="muted">{spacing.rowGuidance || '-'}</p>
        </div>

        {Array.isArray(compatibility.companionPairs) && compatibility.companionPairs.length ? (
          <div className="selected-list" style={{ marginTop: 12 }}>
            <p className="selected-title">{t('fieldPlanner.companions')}</p>
            <ul className="ordered-list">
              {compatibility.companionPairs.map((pair) => (
                <li key={pair}>
                  <CheckCircle2 size={14} strokeWidth={1.9} /> {pair}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {Array.isArray(compatibility.warnings) && compatibility.warnings.length ? (
          <div className="selected-list" style={{ marginTop: 12 }}>
            <p className="selected-title">{t('fieldPlanner.compatibilityWarnings')}</p>
            <ul className="ordered-list">
              {compatibility.warnings.map((warning) => (
                <li key={warning}>
                  <AlertTriangle size={14} strokeWidth={1.9} /> {warning}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {safetyWarnings.length ? (
          <div className="selected-list" style={{ marginTop: 12 }}>
            <p className="selected-title">{t('fieldPlanner.safetyWarnings')}</p>
            <ul className="ordered-list">
              {safetyWarnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  )
}
