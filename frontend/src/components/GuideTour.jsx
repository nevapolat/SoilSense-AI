import { useEffect, useMemo, useState } from 'react'
import { useI18n } from '../i18n/useI18n'

const TOUR_COPY = {
  en: {
    controls: { skip: 'Skip', next: 'Next', finish: 'Finish' },
    steps: {
      fieldProfile: {
        title: 'Field Profile',
        description: 'Set your field size and active crop types from here to calibrate all recommendations.',
      },
      smartAlerts: {
        title: 'Smart Alerts',
        description: 'This panel gives dynamic, action-focused alerts based on weather and your latest farm signals.',
      },
      activityLog: {
        title: 'Activity Log',
        description: 'Record compost, fertilizer, and pesticide usage so SoilSense can adapt guidance to real actions.',
      },
      soilAdvisor: {
        title: 'Soil Health Advisor',
        description: 'Find personalized, empathetic next-step advice tailored to your location, activity, and soil context.',
      },
      educationalGuides: {
        title: 'Educational Guides',
        description: 'Open the Guide tab to read Medium-style educational articles and practical soil health insights.',
      },
      planner: {
        title: 'Planner',
        description: 'Use Planner to view crop-fit recommendations, dosage guidance, spacing, and compatibility checks.',
      },
      compost: {
        title: 'Compost',
        description: 'Build compost recipes from available materials and follow practical composting guidance here.',
      },
      scan: {
        title: 'Plant Scan',
        description: 'Upload a plant photo to run a quick health check and receive treatment suggestions.',
      },
    },
  },
  tr: {
    controls: { skip: 'Atla', next: 'İleri', finish: 'Bitir' },
    steps: {
      fieldProfile: {
        title: 'Tarla Profili',
        description: 'Önerileri daha doğru hale getirmek için tarla boyutunu ve aktif ürün türlerini buradan ayarlayın.',
      },
      smartAlerts: {
        title: 'Akıllı Uyarılar',
        description: 'Bu panel hava ve son saha sinyallerine göre dinamik, eylem odaklı uyarılar sunar.',
      },
      activityLog: {
        title: 'Aktivite Kaydı',
        description: 'Kompost, gübre ve pestisit kullanımını kaydederek SoilSense önerilerini gerçek uygulamalara göre uyarlayın.',
      },
      soilAdvisor: {
        title: 'Toprak Sağlığı Danışmanı',
        description: 'Konumunuza, etkinliklerinize ve toprak durumuna göre kişisel, empatik önerileri burada bulun.',
      },
      educationalGuides: {
        title: 'Eğitim Rehberleri',
        description: 'Guide sekmesini açarak Medium tarzı içeriklere ve pratik toprak sağlığı bilgilerine ulaşın.',
      },
      planner: {
        title: 'Planlayıcı',
        description: 'Planlayıcıda ürün uyumu, dozaj rehberi, sıra aralığı ve uyumluluk kontrollerini görün.',
      },
      compost: {
        title: 'Kompost',
        description: 'Eldeki malzemelere göre kompost tarifleri oluşturun ve pratik kompost rehberini takip edin.',
      },
      scan: {
        title: 'Bitki Tarama',
        description: 'Bir bitki fotoğrafı yükleyip hızlı sağlık analizi ve tedavi önerileri alın.',
      },
    },
  },
  de: {
    controls: { skip: 'Überspringen', next: 'Weiter', finish: 'Fertig' },
    steps: {
      fieldProfile: {
        title: 'Feldprofil',
        description: 'Stellen Sie hier Feldgröße und aktive Kulturen ein, damit alle Empfehlungen besser passen.',
      },
      smartAlerts: {
        title: 'Smart Alerts',
        description: 'Dieses Panel zeigt dynamische, handlungsorientierte Hinweise aus Wetter- und Aktivitätssignalen.',
      },
      activityLog: {
        title: 'Aktivitätsprotokoll',
        description: 'Erfassen Sie Kompost-, Dünger- und Pestizideinsätze, damit SoilSense präziser beraten kann.',
      },
      soilAdvisor: {
        title: 'Boden-Gesundheitsberater',
        description: 'Hier erhalten Sie personalisierte, empathische Empfehlungen passend zu Standort und Verlauf.',
      },
      educationalGuides: {
        title: 'Lernleitfäden',
        description: 'Öffnen Sie den Guide-Tab für Medium-artige Artikel und praktische Bodenwissensinhalte.',
      },
      planner: {
        title: 'Planer',
        description: 'Im Planer sehen Sie Kultur-Eignung, Dosierung, Abstände und Kompatibilitätsprüfungen.',
      },
      compost: {
        title: 'Kompost',
        description: 'Erstellen Sie Kompostrezepte aus verfügbaren Materialien und folgen Sie der Praxisanleitung.',
      },
      scan: {
        title: 'Pflanzen-Scan',
        description: 'Laden Sie ein Pflanzenfoto hoch, um einen schnellen Gesundheitscheck mit Maßnahmen zu erhalten.',
      },
    },
  },
  es: {
    controls: { skip: 'Saltar', next: 'Siguiente', finish: 'Finalizar' },
    steps: {
      fieldProfile: {
        title: 'Perfil del Campo',
        description: 'Configura aquí el tamaño del campo y los cultivos activos para ajustar mejor las recomendaciones.',
      },
      smartAlerts: {
        title: 'Alertas Inteligentes',
        description: 'Este panel muestra alertas dinámicas y accionables según el clima y tus señales recientes.',
      },
      activityLog: {
        title: 'Registro de Actividad',
        description: 'Registra compost y uso de pesticidas/fertilizantes para que SoilSense adapte la guía.',
      },
      soilAdvisor: {
        title: 'Asesor de Salud del Suelo',
        description: 'Encuentra recomendaciones personalizadas y empáticas según ubicación, actividad y contexto del suelo.',
      },
      educationalGuides: {
        title: 'Guías Educativas',
        description: 'Abre la pestaña Guide para leer artículos estilo Medium con consejos prácticos.',
      },
      planner: {
        title: 'Planificador',
        description: 'En Planner verás recomendaciones de cultivos, dosis, espaciado y compatibilidad.',
      },
      compost: {
        title: 'Compost',
        description: 'Crea recetas de compost con tus materiales disponibles y sigue la guía práctica.',
      },
      scan: {
        title: 'Escáner de Plantas',
        description: 'Sube una foto de la planta para obtener un chequeo de salud y sugerencias de tratamiento.',
      },
    },
  },
  zh: {
    controls: { skip: '跳过', next: '下一步', finish: '完成' },
    steps: {
      fieldProfile: {
        title: '田块档案',
        description: '在这里设置田块面积和作物类型，让系统建议更贴合你的实际情况。',
      },
      smartAlerts: {
        title: '智能提醒',
        description: '该面板会根据天气与近期农事信号提供动态、可执行的提醒。',
      },
      activityLog: {
        title: '活动日志',
        description: '记录堆肥、施肥和农药使用，帮助 SoilSense 给出更准确建议。',
      },
      soilAdvisor: {
        title: '土壤健康顾问',
        description: '在这里查看个性化、富有同理心的下一步建议。',
      },
      educationalGuides: {
        title: '教育指南',
        description: '打开 Guide 标签，阅读 Medium 风格的文章与实用土壤健康内容。',
      },
      planner: {
        title: '规划器',
        description: '在 Planner 中查看作物适配建议、施用剂量、间距与兼容性提醒。',
      },
      compost: {
        title: '堆肥',
        description: '根据现有材料生成堆肥配方，并查看实用堆肥指导。',
      },
      scan: {
        title: '植物扫描',
        description: '上传植物照片进行快速健康检测并获取处理建议。',
      },
    },
  },
}

