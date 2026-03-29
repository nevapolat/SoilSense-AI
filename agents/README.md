# agents/ (bonus)

Bu klasör, buildathon **bonus** maddesi kapsamında **otomasyon / yardımcı araç** içerir.

## İçerik

| Dosya | Açıklama |
|--------|-----------|
| `preflight.mjs` | Üretim öncesi kontrol: `frontend` dizininde `npm run build` çalıştırır (CI veya yerel doğrulama). |

## Kullanım

Repo kökünden:

```bash
node agents/preflight.mjs
```

Çıkış kodu `0` ise build başarılıdır.

## Not

Uygulama içi LLM akışları (`features/soil-sense/lib/claudeProvider.js` vb.) asıl “ajan” benzeri davranışı burada değil, `features/` altındaki ürün kodunda sunar; bu klasör yalnızca teslim/otomasyon yardımcıları içindir.
