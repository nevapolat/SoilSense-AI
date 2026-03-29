# Tech stack — SoilSense AI

Aşağıda kullanılan teknolojiler ve **neden seçildikleri** (buildathon `tech-stack.md` beklentisi) özetlenir.

## Frontend

| Teknoloji | Gerekçe |
|-----------|---------|
| **React 19** | Bileşen tabanlı UI, geniş ekosistem; form, sekme ve çok adımlı akışları yönetmek için uygun. |
| **Vite** | Hızlı geliştirme sunucusu ve üretim build’i; Netlify ile uyumlu statik çıktı. |
| **Tailwind CSS v4** | Tutarlı arayüz, responsive düzen ve tema değişkenleri (`index.css` içindeki tasarım token’ları) ile hızlı iterasyon. |
| **Lucide React** | Hafif, tutarlı ikon seti; erişilebilir `aria` kullanımıyla uyumlu. |

## Yapay zeka

| Teknoloji | Gerekçe |
|-----------|---------|
| **Anthropic Claude API** (`@anthropic-ai/sdk`) | Toprak önerileri, kompost reçetesi, günlük görevler, bitki taraması ve konum/iklim metinleri için yapılandırılmış ve serbest metin çıktı üretimi. Kod tabanında tek LLM sağlayıcısı Claude’dur (ör. `features/soil-sense/lib/claudeProvider.js`). |
| **Varsayılan model** | Maliyet/gecikme dengesi için ağırlıklı olarak **Claude Haiku** yönlendirmesi (ortam değişkenleriyle özelleştirilebilir). |

## Veri ve altyapı (isteğe bağlı)

| Teknoloji | Gerekçe |
|-----------|---------|
| **Supabase** (`@supabase/supabase-js`) | İsteğe bağlı uzaktan kimlik doğrulama ve kullanıcı verisi; yerel oturum yedekleriyle birlikte çalışır. |
| **Open-Meteo / jeokodlama yardımcıları** | Konum tabanlı hava ve çevresel bağlam; LLM öncesi yapılandırılmış sinyal. |

## Dağıtım

| Teknoloji | Gerekçe |
|-----------|---------|
| **Netlify** | Tek komutla `frontend` build, SPA yönlendirmeleri (`_redirects`), ortam değişkenleriyle API anahtarlarının güvenli yönetimi. |

## Güvenlik notu

API anahtarları repoda tutulmaz; `frontend/.env` ve Netlify **Environment variables** kullanılır (ör. `VITE_ANTHROPIC_API_KEY`).
