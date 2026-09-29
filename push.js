const crypto = require('crypto');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

function b64u(buf){return Buffer.from(buf).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
function fromB64u(s){return Buffer.from(String(s||'').replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(String(s||'').length/4)*4,'='),'base64');}
function hmac(key,data){return crypto.createHmac('sha256',key).update(data).digest();}
function hkdfExpand(prk,info,length){
  const blocks=[]; let prev=Buffer.alloc(0); let i=0;
  while(Buffer.concat(blocks).length<length){i++; prev=hmac(prk,Buffer.concat([prev,Buffer.from(info),Buffer.from([i])])); blocks.push(prev);}
  return Buffer.concat(blocks).subarray(0,length);
}
function hkdfExtract(salt,ikm){return hmac(salt,ikm);}
function derToJose(der){
  let o=2, rLen=der[o+1]; let r=der.subarray(o+2,o+2+rLen); o=o+2+rLen; let sLen=der[o+1]; let ss=der.subarray(o+2,o+2+sLen);
  if(r[0]===0)r=r.subarray(1); if(ss[0]===0)ss=ss.subarray(1);
  const rb=Buffer.alloc(32); const sb=Buffer.alloc(32); r.copy(rb,32-r.length); ss.copy(sb,32-ss.length); return Buffer.concat([rb,sb]);
}
function publicUncompressedFromJwk(jwk){return Buffer.concat([Buffer.from([4]),fromB64u(jwk.x),fromB64u(jwk.y)]);}
function jwtForAudience(aud){
  const privB64=process.env.VAPID_PRIVATE_KEY_B64||''; if(!privB64) throw new Error('VAPID_PRIVATE_KEY_B64_MISSING');
  const privateKey=crypto.createPrivateKey(Buffer.from(privB64,'base64').toString('utf8'));
  const pubJwk=privateKey.asymmetricKeyType==='ec'?crypto.createPublicKey(privateKey).export({format:'jwk'}):null;
  const header=b64u(Buffer.from(JSON.stringify({typ:'JWT',alg:'ES256'})));
  const payload=b64u(Buffer.from(JSON.stringify({aud,exp:Math.floor(Date.now()/1000)+12*60*60,sub:process.env.VAPID_SUBJECT||'mailto:admin@example.com'})));
  const input=`${header}.${payload}`;
  const sig=derToJose(crypto.sign('sha256',Buffer.from(input),privateKey));
  return {token:`${input}.${b64u(sig)}`,publicKey:publicUncompressedFromJwk(pubJwk)};
}
function encryptPayload(subscription,payload){
  const uaPub=fromB64u(subscription.keys?.p256dh); const auth=fromB64u(subscription.keys?.auth);
  if(uaPub.length!==65||uaPub[0]!==4) throw new Error('BAD_P256DH');
  if(auth.length<16) throw new Error('BAD_AUTH');
  const receiver=crypto.createECDH('prime256v1'); receiver.setPublicKey(uaPub);
  const sender=crypto.createECDH('prime256v1'); sender.generateKeys();
  const asPub=sender.getPublicKey(undefined,'uncompressed');
  const shared=sender.computeSecret(receiver.getPublicKey(undefined,'uncompressed'));
  const prkKey=hkdfExtract(auth,shared);
  const keyInfo=Buffer.concat([Buffer.from('WebPush: info\0'),uaPub,asPub]);
  const ikm=hkdfExpand(prkKey,keyInfo,32);
  const salt=crypto.randomBytes(16);
  const prk=hkdfExtract(salt,ikm);
  const cek=hkdfExpand(prk,Buffer.concat([Buffer.from('Content-Encoding: aes128gcm\0')]),16);
  const nonce=hkdfExpand(prk,Buffer.concat([Buffer.from('Content-Encoding: nonce\0')]),12);
  const plain=Buffer.concat([Buffer.from(JSON.stringify(payload),'utf8'),Buffer.from([2])]);
  const rs=4096; if(plain.length>rs-17) throw new Error('PUSH_PAYLOAD_TOO_LARGE');
  const cipher=crypto.createCipheriv('aes-128-gcm',cek,nonce);
  const ciphertext=Buffer.concat([cipher.update(plain),cipher.final(),cipher.getAuthTag()]);
  const header=Buffer.alloc(21+asPub.length); salt.copy(header,0); header.writeUInt32BE(rs,16); header[20]=asPub.length; asPub.copy(header,21);
  return {body:Buffer.concat([header,ciphertext]),asPub};
}
function httpRequest(endpoint,headers,body){return new Promise((resolve,reject)=>{const u=new URL(endpoint); const lib=u.protocol==='https:'?https:http; const req=lib.request({method:'POST',hostname:u.hostname,port:u.port||undefined,path:u.pathname+u.search,headers:{...headers,'Content-Length':String(body.length)}},res=>{let b='';res.setEncoding('utf8');res.on('data',c=>b+=c);res.on('end',()=>resolve({status:res.statusCode||0,body:b,headers:res.headers}));});req.on('error',reject);req.end(body);});}
function getVapidPublicKey(){return String(process.env.VAPID_PUBLIC_KEY||'').trim();}
function pushConfigured(){return Boolean(getVapidPublicKey()&&process.env.VAPID_PRIVATE_KEY_B64&&process.env.VAPID_SUBJECT);}
function dbRead(name){const f=path.join(__dirname,'data',name+'.json');try{return JSON.parse(fs.readFileSync(f,'utf8')||'[]')}catch{return[]}}
function dbWrite(name,v){fs.writeFileSync(path.join(__dirname,'data',name+'.json.tmp'),JSON.stringify(v,null,2),'utf8');fs.renameSync(path.join(__dirname,'data',name+'.json.tmp'),path.join(__dirname,'data',name+'.json'));}
async function sendOne(sub,payload){
  const endpoint=sub.subscription?.endpoint; if(!endpoint) throw new Error('BAD_ENDPOINT');
  const {body}=encryptPayload(sub.subscription,payload); const vapid=jwtForAudience(new URL(endpoint).origin);
  const result=await httpRequest(endpoint,{TTL:'60','Content-Type':'application/octet-stream','Content-Encoding':'aes128gcm','Authorization':`vapid t=${vapid.token}, k=${b64u(vapid.publicKey)}`},body);
  if(result.status===404||result.status===410) return {expired:true,status:result.status};
  if(result.status<200||result.status>=300) throw new Error(`PUSH_HTTP_${result.status}`);
  return {delivered:true,status:result.status};
}
async function sendPushNotification(userId,payload){
  if(!pushConfigured()) return {configured:false,delivered:0,removed:0};
  const subs=dbRead('pushSubscriptions').filter(x=>x.userId===userId); let delivered=0,removed=0;
  const keep=[];
  for(const sub of subs){
    try{const r=await sendOne(sub,payload); if(r.expired)removed++; else {delivered++;keep.push(sub);}}catch(e){console.warn('push send error',e.message); keep.push(sub);}
  }
  if(subs.length) dbWrite('pushSubscriptions',[...dbRead('pushSubscriptions').filter(x=>x.userId!==userId),...keep]);
  return {configured:true,delivered,removed};
}
function generateVapidKeys(){
  const {privateKey,publicKey}=crypto.generateKeyPairSync('ec',{namedCurve:'prime256v1'});
  const privatePem=privateKey.export({type:'pkcs8',format:'pem'}); const jwk=publicKey.export({format:'jwk'});
  return {publicKey: b64u(publicUncompressedFromJwk(jwk)), privateKeyB64:Buffer.from(privatePem,'utf8').toString('base64')};
}
module.exports={sendPushNotification,getVapidPublicKey,pushConfigured,generateVapidKeys};
