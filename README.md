# PSM OS — Capacitor (iOS + Android)

Empacotamento nativo do PSM OS pra App Store e Google Play.
Mantem 100% do codigo HTML/JS atual + adiciona acesso nativo a camera, GPS, biometria, push e background sync.

---

## Requisitos

| Plataforma | Ferramenta | Versao |
|---|---|---|
| iOS | Xcode (macOS) | 15+ |
| iOS | CocoaPods | 1.15+ |
| Android | Android Studio | Hedgehog+ |
| Android | JDK | 17 |
| Comum | Node | 20+ |

Conta Apple Developer (US$ 99/ano) + Google Play Console (US$ 25 unico).

---

## Setup primeira vez

```bash
cd capacitor
npm install
npm run copy:web        # copia index.html, lib/, sw.js -> www/
npx cap add ios
npx cap add android
npx cap sync
```

---

## Build iOS

```bash
npm run build:ios       # abre Xcode
```

No Xcode:

1. Selecionar time de signing (Apple Developer)
2. Bundle ID: `br.com.imobiliariapsm.os`
3. Build > Archive
4. Upload pra App Store Connect
5. TestFlight (interno) -> Review (10-14 dias) -> Producao

---

## Build Android

```bash
npm run build:android   # abre Android Studio
```

No Android Studio:

1. Build > Generate Signed Bundle (.aab)
2. Keystore: criar uma vez, guardar em local seguro
3. Upload pro Play Console
4. Internal Testing -> Closed -> Open -> Producao

---

## Atualizar app (apos mudancas no index.html)

```bash
cd capacitor
npm run copy:web
npm run sync
```

Recompilar no Xcode/Android Studio e subir nova versao.

---

## Permissoes nativas requeridas

**iOS** (Info.plist auto-gerado pelo Capacitor):
- `NSCameraUsageDescription` - check-in com foto
- `NSLocationWhenInUseUsageDescription` - geolocalizacao
- `NSFaceIDUsageDescription` - login biometrico
- `NSPhotoLibraryUsageDescription` - anexar imoveis

**Android** (AndroidManifest.xml auto):
- `CAMERA`, `ACCESS_FINE_LOCATION`, `USE_BIOMETRIC`, `POST_NOTIFICATIONS`, `INTERNET`, `ACCESS_NETWORK_STATE`, `WAKE_LOCK`

---

## Push Notifications

### Setup Firebase Cloud Messaging (FCM)

Ja temos Firebase Realtime Database. Adicionar tambem FCM:

1. Firebase Console > Project Settings > Cloud Messaging
2. Gerar `GoogleService-Info.plist` (iOS) e `google-services.json` (Android)
3. Colocar em `ios/App/App/` e `android/app/`

### iOS — APNs

1. Apple Developer > Certificates > Apple Push Notification service
2. Upload Auth Key no Firebase
3. Capability "Push Notifications" no Xcode

### Codigo (ja esta em index.html via window.psmNative):

```js
psmNative.requestPushPermission()  // pede permissao
psmNative.onPushReceived(callback) // listener
```

---

## Biometria

Login via FaceID (iOS) ou Fingerprint (Android):

```js
psmNative.loginBiometric()  // valida + auto-fill credenciais salvas
```

Credenciais ficam em Keychain (iOS) / Keystore (Android), nunca em localStorage.

---

## Background Sync

Job de sincronizacao Supabase roda mesmo com app fechado:

- iOS: BGAppRefreshTask (15min minimo, OS controla)
- Android: WorkManager (15min minimo)

Configurado em `lib/psm-offline.js`.

---

## Deploy contínuo (sugestao)

GitHub Actions pra build automatico:

```yaml
# .github/workflows/build-mobile.yml
on: push: branches: [main]
jobs:
  build-ios:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      - run: cd capacitor && npm ci && npm run copy:web && npx cap sync ios
      - uses: yukiarrr/ios-build-action@v1
        with:
          project-path: capacitor/ios/App/App.xcodeproj
          # ... signing certs via secrets
  build-android:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: cd capacitor && npm ci && npm run copy:web && npx cap sync android
      - run: cd capacitor/android && ./gradlew bundleRelease
```

---

## Versionamento

- iOS: `CFBundleShortVersionString` em Info.plist
- Android: `versionName` + `versionCode` em build.gradle

Manter sincronizado com `package.json` versao do PSM OS.

---

## Troubleshooting

**"Pod install failed"** -> `cd ios/App && pod install --repo-update`
**Push iOS nao chega** -> conferir certificado APNs no Firebase + capability no Xcode
**Camera nega permissao** -> Settings do dispositivo > PSM OS > Camera ON
**App branco no boot** -> conferir `webDir: "www"` em capacitor.config.json
