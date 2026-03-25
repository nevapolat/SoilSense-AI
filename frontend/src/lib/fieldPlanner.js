const CROP_LIBRARY = {
  hazelnut: {
    id: 'hazelnut',
    name: 'Hazelnut',
    suitableSoils: ['loam', 'silty', 'clay'],
    climateTags: ['humid', 'temperate'],
    regions: ['black sea', 'humid / wet'],
    compostKgPerHa: 2400,
    pesticideLPerHa: 2.2,
    pesticideToleranceLPerHa: 3.2,
    rowSpacingM: 4.0,
    plantSpacingM: 4.0,
    companions: ['clover', 'garlic'],
    antagonists: ['walnut'],
  },
  tomato: {
    id: 'tomato',
    name: 'Tomato',
    suitableSoils: ['loam', 'sandy', 'silty'],
    climateTags: ['warm', 'temperate'],
    regions: ['temperate', 'dry & warm'],
    compostKgPerHa: 1800,
    pesticideLPerHa: 1.9,
    pesticideToleranceLPerHa: 2.8,
    rowSpacingM: 1.1,
    plantSpacingM: 0.5,
    companions: ['basil', 'marigold'],
    antagonists: ['potato'],
  },
  basil: {
    id: 'basil',
    name: 'Basil',
    suitableSoils: ['loam', 'sandy'],
    climateTags: ['warm', 'temperate'],
    regions: ['temperate', 'dry & warm'],
    compostKgPerHa: 1200,
    pesticideLPerHa: 1.2,
    pesticideToleranceLPerHa: 1.8,
    rowSpacingM: 0.6,
    plantSpacingM: 0.3,
    companions: ['tomato', 'pepper'],
    antagonists: ['cucumber'],
  },
  potato: {
    id: 'potato',
    name: 'Potato',
    suitableSoils: ['sandy', 'loam'],
    climateTags: ['cool', 'temperate'],
    regions: ['cool', 'temperate'],
    compostKgPerHa: 2100,
    pesticideLPerHa: 2.4,
    pesticideToleranceLPerHa: 3.5,
    rowSpacingM: 0.75,
    plantSpacingM: 0.35,
    companions: ['bean', 'corn'],
    antagonists: ['tomato'],
  },
  pepper: {
    id: 'pepper',
    name: 'Pepper',
    suitableSoils: ['loam', 'sandy'],
    climateTags: ['warm', 'temperate'],
    regions: ['temperate', 'dry & warm'],
    compostKgPerHa: 1600,
    pesticideLPerHa: 1.7,
    pesticideToleranceLPerHa: 2.6,
    rowSpacingM: 0.9,
    plantSpacingM: 0.4,
    companions: ['basil', 'onion'],
    antagonists: ['fennel'],
  },
}

function toAreaHa(fieldSize) {
  if (typeof fieldSize?.value !== 'number' || !Number.isFinite(fieldSize.value) || fieldSize.value <= 0) return 1
  return fieldSize.unit === 'sqm' ? fieldSize.value / 10000 : fieldSize.value
}

function toAreaSqm(areaHa) {
  return areaHa * 10000
}

function scoreCropForContext(crop, { soilType, climateZoneHint }) {
  let score = 0
  const soil = String(soilType || 'loam').toLowerCase()
  const climate = String(climateZoneHint || 'temperate').toLowerCase()
  if (crop.suitableSoils.includes(soil)) score += 3
  if (crop.climateTags.some((tag) => climate.includes(tag))) score += 2
  if (crop.regions.some((region) => climate.includes(region))) score += 1
  return score
}

function uniq(items) {
  return Array.from(new Set(items.filter(Boolean)))
}

function customCropIdFromLabel(label) {
  const s = String(label || '').trim()
  let h = 0
  for (let i = 0; i < s.length; i += 1) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  return `custom-${Math.abs(h).toString(36)}`
}

/** User-entered grow list (trim, dedupe, cap count/length). */
export function normalizeCustomGrowLabels(input) {
  if (!Array.isArray(input)) return []
  const seen = new Set()
  const out = []
  for (const x of input) {
    const s = typeof x === 'string' ? x.trim().slice(0, 48) : ''
    if (s.length < 1) continue
    const key = s.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(s)
    if (out.length >= 12) break
  }
  return out
}

function buildSyntheticCustomCrop(displayName) {
  const name = String(displayName || '').trim()
  const id = customCropIdFromLabel(name)
  return {
    id,
    name,
    custom: true,
    suitableSoils: ['loam', 'sandy', 'silty', 'clay'],
    climateTags: [],
    regions: [],
    compostKgPerHa: 2000,
    pesticideLPerHa: 2,
    pesticideToleranceLPerHa: 3,
    rowSpacingM: 0.85,
    plantSpacingM: 0.4,
    companions: [],
    antagonists: [],
  }
}