const STEP_KEYS = ['fieldProfile', 'smartAlerts', 'activityLog', 'soilAdvisor', 'planner', 'compost', 'educationalGuides', 'scan']

const STEP_TAB_MAP = {
  fieldProfile: 'dashboard',
  smartAlerts: 'dashboard',
  activityLog: 'dashboard',
  soilAdvisor: 'dashboard',
  planner: 'planner',
  compost: 'compost',
  educationalGuides: 'guide',
  scan: 'scan',
}

function clickTab(tabId) {
  const tabIndexById = {
    dashboard: 0,
    planner: 1,
    compost: 2,
    guide: 3,
    scan: 4,
  }
  const idx = tabIndexById[tabId]
  if (typeof idx !== 'number') return
  const navButtons = document.querySelectorAll('.bottom-nav .nav-item')
  const button = navButtons?.[idx]
  if (button instanceof HTMLButtonElement) button.click()
}

function getTargetElement(stepKey) {
  if (stepKey === 'fieldProfile') return document.querySelector('.dashboard-header .btn.btn-ghost.btn-inline')
  if (stepKey === 'smartAlerts') return document.querySelector('.smart-alert-card')
  if (stepKey === 'activityLog') return document.querySelector('.dashboard-stack .ordered-list')?.closest('.card')
  if (stepKey === 'soilAdvisor') {
    const cards = Array.from(document.querySelectorAll('.dashboard-stack .card'))
    return cards.find((card) => card.querySelector('.advice-pre') || card.textContent?.includes('Soil Health Advisor')) || null
  }
  if (stepKey === 'planner')
    return document.querySelector('.dashboard .selected-list')?.closest('.card') || document.querySelector('.bottom-nav .nav-item:nth-child(2)')
  if (stepKey === 'compost')
    return (
      document.querySelector('.compost-wizard-title')?.closest('.card') ||
      document.querySelector('.dashboard .card') ||
      document.querySelector('.bottom-nav .nav-item:nth-child(3)')
    )
  if (stepKey === 'educationalGuides') return document.querySelector('.guide-insights-scroll') || document.querySelector('.bottom-nav .nav-item:nth-child(4)')
  if (stepKey === 'scan')
    return (
      document.querySelector('.scanner-grid')?.closest('.card') ||
      document.querySelector('.diagnostic-card') ||
      document.querySelector('.bottom-nav .nav-item:nth-child(5)')
    )
  return null
}

