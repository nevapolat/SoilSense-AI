import { useI18n } from '../i18n/useI18n'

export default function SoilVitalityScore({
  status,
  score,
  explanation,
  errorText,
}) {
  const { t } = useI18n()
  const numericScore = typeof score === 'number' ? score : null
  const progress = numericScore == null ? 0 : Math.max(0, Math.min(100, numericScore))

  const r = 54
  const c = 2 * Math.PI * r
  const dashOffset = c - (progress / 100) * c

  return (
    <section className="card score-card">
      <div className="card-body">
        <div className="score-top">
          <div>
            <p className="muted score-label">{t('common.soilVitalityScore')}</p>
            <p className="score-title">{t('common.soilHealthScore')}</p>
          </div>

          <div className="score-ring" aria-label={`Soil health score: ${progress}`}>
            <svg width="140" height="140" viewBox="0 0 140 140">
              <defs>
                <linearGradient id="scoreGradient" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="var(--accent-lime)" stopOpacity="0.98" />
                  <stop offset="55%" stopColor="var(--accent-lime-mid)" stopOpacity="0.98" />
                  <stop offset="100%" stopColor="var(--accent-lime-dark)" stopOpacity="0.98" />
                </linearGradient>
              </defs>
              <circle cx="70" cy="70" r={r} fill="none" stroke="rgba(20, 83, 45, 0.1)" strokeWidth="12" />
              <circle
                cx="70"
                cy="70"
                r={r}
                fill="none"
                stroke="url(#scoreGradient)"
                strokeWidth="12"
                strokeLinecap="round"
                strokeDasharray={c}
                strokeDashoffset={dashOffset}
                transform="rotate(-90 70 70)"
              />
            </svg>
            <div className="score-center">
              <div className="score-value">{numericScore == null ? '—' : progress}</div>
              <div className="score-units">/ 100</div>
            </div>
          </div>
        </div>

        {status === 'loading' ? (
          <p className="muted score-sub">{t('vitality.calculating')}</p>
        ) : null}

        {status === 'idle' ? (
          <p className="muted score-sub">{t('vitality.idleEnableLocation')}</p>
        ) : null}

        {status === 'error' ? (
          <p className="muted score-sub">
            {t('vitality.errorCompute')}
            {errorText ? ` (${errorText})` : null}
          </p>
        ) : null}

        {status === 'success' && explanation ? (
          <p className="score-explanation">{explanation}</p>
        ) : null}
      </div>
    </section>
  )
}
