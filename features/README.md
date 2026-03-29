# Features klasörü

Buildathon / değerlendirme beklentisi: **uygulama kaynak kodu bu klasör altında** (`.jsx`, `.js` vb.). Çalışan uygulama burada; Vite yalnızca derleme için `frontend/` kullanır.

## Çalışan uygulama kaynağı

Tüm React uygulama kodu (dashboard, bileşenler, AI/lib, i18n) **`soil-sense/`** altındadır.

- **Netlify / Vite:** Build hâlâ `frontend/` üzerinden çalışır; giriş dosyası `frontend/src/main.jsx` yalnızca `features/soil-sense/main.jsx` dosyasını yükler. `frontend/vite.config.js` içindeki `resolveSoilSenseDepsFromFrontend` eklentisi, `features/soil-sense/` altındaki dosyaların npm paketlerini `frontend/node_modules` üzerinden çözmesini sağlar (Windows ve Linux’ta aynı).
- **Yerel geliştirme:** `cd frontend` → `npm install` → `npm run dev` (değişmedi).

## Klasör yapısı (`soil-sense/`)

| Alt klasör / dosya | İçerik |
|--------------------|--------|
| `main.jsx` | Oturum, auth, alan seçimi, `SoilSenseApp` mount |
| `SoilSenseApp.jsx` | Ana panel, görevler, hava, AI akışları |
| `components/` | Compost, tarla planlayıcı, bitki taraması, rehber, tanı paneli vb. |
| `lib/` | AI/LLM, auth, Supabase, hava, jeokodlama, alan mantığı |
| `i18n/` | Çeviri ve dil sağlayıcısı |
| *(stiller)* | `App.css` ve `index.css` Tailwind çözümlemesi için `frontend/src/` altında kalır; `main.jsx` / `SoilSenseApp.jsx` bu dosyaları üst dizinden içe aktarır. |

## Mantıksal özellik → dosya (kısa harita)

- **Kompost:** `components/CompostWizard.jsx`, `CompostGuide.jsx`
- **Tarla / ürün planı:** `components/FieldPlanner.jsx`, `lib/fieldPlanner.js`, `fieldValidation.js`
- **Toprak canlılık skoru:** `components/SoilVitalityScore.jsx`
- **Bitki taraması:** `components/PlantScanner.jsx`
- **Eğitim / rehber:** `components/EducationalGuide.jsx`, `GuideTour.jsx`
- **Tanı / geliştirici:** `components/DiagnosticsPanel.jsx`

`frontend/src/` altında ayrıca **global stiller** (`index.css`, `App.css`), Vite girişi (`main.jsx`), `vite-env.d.ts` ve `assets/` bulunur.
