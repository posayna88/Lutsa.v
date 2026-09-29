const {generateVapidKeys}=require('./push');
const x=generateVapidKeys();
console.log('# Copy these values to .env');
console.log('VAPID_SUBJECT=mailto:admin@example.com');
console.log('VAPID_PUBLIC_KEY='+x.publicKey);
console.log('VAPID_PRIVATE_KEY_B64='+x.privateKeyB64);
