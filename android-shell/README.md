# LUTSA Android v2.7.0

غلاف Android أصلي لـ LUTSA يعمل عبر WebView، مع FCM اختياري للإشعارات والمكالمات في الخلفية.

## إعداد Firebase
- سجّل package name: `com.lutsa.social` في Firebase
- نزّل `google-services.json` وضعه داخل `app/`
- إذا لم يوجد الملف، يبقى المشروع قابلًا لإجراء Gradle configuration دون تطبيق Google Services plugin، لكن FCM لن يعمل وقت التشغيل

## إعداد الخادم
أضف إلى `.env`:

```text
FCM_PROJECT_ID=...
FCM_CLIENT_EMAIL=...
FCM_PRIVATE_KEY_B64=...
```

## المكالمات في الخلفية
`LutsaFirebaseMessagingService` يستقبل Data Messages من FCM. نوع `call` يعرض إشعار اتصال عالي الأولوية، و`CallActionReceiver` ينفذ accept/reject عبر API باستخدام access token خاص بالجهاز.

## البناء
افتح `android-shell` في Android Studio، ثم Sync وBuild. يجب توفير Android SDK وباقي أدوات البناء، وإضافة `google-services.json` الحقيقي قبل اختبار FCM. لا يتم تضمين keystore إنتاجي.
