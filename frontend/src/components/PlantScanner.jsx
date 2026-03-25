import { useMemo, useState } from 'react'
import { Camera, Image, UploadCloud, ScanSearch, Leaf, AlertTriangle } from 'lucide-react'
import { generatePlantScan } from '../lib/gemini'
import { useI18n } from '../i18n/useI18n'
import { createLogger, generateRunId } from '../lib/logger'

const uiLog = createLogger('ui')

export default function PlantScanner({ onScanComplete, lang } = {}) {
  const { t } = useI18n()
  const [fileName, setFileName] = useState('')
  const [previewUrl, setPreviewUrl] = useState('')
  const [mimeType, setMimeType] = useState('')
  const [imageBase64, setImageBase64] = useState('')

  const [status, setStatus] = useState('idle') // idle|loading|success|error
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)

  const canScan = useMemo(() => Boolean(imageBase64 && mimeType), [imageBase64, mimeType])

  async function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onerror = () => reject(new Error('Failed to read file'))
      reader.onload = () => {
        const dataUrl = String(reader.result || '')
        // dataUrl format: data:<mime>;base64,<base64>
        const base64 = dataUrl.split(',')[1] || ''
        resolve(base64)
      }
      reader.readAsDataURL(file)
    })
  }

  async function onFileSelected(e) {
    const file = e.target.files && e.target.files[0]
    if (!file) return

    uiLog.info('ui.plantScan.uploadSelected', {
      mimeType: file.type || 'unknown',
      fileNameLen: (file.name || '').length,
      sizeBytes: typeof file.size === 'number' ? file.size : null,
    })
    setFileName(file.name || '')
    setStatus('idle')
    setError('')
    setResult(null)

    // Preview for UX (object URL).
    const objUrl = URL.createObjectURL(file)
    setPreviewUrl(objUrl)

    setMimeType(file.type || 'image/*')
    const base64 = await fileToBase64(file)
    setImageBase64(base64)
  }

  async function onScan() {
    if (!canScan) {
      setError(t('plantScanner.pleaseUploadClearPhoto'))
      setStatus('error')
      return
    }

    setStatus('loading')
    setError('')
    setResult(null)

    const correlationId = generateRunId()
    try {
      const json = await generatePlantScan({
        imageBase64,
        mimeType,
        lang,
        correlationId,
      })
      setResult(json)
      setStatus(json?.parseError ? 'error' : 'success')
      uiLog.info(
        'ui.plantScan.analysisResult',
        {
          healthStatus: json?.healthStatus,
          parseError: Boolean(json?.parseError),
        },
        { correlationId }
      )
      if (typeof onScanComplete === 'function') onScanComplete(json)
      if (json?.parseError) {
        setError(t('plantScanner.couldNotParseResult'))
      }
    } catch (err) {
      setStatus('error')
      setResult(null)
      const message = err?.message ? err.message : String(err)
      uiLog.warn(
        'ui.plantScan.analysisFailed',
        { messagePreview: message.slice(0, 200) },
        { correlationId }
      )
      setError(message)
    }
  }

  return (
    <section className="dashboard">
      <header className="dashboard-header">
        <h1 className="dashboard-title">{t('plantScanner.title')}</h1>
        <p className="dashboard-subtitle">{t('plantScanner.subtitle')}</p>
      </header>

      <section className="card" data-tour="plant-scan">
        <div className="card-body">
          <div className="scanner-grid">
            <div className="scanner-upload">
              <label className="scanner-drop">
                <UploadCloud size={22} strokeWidth={2.2} />
                <span>{t('plantScanner.chooseAnImage')}</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={onFileSelected}
                  style={{ display: 'none' }}
                />
              </label>

              {fileName ? <p className="muted scanner-filename">{fileName}</p> : null}

              <button type="button" className="btn btn-primary" onClick={onScan} disabled={!canScan || status==='loading'}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, justifyContent: 'center' }}>
                  <ScanSearch size={20} strokeWidth={2.2} />
                  {status === 'loading' ? t('plantScanner.scanning') : t('plantScanner.scanAndHealthCheck')}
                </span>
              </button>

              {status === 'loading' ? (
                <p className="muted scanner-doctor-message">{t('plantScanner.doctorExaminingMessage')}</p>
              ) : null}

              {status === 'error' && error ? (
                <div className="scanner-error">
                  <AlertTriangle size={18} strokeWidth={2.2} />
                  <pre className="error-pre">{error}</pre>
                </div>
              ) : null}
            </div>

            <div className="scanner-preview">
              {previewUrl ? (
                <>
                  <div className="scanner-preview-top">
                    <Image size={18} strokeWidth={2.2} />
                    <span>{t('plantScanner.preview')}</span>
                  </div>
                  <img
                    src={previewUrl}
                    alt={t('plantScanner.title')}
                    className="scanner-image"
                  />
                </>
              ) : (
                <div className="scanner-placeholder">
                  <Leaf size={22} strokeWidth={2.2} />
                  <p className="muted">{t('plantScanner.bestResultsHint')}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {status === 'success' && result ? (
        <section className="card diagnostic-card">
          <div className="card-body">
            <div className="diagnostic-top">
              <div>
                <p className="muted" style={{ marginBottom: 4 }}>
                  {t('plantScanner.diagnosticReportTitle')}
                </p>
                <p className="scan-plant-name">{result.plantName || t('plantScanner.unknown')}</p>
              </div>

              <div className={`health-indicator health-indicator--${String(result.healthStatus || 'Healthy').toLowerCase()}`}>
                <Camera size={18} strokeWidth={2.2} />
                <span className="health-indicator-label">
                  {result.healthStatus === 'Healthy'
                    ? t('plantScanner.statusHealthy')
                    : result.healthStatus === 'Stressed'
                      ? t('plantScanner.statusStressed')
                      : result.healthStatus === 'Sick'
                        ? t('plantScanner.statusSick')
                        : t('plantScanner.unknown')}
                </span>
              </div>
            </div>

            <div className="diagnostic-section">
              <p className="section-title">{t('plantScanner.diseaseNameLabel')}</p>
              <p className="muted" style={{ marginTop: 4 }}>
                {result.diseaseName ? result.diseaseName : t('plantScanner.noDiseaseIdentified')}
              </p>
            </div>

            {Array.isArray(result.symptomsVisible) && result.symptomsVisible.length ? (
              <div className="diagnostic-section">
                <p className="section-title">{t('plantScanner.symptomsVisibleLabel')}</p>
                <ul className="ordered-list">
                  {result.symptomsVisible.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {Array.isArray(result.treatmentPlan) && result.treatmentPlan.length ? (
              <div className="doctor-prescription">
                <p className="section-title">{t('plantScanner.doctorsPrescriptionTitle')}</p>
                <ol className="ordered-list doctor-list">
                  {result.treatmentPlan.map((x, idx) => (
                    <li key={`${idx}-${x}`}>{x}</li>
                  ))}
                </ol>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}
    </section>
  )
}

