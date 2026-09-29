const fs=require('fs');
const path=require('path');
const file=process.argv[2]||'fcm-service-account.json';
if(!fs.existsSync(file)){console.error(`File not found: ${file}`);process.exit(1);}
let x; try{x=JSON.parse(fs.readFileSync(file,'utf8'));}catch(e){console.error('Invalid JSON:',e.message);process.exit(1);}
if(!x.project_id||!x.client_email||!x.private_key){console.error('Expected project_id, client_email and private_key in the service-account JSON');process.exit(1);}
const keyB64=Buffer.from(x.private_key,'utf8').toString('base64');
console.log('\nFCM_PROJECT_ID='+x.project_id);
console.log('FCM_CLIENT_EMAIL='+x.client_email);
console.log('FCM_PRIVATE_KEY_B64='+keyB64);
console.log('\nDo not commit the service-account JSON or these environment values.');