export default function GuideTour({ open, onClose }) {
  const { lang } = useI18n()
  const [stepIndex, setStepIndex] = useState(0)
  const [targetRect, setTargetRect] = useState(null)

  const copy = useMemo(() => TOUR_COPY[lang] || TOUR_COPY.en, [lang])
  const currentStepKey = STEP_KEYS[stepIndex]
  const isLastStep = stepIndex === STEP_KEYS.length - 1

  useEffect(() => {
    if (!open) return
    clickTab(STEP_TAB_MAP[currentStepKey] || 'dashboard')
  }, [open, currentStepKey])

  useEffect(() => {
    if (!open) return
    const updateRect = () => {
      const el = getTargetElement(currentStepKey)
      if (!el) {
        setTargetRect(null)
        return
      }
      const rect = el.getBoundingClientRect()
      setTargetRect({
        top: Math.max(8, rect.top - 8),
        left: Math.max(8, rect.left - 8),
        width: rect.width + 16,
        height: rect.height + 16,
      })
    }
    const id = window.setTimeout(updateRect, 120)
    window.addEventListener('resize', updateRect)
    window.addEventListener('scroll', updateRect, true)
    return () => {
      window.clearTimeout(id)
      window.removeEventListener('resize', updateRect)
      window.removeEventListener('scroll', updateRect, true)
    }
  }, [open, currentStepKey])

  useEffect(() => {
    if (open) return
    setStepIndex(0)
    setTargetRect(null)
  }, [open])

  if (!open) return null

  const stepCopy = copy.steps[currentStepKey] || TOUR_COPY.en.steps[currentStepKey]

  const tooltipStyle = targetRect
    ? {
        top: Math.min(window.innerHeight - 170, targetRect.top + targetRect.height + 14),
        left: Math.min(window.innerWidth - 340, Math.max(14, targetRect.left)),
      }
    : {
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
      }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={stepCopy.title}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2500,
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(15, 30, 45, 0.36)',
          backdropFilter: 'blur(1.5px)',
        }}
      />

      {targetRect ? (
        <div
          style={{
            position: 'absolute',
            top: targetRect.top,
            left: targetRect.left,
            width: targetRect.width,
            height: targetRect.height,
            borderRadius: 16,
            boxShadow: '0 0 0 9999px rgba(15, 30, 45, 0.35), 0 0 0 2px rgba(152, 203, 255, 0.95)',
            background: 'transparent',
            transition: 'all 220ms ease',
          }}
        />
      ) : null}

      <div
        style={{
          position: 'absolute',
          width: 320,
          maxWidth: 'calc(100vw - 28px)',
          borderRadius: 16,
          border: '1px solid rgba(126, 177, 213, 0.35)',
          background: 'linear-gradient(180deg, rgba(245, 251, 255, 0.97), rgba(236, 247, 255, 0.97))',
          color: '#133047',
          boxShadow: '0 18px 48px rgba(9, 29, 49, 0.28)',
          padding: 16,
          pointerEvents: 'auto',
          ...tooltipStyle,
        }}
      >
        <p style={{ margin: 0, fontSize: 12, color: '#5a7690', fontWeight: 700 }}>
          {stepIndex + 1} / {STEP_KEYS.length}
        </p>
        <h3 style={{ margin: '8px 0 6px', fontSize: 18, lineHeight: 1.25 }}>{stepCopy.title}</h3>
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.45 }}>{stepCopy.description}</p>

        <div style={{ marginTop: 14, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              border: '1px solid rgba(95, 140, 176, 0.3)',
              borderRadius: 10,
              background: 'rgba(255,255,255,0.78)',
              color: '#355269',
              padding: '8px 12px',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            {copy.controls.skip}
          </button>
          <button
            type="button"
            onClick={() => {
              if (isLastStep) {
                onClose()
                return
              }
              setStepIndex((prev) => prev + 1)
            }}
            style={{
              border: '1px solid rgba(71, 129, 174, 0.4)',
              borderRadius: 10,
              background: 'linear-gradient(180deg, #d9f0ff, #c2e6ff)',
              color: '#113654',
              padding: '8px 14px',
              fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            {isLastStep ? copy.controls.finish : copy.controls.next}
          </button>
        </div>
      </div>
    </div>
  )
}
