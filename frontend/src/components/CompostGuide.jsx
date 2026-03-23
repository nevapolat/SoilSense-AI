import { useI18n } from '../i18n/useI18n'

function asStringArray(value) {
  return Array.isArray(value) ? value.filter((x) => typeof x === 'string' && x.trim().length) : []
}

export default function CompostGuide({ compact = false }) {
  const { t } = useI18n()

  const environmentalBullets = asStringArray(t('compostGuide.environmentalBullets'))
  const equipmentBullets = asStringArray(t('compostGuide.equipmentBullets'))
  const brownsBullets = asStringArray(t('compostGuide.brownsBullets'))
  const greensBullets = asStringArray(t('compostGuide.greensBullets'))
  const waterAndAirBullets = asStringArray(t('compostGuide.waterAndAirBullets'))
  const lasagnaSteps = asStringArray(t('compostGuide.lasagnaSteps'))

  const photoPlaceholder = t('compostGuide.photoPlaceholder')
  const videoPlaceholder = t('compostGuide.videoPlaceholder')
  const mediaNote = t('compostGuide.mediaNote')

  const photos = [
    { src: '/compost-guide/photo-1.png', alt: photoPlaceholder },
    { src: '/compost-guide/photo-2.png', alt: photoPlaceholder },
  ]

  const videos = [
    { id: 'nxTzuasQLFo', title: videoPlaceholder },
    { id: '_K25WjjCBuw', title: videoPlaceholder },
  ]

  return (
    <div className={compact ? 'compost-guide compost-guide-compact' : 'compost-guide'}>
      <div className="compost-guide-header">
        <p className="compost-guide-kicker muted">{t('compostGuide.environmentalSetupKicker')}</p>
        <h3 className="compost-guide-title">{t('compostGuide.title')}</h3>
        <p className="compost-guide-subtitle muted">{t('compostGuide.subtitle')}</p>
      </div>

      <div className="compost-guide-grid">
        <div className="compost-guide-col">
          <h4 className="compost-guide-section-title">{t('compostGuide.environmentalSetup')}</h4>
          <ul className="compost-guide-bullets">
            {environmentalBullets.map((b, idx) => (
              <li key={`${b}-${idx}`}>{b}</li>
            ))}
          </ul>

          <h4 className="compost-guide-section-title">{t('compostGuide.equipmentRequirements')}</h4>
          <ul className="compost-guide-bullets">
            {equipmentBullets.map((b, idx) => (
              <li key={`${b}-${idx}`}>{b}</li>
            ))}
          </ul>
        </div>

        <div className="compost-guide-col">
          <h4 className="compost-guide-section-title">{t('compostGuide.lasagnaMethod')}</h4>
          <ol className="compost-guide-steps">
            {lasagnaSteps.map((s, idx) => (
              <li key={`${s}-${idx}`}>{s}</li>
            ))}
          </ol>

          <div className="compost-guide-layer-group">
            <h5 className="compost-guide-layer-title">{t('compostGuide.brownsTitle')}</h5>
            <ul className="compost-guide-bullets compost-guide-bullets-tight">
              {brownsBullets.map((b, idx) => (
                <li key={`${b}-${idx}`}>{b}</li>
              ))}
            </ul>

            <h5 className="compost-guide-layer-title">{t('compostGuide.greensTitle')}</h5>
            <ul className="compost-guide-bullets compost-guide-bullets-tight">
              {greensBullets.map((b, idx) => (
                <li key={`${b}-${idx}`}>{b}</li>
              ))}
            </ul>

            <h5 className="compost-guide-layer-title">{t('compostGuide.waterAndAirTitle')}</h5>
            <ul className="compost-guide-bullets compost-guide-bullets-tight">
              {waterAndAirBullets.map((b, idx) => (
                <li key={`${b}-${idx}`}>{b}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      <div className="compost-guide-media">
        <p className="compost-guide-section-title compost-guide-media-title">{t('compostGuide.mediaTitlePhotos')}</p>
        <div className="compost-guide-media-grid">
          <div className="compost-guide-media-card" aria-label={photoPlaceholder}>
            <img
              className="compost-guide-media-image"
              src={photos[0].src}
              alt={photos[0].alt}
              loading="lazy"
              decoding="async"
            />
          </div>
          <div className="compost-guide-media-card" aria-label={photoPlaceholder}>
            <img
              className="compost-guide-media-image"
              src={photos[1].src}
              alt={photos[1].alt}
              loading="lazy"
              decoding="async"
            />
          </div>
        </div>

        <p className="compost-guide-section-title compost-guide-media-title">{t('compostGuide.mediaTitleVideos')}</p>
        <div className="compost-guide-media-grid compost-guide-media-grid-2">
          <div className="compost-guide-media-card" aria-label={videoPlaceholder}>
            <div className="compost-guide-video-frame">
              <iframe
                className="compost-guide-video-iframe"
                title={videos[0].title}
                src={`https://www.youtube.com/embed/${videos[0].id}?rel=0&modestbranding=1`}
                loading="lazy"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
              />
            </div>
          </div>
          <div className="compost-guide-media-card" aria-label={videoPlaceholder}>
            <div className="compost-guide-video-frame">
              <iframe
                className="compost-guide-video-iframe"
                title={videos[1].title}
                src={`https://www.youtube.com/embed/${videos[1].id}?rel=0&modestbranding=1`}
                loading="lazy"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
              />
            </div>
          </div>
        </div>

        <p className="compost-guide-media-note muted">{mediaNote}</p>
      </div>
    </div>
  )
}

