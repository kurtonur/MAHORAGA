# MAHORAGA: Docker Compose + Cloudflare Tunnel

Bu kurulum dashboard, Worker, Durable Objects, D1, KV ve R2'nin yerel sürümlerini tek Docker container içinde çalıştırır. Veriler `mahoraga-state` volume'unda `/data` altında tutulur. `18650:3000` eşlemesi sunucunun 18650 portunu container'ın 3000 portuna yönlendirir. Bu eşleme sunucunun tüm ağ arayüzlerinde dinler; yalnızca Cloudflare Tunnel erişimi isteniyorsa dış ağdan 18650 portuna erişimi ağ güvenlik duvarında engelleyin.

## Coolify (Trading Bot / production)

1. Git kaynağı olarak bu repository'nin `main` dalını kullanın.
2. Build Pack: **Docker Compose**. Base Directory: `/`. Docker Compose Location: `compose.yaml`.
3. **Raw Compose Deployment** kapalı kalsın. Bu uygulamaya Coolify domain'i eklemeyin; eski otomatik domain varsa kaldırın.
4. Coolify'nin oluşturduğu `SERVICE_REALBASE64_64_MAHORAGA_API_TOKEN` ve `SERVICE_REALBASE64_64_MAHORAGA_KILL_SWITCH` değişkenlerinin farklı, dolu değerler olduğunu kontrol edin. Bu değerleri Git'e yazmayın.
5. Ortam değişkenlerine `ALPACA_API_KEY`, `ALPACA_API_SECRET` ve seçtiğiniz LLM sağlayıcısının anahtarını ekleyin. Başlangıçta `ALPACA_PAPER=true` tutun. API anahtarları girilmeden web servisi açılır ancak işlem botu çalışmaz.
6. Deploy edin. Docker sağlık kontrolü container içinde `http://127.0.0.1:3000/health` adresini yoklar. Sunucuda `curl http://127.0.0.1:18650/health` yanıtında `"status":"ok"` görülmelidir.

Bot varsayılan olarak devre dışıdır. Dashboard, Coolify'deki `SERVICE_REALBASE64_64_MAHORAGA_API_TOKEN` değeriyle oturum açar. Testten sonra etkinleştirmek için:

```sh
curl -H "Authorization: Bearer $MAHORAGA_API_TOKEN" \
  http://127.0.0.1:18650/agent/enable
```

`MAHORAGA_API_TOKEN` shell değişkenini önce kendiniz atayın; komut geçmişine gerçek token yazmayın.

## Sunucuda doğrudan Docker Compose

`compose.env.example` dosyasını `.env` olarak kopyalayıp iki farklı güçlü token ile API anahtarlarını girin. Ardından:

```sh
docker compose up -d --build
docker compose ps
curl http://127.0.0.1:18650/health
```

`.env` dosyası Git tarafından dışlanır. Volume'u düzenli olarak yedekleyin. `docker compose down -v` komutu kalıcı verileri siler; kullanmayın.

## Cloudflare Tunnel

`cloudflared` sunucuda host servisi olarak çalışıyorsa mevcut Tunnel'a şu **Published application** rotasını ekleyin:

| Alan | Değer |
| --- | --- |
| Hostname | `newtrading.kurt.best` |
| Service type | `HTTP` |
| Service URL | `http://127.0.0.1:18650` |
| Path | Boş / tüm yollar |

Cloudflare DNS kaydı rota eklendiğinde Tunnel hedefiyle oluşturulur. Bu sunucuda `cloudflared` host network ile çalıştığından `http://localhost:18650` hedefi uygundur. `18650:3000` eşlemesi dış ağ arayüzlerinde de dinlediği için yalnızca Tunnel erişimi isteniyorsa dışarıdan gelen 18650 trafiğini engelleyin.

Dashboard'a yalnızca sizin erişmeniz için Cloudflare Access politikası tanımlayın. API token'ı dashboard tarayıcısında localStorage'a kaydedilir.

## Çalışma modeli

Bu server paketi Cloudflare'ın yerel `wrangler dev`/Miniflare runtime'ını kullanır. Cloudflare bunu geliştirme ortamı olarak belgeliyor; gerçek para ile otomatik işlem için resmi production platformu değildir. Canlı işlem öncesinde Cloudflare Workers üzerinde D1/KV/R2/Durable Objects dağıtımı veya üretim için ayrıca doğrulanmış bir sunucu runtime'ı gerekir. Bu Compose kurulumunda paper trading varsayılandır.

Docker imajında Bun ile birlikte Node.js 22 bulunur. Bun paketleri yükler ve dış HTTP sunucusunu çalıştırır; Wrangler gerçek Node.js ile çalışır. `wrangler dev` için ekrana yazılan `8787` yalnızca container içindeki Worker portudur. Tunnel hedefi `18650`, Docker sağlık kontrolü hedefi container içindeki `3000` portudur.
