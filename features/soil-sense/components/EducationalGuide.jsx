import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useI18n } from '../i18n/useI18n'

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

  const lat = typeof latitude === 'number' && Number.isFinite(latitude) ? latitude : null
  if (lat == null) return 'temperate'
  const abs = Math.abs(lat)
  if (abs >= 55) return 'cold'
  if (abs <= 25) return 'humid'
  return 'temperate'
}

const READING = {
  WHY_SOIL: 'why-soil-health',
  PESTICIDE: 'pesticide-impact',
  LOCATION: 'location-tips',
}

const TOPIC = {
  RECOMMENDED: 'recommended',
  SOIL: 'soil',
  PESTICIDE: 'pesticide',
  ZONE: 'zone',
}

function readingOrderForRecommended(highPesticideUse) {
  const first = highPesticideUse ? READING.PESTICIDE : READING.WHY_SOIL
  const all = [READING.WHY_SOIL, READING.PESTICIDE, READING.LOCATION]
  return [first, ...all.filter((id) => id !== first)]
}

function titlesForTopic(topic, highPesticideUse) {
  if (topic === TOPIC.SOIL) return [READING.WHY_SOIL]
  if (topic === TOPIC.PESTICIDE) return [READING.PESTICIDE]
  if (topic === TOPIC.ZONE) return [READING.LOCATION]
  return readingOrderForRecommended(highPesticideUse)
}

function ReadingBody({
  readingId,
  t,
  climateZone,
  whyBulletsList,
  pesticideBulletsList,
}) {
  if (readingId === READING.WHY_SOIL) {
    return (
      <>
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
      </>
    )
  }

  if (readingId === READING.PESTICIDE) {
    return (
      <>
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
      </>
    )
  }

  if (readingId === READING.LOCATION) {
    return (
      <>
        <p className="educational-guide-p">{t('compostPestGuide.locationBody')}</p>
        <div className="educational-guide-zone-card">
          <div className="educational-guide-zone-card-title">{t('compostPestGuide.locationZoneTitle')}</div>
          <p className="educational-guide-zone-card-body">{t('compostPestGuide.locationZoneTips.' + climateZone)}</p>
        </div>
        <div className="educational-guide-goodbad educational-guide-goodbad--modal">
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
      </>
    )
  }

  return null
}

function ReadingModal({
  readingId,
  onClose,
  t,
  climateZone,
  whyBulletsList,
  pesticideBulletsList,
}) {
  useEffect(() => {
    if (!readingId) return undefined
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [readingId, onClose])

  if (!readingId) return null

  return createPortal(
    <div
      className="educational-guide-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="educational-guide-modal-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="educational-guide-modal-sheet"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="educational-guide-modal-topbar">
          <div className="educational-guide-modal-drag-wrap" aria-hidden="true">
            <span className="educational-guide-modal-drag" />
          </div>
          <button
            type="button"
            className="educational-guide-modal-close"
            onClick={onClose}
            aria-label={t('guide.closeReading')}
          >
            ×
          </button>
        </div>
        <div className="educational-guide-modal-scroll">
          <h3 id="educational-guide-modal-title" className="educational-guide-modal-title">
            {readingId === READING.WHY_SOIL && t('compostPestGuide.whyHeading')}
            {readingId === READING.PESTICIDE && t('compostPestGuide.pesticideHeading')}
            {readingId === READING.LOCATION && t('compostPestGuide.locationHeading')}
          </h3>
          <div className="educational-guide-modal-article">
            <ReadingBody
              readingId={readingId}
              t={t}
              climateZone={climateZone}
              whyBulletsList={whyBulletsList}
              pesticideBulletsList={pesticideBulletsList}
            />
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
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

  const [topic, setTopic] = useState(TOPIC.RECOMMENDED)
  const [openReadingId, setOpenReadingId] = useState(null)

  const whyBullets = t('compostPestGuide.whyBullets')
  const pesticideBullets = t('compostPestGuide.pesticideBullets')
  const whyBulletsList = Array.isArray(whyBullets) ? whyBullets : []
  const pesticideBulletsList = Array.isArray(pesticideBullets) ? pesticideBullets : []

  const visibleIds = useMemo(() => titlesForTopic(topic, highPesticideUse), [topic, highPesticideUse])

  const titleForId = useCallback(
    (id) => {
      if (id === READING.WHY_SOIL) return t('compostPestGuide.whyHeading')
      if (id === READING.PESTICIDE) return t('compostPestGuide.pesticideHeading')
      if (id === READING.LOCATION) return t('compostPestGuide.locationHeading')
      return ''
    },
    [t]
  )

  const closeModal = useCallback(() => setOpenReadingId(null), [])

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
        <button
          type="button"
          className={`guide-topic-pill ${topic === TOPIC.RECOMMENDED ? 'guide-topic-pill-featured' : ''}`}
          onClick={() => setTopic(TOPIC.RECOMMENDED)}
        >
          {t('guide.tocPickForYou')}
        </button>
        <button
          type="button"
          className={`guide-topic-pill ${topic === TOPIC.SOIL ? 'guide-topic-pill-featured' : ''}`}
          onClick={() => setTopic(TOPIC.SOIL)}
        >
          {t('guide.tocSoil')}
        </button>
        <button
          type="button"
          className={`guide-topic-pill ${topic === TOPIC.PESTICIDE ? 'guide-topic-pill-featured' : ''}`}
          onClick={() => setTopic(TOPIC.PESTICIDE)}
        >
          {t('guide.tocPesticides')}
        </button>
        <button
          type="button"
          className={`guide-topic-pill ${topic === TOPIC.ZONE ? 'guide-topic-pill-featured' : ''}`}
          onClick={() => setTopic(TOPIC.ZONE)}
        >
          {t('guide.tocZone')}
        </button>
      </nav>

      {topic === TOPIC.RECOMMENDED ? (
        <p className="educational-guide-titles-hint muted">
          {highPesticideUse ? t('compostPestGuide.recommendedRead.pesticideImpactDesc') : t('compostPestGuide.recommendedRead.compostBasicsDesc')}
        </p>
      ) : null}

      <ul className="educational-guide-titles">
        {visibleIds.map((id, idx) => (
          <li key={id}>
            <button
              type="button"
              className={`educational-guide-title-btn ${topic === TOPIC.RECOMMENDED && idx === 0 ? 'educational-guide-title-btn--featured' : ''}`}
              onClick={() => setOpenReadingId(id)}
            >
              <span className="educational-guide-title-btn-text">{titleForId(id)}</span>
              <span className="educational-guide-title-btn-chevron" aria-hidden>
                →
              </span>
            </button>
          </li>
        ))}
      </ul>

      <ReadingModal
        readingId={openReadingId}
        onClose={closeModal}
        t={t}
        climateZone={climateZone}
        whyBulletsList={whyBulletsList}
        pesticideBulletsList={pesticideBulletsList}
      />
    </div>
  )
}