export function hasUserGrowSelections(profile) {
  const libIds = Array.isArray(profile?.currentCrops) ? profile.currentCrops : []
  const hasLib = libIds.some((id) => Boolean(CROP_LIBRARY[id]))
  return hasLib || normalizeCustomGrowLabels(profile?.customCrops).length > 0
}

/** Labels for LLM / memory: localized library names + custom strings. */
export function buildCropTypesForAdvice(profile, t) {
  const libIds = Array.isArray(profile?.currentCrops) ? profile.currentCrops.filter((id) => Boolean(CROP_LIBRARY[id])) : []
  const fromLib = libIds.map((id) => (typeof t === 'function' ? t(`crops.${id}`) : CROP_LIBRARY[id].name))
  const custom = normalizeCustomGrowLabels(profile?.customCrops)
  return [...fromLib, ...custom]
}

export function cropDisplayNameForTask(crop, t) {
  if (!crop) return ''
  if (crop.custom) return crop.name
  return typeof t === 'function' ? t(`crops.${crop.id}`) : crop.name
}

export function getAvailableCrops() {
  return Object.values(CROP_LIBRARY).map((crop) => ({ id: crop.id, name: crop.name }))
}

export function buildFieldPlan({ profile, climateZoneHint, activityImpact }) {
  const soilType = profile?.soilType || 'loam'
  const areaHa = toAreaHa(profile?.fieldSize)
  const areaSqm = toAreaSqm(areaHa)
  const allCrops = Object.values(CROP_LIBRARY)
  const scored = allCrops
    .map((crop) => ({ crop, score: scoreCropForContext(crop, { soilType, climateZoneHint }) }))
    .sort((a, b) => b.score - a.score)

  const recommendedCropIds = scored.slice(0, 3).map((x) => x.crop.id)
  const libraryIdsRaw = Array.isArray(profile?.currentCrops) ? profile.currentCrops : []
  const libraryIds = libraryIdsRaw.filter((id) => Boolean(CROP_LIBRARY[id]))
  const customLabels = normalizeCustomGrowLabels(profile?.customCrops)
  const fromLibrary = libraryIds.map((id) => CROP_LIBRARY[id]).filter(Boolean)
  const fromCustom = customLabels.map(buildSyntheticCustomCrop)
  let selectedCrops = [...fromLibrary, ...fromCustom]
  if (!selectedCrops.length) {
    selectedCrops = recommendedCropIds.slice(0, 1).map((id) => CROP_LIBRARY[id]).filter(Boolean)
  }

  const dosageByCrop = selectedCrops.map((crop) => ({
    cropId: crop.id,
    cropName: crop.name,
    compostKg: Math.round(crop.compostKgPerHa * areaHa),
    pesticideL: Number((crop.pesticideLPerHa * areaHa).toFixed(2)),
    pesticideToleranceL: Number((crop.pesticideToleranceLPerHa * areaHa).toFixed(2)),
  }))

  const totalCompostKg = dosageByCrop.reduce((sum, x) => sum + x.compostKg, 0)
  const totalPesticideL = Number(dosageByCrop.reduce((sum, x) => sum + x.pesticideL, 0).toFixed(2))
  const totalPesticideToleranceL = Number(dosageByCrop.reduce((sum, x) => sum + x.pesticideToleranceL, 0).toFixed(2))

  const compatibilityWarnings = []
  const compatibilityWarningCodes = []
  for (let i = 0; i < selectedCrops.length; i += 1) {
    for (let j = i + 1; j < selectedCrops.length; j += 1) {
      const a = selectedCrops[i]
      const b = selectedCrops[j]
      if (a.antagonists.includes(b.id) || b.antagonists.includes(a.id)) {
        compatibilityWarnings.push(`${a.name} and ${b.name} should be separated`)
        compatibilityWarningCodes.push({ code: 'separate-crops', cropAId: a.id, cropBId: b.id })
      }
    }
  }

  const companionPairs = []
  const companionPairIds = []
  for (let i = 0; i < selectedCrops.length; i += 1) {
    for (let j = i + 1; j < selectedCrops.length; j += 1) {
      const a = selectedCrops[i]
      const b = selectedCrops[j]
      if (a.companions.includes(b.id) || b.companions.includes(a.id)) {
        companionPairs.push(`${a.name} + ${b.name}`)
        companionPairIds.push({ cropAId: a.id, cropBId: b.id })
      }
    }
  }

  const averageRowSpacing =
    selectedCrops.length > 0 ? selectedCrops.reduce((sum, x) => sum + x.rowSpacingM, 0) / selectedCrops.length : 1

  const spacingPlan = {
    averageRowSpacingM: Number(averageRowSpacing.toFixed(2)),
    recommendedRowSpacingM: Number(averageRowSpacing.toFixed(1)),
    guidanceMode: averageRowSpacing >= 2 ? 'wide' : 'exact',
    rowGuidance:
      averageRowSpacing >= 2
        ? 'Leave around 2 meters between rows for airflow and access.'
        : `Keep rows around ${averageRowSpacing.toFixed(1)} meters apart for efficient spacing.`,
    perCrop: selectedCrops.map((crop) => ({
      cropId: crop.id,
      cropName: crop.name,
      rowSpacingM: crop.rowSpacingM,
      plantSpacingM: crop.plantSpacingM,
    })),
  }

  const pesticideAppliedL = typeof activityImpact?.chemicalPesticideLiters === 'number' ? activityImpact.chemicalPesticideLiters : 0
  const safetyWarnings = []
  const safetyWarningCodes = []
  if (pesticideAppliedL > totalPesticideToleranceL && selectedCrops.length > 0) {
    safetyWarnings.push('Pesticide usage is above crop tolerance threshold for this field context.')
    safetyWarningCodes.push('pesticide-over-tolerance')
  }

  if (!profile?.equipment?.sprinkler && !profile?.equipment?.dripIrrigation) {
    safetyWarnings.push('No irrigation equipment detected; prioritize drought-resilient scheduling.')
    safetyWarningCodes.push('no-irrigation-equipment')
  }
  if (typeof profile?.workforce === 'number' && profile.workforce < 1 && areaHa > 1) {
    safetyWarnings.push('Workforce may be insufficient for the current field size.')
    safetyWarningCodes.push('insufficient-workforce')
  }

  return {
    context: {
      soilType,
      climateZoneHint: climateZoneHint || 'Temperate',
      areaHa: Number(areaHa.toFixed(3)),
      areaSqm: Math.round(areaSqm),
    },
    recommendations: recommendedCropIds.map((id) => CROP_LIBRARY[id]).filter(Boolean),
    selectedCrops,
    dosage: {
      compostKg: totalCompostKg,
      pesticideL: totalPesticideL,
      pesticideToleranceL: totalPesticideToleranceL,
      byCrop: dosageByCrop,
    },
    compatibility: {
      companionPairIds: uniq(companionPairIds.map((x) => `${x.cropAId}:${x.cropBId}`)).map((entry) => {
        const [cropAId, cropBId] = String(entry).split(':')
        return { cropAId, cropBId }
      }),
      companionPairs: uniq(companionPairs),
      warningCodes: uniq(compatibilityWarningCodes.map((x) => `${x.code}:${x.cropAId}:${x.cropBId}`)).map((entry) => {
        const [code, cropAId, cropBId] = String(entry).split(':')
        return { code, cropAId, cropBId }
      }),
      warnings: uniq(compatibilityWarnings),
    },
    spacing: spacingPlan,
    safetyWarningCodes: uniq(safetyWarningCodes),
    safetyWarnings: uniq(safetyWarnings),
  }
}

