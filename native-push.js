const crypto = require('crypto');
const https = require('https');

let accessTokenCache = { token: '', exp: 0 };

function b64u(buf){
  return Buffer.from(buf).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function postJson(hostname, path, body, headers={}){
  return new Promise((resolve,reject)=>{
    const data=Buffer.from(JSON.stringify(body),'utf8');
    const req=https.request({hostname, path, method:'POST',headers:{'Content-Type':'application/json','Content-Length':String(data.length),...headers}},res=>{
      let text=''; res.setEncoding('utf8');
      res.on('data',c=>text+=c);
      res.on('end',()=>resolve({status:res.statusCode||0,body:text,headers:res.headers}));
    });
    req.on('error',reject); req.end(data);
  });
}
function postForm(hostname, path, form){
  return new Promise((resolve,reject)=>{
    const data=Buffer.from(new URLSearchParams(form).toString(),'utf8');
    const req=https.request({hostname,path,method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','Content-Length':String(data.length)}},res=>{
      let text=''; res.setEncoding('utf8'); res.on('data',c=>text+=c); res.on('end',()=>resolve({status:res.statusCode||0,body:text,headers:res.headers}));
    });
    req.on('error',reject); req.end(data);
  });
}
function configured(){ return Boolean(process.env.FCM_PROJECT_ID && process.env.FCM_CLIENT_EMAIL && process.env.FCM_PRIVATE_KEY_B64); }
function privateKey(){
  const raw=Buffer.from(String(process.env.FCM_PRIVATE_KEY_B64||''),'base64').toString('utf8');
  if(!raw.includes('BEGIN PRIVATE KEY')) throw new Error('FCM_PRIVATE_KEY_INVALID');
  return crypto.createPrivateKey(raw);
}
async function getAccessToken(){
  if(!configured()) return '';
  const now=Math.floor(Date.now()/1000);
  if(accessTokenCache.token && accessTokenCache.exp-now>60) return accessTokenCache.token;
  const iat=now;
  const header=b64u(Buffer.from(JSON.stringify({alg:'RS256',typ:'JWT'})));
  const payload=b64u(Buffer.from(JSON.stringify({iss:process.env.FCM_CLIENT_EMAIL,scope:'https://www.googleapis.com/auth/firebase.messaging',aud:'https://oauth2.googleapis.com/token',iat,exp:iat+3600})));
  const input=`${header}.${payload}`;
  const sig=b64u(crypto.sign('RSA-SHA256',Buffer.from(input),privateKey()));
  const assertion=`${input}.${sig}`;
  const result=await postForm('oauth2.googleapis.com','/token',{grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion});
  if(result.status!==200) throw new Error(`FCM_OAUTH_${result.status}`);
  const parsed=JSON.parse(result.body||'{}');
  if(!parsed.access_token) throw new Error('FCM_OAUTH_NO_TOKEN');
  accessTokenCache={token:parsed.access_token,exp:now+Number(parsed.expires_in||3600)};
  return accessTokenCache.token;
}
function dbRead(name){
  const fs=require('fs'); const path=require('path');
  try{return JSON.parse(fs.readFileSync(path.join(__dirname,'data',name+'.json'),'utf8')||'[]')}catch{return[]}
}
function dbWrite(name,value){
  const fs=require('fs'); const path=require('path');
  const file=path.join(__dirname,'data',name+'.json'); const tmp=file+'.tmp';
  fs.writeFileSync(tmp,JSON.stringify(value,null,2),'utf8'); fs.renameSync(tmp,file);
}
function cleanTokensForUser(userId,keep){
  const arr=dbRead('nativePushTokens'); const allowed=new Set(keep.map(x=>x.id));
  dbWrite('nativePushTokens',arr.filter(x=>x.userId!==userId||allowed.has(x.id)));
}
async function sendNativePushNotification(userId,payload){
  if(!configured()) return {configured:false,delivered:0,removed:0};
  const tokens=dbRead('nativePushTokens').filter(x=>x.userId===userId && x.fcmToken);
  if(!tokens.length) return {configured:true,delivered:0,removed:0};
  const access=await getAccessToken(); let delivered=0,removed=0,keep=[];
  for(const row of tokens){
    const data={
      kind:String(payload.kind||payload.type||'notification'),
      title:String(payload.title||'LUTSA'),
      body:String(payload.body||''),
      url:String(payload.url||'/'),
      tag:String(payload.tag||'lutsa-notification'),
      callId:String(payload.callId||''),
      callType:String(payload.callType||payload.type||''),
      callerName:String(payload.callerName||''),
      action:String(payload.action||'open')
    };
    try{
      const result=await postJson('fcm.googleapis.com',`/v1/projects/${encodeURIComponent(process.env.FCM_PROJECT_ID)}/messages:send`,{
        message:{token:row.fcmToken,data,android:{priority:'HIGH'}}
      },{Authorization:`Bearer ${access}`});
      let parsed={}; try{parsed=JSON.parse(result.body||'{}')}catch{}
      if(result.status>=200&&result.status<300){delivered++;keep.push(row);continue;}
      const detail=JSON.stringify(parsed);
      if(detail.includes('UNREGISTERED')||detail.includes('registration-token-not-registered')){removed++;continue;}
      keep.push(row); console.warn('FCM send failed',result.status,result.body?.slice(0,300));
    }catch(err){keep.push(row); console.warn('FCM send error',err.message)}
  }
  cleanTokensForUser(userId,keep);
  return {configured:true,delivered,removed};
}
module.exports={configured,sendNativePushNotification};
