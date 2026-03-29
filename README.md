# SoilSense AI

> **Yayın linki (Netlify):** https://soilsensee.netlify.app/  
> **Demo video (YouTube):** https://youtu.be/cKYimROzmqs?si=Hf9ytqzqFU1WW8p7

## Problem

Agricultural soils are degrading due to excessive chemical input, poor irrigation habits, and climate instability. Small and medium producers need affordable, practical guidance to restore soil health and reduce production costs.

## Solution

SoilSense AI helps growers make regenerative farming decisions with AI-powered recommendations. The app provides soil-health guidance, compost insights, and climate-aware suggestions for more sustainable production.

## How to run

```bash
cd frontend
npm install
npm run dev
```

## Build (production)

```bash
cd frontend
npm run build
```

## Tech stack (summary)

- React (Vite), Tailwind CSS, Lucide React  
- **AI:** Anthropic Claude API (`@anthropic-ai/sdk`, varsayılan Haiku modeli)  
- İsteğe bağlı: Supabase (uzaktan oturum)  
- **Deployment:** Netlify  

Ayrıntılı gerekçeler için kök dizindeki `tech-stack.md` dosyasına bakın.

## Repository layout (buildathon)

| Gereksinim | Konum |
|------------|--------|
| Kaynak kod | `features/soil-sense/` (React bileşenleri, `lib/`, `i18n/`). Vite girişi: `frontend/src/main.jsx`. |
| Problem / fikir | `idea.md` |
| Kullanıcı akışı | `user-flow.md` |
| Teknoloji + gerekçe | `tech-stack.md` |
| Yayın linki (ayrı dosya) | `yayin-linki.md` |
| Demo video notu | `demo-videosu.md` (link bu README’de de var) |

## Proje dosya yapısı (özet)

- `README.md`, `idea.md`, `user-flow.md`, `tech-stack.md`, `yayin-linki.md`, `demo-videosu.md`
- `features/` — uygulama kaynağı (`features/soil-sense/`)
- `frontend/` — Vite projesi, `npm run dev` / `build`
- `agents/`, `assets/` (bonus)