export function buildCropDrivenDailyTasks(fieldPlan, t) {
  const crops = Array.isArray(fieldPlan?.selectedCrops) ? fieldPlan.selectedCrops : []
  const cropNames = crops.map((x) => cropDisplayNameForTask(x, t)).join(', ') || 'selected crops'
  const dosage = fieldPlan?.dosage || {}
  const spacing = fieldPlan?.spacing || {}

  return [
    {
      id: 'crop-dosage-check',
      title: `Apply crop-specific compost for ${cropNames}`,
      whyThisTaskHelps: `Keeps nutrient delivery aligned with field size and crop demand (${dosage.compostKg || 0} kg target).`,
      steps: [
        `Split compost in 2 passes to avoid patchy application.`,
        `Target ${dosage.compostKg || 0} kg total and avoid piling against stems.`,
        `Irrigate lightly after top-dressing to activate soil biology.`,
      ],
      estimatedMinutes: 25,
    },
    {
      id: 'crop-layout',
      title: `Validate row spacing and companion layout`,
      whyThisTaskHelps: `Improves airflow and compatibility while reducing disease pressure.`,
      steps: [
        spacing?.rowGuidance || 'Keep a consistent row spacing plan.',
        `Follow per-crop spacing to avoid canopy overlap.`,
        `Separate incompatible crop pairs into different zones.`,
      ],
      estimatedMinutes: 20,
    },
    {
      id: 'crop-safety-threshold',
      title: `Check pesticide threshold before next spray`,
      whyThisTaskHelps: `Prevents over-application beyond crop tolerance.`,
      steps: [
        `Current weekly chemical usage: ${Number(dosage.pesticideL || 0).toFixed(2)} L target for selected crops.`,
        `Hard stop threshold: ${Number(dosage.pesticideToleranceL || 0).toFixed(2)} L.`,
        `If close to threshold, shift to scouting and biological control.`,
      ],
      estimatedMinutes: 15,
    },
  ]
}
