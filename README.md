# LUTSA Social v2.7.4

شبكة اجتماعية عربية/إنجليزية مبنية على Node.js + Vanilla JS + JSON فقط، بدون MongoDB وبدون Socket.IO وبدون مكتبات npm خارجية على الخادم.

## v2.7.4
- Messenger: رد على الرسائل، تعديل الرسائل خلال 15 دقيقة، تفاعلات للرسائل، نسخ الرسائل، وإظهار المرفقات والردود داخل الفقاعة
- Groups: Composer للمنشورات داخل المجموعة من نافذة المجموعة
- Pages: Composer للمنشورات داخل الصفحة للمالك
- Stories: عارض قصص مع التالي/السابق ومؤشر التقدم ومشاركة الرابط
- WebRTC الصوتي/الفيديوي مع ICE buffering + ICE restart + جودة المكالمة + STUN/TURN + Polling + FCM/PWA
- JSON storage فقط مع ملف `data/messageReactions.json` جديد

## التشغيل
```bash
node server.js
```

ثم افتح `http://localhost:3000`.

## الصحة
`GET /api/health` يجب أن يعرض `version: 2.7.4` و`signalRoute: true`.

## Android
افتح `android-shell` في Android Studio، وضع `google-services.json` الحقيقي لتفعيل FCM. لم يتم تضمين keystore إنتاجي أو APK/AAB مبني مسبقًا.


## WebRTC / TURN
المكالمات بين شبكات مختلفة تحتاج TURN في بعض حالات NAT. يمكن ضبط TURN ثابتًا عبر `TURN_URLS`/`TURN_USERNAME`/`TURN_CREDENTIAL`، أو استخدام Metered عبر `METERED_APP_NAME` و`METERED_TURN_API_KEY`. الخادم يحمّل مصفوفة ICE من Metered ويخزنها مؤقتًا بدل إنشاء credential جديدة عند كل مكالمة.

ملاحظات مهمة: مفتاح Metered المستخدم هنا هو **Credential API Key** الخاص ببيانات TURN، وليس Secret Key الحساب؛ وثائق Metered توصي بجلب ICE servers من مسار credentials واستخدام بيانات الاعتماد الموزعة من الشبكة.
