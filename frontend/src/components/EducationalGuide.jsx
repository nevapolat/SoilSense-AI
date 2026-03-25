import { useCallback, useMemo } from 'react'
import { useI18n } from '../i18n/useI18n'

function scrollToGuideSection(id) {
  const el = typeof document !== 'undefined' ? document.getElementById(id) : null
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function toFixedOrNull(n, digits) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null
  return n.toFixed(digits)
}

function classifyClimateZone({ climateZoneHint, latitude } = {}) {
  const hint = typeof climateZoneHint === 'string' ? climateZoneHint.toLowerCase() : ''
  if (hint.includes('cold')) return 'cold'
  if (hint.includes('humid') || hint.includes('wet')) return 'humid'
  if (hint.includes('dry')) return 'dry'
  if (hint.includes('temperate')) return 'temperate'

  // Fallback heuristic based on latitude (rough, but better than nothing).
  const lat = typeof latitude === 'number' && Number.isFinite(latitude) ? latitude : null
  if (lat == null) return 'temperate'
  const abs = Math.abs(lat)
  if (abs >= 55) return 'cold'
  if (abs <= 25) return 'humid'
  return 'temperate'
}

export default function EducationalGuide({ coords, climateZoneHint, activityImpact } = {}) {
  const { t } = useI18n()

  const chemicalPesticideLiters = typeof activityImpact?.chemicalPesticideLiters === 'number' ? activityImpact.chemicalPesticideLiters : 0
  const chemicalPesticideCount = typeof activityImpact?.chemicalPesticideCount === 'number' ? activityImpact.chemicalPesticideCount : 0

  const highPesticideUse = chemicalPesticideCount >= 2 || chemicalPesticideLiters >= 5

  const climateZone = useMemo(() => {
    return classifyClimateZone({ climateZoneHint, latitude: coords?.latitude })
  }, [climateZoneHint, coords?.latitude])

  const latStr = toFixedOrNull(coords?.latitude, 3)
  const lonStr = toFixedOrNull(coords?.longitude, 3)

  const zoneKey =
    climateZone === 'dry'
      ? 'compostPestGuide.locationZone.dry'
      : climateZone === 'humid'
        ? 'compostPestGuide.locationZone.humid'
        : climateZone === 'cold'
          ? 'compostPestGuide.locationZone.cold'
          : 'compostPestGuide.locationZone.temperate'

  const locationZoneLabel = t(zoneKey)

  const recommendedReadTitle = t(highPesticideUse ? 'compostPestGuide.recommendedRead.pesticideImpact' : 'compostPestGuide.recommendedRead.compostBasics')
  const recommendedReadDesc = t(
    highPesticideUse ? 'compostPestGuide.recommendedRead.pesticideImpactDesc' : 'compostPestGuide.recommendedRead.compostBasicsDesc'
  )

  const whyBullets = t('compostPestGuide.whyBullets')
  const pesticideBullets = t('compostPestGuide.pesticideBullets')
  const whyBulletsList = Array.isArray(whyBullets) ? whyBullets : []
  const pesticideBulletsList = Array.isArray(pesticideBullets) ? pesticideBullets : []

  const jump = useCallback((id) => () => scrollToGuideSection(id), [])

  return (
    <div className="educational-guide">
      <header className="educational-guide-header">
        <h2 className="educational-guide-hero">{t('compostPestGuide.heroTitle')}</h2>
        <p className="educational-guide-hero-sub">{t('compostPestGuide.heroSubtitle')}</p>
        <p className="educational-guide-context muted">
          <span className="educational-guide-context-zone">{locationZoneLabel}</span>
          {latStr && lonStr ? (
            <span className="educational-guide-context-coords">
              {' '}
              · {latStr}, {lonStr}
            </span>
          ) : null}
        </p>
      </header>

      <nav className="guide-topic-nav" aria-label={t('guide.tocAria')}>
        <button type="button" className="guide-topic-pill guide-topic-pill-featured" onClick={jump('guide-recommended')}>
          {t('guide.tocPickForYou')}
        </button>
        <button type="button" className="guide-topic-pill" onClick={jump('why-soil-health')}>
          {t('guide.tocSoil')}
        </button>
        <button type="button" className="guide-topic-pill" onClick={jump('pesticide-impact')}>
          {t('guide.tocPesticides')}
        </button>
        <button type="button" className="guide-topic-pill" onClick={jump('location-tips')}>
          {t('guide.tocZone')}
        </button>
      </nav>

      <div
        id="guide-recommended"
        className="educational-guide-recommended"
        role="note"
        tabIndex={-1}
      >
        <div className="educational-guide-recommended-top">
          <span className="educational-guide-recommended-label">{t('compostPestGuide.recommendedReadLabel')}</span>
          <button
            type="button"
            className="educational-guide-recommended-jump"
            onClick={jump(highPesticideUse ? 'pesticide-impact' : 'why-soil-health')}
          >
            {recommendedReadTitle}
            <span className="educational-guide-recommended-jump-arrow" aria-hidden>
              →
            </span>
          </button>
        </div>
        <p className="educational-guide-recommended-desc">{recommendedReadDesc}</p>
      </div>

      <article className="educational-guide-article">
        <section id="why-soil-health" className="educational-guide-section">
          <h3 className="educational-guide-h3">{t('compostPestGuide.whyHeading')}</h3>
          <p className="educational-guide-p">{t('compostPestGuide.whyBody')}</p>
          <blockquote className="educational-guide-quote">{t('compostPestGuide.pullQuoteWhy')}</blockquote>

          <div className="educational-guide-infobox">
            <div className="educational-guide-infocard">
              <img
                className="educational-guide-infographic-image"
                src="/compost-pest-guide/sustainable-benefits.png"
                alt={t('compostPestGuide.infographicBenefitsAlt')}
                loading="lazy"
                decoding="async"
              />
              <p className="educational-guide-infocaption">{t('compostPestGuide.infographicCycleCaption')}</p>
            </div>
          </div>

          <ul className="educational-guide-list">
            {whyBulletsList.map((b, idx) => (
              <li key={`${b}-${idx}`}>{b}</li>
            ))}
          </ul>
        </section>

        <section id="pesticide-impact" className="educational-guide-section">
          <h3 className="educational-guide-h3">{t('compostPestGuide.pesticideHeading')}</h3>
          <p className="educational-guide-p">{t('compostPestGuide.pesticideBody')}</p>
          <blockquote className="educational-guide-quote">{t('compostPestGuide.pullQuotePesticide')}</blockquote>

          <ul className="educational-guide-list">
            {pesticideBulletsList.map((b, idx) => (
              <li key={`${b}-${idx}`}>{b}</li>
            ))}
          </ul>

          <div className="educational-guide-infobox">
            <div className="educational-guide-infocard">
              <img
                className="educational-guide-infographic-image"
                src="/compost-pest-guide/nutrient-cycle-fig01.png"
                alt={t('compostPestGuide.infographicNutrientCycleAlt')}
                loading="lazy"
                decoding="async"
              />
              <p className="educational-guide-infocaption">{t('compostPestGuide.infographicCompostLayersCaption')}</p>
            </div>
          </div>
        </section>

        <section id="location-tips" className="educational-guide-section">
          <h3 className="educational-guide-h3">{t('compostPestGuide.locationHeading')}</h3>
          <p className="educational-guide-p">{t('compostPestGuide.locationBody')}</p>

          <div className="educational-guide-zone-card">
            <div className="educational-guide-zone-card-title">{t('compostPestGuide.locationZoneTitle')}</div>
            <p className="educational-guide-zone-card-body">{t('compostPestGuide.locationZoneTips.' + climateZone)}</p>
          </div>

          <div className="educational-guide-goodbad">
            <div className="educational-guide-goodbad-item">
              <img
                className="educational-guide-goodbad-img"
                src="/compost-pest-guide/composting-101.png"
                alt={t('compostPestGuide.compostingLayersAlt')}
                loading="lazy"
                decoding="async"
              />
              <p className="educational-guide-goodbad-caption">{t('compostPestGuide.compostingLayersCaption')}</p>
            </div>
            <div className="educational-guide-goodbad-item">
              <img
                className="educational-guide-goodbad-img"
                src="/compost-pest-guide/compost-pile-layering.png"
                alt={t('compostPestGuide.compostPileLayeringAlt')}
                loading="lazy"
                decoding="async"
              />
              <p className="educational-guide-goodbad-caption">{t('compostPestGuide.compostPileLayeringCaption')}</p>
            </div>
          </div>
        </section>
      </article>
    </div>
  )
}

