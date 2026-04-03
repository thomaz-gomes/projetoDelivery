# Core Delivery — App Entregador (Capacitor)

App Android nativo para entregadores com GPS background.

## Pré-requisitos

- Node.js 18+
- Android Studio (com SDK 33+)
- Java 17+

## Setup

```bash
cd delivery-rider-app
npm install
npx cap sync
```

## Desenvolvimento

```bash
# Abrir no Android Studio
npx cap open android

# Ou rodar direto (com device/emulador conectado)
npx cap run android
```

## Build APK

1. Abrir no Android Studio: `npx cap open android`
2. Build > Build Bundle(s) / APK(s) > Build APK(s)
3. APK gerado em `android/app/build/outputs/apk/debug/`

## Build para Play Store (AAB)

1. Android Studio > Build > Generate Signed Bundle / APK
2. Selecionar Android App Bundle
3. Criar/usar keystore de assinatura
4. Upload do `.aab` no Google Play Console

## Arquitetura

- **Modo Live**: o app carrega `https://app.deliverywl.com.br/rider/orders` via WebView
- **GPS Background**: usa `@capacitor-community/background-geolocation` com Foreground Service
- **Frontend inalterado**: o código Vue detecta automaticamente se está no Capacitor e usa GPS nativo
- **Atualizações**: mudanças no frontend refletem instantaneamente sem update na Play Store

## Permissões Android

| Permissão | Motivo |
|---|---|
| `ACCESS_FINE_LOCATION` | GPS preciso para tracking |
| `ACCESS_BACKGROUND_LOCATION` | GPS com app minimizado |
| `FOREGROUND_SERVICE_LOCATION` | Serviço de notificação persistente |
| `WAKE_LOCK` | Manter processamento ativo |
| `INTERNET` | Comunicação com o servidor |
