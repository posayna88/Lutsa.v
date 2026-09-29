const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { sendPushNotification, getVapidPublicKey, pushConfigured, generateVapidKeys } = require('./push.js');
const { sendNativePushNotification, configured: nativePushConfigured } = require('./native-push.js');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const APP_NAME = process.env.APP_NAME || 'LUTSA Social';
const MAX_JSON = Number(process.env.MAX_JSON || 32 * 1024 * 1024);
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 25 * 1024 * 1024);
const MAX_IMAGE_BYTES = Number(process.env.MAX_IMAGE_BYTES || 12 * 1024 * 1024);
const MAX_VIDEO_BYTES = Number(process.env.MAX_VIDEO_BYTES || 25 * 1024 * 1024);
const MAX_AUDIO_BYTES = Number(process.env.MAX_AUDIO_BYTES || 15 * 1024 * 1024);
const RATE_WINDOW_MS = Number(process.env.RATE_WINDOW_MS || 60 * 1000);
const RATE_API_GET = Number(process.env.RATE_API_GET || 240);
const RATE_API_POST = Number(process.env.RATE_API_POST || 120);
const RATE_AUTH = Number(process.env.RATE_AUTH || 10);
const SESSION_TTL = Number(process.env.SESSION_TTL || 30 * 24 * 60 * 60 * 1000);
const APP_VERSION = '2.7.4';
const COOKIE_NAME = 'lutsa_session';
const SECRET = process.env.SESSION_SECRET || 'change-this-lutsa-secret-in-production';
const STUN_URLS = (process.env.STUN_URLS || 'stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302').split(',').map(s => s.trim()).filter(Boolean);
const TURN_URLS = (process.env.TURN_URLS || '').split(',').map(s => s.trim()).filter(Boolean);
const TURN_USERNAME = process.env.TURN_USERNAME || '';
const TURN_CREDENTIAL = process.env.TURN_CREDENTIAL || '';
const METERED_APP_NAME = process.env.METERED_APP_NAME || '';
const METERED_TURN_API_KEY = process.env.METERED_TURN_API_KEY || '';
const METERED_REGION = process.env.METERED_REGION || '';
const METERED_ICE_CACHE_MS = Number(process.env.METERED_ICE_CACHE_MS || 30 * 60 * 1000);
let meteredIceCache = { iceServers: [], expiresAt: 0, error: '' };
const CALL_POLL_MS = 2000;
const STREAM_POLL_MS = 1800;
const FEED_DEFAULT_LIMIT = Number(process.env.FEED_DEFAULT_LIMIT || 15);
const FEED_MAX_LIMIT = Number(process.env.FEED_MAX_LIMIT || 30);
const MESSAGES_DEFAULT_LIMIT = Number(process.env.MESSAGES_DEFAULT_LIMIT || 80);
const MESSAGES_MAX_LIMIT = Number(process.env.MESSAGES_MAX_LIMIT || 150);
const PRESENCE_WINDOW_MS = 70000;

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DATA = path.join(ROOT, 'data');
const UPLOADS = path.join(PUBLIC, 'uploads');
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(UPLOADS, { recursive: true });
const BACKUPS = path.join(ROOT, 'backups');
fs.mkdirSync(BACKUPS, { recursive: true });

const DB_FILES = [
  'users','sessions','posts','comments','reactions','stories','messages','conversations',
  'friendRequests','follows','blocks','notifications','groups','groupMembers','pages','pageFollows',
  'marketplace','events','eventRsvps','reports','calls','callSignals','callQuality','stream','streamSignals','memories','groupPosts','pagePosts','audit','pushSubscriptions','nativePushTokens','media','collections','collectionItems','storyViews','storyReactions','messageReactions'
];

for (const name of DB_FILES) {
  const f = path.join(DATA, name + '.json');
  if (!fs.existsSync(f)) fs.writeFileSync(f, '[]', 'utf8');
}

const writeLocks = new Map();
const dbCache = new Map();
function dbRead(name) {
  if (dbCache.has(name)) return dbCache.get(name);
  const f = path.join(DATA, name + '.json');
  try {
    const value = JSON.parse(fs.readFileSync(f, 'utf8') || '[]');
    dbCache.set(name, value);
    return value;
  } catch {
    const value = [];
    dbCache.set(name, value);
    return value;
  }
}
function dbWrite(name, value) {
  const f = path.join(DATA, name + '.json');
  const tmp = f + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, f);
  dbCache.set(name, value);
}
function mutate(name, fn) {
  const current = dbRead(name);
  const next = fn(current) || current;
  dbWrite(name, next);
  return next;
}
function clearDbCache(){dbCache.clear();}
function clampLimit(raw,fallback,max){const n=Number.parseInt(raw,10);return Number.isFinite(n)?Math.min(max,Math.max(1,n)):fallback;}
function encodeCursor(item){return Buffer.from(JSON.stringify({createdAt:item.createdAt,id:item.id}),'utf8').toString('base64url');}
function decodeCursor(raw){if(!raw)return null;try{const v=JSON.parse(Buffer.from(String(raw),'base64url').toString('utf8'));return v&&v.createdAt&&v.id?v:null;}catch{return null;}}
function isBeforeCursor(item,cursor){return !cursor || item.createdAt<cursor.createdAt || (item.createdAt===cursor.createdAt&&String(item.id)<String(cursor.id));}
function id(prefix='id') { return prefix + '_' + crypto.randomBytes(8).toString('hex'); }
function now() { return new Date().toISOString(); }
function safeText(v, max=5000) { return String(v ?? '').trim().slice(0,max); }
async function getMeteredIceServers() {
  if (!METERED_APP_NAME || !METERED_TURN_API_KEY) return [];
  if (meteredIceCache.expiresAt > Date.now() && meteredIceCache.iceServers.length) return meteredIceCache.iceServers;
  try {
    const qs = new URLSearchParams({ apiKey: METERED_TURN_API_KEY });
    if (METERED_REGION) qs.set('region', METERED_REGION);
    const endpoint = `https://${METERED_APP_NAME}.metered.live/api/v1/turn/credentials?${qs}`;
    const r = await fetch(endpoint, { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(7000) });
    if (!r.ok) throw new Error(`METERED_HTTP_${r.status}`);
    const data = await r.json();
    if (!Array.isArray(data) || !data.length) throw new Error('METERED_EMPTY_ICE_SERVERS');
    meteredIceCache = { iceServers: data, expiresAt: Date.now() + METERED_ICE_CACHE_MS, error: '' };
    return data;
  } catch (e) {
    meteredIceCache.error = e?.message || 'METERED_FETCH_FAILED';
    console.warn('Metered TURN configuration unavailable:', meteredIceCache.error);
    return meteredIceCache.iceServers || [];
  }
}
async function buildWebRtcConfig() {
  const metered = await getMeteredIceServers();
  const staticTurn = TURN_URLS.length ? [{ urls: TURN_URLS, username: TURN_USERNAME, credential: TURN_CREDENTIAL }] : [];
  const iceServers = [{ urls: STUN_URLS }, ...(metered.length ? metered : staticTurn)];
  return {
    iceServers,
    iceTransportPolicy: 'all',
    bundlePolicy: 'max-bundle',
    rtcpMuxPolicy: 'require',
    iceCandidatePoolSize: 4
  };
}
function hashPassword(password, saltHex) {
  const salt = saltHex ? Buffer.from(saltHex, 'hex') : crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 64);
  return { salt: salt.toString('hex'), hash: hash.toString('hex') };
}
function verifyPassword(password, salt, expected) {
  try {
    const actual = hashPassword(password, salt).hash;
    return crypto.timingSafeEqual(Buffer.from(actual,'hex'), Buffer.from(expected,'hex'));
  } catch { return false; }
}
function sign(value) {
  return crypto.createHmac('sha256', SECRET).update(value).digest('hex');
}
function makeSession(userId) {
  const raw = `${userId}.${Date.now()}.${crypto.randomBytes(12).toString('hex')}`;
  return raw + '.' + sign(raw);
}
function parseCookies(req) {
  const out = {};
  const line = req.headers.cookie || '';
  for (const p of line.split(';')) {
    const i = p.indexOf('='); if (i < 0) continue;
    out[p.slice(0,i).trim()] = decodeURIComponent(p.slice(i+1).trim());
  }
  return out;
}
function sessionUser(req) {
  const token = parseCookies(req)[COOKIE_NAME];
  if (!token) return null;
  const p = token.split('.');
  if (p.length < 4) return null;
  const raw = p.slice(0,-1).join('.');
  if (sign(raw) !== p[p.length-1]) return null;
  const ts = Number(p[1]);
  if (!ts || Date.now() - ts > SESSION_TTL) return null;
  const s = dbRead('sessions').find(x => x.token === token && x.expiresAt > Date.now());
  if (!s) return null;
  const u = dbRead('users').find(x => x.id === p[0]);
  return u || null;
}
function cookie(token, maxAge=SESSION_TTL, req=null) {
  const secure=req && String(req.headers['x-forwarded-proto']||'').split(',')[0].trim()==='https' ? '; Secure' : '';
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=${Math.floor(maxAge/1000)}`;
}
function normalizeLiveStream(s){
  if(!s) return null;
  const cutoff=Date.now()-65000;
  const viewerSeen=s.viewerSeen&&typeof s.viewerSeen==='object'?s.viewerSeen:{};
  const viewers=Array.isArray(s.viewerIds)?s.viewerIds.filter(id=>Number(viewerSeen[id]||0)>=cutoff):[];
  const next={...s,viewerIds:[...new Set(viewers)],viewerSeen};
  if(next.status==='live' && new Date(next.heartbeatAt||next.startedAt).getTime()<Date.now()-90000){
    next.status='ended'; next.endedAt=now(); next.viewerIds=[];
  }
  return next;
}
function publicUser(u) {
  if (!u) return null;
  return {
    id:u.id, username:u.username, displayName:u.displayName, bio:u.bio || '', avatar:u.avatar || '',
    cover:u.cover || '', role:u.role, createdAt:u.createdAt, lastSeenAt:u.lastSeenAt,
    isOnline: u.lastSeenAt ? (Date.now() - new Date(u.lastSeenAt).getTime() < PRESENCE_WINDOW_MS) : false,
    disabled: Boolean(u.disabled)
  };
}

const rateBuckets = new Map();
const rateCleanupTimer = setInterval(()=>{const cutoff=Date.now()-RATE_WINDOW_MS*2;for(const [k,v] of rateBuckets){if(v.startedAt<cutoff)rateBuckets.delete(k);}},Math.max(60000,RATE_WINDOW_MS));
rateCleanupTimer.unref?.();
function clientIp(req){
  const forwarded=String(req.headers['x-forwarded-for']||'').split(',')[0].trim();
  return forwarded || req.socket?.remoteAddress || 'unknown';
}
function rateLimit(req,res,pathname,method){
  if(!pathname.startsWith('/api/')) return true;
  let limit=method==='GET'?RATE_API_GET:RATE_API_POST;
  if(pathname.startsWith('/api/auth/')) limit=RATE_AUTH;
  if(pathname==='/api/calls/signal' || pathname==='/api/stream/signal') limit=Math.max(limit,300);
  const key=`${clientIp(req)}|${method}|${pathname.startsWith('/api/auth/')?'auth':pathname.includes('/signal')?'signal':'api'}`;
  const nowTs=Date.now();
  let b=rateBuckets.get(key);
  if(!b || nowTs-b.startedAt>=RATE_WINDOW_MS){ b={startedAt:nowTs,count:0}; rateBuckets.set(key,b); }
  b.count++;
  if(b.count>limit){
    const retry=Math.max(1,Math.ceil((RATE_WINDOW_MS-(nowTs-b.startedAt))/1000));
    res.setHeader('Retry-After',String(retry));
    writeJson(res,429,{error:'RATE_LIMITED',retryAfter:retry});
    return false;
  }
  return true;
}
function sameOrigin(req){
  const origin=req.headers.origin;
  if(!origin) return true;
  try{
    const expected=String(req.headers['x-forwarded-host']||req.headers.host||'').split(',')[0].trim();
    return new URL(origin).host===expected;
  }catch{return false;}
}
function securityHeaders(res, req){
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
  res.setHeader('X-Robots-Tag','noindex, nofollow');
  res.setHeader('Permissions-Policy','camera=(self), microphone=(self), geolocation=(self)');
  res.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; worker-src 'self' blob:; manifest-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
  if(String(req.headers['x-forwarded-proto']||'').split(',')[0].trim()==='https') res.setHeader('Strict-Transport-Security','max-age=31536000');
}
function logAdmin(actorId,action,targetId=null,meta={}){
  mutate('audit',a=>[{id:id('audit'),actorId,action,targetId,meta,createdAt:now()},...a].slice(0,5000));
}
const BACKUP_EXCLUDE=new Set(['sessions','callSignals','streamSignals','nativePushTokens']);
function backupFiles(){ return DB_FILES.filter(n=>!BACKUP_EXCLUDE.has(n)); }
function backupSnapshot(){
  const files={};
  for(const name of backupFiles()) files[name]=dbRead(name);
  return {format:'lutsa-json-backup',version:APP_VERSION,createdAt:now(),files};
}
function dirSize(dir){
  let total=0;
  const walk=d=>{for(const ent of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,ent.name);if(ent.isDirectory())walk(p);else{try{total+=fs.statSync(p).size}catch{}}}};
  try{walk(dir)}catch{}
  return total;
}
function countFiles(dir){
  let total=0;
  const walk=d=>{for(const ent of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,ent.name);if(ent.isDirectory())walk(p);else total++}};
  try{walk(dir)}catch{}
  return total;
}
function writeDownloadJson(res,filename,obj){
  const data=JSON.stringify(obj,null,2);
  res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Content-Disposition':`attachment; filename="${filename}"`,'Cache-Control':'no-store'});
  res.end(data);
}
function validateSnapshot(snapshot){
  if(!snapshot || snapshot.format!=='lutsa-json-backup' || !snapshot.files || typeof snapshot.files!=='object') return 'INVALID_BACKUP';
  const required=backupFiles();
  if(!required.every(n=>Array.isArray(snapshot.files[n]))) return 'INCOMPLETE_BACKUP';
  const users=snapshot.files.users||[];
  if(!users.some(x=>x && x.role==='admin' && !x.disabled)) return 'NO_ACTIVE_ADMIN';
  return null;
}
function restoreSnapshot(snapshot){
  const err=validateSnapshot(snapshot); if(err) throw new Error(err);
  clearDbCache();
  const temp=[];
  try{
    for(const name of backupFiles()){
      const f=path.join(DATA,name+'.json'); const t=f+'.restore.tmp';
      fs.writeFileSync(t,JSON.stringify(snapshot.files[name],null,2),'utf8'); temp.push([t,f]);
    }
    for(const [t,f] of temp) fs.renameSync(t,f);
    dbWrite('sessions',[]); dbWrite('callSignals',[]); dbWrite('streamSignals',[]); dbWrite('stream',[]);
  }catch(e){
    for(const [t] of temp){try{if(fs.existsSync(t))fs.unlinkSync(t)}catch{}}
    throw e;
  }
}

function writeJson(res, status, body, extraHeaders={}) {
  const data=Buffer.from(JSON.stringify(body));
  const accepts=String(res.req?.headers?.['accept-encoding']||'');
  const canGzip=status===200&&data.length>1024&&/(?:^|,\s*)gzip(?:\s*;|\s*,|$)/i.test(accepts);
  if(canGzip){try{const gz=zlib.gzipSync(data,{level:zlib.constants.Z_BEST_SPEED});res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Content-Encoding':'gzip','Vary':'Accept-Encoding',...extraHeaders});return res.end(gz);}catch{}}
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...extraHeaders});res.end(data);
}
function textRes(res, status, body, type='text/plain; charset=utf-8') {
  res.writeHead(status, {'Content-Type':type}); res.end(body);
}
async function readBody(req) {
  return await new Promise((resolve,reject)=>{
    let buf = Buffer.alloc(0);
    req.on('data', c => { buf = Buffer.concat([buf,c]); if (buf.length > MAX_JSON) { req.destroy(); reject(new Error('Payload too large')); }});
    req.on('end', () => resolve(buf));
    req.on('error', reject);
  });
}
async function jsonBody(req) {
  const b = await readBody(req); if (!b.length) return {};
  return JSON.parse(b.toString('utf8'));
}
function requireUser(req,res) {
  const u = sessionUser(req);
  if (!u) { writeJson(res,401,{error:'AUTH_REQUIRED'}); return null; }
  return u;
}
function touch(u) { if (!u || !u.id) return; mutate('users', arr => arr.map(x => x.id===u.id ? {...x,lastSeenAt:now()} : x)); }
function hashBearerToken(token){ return crypto.createHash('sha256').update(String(token||'')).digest('hex'); }
function nativeTokenUser(req){
  const auth=String(req.headers.authorization||'');
  if(!auth.startsWith('Bearer ')) return null;
  const hash=hashBearerToken(auth.slice(7).trim());
  const row=dbRead('nativePushTokens').find(x=>x.accessHash===hash&&x.revokedAt==null);
  if(!row) return null;
  const user=dbRead('users').find(x=>x.id===row.userId);
  if(!user||user.disabled) return null;
  mutate('nativePushTokens',a=>a.map(x=>x.accessHash===hash?{...x,lastSeenAt:now()}:x));
  return {user,row};
}
function requireNativeUser(req,res){ const found=nativeTokenUser(req); if(!found){writeJson(res,401,{error:'NATIVE_AUTH_REQUIRED'});return null;} return found; }
function sessionKey(token){ return hashBearerToken(token); }
function notificationDefaults(){ return {messages:true,calls:true,friends:true,follows:true,reactions:true,comments:true,shares:true,events:true,groups:true,pages:true,general:true}; }
function notificationPrefsFor(user){ return {...notificationDefaults(),...(user?.notificationPrefs||{})}; }
function shouldPushNotify(user,type){
  const p=notificationPrefsFor(user);
  if(type==='message') return p.messages;
  if(type==='call') return p.calls;
  if(type==='friend') return p.friends;
  if(type==='follow') return p.follows;
  if(type==='reaction') return p.reactions;
  if(type==='comment') return p.comments;
  if(type==='share') return p.shares;
  if(type==='event') return p.events;
  if(type==='group') return p.groups;
  if(type==='page') return p.pages;
  return p.general;
}
function notificationUrl(meta={}) {
  if (meta.url) return meta.url;
  if (meta.postId) return `/?page=post&postId=${encodeURIComponent(meta.postId)}`;
  if (meta.storyId) return `/?page=stories&storyId=${encodeURIComponent(meta.storyId)}`;
  if (meta.groupId) return `/?page=group&gid=${encodeURIComponent(meta.groupId)}`;
  if (meta.pageId) return `/?page=page&pid=${encodeURIComponent(meta.pageId)}`;
  if (meta.userId) return `/?page=profile&uid=${encodeURIComponent(meta.userId)}`;
  if (meta.conversationId || meta.fromUserId) {
    const uid = meta.fromUserId || meta.userId || '';
    return uid ? `/?page=messenger&uid=${encodeURIComponent(uid)}` : '/?page=messenger';
  }
  if (meta.callId) return '/?page=calls';
  return '/';
}
function notify(userId,type,title,body,meta={}) {
  const enrichedMeta={...meta,url:notificationUrl(meta)};
  const item={id:id('n'),userId,type,title,body,meta:enrichedMeta,read:false,createdAt:now()};
  mutate('notifications', a => [item,...a].slice(0,5000));
  const pushPayload={kind:type,title,body,url:enrichedMeta.url||'/',tag:`${type}:${item.id}`,callId:enrichedMeta?.callId||'',callType:enrichedMeta?.type||'',callerName:enrichedMeta?.callerName||'',action:enrichedMeta?.action||'open'};
  const target=userFromId(userId);
  if(shouldPushNotify(target,type) && pushConfigured()) queueMicrotask(() => sendPushNotification(userId,pushPayload).catch(err=>console.warn('web push delivery failed',err.message)));
  if(shouldPushNotify(target,type) && nativePushConfigured()) queueMicrotask(() => sendNativePushNotification(userId,pushPayload).catch(err=>console.warn('native push delivery failed',err.message)));
}
function expireRingingCalls(){
  const cutoff=Date.now()-30000;
  const calls=dbRead('calls');
  const expired=calls.filter(c=>c.status==='ringing'&&new Date(c.createdAt).getTime()<=cutoff);
  if(!expired.length) return;
  const ids=new Set(expired.map(c=>c.id));
  mutate('calls',a=>a.map(c=>ids.has(c.id)?{...c,status:'missed',endedAt:now()}:c));
  for(const c of expired) notify(c.from,'call','مكالمة فائتة','لم يتم الرد على مكالمتك',{callId:c.id,action:'open'});
}

function blocked(a,b) {
  const bs=dbRead('blocks'); return bs.some(x => (x.userId===a&&x.blockedUserId===b)||(x.userId===b&&x.blockedUserId===a));
}
function canMessage(sender, target) {
  if (!target) return false;
  if (blocked(sender.id,target.id)) return false;
  const p=target.privacy||{};
  if (p.messageWho==='nobody') return false;
  if (p.messageWho==='friends') return dbRead('friendRequests').some(x=>x.status==='accepted' && ((x.from===sender.id&&x.to===target.id)||(x.from===target.id&&x.to===sender.id)));
  return true;
}
function relCounts(userId) {
  const followers=dbRead('follows').filter(x=>x.to===userId).length;
  const following=dbRead('follows').filter(x=>x.from===userId).length;
  const friends=dbRead('friendRequests').filter(x=>x.status==='accepted' && (x.from===userId||x.to===userId)).length;
  const posts=dbRead('posts').filter(x=>x.authorId===userId && !x.deleted).length;
  const media=dbRead('posts').filter(x=>x.authorId===userId && !x.deleted && x.media).length;
  return {followers,following,friends,posts,media};
}
function friendship(a,b) {
  const req=dbRead('friendRequests').find(x=>((x.from===a&&x.to===b)||(x.from===b&&x.to===a)));
  const following=dbRead('follows').some(x=>x.from===a&&x.to===b);
  return {status:req?.status||'none',following};
}
function serializePost(p,current) {
  const reactions=dbRead('reactions').filter(x=>x.targetType==='post'&&x.targetId===p.id);
  const my=reactions.find(x=>x.userId===current?.id)?.type || null;
  const rawComments=dbRead('comments').filter(x=>x.postId===p.id&&!x.deleted).sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
  const all=rawComments.map(c=>({...c,author:publicUser(userFromId(c.authorId)),replies:[]}));
  const byId=new Map(all.map(c=>[c.id,c])); const roots=[];
  for(const c of all){if(c.parentId&&byId.has(c.parentId))byId.get(c.parentId).replies.push(c);else roots.push(c);}
  return {...p,author:publicUser(userFromId(p.authorId)),reactionSummary:reactions.reduce((m,x)=>(m[x.type]=(m[x.type]||0)+1,m),{}),myReaction:my,comments:roots.slice(-40),commentCount:rawComments.length};
}
function userFromId(idv){return dbRead('users').find(u=>u.id===idv)}

function serializeMessage(m,currentUserId,otherUserId){
  const reactions=dbRead('messageReactions').filter(x=>x.messageId===m.id);
  const reply=m.replyTo?dbRead('messages').find(x=>x.id===m.replyTo):null;
  return {...m,
    reactionSummary:reactions.reduce((acc,x)=>(acc[x.type]=(acc[x.type]||0)+1,acc),{}),
    myReaction:reactions.find(x=>x.userId===currentUserId)?.type||null,
    replyTo: reply ? {id:reply.id,from:reply.from,text:reply.deleted?'تم حذف الرسالة':(reply.text||'مرفق'),deleted:Boolean(reply.deleted)} : null
  };
}

function messageBelongsToPair(message,a,b){
  return Boolean(message && ((message.from===a&&message.to===b)||(message.from===b&&message.to===a)));
}


function isFriend(a,b){
  return dbRead('friendRequests').some(x=>x.status==='accepted'&&((x.from===a&&x.to===b)||(x.from===b&&x.to===a)));
}
function restrictedUser(u){
  const x=publicUser(u);
  return x?{id:x.id,username:x.username,displayName:x.displayName,role:x.role,createdAt:x.createdAt,disabled:x.disabled}:null;
}
function canViewProfile(viewer,target){
  if(!target) return false;
  if(target.id===viewer?.id) return true;
  if((target.privacy?.profile||'public')==='friends') return isFriend(viewer?.id,target.id);
  return true;
}
function scrubFileName(name='file'){
  const base=String(name).split(/[\\/]/).pop().replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,120);
  return base || 'file';
}
function mediaKind(mime){
  if(mime.startsWith('image/')) return 'image';
  if(mime.startsWith('video/')) return 'video';
  if(mime.startsWith('audio/')) return 'audio';
  return 'file';
}
function allowedMediaMime(mime){
  return ['image/jpeg','image/png','image/webp','image/gif','image/avif','video/mp4','video/webm','video/quicktime','audio/webm','audio/ogg','audio/mpeg','audio/wav','application/pdf','application/zip'].includes(mime);
}
function mediaLimit(mime){
  const k=mediaKind(mime);
  if(k==='image') return MAX_IMAGE_BYTES;
  if(k==='video') return MAX_VIDEO_BYTES;
  if(k==='audio') return MAX_AUDIO_BYTES;
  return MAX_UPLOAD_BYTES;
}
function mediaOwnerAllowed(userId, media){ return Boolean(media && media.ownerId===userId); }
function cleanupUserData(userId){
  const mediaFiles=dbRead('media').filter(x=>x.ownerId===userId);
  for(const [name,predicate] of [
    ['posts',x=>x.authorId===userId],['comments',x=>x.authorId===userId],['reactions',x=>x.userId===userId],
    ['stories',x=>x.authorId===userId],['messages',x=>x.from===userId||x.to===userId],['friendRequests',x=>x.from===userId||x.to===userId],
    ['follows',x=>x.from===userId||x.to===userId],['blocks',x=>x.userId===userId||x.blockedUserId===userId],['notifications',x=>x.userId===userId],
    ['groupMembers',x=>x.userId===userId],['groupPosts',x=>x.authorId===userId],['pageFollows',x=>x.userId===userId],['pagePosts',x=>x.authorId===userId],
    ['eventRsvps',x=>x.userId===userId],['calls',x=>x.from===userId||x.to===userId],['reports',x=>x.reporterId===userId],['memories',x=>x.userId===userId],
    ['pushSubscriptions',x=>x.userId===userId],['nativePushTokens',x=>x.userId===userId],['media',x=>x.ownerId===userId],['messageReactions',x=>x.userId===userId]
  ]) mutate(name,a=>a.filter(x=>!predicate(x)));
  mutate('groups',a=>a.filter(x=>x.ownerId!==userId));
  mutate('pages',a=>a.filter(x=>x.ownerId!==userId));
  mutate('marketplace',a=>a.filter(x=>x.sellerId!==userId));
  mutate('events',a=>a.filter(x=>x.hostId!==userId));
  mutate('sessions',a=>a.filter(x=>x.userId!==userId));
  for(const m of mediaFiles){try{fs.unlinkSync(path.join(PUBLIC,m.path.replace(/^\//,'')).replace(/\\/g,path.sep))}catch{}}
}

function serveStatic(req,res,u) {
  let pathname = new URL(req.url,'http://localhost').pathname;
  if (pathname==='/' || pathname==='/index.html') pathname='/index.html';
  if (pathname.startsWith('/api/')) return false;
  const rel = pathname.replace(/^\//,'');
  const file = path.resolve(PUBLIC, rel || 'index.html');
  if (!file.startsWith(path.resolve(PUBLIC))) return false;
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return false;
  const ext=path.extname(file).toLowerCase();
  const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.webmanifest':'application/manifest+json','.ico':'image/x-icon','.mp4':'video/mp4','.webm':'video/webm','.ogg':'audio/ogg','.wav':'audio/wav','.mp3':'audio/mpeg'};
  const compressible=['.html','.js','.css','.json','.svg'].includes(ext) && ext!=='.webmanifest';
  const accepts=String(req.headers['accept-encoding']||'');
  if(compressible&&/(?:^|,\s*)gzip(?:\s*;|\s*,|$)/i.test(accepts)){
    res.writeHead(200,{'Content-Type':types[ext]||'application/octet-stream','Cache-Control':['.html','.js','.css','.webmanifest','.svg'].includes(ext)?'no-cache':'public, max-age=3600','Content-Encoding':'gzip','Vary':'Accept-Encoding'});
    return fs.createReadStream(file).pipe(zlib.createGzip({level:zlib.constants.Z_BEST_SPEED})).pipe(res);
  }
  res.writeHead(200, {'Content-Type':types[ext]||'application/octet-stream','Cache-Control': ['.html','.js','.css','.webmanifest','.svg'].includes(ext)?'no-cache':'public, max-age=3600'});
  fs.createReadStream(file).pipe(res); return true;
}

async function router(req,res) {
  const u = sessionUser(req);
  const native = !u ? nativeTokenUser(req) : null;
  expireRingingCalls();
  if (u) touch(u);
  const url = new URL(req.url,'http://localhost');
  securityHeaders(res,req);
  if (url.pathname === '/manifest.webmanifest' || url.pathname === '/manifest-2.7.4.webmanifest' || url.pathname === '/manifest-2.7.3.webmanifest') {
    const manifestPath = fs.existsSync(path.join(PUBLIC, 'manifest-2.7.4.webmanifest')) ? path.join(PUBLIC, 'manifest-2.7.4.webmanifest') : path.join(PUBLIC, 'manifest-2.7.3.webmanifest');
    const manifest = fs.readFileSync(manifestPath);
    res.writeHead(200, {
      'Content-Type': 'application/manifest+json; charset=utf-8',
      'Content-Length': String(manifest.length),
      'Cache-Control': 'no-store, max-age=0, must-revalidate',
      'Pragma': 'no-cache',
      'Content-Encoding': 'identity',
      'X-Content-Type-Options': 'nosniff'
    });
    return res.end(manifest);
  }
  if (serveStatic(req,res,u)) return;
  const pathname=url.pathname.replace(/\/+$/,'') || '/';
  const method=req.method;
  if(method==='OPTIONS') return writeJson(res,204,{});
  if(!rateLimit(req,res,pathname,method)) return;
  if(pathname.startsWith('/api/') && method!=='GET' && method!=='HEAD' && !sameOrigin(req)) return writeJson(res,403,{error:'ORIGIN_FORBIDDEN'});
  try {
    // Auth
    if (pathname==='/api/auth/me' && method==='GET') return writeJson(res,200,{user:publicUser(u)});
    if (pathname==='/api/auth/register' && method==='POST') {
      const b=await jsonBody(req); const username=safeText(b.username,40).toLowerCase().replace(/[^a-z0-9_.-]/g,'');
      const displayName=safeText(b.displayName,80); const password=String(b.password||'');
      if(username.length<3||displayName.length<2||password.length<6) return writeJson(res,400,{error:'VALIDATION'});
      const users=dbRead('users'); if(users.some(x=>x.username===username)) return writeJson(res,409,{error:'USERNAME_TAKEN'});
      const hp=hashPassword(password); const user={id:id('usr'),username,displayName,bio:'',avatar:'',cover:'',role:'user',passwordHash:hp.hash,passwordSalt:hp.salt,privacy:{messageWho:'everyone',profile:'public',readReceipts:true,activityStatus:true},notificationPrefs:notificationDefaults(),createdAt:now(),lastSeenAt:now()};
      dbWrite('users',[...users,user]);
      const token=makeSession(user.id); dbWrite('sessions',[...dbRead('sessions').filter(s=>s.expiresAt>Date.now()),{token,userId:user.id,createdAt:Date.now(),expiresAt:Date.now()+SESSION_TTL,userAgent:safeText(req.headers['user-agent'],300),label:safeText(req.headers['x-device-label'],100)}]);
      return writeJson(res,200,{user:publicUser(user)},{'Set-Cookie':cookie(token, SESSION_TTL, req)});
    }
    if (pathname==='/api/auth/login' && method==='POST') {
      const b=await jsonBody(req); const login=safeText(b.login,80).toLowerCase(); const pass=String(b.password||'');
      const user=dbRead('users').find(x=>x.username===login || x.email===login);
      if(!user || !verifyPassword(pass,user.passwordSalt,user.passwordHash)) return writeJson(res,401,{error:'BAD_LOGIN'});
      const token=makeSession(user.id); dbWrite('sessions',[...dbRead('sessions').filter(s=>s.expiresAt>Date.now()),{token,userId:user.id,createdAt:Date.now(),expiresAt:Date.now()+SESSION_TTL,userAgent:safeText(req.headers['user-agent'],300),label:safeText(req.headers['x-device-label'],100)}]);
      return writeJson(res,200,{user:publicUser(user)},{'Set-Cookie':cookie(token, SESSION_TTL, req)});
    }
    if(pathname==='/api/auth/logout'&&method==='POST') { const t=parseCookies(req)[COOKIE_NAME]; mutate('sessions',a=>a.filter(x=>x.token!==t)); return writeJson(res,200,{ok:true},{'Set-Cookie':cookie('',0,req)}); }

    if(pathname==='/api/health'&&method==='GET') return writeJson(res,200,{ok:true,appName:APP_NAME,version:APP_VERSION,time:Date.now(),signalRoute:true,cache:{entries:dbCache.size},memory:{rss:process.memoryUsage().rss,heapUsed:process.memoryUsage().heapUsed}});
    if(pathname==='/api/config'&&method==='GET'){
      const webrtc=await buildWebRtcConfig();
      return writeJson(res,200,{appName:APP_NAME,version:SERVER_VERSION,webrtc,turn:{configured:webrtc.iceServers.length>1,provider:METERED_APP_NAME&&METERED_TURN_API_KEY?'metered':TURN_URLS.length?'static':'none',meteredConfigured:Boolean(METERED_APP_NAME&&METERED_TURN_API_KEY),error:meteredIceCache.error||''},polling:{call:CALL_POLL_MS,stream:STREAM_POLL_MS}});
    }
    if(pathname==='/api/presence'&&method==='GET') return writeJson(res,200,{online:dbRead('users').filter(x=>x.id!==u?.id&&x.privacy?.activityStatus!==false&&x.lastSeenAt&&Date.now()-new Date(x.lastSeenAt).getTime()<PRESENCE_WINDOW_MS).slice(0,100).map(publicUser)});
    if(pathname==='/api/push/status'&&method==='GET'){ if(!u) return writeJson(res,401,{error:'AUTH_REQUIRED'}); return writeJson(res,200,{enabled:pushConfigured(),subscriptions:dbRead('pushSubscriptions').filter(x=>x.userId===u.id).length,publicKey:getVapidPublicKey()||'',subject:process.env.VAPID_SUBJECT||'',transport:pushConfigured()?'web-push-vapid':'service-worker-local',native:{configured:nativePushConfigured(),devices:dbRead('nativePushTokens').filter(x=>x.userId===u.id&&!x.revokedAt).length}}); }
    if(pathname==='/api/push/native/register'&&method==='POST'){
      const b=await jsonBody(req); const token=safeText(b.fcmToken,4096); const deviceId=safeText(b.deviceId,120)||id('device');
      if(!token) return writeJson(res,400,{error:'FCM_TOKEN_REQUIRED'});
      const accessToken=crypto.randomBytes(32).toString('base64url'); const accessHash=hashBearerToken(accessToken);
      mutate('nativePushTokens',a=>[{id:id('npt'),userId:u.id,fcmToken:token,deviceId,platform:'android',accessHash,lastSeenAt:now(),createdAt:now(),updatedAt:now()},...a.filter(x=>x.deviceId!==deviceId)].slice(0,10000));
      return writeJson(res,200,{ok:true,accessToken,nativeConfigured:nativePushConfigured()});
    }
    if(pathname==='/api/push/native/register-token'&&method==='POST'){
      const found=requireNativeUser(req,res); if(!found)return; const b=await jsonBody(req); const token=safeText(b.fcmToken,4096); if(!token)return writeJson(res,400,{error:'FCM_TOKEN_REQUIRED'});
      mutate('nativePushTokens',a=>a.map(x=>x.id===found.row.id?{...x,fcmToken:token,updatedAt:now(),lastSeenAt:now()}:x)); return writeJson(res,200,{ok:true});
    }
    if(pathname==='/api/push/native/revoke'&&method==='POST'){
      const found=requireNativeUser(req,res); if(!found)return; mutate('nativePushTokens',a=>a.map(x=>x.id===found.row.id?{...x,revokedAt:now()}:x)); return writeJson(res,200,{ok:true});
    }
    if(pathname==='/api/push/native/revoke-all'&&method==='POST'){ mutate('nativePushTokens',a=>a.map(x=>x.userId===u.id&&!x.revokedAt?{...x,revokedAt:now()}:x)); return writeJson(res,200,{ok:true}); }
    if(pathname==='/api/push/subscribe'&&method==='POST'){ const b=await jsonBody(req); if(!b.subscription||!b.subscription.endpoint) return writeJson(res,400,{error:'BAD_SUBSCRIPTION'}); const sub={id:id('push'),userId:u.id,subscription:b.subscription,userAgent:safeText(req.headers['user-agent'],300),createdAt:now(),updatedAt:now()}; mutate('pushSubscriptions',a=>[sub,...a.filter(x=>!(x.userId===u.id&&x.subscription?.endpoint===b.subscription.endpoint))].slice(0,5000)); return writeJson(res,200,{ok:true,ready:true}); }
    if(pathname==='/api/push/unsubscribe'&&method==='POST'){ const b=await jsonBody(req); mutate('pushSubscriptions',a=>a.filter(x=>!(x.userId===u.id&&(!b.endpoint||x.subscription?.endpoint===b.endpoint)))); return writeJson(res,200,{ok:true}); }
    if(pathname==='/api/push/disable'&&method==='POST'){ mutate('pushSubscriptions',a=>a.filter(x=>x.userId!==u.id)); return writeJson(res,200,{ok:true}); }
    if(pathname==='/api/presence/ping'&&method==='POST'){ if(!u) return writeJson(res,401,{error:'AUTH_REQUIRED'}); touch(u); return writeJson(res,200,{ok:true,at:new Date().toISOString()}); }
    if(!u && !(pathname==='/api/calls/action'&&native)) return writeJson(res,401,{error:'AUTH_REQUIRED'});
    touch(u||native?.user);

    // Bootstrap
    if(pathname==='/api/bootstrap'&&method==='GET') {
      const people=dbRead('users').filter(x=>x.id!==u.id && !blocked(u.id,x.id)).slice(0,30).map(publicUser);
      const follows=dbRead('follows');
      const friends=dbRead('friendRequests').filter(x=>x.status==='accepted').filter(x=>x.from===u.id||x.to===u.id).map(x=>x.from===u.id?x.to:x.from);
      const visibleFeed=dbRead('posts').filter(x=>!x.deleted).filter(x=>x.visibility!=='private'||x.authorId===u.id||friends.includes(x.authorId)||follows.some(f=>f.from===u.id&&f.to===x.authorId)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||String(b.id).localeCompare(String(a.id)));
      const feedPage=visibleFeed.slice(0,12);
      const feedNextCursor=feedPage.length===12?encodeCursor(feedPage[feedPage.length-1]):null;
      const feedHasMore=visibleFeed.length>feedPage.length;
      const posts=feedPage.map(p=>serializePost(p,u));
      const stories=dbRead('stories').filter(x=>new Date(x.expiresAt)>Date.now()).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(s=>({...s,author:publicUser(userFromId(s.authorId))}));
      const notifications=dbRead('notifications').filter(x=>x.userId===u.id).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,25);
      const unreadMessages=dbRead('messages').filter(x=>x.to===u.id&&!x.readAt).length;
      return writeJson(res,200,{user:publicUser(u),counts:relCounts(u.id),people,posts,feed:{nextCursor:feedNextCursor,hasMore:feedHasMore},stories,notifications,unreadMessages,groups:dbRead('groups').slice(0,12),pages:dbRead('pages').slice(0,12),events:dbRead('events').slice(0,12),marketplace:dbRead('marketplace').slice(0,12)});
    }
    // Shareable deep links
    if(pathname==='/api/share/link'&&method==='GET') {
      const type=safeText(url.searchParams.get('type'),30);
      const targetId=safeText(url.searchParams.get('id'),120);
      if(!targetId || !['post','profile','group','page','story'].includes(type)) return writeJson(res,400,{error:'BAD_SHARE_TARGET'});
      let title='LUTSA Social', description='';
      if(type==='post'){
        const p=dbRead('posts').find(x=>x.id===targetId&&!x.deleted); if(!p)return writeJson(res,404,{error:'NOT_FOUND'});
        const friends=dbRead('friendRequests').filter(x=>x.status==='accepted'&&(x.from===u.id||x.to===u.id)).map(x=>x.from===u.id?x.to:x.from);
        const follows=dbRead('follows'); const visible=p.visibility==='public'||p.authorId===u.id||friends.includes(p.authorId)||follows.some(f=>f.from===u.id&&f.to===p.authorId);
        if(!visible)return writeJson(res,403,{error:'POST_PRIVATE'}); title=`منشور على LUTSA`; description=safeText(p.text,140);
      } else if(type==='profile'){ const x=userFromId(targetId); if(!x)return writeJson(res,404,{error:'NOT_FOUND'}); if(!canViewProfile(u,x))return writeJson(res,403,{error:'PROFILE_PRIVATE'}); title=x.displayName; description=x.bio||`@${x.username}`;
      } else if(type==='group'){ const g=dbRead('groups').find(x=>x.id===targetId); if(!g)return writeJson(res,404,{error:'NOT_FOUND'}); const member=dbRead('groupMembers').some(x=>x.groupId===g.id&&x.userId===u.id); if(g.privacy==='private'&&!member&&g.ownerId!==u.id)return writeJson(res,403,{error:'GROUP_PRIVATE'}); title=g.name; description=g.description||'مجموعة LUTSA';
      } else if(type==='page'){ const p=dbRead('pages').find(x=>x.id===targetId); if(!p)return writeJson(res,404,{error:'NOT_FOUND'}); title=p.name; description=p.description||p.category||'صفحة LUTSA';
      } else if(type==='story'){ const st=dbRead('stories').find(x=>x.id===targetId&&new Date(x.expiresAt)>Date.now()); if(!st)return writeJson(res,404,{error:'NOT_FOUND'}); title=`قصة ${userFromId(st.authorId)?.displayName||''}`; description=st.caption||'Story على LUTSA';
      }
      const proto=String(req.headers['x-forwarded-proto']||'http').split(',')[0].trim()||'http';
      const host=String(req.headers['x-forwarded-host']||req.headers.host||'localhost').split(',')[0].trim();
      const base=`${proto}://${host}`;
      const params=type==='post'?`page=post&postId=${encodeURIComponent(targetId)}`:type==='profile'?`page=profile&uid=${encodeURIComponent(targetId)}`:type==='group'?`page=group&gid=${encodeURIComponent(targetId)}`:type==='page'?`page=page&pid=${encodeURIComponent(targetId)}`:`page=stories&storyId=${encodeURIComponent(targetId)}`;
      return writeJson(res,200,{type,id:targetId,title,description,url:`${base}/?${params}`});
    }

    // Users / profile / search
    if(pathname==='/api/search'&&method==='GET') {
      const q=safeText(url.searchParams.get('q'),100).toLowerCase(); const type=url.searchParams.get('type')||'all';
      const match=(v='')=>String(v).toLowerCase().includes(q);
      const users=['all','people'].includes(type)?dbRead('users').filter(x=>(match(x.displayName)||match(x.username))&&x.id!==u.id&&!blocked(u.id,x.id)).slice(0,30).map(publicUser):[];
      const posts=['all','posts'].includes(type)?dbRead('posts').filter(p=>!p.deleted&&match(p.text)).slice(0,30).map(p=>serializePost(p,u)):[];
      const groups=['all','groups'].includes(type)?dbRead('groups').filter(g=>match(g.name)||match(g.description)).slice(0,20):[];
      const pages=['all','pages'].includes(type)?dbRead('pages').filter(g=>match(g.name)||match(g.description)).slice(0,20):[];
      const marketplace=['all','marketplace'].includes(type)?dbRead('marketplace').filter(x=>match(x.title)||match(x.description)||match(x.category)).slice(0,20).map(x=>({...x,seller:publicUser(userFromId(x.sellerId))})):[];
      const events=['all','events'].includes(type)?dbRead('events').filter(x=>match(x.title)||match(x.description)||match(x.location)).slice(0,20).map(x=>({...x,host:publicUser(userFromId(x.hostId))})):[];
      return writeJson(res,200,{users,posts,groups,pages,marketplace,events});
    }
    const prof=/^\/api\/users\/([^/]+)$/.exec(pathname);
    if(prof&&method==='GET') { const target=userFromId(prof[1]); if(!target) return writeJson(res,404,{error:'NOT_FOUND'}); const canView=canViewProfile(u,target); const rel=friendship(u.id,target.id); const posts=canView?dbRead('posts').filter(p=>p.authorId===target.id&&!p.deleted&&p.visibility!=='private').sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(p=>serializePost(p,u)):[]; return writeJson(res,200,{user:canView?publicUser(target):restrictedUser(target),counts:canView?relCounts(target.id):{followers:relCounts(target.id).followers,following:relCounts(target.id).following,friends:relCounts(target.id).friends,posts:0,media:0},relationship:rel,privateProfile:!canView,posts}); }
    if(pathname==='/api/users/profile'&&method==='PATCH') { const b=await jsonBody(req); mutate('users',a=>a.map(x=>x.id===u.id?{...x,displayName:safeText(b.displayName,80)||x.displayName,bio:safeText(b.bio,500),avatar:b.avatar??x.avatar,cover:b.cover??x.cover}:x)); return writeJson(res,200,{user:publicUser(userFromId(u.id))}); }
    if(pathname==='/api/users/follow'&&method==='POST') { const b=await jsonBody(req); const target=userFromId(b.userId); if(!target||target.id===u.id||blocked(u.id,target.id)) return writeJson(res,400,{error:'INVALID'}); const exists=dbRead('follows').some(x=>x.from===u.id&&x.to===target.id); if(exists) mutate('follows',a=>a.filter(x=>!(x.from===u.id&&x.to===target.id))); else {mutate('follows',a=>[...a,{id:id('follow'),from:u.id,to:target.id,createdAt:now()}]); notify(target.id,'follow','متابع جديد / New follower',`${u.displayName} بدأ بمتابعتك`,{userId:u.id});} return writeJson(res,200,{following:!exists}); }
    if(pathname==='/api/users/block'&&method==='POST') { const b=await jsonBody(req); const tid=b.userId; const exists=dbRead('blocks').some(x=>x.userId===u.id&&x.blockedUserId===tid); if(exists) mutate('blocks',a=>a.filter(x=>!(x.userId===u.id&&x.blockedUserId===tid))); else mutate('blocks',a=>[...a,{id:id('block'),userId:u.id,blockedUserId:tid,createdAt:now()}]); return writeJson(res,200,{blocked:!exists}); }

    // Friends
    if(pathname==='/api/friends/request'&&method==='POST') { const b=await jsonBody(req); const target=userFromId(b.userId); if(!target||target.id===u.id||blocked(u.id,target.id)) return writeJson(res,400,{error:'INVALID'}); const existing=dbRead('friendRequests').find(x=>((x.from===u.id&&x.to===target.id)||(x.from===target.id&&x.to===u.id))&&x.status!=='rejected'); if(existing) return writeJson(res,200,{request:existing}); const r={id:id('fr'),from:u.id,to:target.id,status:'pending',createdAt:now()}; mutate('friendRequests',a=>[r,...a]); notify(target.id,'friend','طلب صداقة / Friend request',`${u.displayName} أرسل طلب صداقة`,{requestId:r.id,userId:u.id}); return writeJson(res,200,{request:r}); }
    if(pathname==='/api/friends/action'&&method==='POST') { const b=await jsonBody(req); const r=dbRead('friendRequests').find(x=>x.id===b.requestId); if(!r||r.to!==u.id) return writeJson(res,404,{error:'NOT_FOUND'}); const status=b.action==='accept'?'accepted':b.action==='reject'?'rejected':'cancelled'; mutate('friendRequests',a=>a.map(x=>x.id===r.id?{...x,status,updatedAt:now()}:x)); notify(r.from,'friend',status==='accepted'?'تم قبول طلب الصداقة':'تم تحديث طلب الصداقة',`${u.displayName} ${status==='accepted'?'قبل طلب صداقتك':'تعامل مع طلب صداقتك'}`,{userId:u.id}); return writeJson(res,200,{ok:true,status}); }
    if(pathname==='/api/friends/list'&&method==='GET') { const rs=dbRead('friendRequests').filter(x=>x.status==='accepted'&&(x.from===u.id||x.to===u.id)); const friends=rs.map(x=>publicUser(userFromId(x.from===u.id?x.to:x.from))).filter(Boolean); const incoming=dbRead('friendRequests').filter(x=>x.to===u.id&&x.status==='pending').map(x=>({...x,fromUser:publicUser(userFromId(x.from))})); const accepted=dbRead('friendRequests').filter(r=>r.status==='accepted'); const myFriendIds=new Set(rs.map(r=>r.from===u.id?r.to:r.from)); const suggestions=dbRead('users').filter(x=>x.id!==u.id&&!blocked(u.id,x.id)&&!friends.some(f=>f.id===x.id)).slice(0,30).map(x=>{const xFriendIds=new Set(accepted.filter(r=>r.from===x.id||r.to===x.id).map(r=>r.from===x.id?r.to:r.from)); let mutual=0; for(const idv of myFriendIds) if(xFriendIds.has(idv)) mutual++; return {...publicUser(x),mutual};}).sort((a,b)=>b.mutual-a.mutual); return writeJson(res,200,{friends,incoming,suggestions}); }
    if(pathname==='/api/friends/remove'&&method==='POST') { const b=await jsonBody(req); mutate('friendRequests',a=>a.map(x=>((x.from===u.id&&x.to===b.userId)||(x.to===u.id&&x.from===b.userId))&&x.status==='accepted'?{...x,status:'removed',updatedAt:now()}:x)); return writeJson(res,200,{ok:true}); }

    // Posts
    if(pathname==='/api/posts'&&method==='GET') {
      const tab=url.searchParams.get('tab')||'home';
      const limit=clampLimit(url.searchParams.get('limit'),FEED_DEFAULT_LIMIT,FEED_MAX_LIMIT);
      const cursor=decodeCursor(url.searchParams.get('cursor'));
      let arr=dbRead('posts').filter(p=>!p.deleted);
      const follows=dbRead('follows'), friends=dbRead('friendRequests').filter(x=>x.status==='accepted').filter(x=>x.from===u.id||x.to===u.id).map(x=>x.from===u.id?x.to:x.from);
      if(tab==='video') arr=arr.filter(p=>p.media?.kind?.startsWith('video'));
      if(tab==='reels') arr=arr.filter(p=>p.isReel&&p.media?.kind?.startsWith('video'));
      if(tab==='home') arr=arr.filter(p=>p.visibility!=='private'||p.authorId===u.id||friends.includes(p.authorId)||follows.some(f=>f.from===u.id&&f.to===p.authorId));
      arr.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||String(b.id).localeCompare(String(a.id)));
      if(cursor) arr=arr.filter(item=>isBeforeCursor(item,cursor));
      const page=arr.slice(0,limit);
      return writeJson(res,200,{posts:page.map(p=>serializePost(p,u)),tab,nextCursor:page.length===limit?encodeCursor(page[page.length-1]):null,hasMore:arr.length>page.length});
    }
    if(pathname==='/api/posts'&&method==='POST') { const b=await jsonBody(req); const media=b.media&&b.media.path?b.media:null; if(!safeText(b.text,10000)&&!media) return writeJson(res,400,{error:'EMPTY_POST'}); const p={id:id('post'),authorId:u.id,text:safeText(b.text,10000),media,visibility:['public','friends','private'].includes(b.visibility)?b.visibility:'public',isReel:Boolean(b.isReel)&&Boolean(media?.kind?.startsWith('video')),createdAt:now(),updatedAt:now(),deleted:false,savedBy:[]}; mutate('posts',a=>[p,...a]); return writeJson(res,200,{post:serializePost(p,u)}); }
    const postId=/^\/api\/posts\/(?!saved$)([^/]+)$/.exec(pathname);
    if(postId&&method==='GET'){
      const p=dbRead('posts').find(x=>x.id===postId[1]&&!x.deleted);
      if(!p)return writeJson(res,404,{error:'NOT_FOUND'});
      const friends=dbRead('friendRequests').filter(x=>x.status==='accepted'&&(x.from===u.id||x.to===u.id)).map(x=>x.from===u.id?x.to:x.from);
      const follows=dbRead('follows');
      const visible=p.visibility==='public'||p.authorId===u.id||friends.includes(p.authorId)||follows.some(f=>f.from===u.id&&f.to===p.authorId);
      if(!visible)return writeJson(res,403,{error:'POST_PRIVATE'});
      return writeJson(res,200,{post:serializePost(p,u)});
    }
    if(postId&&method==='PATCH'){ const p=dbRead('posts').find(x=>x.id===postId[1]); if(!p||p.authorId!==u.id) return writeJson(res,403,{error:'FORBIDDEN'}); const b=await jsonBody(req); mutate('posts',a=>a.map(x=>x.id===p.id?{...x,text:safeText(b.text,10000),updatedAt:now()}:x)); return writeJson(res,200,{ok:true}); }
    if(postId&&method==='DELETE'){ const p=dbRead('posts').find(x=>x.id===postId[1]); if(!p||(p.authorId!==u.id&&u.role!=='admin')) return writeJson(res,403,{error:'FORBIDDEN'}); mutate('posts',a=>a.map(x=>x.id===p.id?{...x,deleted:true,deletedAt:now()}:x)); return writeJson(res,200,{ok:true}); }
    if(pathname==='/api/posts/react'&&method==='POST'){ const b=await jsonBody(req); const types=['like','love','care','haha','wow','sad','angry']; if(!types.includes(b.type)) return writeJson(res,400,{error:'BAD_REACTION'}); const existing=dbRead('reactions').find(x=>x.targetType==='post'&&x.targetId===b.postId&&x.userId===u.id); if(existing&&existing.type===b.type) mutate('reactions',a=>a.filter(x=>x.id!==existing.id)); else if(existing) mutate('reactions',a=>a.map(x=>x.id===existing.id?{...x,type:b.type,createdAt:now()}:x)); else mutate('reactions',a=>[{id:id('rx'),targetType:'post',targetId:b.postId,userId:u.id,type:b.type,createdAt:now()},...a]); const p=userFromId(dbRead('posts').find(x=>x.id===b.postId)?.authorId); if(p&&p.id!==u.id) notify(p.id,'reaction','تفاعل جديد','لديك تفاعل جديد على منشورك',{postId:b.postId}); return writeJson(res,200,{ok:true}); }
    if(pathname==='/api/posts/comment'&&method==='POST'){ const b=await jsonBody(req); if(!safeText(b.text,2000))return writeJson(res,400,{error:'EMPTY'}); const p=dbRead('posts').find(x=>x.id===b.postId&&!x.deleted); if(!p)return writeJson(res,404,{error:'NOT_FOUND'}); let parentId=null; if(b.parentId){const parent=dbRead('comments').find(x=>x.id===b.parentId&&x.postId===p.id&&!x.deleted); if(!parent)return writeJson(res,400,{error:'BAD_PARENT'}); parentId=parent.id;} const c={id:id('comment'),postId:p.id,authorId:u.id,parentId,text:safeText(b.text,2000),createdAt:now(),updatedAt:now(),deleted:false}; mutate('comments',a=>[...a,c]); if(p.authorId!==u.id)notify(p.authorId,'comment',parentId?'رد جديد':'تعليق جديد',`${u.displayName} ${parentId?'رد على تعليقك':'علّق على منشورك'}`,{postId:p.id,commentId:c.id}); if(parentId){const parent=dbRead('comments').find(x=>x.id===parentId); if(parent&&parent.authorId!==u.id)notify(parent.authorId,'comment','رد جديد على تعليقك',`${u.displayName} رد على تعليقك`,{postId:p.id,commentId:c.id});} return writeJson(res,200,{comment:{...c,author:publicUser(u),replies:[]}}); }
    const commentDeletePath=/^\/api\/posts\/comment\/([^/]+)$/.exec(pathname); if(commentDeletePath&&method==='DELETE'){const c=dbRead('comments').find(x=>x.id===commentDeletePath[1]); if(!c|| (c.authorId!==u.id&&u.role!=='admin'))return writeJson(res,403,{error:'FORBIDDEN'}); mutate('comments',a=>a.map(x=>x.id===c.id?{...x,deleted:true,deletedAt:now()}:x)); return writeJson(res,200,{ok:true}); }
    if(pathname==='/api/posts/share'&&method==='POST'){ const b=await jsonBody(req); const original=dbRead('posts').find(x=>x.id===b.postId); if(!original) return writeJson(res,404,{error:'NOT_FOUND'}); const p={id:id('post'),authorId:u.id,text:safeText(b.comment,5000),sharedPostId:original.id,media:null,createdAt:now(),updatedAt:now(),deleted:false}; mutate('posts',a=>[p,...a]); if(original.authorId!==u.id) notify(original.authorId,'share','مشاركة جديدة','تمت مشاركة منشورك',{postId:original.id}); return writeJson(res,200,{post:serializePost(p,u)}); }
    if(pathname==='/api/posts/save'&&method==='POST'){ const b=await jsonBody(req); const p=dbRead('posts').find(x=>x.id===b.postId); if(!p) return writeJson(res,404,{error:'NOT_FOUND'}); const saved=p.savedBy||[]; const has=saved.includes(u.id); mutate('posts',a=>a.map(x=>x.id===p.id?{...x,savedBy:has?saved.filter(idv=>idv!==u.id):[...saved,u.id]}:x)); return writeJson(res,200,{saved:!has}); }
    if(pathname==='/api/posts/saved'&&method==='GET'){ const arr=dbRead('posts').filter(p=>!p.deleted&&(p.savedBy||[]).includes(u.id)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,100); return writeJson(res,200,{posts:arr.map(p=>serializePost(p,u))}); }
    if(pathname==='/api/collections'&&method==='GET'){const cols=dbRead('collections').filter(c=>c.ownerId===u.id).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));const items=dbRead('collectionItems');return writeJson(res,200,{collections:cols.map(c=>({...c,count:items.filter(i=>i.collectionId===c.id).length}))});}
    if(pathname==='/api/collections'&&method==='POST'){const b=await jsonBody(req),name=safeText(b.name,80);if(name.length<1)return writeJson(res,400,{error:'NAME_REQUIRED'});if(dbRead('collections').some(c=>c.ownerId===u.id&&c.name.toLowerCase()===name.toLowerCase()))return writeJson(res,409,{error:'COLLECTION_EXISTS'});const c={id:id('col'),ownerId:u.id,name,createdAt:now()};mutate('collections',a=>[c,...a]);return writeJson(res,200,{collection:{...c,count:0}});}
    const collectionPath=/^\/api\/collections\/([^/]+)$/.exec(pathname); if(collectionPath&&method==='DELETE'){const c=dbRead('collections').find(x=>x.id===collectionPath[1]&&x.ownerId===u.id);if(!c)return writeJson(res,404,{error:'NOT_FOUND'});mutate('collectionItems',a=>a.filter(i=>i.collectionId!==c.id));mutate('collections',a=>a.filter(x=>x.id!==c.id));return writeJson(res,200,{ok:true});}
    if(pathname==='/api/collections/items'&&method==='POST'){const b=await jsonBody(req),c=dbRead('collections').find(x=>x.id===b.collectionId&&x.ownerId===u.id),p=dbRead('posts').find(x=>x.id===b.postId&&!x.deleted);if(!c||!p)return writeJson(res,404,{error:'NOT_FOUND'});const ex=dbRead('collectionItems').find(i=>i.collectionId===c.id&&i.postId===p.id);if(ex)mutate('collectionItems',a=>a.filter(i=>i.id!==ex.id));else mutate('collectionItems',a=>[{id:id('ci'),collectionId:c.id,postId:p.id,ownerId:u.id,createdAt:now()},...a]);return writeJson(res,200,{saved:!ex});}
    if(pathname==='/api/collections/items'&&method==='GET'){const cid=url.searchParams.get('collectionId'),c=dbRead('collections').find(x=>x.id===cid&&x.ownerId===u.id);if(!c)return writeJson(res,404,{error:'NOT_FOUND'});const ids=new Set(dbRead('collectionItems').filter(i=>i.collectionId===c.id).map(i=>i.postId));const posts=dbRead('posts').filter(p=>ids.has(p.id)&&!p.deleted).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(p=>serializePost(p,u));return writeJson(res,200,{collection:{...c,count:posts.length},posts});}
    if(pathname==='/api/posts/report'&&method==='POST'){ const b=await jsonBody(req); const r={id:id('rep'),type:'post',targetId:b.postId,reporterId:u.id,reason:safeText(b.reason,500),status:'open',createdAt:now()}; mutate('reports',a=>[r,...a]); return writeJson(res,200,{ok:true}); }

    // Media center: validated uploads with JSON ownership metadata.
    if(pathname==='/api/media'&&method==='GET'){ const items=dbRead('media').filter(x=>x.ownerId===u.id).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,200); return writeJson(res,200,{items}); }
    const mediaPath=/^\/api\/media\/([^/]+)$/.exec(pathname);
    if(mediaPath&&method==='DELETE'){ const item=dbRead('media').find(x=>x.id===mediaPath[1]); if(!item)return writeJson(res,404,{error:'NOT_FOUND'}); if(!mediaOwnerAllowed(u.id,item)&&u.role!=='admin')return writeJson(res,403,{error:'FORBIDDEN'}); try{fs.unlinkSync(path.join(PUBLIC,item.path.replace(/^\//,'')))}catch{}; mutate('media',a=>a.filter(x=>x.id!==item.id)); if(u.role==='admin')logAdmin(u.id,'media.delete',item.id); return writeJson(res,200,{ok:true}); }
    if(pathname==='/api/media'&&method==='POST'){ const b=await jsonBody(req); const data=String(b.data||''); const m=/^data:([^;]+);base64,(.+)$/.exec(data); if(!m) return writeJson(res,400,{error:'BAD_DATA'}); const mime=String(m[1]).toLowerCase(); if(!allowedMediaMime(mime)) return writeJson(res,415,{error:'UNSUPPORTED_MEDIA_TYPE'}); const bytes=Buffer.from(m[2],'base64'); const limit=mediaLimit(mime); if(bytes.length>limit) return writeJson(res,413,{error:'FILE_TOO_LARGE',limit}); const ext=({ 'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif','image/avif':'avif','video/mp4':'mp4','video/webm':'webm','video/quicktime':'mov','audio/webm':'webm','audio/ogg':'ogg','audio/mpeg':'mp3','audio/wav':'wav','application/pdf':'pdf','application/zip':'zip'}[mime]||'bin'); const safeName=scrubFileName(b.name||'file'); const idv=id('media'); const fileName=idv+'.'+ext; fs.writeFileSync(path.join(UPLOADS,fileName),bytes); const item={id:idv,ownerId:u.id,path:'/uploads/'+fileName,mime,kind:mediaKind(mime),size:bytes.length,name:safeName,createdAt:now()}; mutate('media',a=>[item,...a].slice(0,10000)); return writeJson(res,200,{path:item.path,mime,size:bytes.length,kind:item.kind,id:item.id,name:safeName}); }

    // Stories
    if(pathname==='/api/stories'&&method==='GET'){ const stories=dbRead('stories').filter(s=>new Date(s.expiresAt)>Date.now()).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)); return writeJson(res,200,{stories:stories.map(st=>{const views=dbRead('storyViews').filter(v=>v.storyId===st.id); const reactions=dbRead('storyReactions').filter(r=>r.storyId===st.id); return {...st,author:publicUser(userFromId(st.authorId)),viewsCount:views.length,viewedByMe:views.some(v=>v.userId===u.id),reactionSummary:reactions.reduce((m,x)=>(m[x.type]=(m[x.type]||0)+1,m),{}),myReaction:reactions.find(r=>r.userId===u.id)?.type||null};})}); }
    if(pathname==='/api/stories'&&method==='POST'){ const b=await jsonBody(req); if(!b.media) return writeJson(res,400,{error:'MEDIA_REQUIRED'}); const s={id:id('story'),authorId:u.id,caption:safeText(b.caption,500),media:b.media,createdAt:now(),expiresAt:new Date(Date.now()+24*3600*1000).toISOString()}; mutate('stories',a=>[s,...a]); return writeJson(res,200,{story:{...s,author:publicUser(u),viewsCount:0,viewedByMe:true}}); }
    if(pathname==='/api/stories/view'&&method==='POST'){ const b=await jsonBody(req); const st=dbRead('stories').find(x=>x.id===b.storyId&&new Date(x.expiresAt)>Date.now()); if(!st)return writeJson(res,404,{error:'NOT_FOUND'}); if(!dbRead('storyViews').some(v=>v.storyId===st.id&&v.userId===u.id))mutate('storyViews',a=>[{id:id('sv'),storyId:st.id,userId:u.id,createdAt:now()},...a]); return writeJson(res,200,{ok:true}); }
    if(pathname==='/api/stories/react'&&method==='POST'){ const b=await jsonBody(req); const types=['like','love','haha','wow','sad','angry']; if(!types.includes(b.type))return writeJson(res,400,{error:'BAD_REACTION'}); const st=dbRead('stories').find(x=>x.id===b.storyId&&new Date(x.expiresAt)>Date.now()); if(!st)return writeJson(res,404,{error:'NOT_FOUND'}); const ex=dbRead('storyReactions').find(r=>r.storyId===st.id&&r.userId===u.id); if(ex&&ex.type===b.type)mutate('storyReactions',a=>a.filter(r=>r.id!==ex.id)); else if(ex)mutate('storyReactions',a=>a.map(r=>r.id===ex.id?{...r,type:b.type,createdAt:now()}:r)); else mutate('storyReactions',a=>[{id:id('sr'),storyId:st.id,userId:u.id,type:b.type,createdAt:now()},...a]); if(st.authorId!==u.id)notify(st.authorId,'reaction','تفاعل مع قصتك',`${u.displayName} تفاعل مع قصتك`,{storyId:st.id}); return writeJson(res,200,{ok:true}); }

    // Messenger
    if(pathname==='/api/messenger'&&method==='GET'){
      const ms=dbRead('messages').filter(m=>m.from===u.id||m.to===u.id).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||String(b.id).localeCompare(String(a.id)));
      const map=new Map(), unread=new Map();
      for(const m of ms){const other=m.from===u.id?m.to:m.from;if(!map.has(other))map.set(other,m);if(m.to===u.id&&!m.readAt)unread.set(other,(unread.get(other)||0)+1);}
      const conversations=[...map.values()].slice(0,100).map(last=>{const other=last.from===u.id?last.to:last.from;const tt=typingState.get(other);return {user:publicUser(userFromId(other)),lastMessage:last,unread:unread.get(other)||0,isTyping:!!(tt&&tt.to===u.id&&Date.now()-tt.at<5000)}});
      return writeJson(res,200,{conversations});
    }
    if(pathname==='/api/messenger/search'&&method==='GET'){ const q=safeText(url.searchParams.get('q'),80).toLowerCase(); const users=dbRead('users').filter(x=>x.id!==u.id&&!x.disabled&&!blocked(u.id,x.id)&&((x.displayName||'').toLowerCase().includes(q)||(x.username||'').toLowerCase().includes(q))).slice(0,30).map(publicUser); return writeJson(res,200,{users}); }
    const convPath=/^\/api\/messenger\/([^/]+)$/.exec(pathname);
    if(convPath&&method==='GET'){
      const other=userFromId(convPath[1]);if(!other)return writeJson(res,404,{error:'NOT_FOUND'});
      const limit=clampLimit(url.searchParams.get('limit'),MESSAGES_DEFAULT_LIMIT,MESSAGES_MAX_LIMIT);
      const after=Number(url.searchParams.get('after')||0),before=decodeCursor(url.searchParams.get('before'));
      let messages=dbRead('messages').filter(m=>(m.from===u.id&&m.to===other.id)||(m.from===other.id&&m.to===u.id)).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||String(a.id).localeCompare(String(b.id)));
      const total=messages.length;
      if(after) messages=messages.filter(m=>new Date(m.createdAt).getTime()>after);
      if(before) messages=messages.filter(m=>isBeforeCursor(m,before));
      const page=messages.slice(-limit);
      const oldest=page[0]||null;
      if(u.privacy?.readReceipts!==false&&!after) mutate('messages',a=>a.map(m=>m.to===u.id&&m.from===other.id&&!m.readAt?{...m,readAt:now()}:m));
      return writeJson(res,200,{user:publicUser(other),messages:page.map(m=>serializeMessage(m,u.id,other.id)),nextBefore:oldest?encodeCursor(oldest):null,hasOlder:before?page.length===limit:total>page.length,serverTime:Date.now()});
    }
    if(pathname==='/api/messages/send'&&method==='POST'){ const b=await jsonBody(req); const target=userFromId(b.to); if(!canMessage(u,target)||target.disabled) return writeJson(res,403,{error:'MESSAGING_NOT_ALLOWED'}); if(!safeText(b.text,5000)&&!b.media&&!b.voice) return writeJson(res,400,{error:'EMPTY_MESSAGE'}); let replyTo=null; if(b.replyTo){const parent=dbRead('messages').find(x=>x.id===b.replyTo); if(!messageBelongsToPair(parent,u.id,target.id)) return writeJson(res,400,{error:'BAD_REPLY_TARGET'}); replyTo=parent.id;} const msg={id:id('msg'),from:u.id,to:target.id,text:safeText(b.text,5000),media:b.media||null,voice:b.voice||null,replyTo,createdAt:now(),readAt:null,deleted:false}; mutate('messages',a=>[...a,msg]); notify(target.id,'message','رسالة جديدة / New message',`${u.displayName}: ${msg.text||'مرفق جديد'}`,{fromUserId:u.id,conversationId:`${[u.id,target.id].sort().join('_')}`}); return writeJson(res,200,{message:serializeMessage(msg,u.id,target.id)}); }
    if(pathname==='/api/messages/edit'&&method==='POST'){ const b=await jsonBody(req); const m=dbRead('messages').find(x=>x.id===b.messageId); if(!m||m.from!==u.id||m.deleted) return writeJson(res,403,{error:'FORBIDDEN'}); if(Date.now()-new Date(m.createdAt).getTime()>15*60*1000) return writeJson(res,400,{error:'EDIT_WINDOW_EXPIRED'}); const text=safeText(b.text,5000); if(!text) return writeJson(res,400,{error:'EMPTY_MESSAGE'}); const editedAt=now(); mutate('messages',a=>a.map(x=>x.id===m.id?{...x,text,editedAt}:x)); const saved=dbRead('messages').find(x=>x.id===m.id); return writeJson(res,200,{message:serializeMessage(saved,u.id,m.to)}); }
    if(pathname==='/api/messages/delete'&&method==='POST'){ const b=await jsonBody(req); const m=dbRead('messages').find(x=>x.id===b.messageId); if(!m||m.from!==u.id) return writeJson(res,403,{error:'FORBIDDEN'}); mutate('messages',a=>a.map(x=>x.id===m.id?{...x,deleted:true,text:'',media:null,voice:null,deletedAt:now()}:x)); mutate('messageReactions',a=>a.filter(x=>x.messageId!==m.id)); return writeJson(res,200,{ok:true}); }
    if(pathname==='/api/messages/react'&&method==='POST'){ const b=await jsonBody(req); const m=dbRead('messages').find(x=>x.id===b.messageId); const targetId=m?.from===u.id?m?.to:m?.from; if(!m||!messageBelongsToPair(m,u.id,targetId)) return writeJson(res,404,{error:'NOT_FOUND'}); if(blocked(u.id,targetId)) return writeJson(res,403,{error:'BLOCKED'}); const types=['like','love','care','haha','wow','sad','angry']; if(!types.includes(b.type)) return writeJson(res,400,{error:'BAD_REACTION'}); const ex=dbRead('messageReactions').find(x=>x.messageId===m.id&&x.userId===u.id); if(ex&&ex.type===b.type) mutate('messageReactions',a=>a.filter(x=>x.id!==ex.id)); else if(ex) mutate('messageReactions',a=>a.map(x=>x.id===ex.id?{...x,type:b.type,createdAt:now()}:x)); else mutate('messageReactions',a=>[{id:id('mr'),messageId:m.id,userId:u.id,type:b.type,createdAt:now()},...a]); return writeJson(res,200,{ok:true}); }
    if(pathname==='/api/messages/typing'&&method==='POST'){ const b=await jsonBody(req); typingState.set(u.id,{to:b.to,at:Date.now()}); return writeJson(res,200,{ok:true}); }
    if(pathname==='/api/messages/typing'&&method==='GET'){ const target=url.searchParams.get('with'); const t=typingState.get(target); return writeJson(res,200,{typing:!!(t&&t.to===u.id&&Date.now()-t.at<5000)}); }

    // Notifications
    if(pathname==='/api/notifications'&&method==='GET'){ const n=dbRead('notifications').filter(x=>x.userId===u.id).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,100); return writeJson(res,200,{items:n,unread:n.filter(x=>!x.read).length}); }
    if(pathname==='/api/notifications/read'&&method==='POST'){ const b=await jsonBody(req); mutate('notifications',a=>a.map(x=>x.userId===u.id&&(b.all||x.id===b.id)?{...x,read:true}:x)); return writeJson(res,200,{ok:true}); }
    if(pathname==='/api/notifications/delete'&&method==='POST'){ const b=await jsonBody(req); if(b.all)mutate('notifications',a=>a.filter(x=>x.userId!==u.id)); else if(b.id)mutate('notifications',a=>a.filter(x=>!(x.userId===u.id&&x.id===b.id))); else return writeJson(res,400,{error:'BAD_REQUEST'}); return writeJson(res,200,{ok:true}); }

    // Settings
    if(pathname==='/api/settings'&&method==='GET') return writeJson(res,200,{privacy:{messageWho:u.privacy?.messageWho||'everyone',profile:u.privacy?.profile||'public',readReceipts:u.privacy?.readReceipts!==false,activityStatus:u.privacy?.activityStatus!==false},notifications:notificationPrefsFor(u)});
    if(pathname==='/api/settings'&&method==='PATCH'){
      const b=await jsonBody(req);
      const allowed={messageWho:['everyone','friends','nobody'],profile:['public','friends'],readReceipts:[true,false],activityStatus:[true,false]};
      const cur=u.privacy||{}; const p={...cur};
      for(const k of Object.keys(allowed)) if(allowed[k].includes(b[k])) p[k]=b[k];
      const allowedNotif=Object.keys(notificationDefaults()); const np={...notificationPrefsFor(u)};
      for(const k of allowedNotif) if(typeof b.notifications?.[k]==='boolean') np[k]=b.notifications[k];
      mutate('users',a=>a.map(x=>x.id===u.id?{...x,privacy:p,notificationPrefs:np}:x));
      return writeJson(res,200,{privacy:p,notifications:np});
    }
    if((pathname==='/api/sessions'||pathname==='/api/security/sessions')&&method==='GET') {
      const current=parseCookies(req)[COOKIE_NAME];
      const rows=dbRead('sessions').filter(x=>x.userId===u.id&&x.expiresAt>Date.now()).sort((a,b)=>b.createdAt-a.createdAt);
      return writeJson(res,200,{items:rows.map(x=>({sessionKey:sessionKey(x.token),createdAt:x.createdAt,expiresAt:x.expiresAt,userAgent:x.userAgent||'غير معروف',label:x.label||'',current:x.token===current}))});
    }
    if((pathname==='/api/sessions/revoke'||pathname==='/api/security/sessions/revoke')&&method==='POST') {
      const b=await jsonBody(req); const key=safeText(b.sessionKey,128); if(!key)return writeJson(res,400,{error:'SESSION_REQUIRED'});
      const rows=dbRead('sessions').filter(x=>x.userId===u.id); const target=rows.find(x=>sessionKey(x.token)===key); if(!target)return writeJson(res,404,{error:'SESSION_NOT_FOUND'});
      if(target.token===parseCookies(req)[COOKIE_NAME]) return writeJson(res,400,{error:'CURRENT_SESSION'});
      mutate('sessions',a=>a.filter(x=>x.token!==target.token)); return writeJson(res,200,{ok:true});
    }
    if(pathname==='/api/account/export'&&method==='GET') {
      const files={
        profile:publicUser(u),
        privacy:u.privacy||{}, notificationPrefs:notificationPrefsFor(u),
        posts:dbRead('posts').filter(x=>x.authorId===u.id), comments:dbRead('comments').filter(x=>x.authorId===u.id),
        reactions:dbRead('reactions').filter(x=>x.userId===u.id), stories:dbRead('stories').filter(x=>x.authorId===u.id),
        messages:dbRead('messages').filter(x=>x.from===u.id||x.to===u.id), notifications:dbRead('notifications').filter(x=>x.userId===u.id),
        friendRequests:dbRead('friendRequests').filter(x=>x.from===u.id||x.to===u.id), follows:dbRead('follows').filter(x=>x.from===u.id||x.to===u.id),
        blocks:dbRead('blocks').filter(x=>x.userId===u.id||x.blockedUserId===u.id), groups:dbRead('groups').filter(x=>x.ownerId===u.id),
        groupMemberships:dbRead('groupMembers').filter(x=>x.userId===u.id), pages:dbRead('pages').filter(x=>x.ownerId===u.id),
        pageFollows:dbRead('pageFollows').filter(x=>x.userId===u.id), marketplace:dbRead('marketplace').filter(x=>x.sellerId===u.id),
        events:dbRead('events').filter(x=>x.hostId===u.id), eventRsvps:dbRead('eventRsvps').filter(x=>x.userId===u.id),
        calls:dbRead('calls').filter(x=>x.from===u.id||x.to===u.id), media:dbRead('media').filter(x=>x.ownerId===u.id)
      };
      writeDownloadJson(res,`lutsa-my-data-${u.username}.json`,{format:'lutsa-user-export',version:APP_VERSION,createdAt:now(),data:files}); return;
    }
    if(pathname==='/api/password'&&method==='POST'){ const b=await jsonBody(req); if(!verifyPassword(String(b.current||''),u.passwordSalt,u.passwordHash)) return writeJson(res,400,{error:'BAD_CURRENT'}); if(String(b.newPassword||'').length<8) return writeJson(res,400,{error:'WEAK_PASSWORD'}); const hp=hashPassword(String(b.newPassword)); const current=parseCookies(req)[COOKIE_NAME]; mutate('users',a=>a.map(x=>x.id===u.id?{...x,passwordHash:hp.hash,passwordSalt:hp.salt}:x)); mutate('sessions',a=>a.filter(x=>x.userId!==u.id||x.token===current)); return writeJson(res,200,{ok:true,sessionsRevoked:true}); }
    if(pathname==='/api/sessions/revoke-all'&&method==='POST'){ const current=parseCookies(req)[COOKIE_NAME]; mutate('sessions',a=>a.filter(x=>x.userId!==u.id||x.token===current)); return writeJson(res,200,{ok:true}); }
    if(pathname==='/api/account/delete'&&method==='POST'){ const b=await jsonBody(req); if(!verifyPassword(String(b.password||''),u.passwordSalt,u.passwordHash)) return writeJson(res,400,{error:'BAD_PASSWORD'}); cleanupUserData(u.id); mutate('users',a=>a.filter(x=>x.id!==u.id)); return writeJson(res,200,{ok:true},{'Set-Cookie':cookie('',0,req)}); }

    // Groups / pages
    if(pathname==='/api/groups'&&method==='GET') return writeJson(res,200,{groups:dbRead('groups').map(g=>({...g,owner:publicUser(userFromId(g.ownerId)),members:dbRead('groupMembers').filter(m=>m.groupId===g.id).length,isMember:dbRead('groupMembers').some(m=>m.groupId===g.id&&m.userId===u.id)}))});
    if(pathname==='/api/groups'&&method==='POST'){ const b=await jsonBody(req); const name=safeText(b.name,100); if(name.length<2)return writeJson(res,400,{error:'NAME_REQUIRED'}); const g={id:id('grp'),ownerId:u.id,name,description:safeText(b.description,500),cover:b.cover||'',privacy:b.privacy==='private'?'private':'public',createdAt:now()}; mutate('groups',a=>[g,...a]); mutate('groupMembers',a=>[...a,{id:id('gm'),groupId:g.id,userId:u.id,role:'owner',createdAt:now()}]); return writeJson(res,200,{group:g}); }
    const groupPath=/^\/api\/groups\/([^/]+)$/.exec(pathname);
    if(groupPath&&method==='GET'){ const g=dbRead('groups').find(x=>x.id===groupPath[1]); if(!g)return writeJson(res,404,{error:'NOT_FOUND'}); const members=dbRead('groupMembers').filter(m=>m.groupId===g.id).map(m=>({...m,user:publicUser(userFromId(m.userId))})); const posts=dbRead('groupPosts').filter(p=>p.groupId===g.id&&!p.deleted).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,50).map(p=>serializePost(p,u)); return writeJson(res,200,{group:{...g,owner:publicUser(userFromId(g.ownerId)),members:members.length,isMember:members.some(m=>m.userId===u.id)},members,posts}); }
    if(pathname==='/api/groups/post'&&method==='POST'){ const b=await jsonBody(req); const g=dbRead('groups').find(x=>x.id===b.groupId); if(!g)return writeJson(res,404,{error:'NOT_FOUND'}); const isMember=dbRead('groupMembers').some(m=>m.groupId===g.id&&m.userId===u.id); if(!isMember)return writeJson(res,403,{error:'GROUP_MEMBER_REQUIRED'}); const media=b.media&&b.media.path?b.media:null; if(!safeText(b.text,5000)&&!media)return writeJson(res,400,{error:'EMPTY'}); const p={id:id('gpost'),groupId:g.id,authorId:u.id,text:safeText(b.text,5000),media,visibility:'public',createdAt:now(),updatedAt:now(),deleted:false,savedBy:[]}; mutate('groupPosts',a=>[p,...a]); return writeJson(res,200,{post:serializePost(p,u)}); }
    if(pathname==='/api/groups/join'&&method==='POST'){ const b=await jsonBody(req); const g=dbRead('groups').find(x=>x.id===b.groupId); if(!g) return writeJson(res,404,{error:'NOT_FOUND'}); const exists=dbRead('groupMembers').some(x=>x.groupId===g.id&&x.userId===u.id); if(!exists) {mutate('groupMembers',a=>[...a,{id:id('gm'),groupId:g.id,userId:u.id,role:'member',createdAt:now()}]); notify(g.ownerId,'group','عضو جديد','انضم مستخدم جديد إلى مجموعتك',{groupId:g.id,userId:u.id});} return writeJson(res,200,{joined:true}); }
    if(pathname==='/api/groups/leave'&&method==='POST'){ const b=await jsonBody(req); const gm=dbRead('groupMembers').find(x=>x.groupId===b.groupId&&x.userId===u.id); if(!gm)return writeJson(res,200,{joined:false}); if(gm.role==='owner')return writeJson(res,400,{error:'OWNER_CANNOT_LEAVE'}); mutate('groupMembers',a=>a.filter(x=>x!==gm)); return writeJson(res,200,{joined:false}); }

    if(pathname==='/api/pages'&&method==='GET') return writeJson(res,200,{pages:dbRead('pages').map(p=>({...p,owner:publicUser(userFromId(p.ownerId)),followers:dbRead('pageFollows').filter(m=>m.pageId===p.id).length,following:dbRead('pageFollows').some(m=>m.pageId===p.id&&m.userId===u.id)}))});
    if(pathname==='/api/pages'&&method==='POST'){ const b=await jsonBody(req); const name=safeText(b.name,100); if(name.length<2)return writeJson(res,400,{error:'NAME_REQUIRED'}); const p={id:id('page'),ownerId:u.id,name,description:safeText(b.description,500),avatar:b.avatar||'',cover:b.cover||'',category:safeText(b.category,60)||'عام',createdAt:now()}; mutate('pages',a=>[p,...a]); mutate('pageFollows',a=>[...a,{id:id('pf'),pageId:p.id,userId:u.id,createdAt:now()}]); return writeJson(res,200,{page:p}); }
    const pagePath=/^\/api\/pages\/([^/]+)$/.exec(pathname);
    if(pagePath&&method==='GET'){ const p=dbRead('pages').find(x=>x.id===pagePath[1]); if(!p)return writeJson(res,404,{error:'NOT_FOUND'}); const posts=dbRead('pagePosts').filter(x=>x.pageId===p.id&&!x.deleted).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,50).map(x=>serializePost(x,u)); return writeJson(res,200,{page:{...p,owner:publicUser(userFromId(p.ownerId)),followers:dbRead('pageFollows').filter(m=>m.pageId===p.id).length,following:dbRead('pageFollows').some(m=>m.pageId===p.id&&m.userId===u.id)},posts}); }
    if(pathname==='/api/pages/post'&&method==='POST'){ const b=await jsonBody(req); const p=dbRead('pages').find(x=>x.id===b.pageId); if(!p)return writeJson(res,404,{error:'NOT_FOUND'}); if(p.ownerId!==u.id)return writeJson(res,403,{error:'PAGE_OWNER_REQUIRED'}); const media=b.media&&b.media.path?b.media:null; if(!safeText(b.text,5000)&&!media)return writeJson(res,400,{error:'EMPTY'}); const post={id:id('ppost'),pageId:p.id,authorId:u.id,text:safeText(b.text,5000),media,visibility:'public',createdAt:now(),updatedAt:now(),deleted:false,savedBy:[]}; mutate('pagePosts',a=>[post,...a]); return writeJson(res,200,{post:serializePost(post,u)}); }
    if(pathname==='/api/pages/follow'&&method==='POST'){ const b=await jsonBody(req); const p=dbRead('pages').find(x=>x.id===b.pageId); if(!p)return writeJson(res,404,{error:'NOT_FOUND'}); const ex=dbRead('pageFollows').some(x=>x.pageId===p.id&&x.userId===u.id); if(ex) mutate('pageFollows',a=>a.filter(x=>!(x.pageId===p.id&&x.userId===u.id))); else {mutate('pageFollows',a=>[...a,{id:id('pf'),pageId:p.id,userId:u.id,createdAt:now()}]); if(p.ownerId!==u.id)notify(p.ownerId,'page','متابع جديد',`${u.displayName} بدأ بمتابعة صفحتك`,{pageId:p.id,userId:u.id});} return writeJson(res,200,{following:!ex}); }

    // Marketplace
    if(pathname==='/api/marketplace'&&method==='GET'){ const q=safeText(url.searchParams.get('q'),100).toLowerCase(); const cat=safeText(url.searchParams.get('category'),60); const sort=url.searchParams.get('sort')||'newest'; let a=dbRead('marketplace').filter(x=>!q||[x.title,x.description,x.category,x.location].join(' ').toLowerCase().includes(q)).filter(x=>!cat||x.category===cat); a.sort((x,y)=>sort==='price_asc'?(Number(x.price)||0)-(Number(y.price)||0):sort==='price_desc'?(Number(y.price)||0)-(Number(x.price)||0):y.createdAt.localeCompare(x.createdAt)); return writeJson(res,200,{items:a.slice(0,100).map(x=>({...x,seller:publicUser(userFromId(x.sellerId))}))}); }
    if(pathname==='/api/marketplace'&&method==='POST'){ const b=await jsonBody(req); const title=safeText(b.title,120); if(title.length<2)return writeJson(res,400,{error:'TITLE_REQUIRED'}); const item={id:id('mkt'),sellerId:u.id,title,description:safeText(b.description,1000),price:safeText(b.price,50),category:safeText(b.category,60)||'other',location:safeText(b.location,120),media:b.media||null,createdAt:now()}; mutate('marketplace',a=>[item,...a]); return writeJson(res,200,{item:{...item,seller:publicUser(u)}}); }
    if(pathname==='/api/marketplace/delete'&&method==='POST'){const b=await jsonBody(req);const item=dbRead('marketplace').find(x=>x.id===b.itemId);if(!item)return writeJson(res,404,{error:'NOT_FOUND'});if(item.sellerId!==u.id&&u.role!=='admin')return writeJson(res,403,{error:'FORBIDDEN'});mutate('marketplace',a=>a.filter(x=>x.id!==item.id));return writeJson(res,200,{ok:true});}

    // Events
    if(pathname==='/api/events'&&method==='GET') return writeJson(res,200,{events:dbRead('events').sort((a,b)=>a.date.localeCompare(b.date)).slice(0,100).map(e=>({...e,host:publicUser(userFromId(e.hostId)),counts:{going:dbRead('eventRsvps').filter(r=>r.eventId===e.id&&r.status==='going').length,interested:dbRead('eventRsvps').filter(r=>r.eventId===e.id&&r.status==='interested').length},myStatus:dbRead('eventRsvps').find(r=>r.eventId===e.id&&r.userId===u.id)?.status||null}))});
    if(pathname==='/api/events'&&method==='POST'){ const b=await jsonBody(req); const title=safeText(b.title,120); if(title.length<2||!b.date)return writeJson(res,400,{error:'EVENT_REQUIRED'}); const e={id:id('evt'),hostId:u.id,title,description:safeText(b.description,1000),date:b.date,location:safeText(b.location,200),cover:b.cover||'',privacy:b.privacy==='private'?'private':'public',createdAt:now()}; mutate('events',a=>[e,...a]); return writeJson(res,200,{event:{...e,host:publicUser(u)}}); }
    if(pathname==='/api/events/rsvp'&&method==='POST'){ const b=await jsonBody(req); if(!['going','interested','none'].includes(b.status)) return writeJson(res,400,{error:'BAD_STATUS'}); const ev=dbRead('events').find(x=>x.id===b.eventId); if(!ev)return writeJson(res,404,{error:'NOT_FOUND'}); const ex=dbRead('eventRsvps').find(x=>x.eventId===b.eventId&&x.userId===u.id); if(b.status==='none') {if(ex)mutate('eventRsvps',a=>a.filter(x=>x!==ex));} else if(ex) mutate('eventRsvps',a=>a.map(x=>x===ex?{...x,status:b.status,updatedAt:now()}:x)); else mutate('eventRsvps',a=>[...a,{id:id('rsvp'),eventId:b.eventId,userId:u.id,status:b.status,createdAt:now()}]); if(ev.hostId!==u.id&&b.status!=='none')notify(ev.hostId,'event','تفاعل مع الحدث',`${u.displayName} اختار ${b.status==='going'?'سأحضر':'مهتم'} بحدثك`,{eventId:ev.id,userId:u.id}); return writeJson(res,200,{status:b.status}); }
    if(pathname==='/api/events/delete'&&method==='POST'){const b=await jsonBody(req);const ev=dbRead('events').find(x=>x.id===b.eventId);if(!ev)return writeJson(res,404,{error:'NOT_FOUND'});if(ev.hostId!==u.id&&u.role!=='admin')return writeJson(res,403,{error:'FORBIDDEN'});mutate('events',a=>a.filter(x=>x.id!==ev.id));mutate('eventRsvps',a=>a.filter(x=>x.eventId!==ev.id));return writeJson(res,200,{ok:true});}

    // Memories
    if(pathname==='/api/memories'&&method==='GET'){
      const d=new Date(); const mm=String(d.getUTCMonth()+1).padStart(2,'0'), dd=String(d.getUTCDate()).padStart(2,'0');
      const items=dbRead('posts').filter(p=>p.authorId===u.id&&!p.deleted&&p.createdAt.slice(5,10)===`${mm}-${dd}`&&Date.now()-new Date(p.createdAt).getTime()>24*3600*1000).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
      return writeJson(res,200,{items:items.slice(0,50).map(p=>serializePost(p,u))});
    }

    // Calls: signaling is stored in JSON, media travels peer-to-peer through WebRTC.
    if(pathname==='/api/calls/start'&&method==='POST'){
      const b=await jsonBody(req);
      const target=userFromId(b.to);
      if(!target||target.id===u.id||target.disabled||blocked(u.id,target.id)) return writeJson(res,400,{error:'INVALID'});
      const busy=dbRead('calls').some(x=>(x.from===u.id||x.to===u.id)&&(x.status==='ringing'||x.status==='accepted'));
      if(busy) return writeJson(res,409,{error:'CALL_BUSY'});
      const c={id:id('call'),from:u.id,to:target.id,type:b.type==='audio'?'audio':'video',status:'ringing',createdAt:now(),acceptedAt:null,endedAt:null};
      mutate('calls',a=>[c,...a]);
      const cutoff=Date.now()-10*60*1000;
      mutate('callSignals',a=>a.filter(x=>new Date(x.createdAt).getTime()>cutoff));
      notify(target.id,'call','مكالمة واردة / Incoming call',`${u.displayName} يتصل بك`,{callId:c.id,type:c.type,callerName:u.displayName,fromUserId:u.id,url:`/?callAction=open&callId=${encodeURIComponent(c.id)}`});
      return writeJson(res,200,{call:c});
    }
    if(pathname==='/api/calls/action'&&method==='POST'){ const b=await jsonBody(req); const actor=u||native?.user; const c=dbRead('calls').find(x=>x.id===b.callId); if(!actor)return writeJson(res,401,{error:'AUTH_REQUIRED'}); if(!c||![c.from,c.to].includes(actor.id)) return writeJson(res,404,{error:'NOT_FOUND'}); if(['ended','rejected','missed'].includes(c.status)&&['accept','reject'].includes(b.action)) return writeJson(res,409,{error:'CALL_NO_LONGER_ACTIVE'}); let status=c.status; if(b.action==='accept'&&c.status==='ringing')status='accepted'; else if(b.action==='reject'&&c.status==='ringing')status='rejected'; else if(b.action==='end'&&(c.status==='ringing'||c.status==='accepted'))status='ended'; else if(b.action==='missed'&&c.status==='ringing')status='missed'; else return writeJson(res,400,{error:'BAD_CALL_ACTION'}); mutate('calls',a=>a.map(x=>x.id===c.id?{...x,status,acceptedAt:status==='accepted'?now():x.acceptedAt,endedAt:['ended','rejected','missed'].includes(status)?now():x.endedAt}:x)); if(status==='accepted'&&c.from!==actor.id) notify(c.from,'call','تم قبول المكالمة','تم قبول مكالمتك',{callId:c.id}); if(status==='rejected'&&c.from!==actor.id) notify(c.from,'call','مكالمة مرفوضة','تم رفض المكالمة',{callId:c.id}); if(status==='missed'&&c.from!==actor.id) notify(c.from,'call','مكالمة فائتة','لم يتم الرد على مكالمتك',{callId:c.id}); return writeJson(res,200,{status}); }
    if(pathname==='/api/calls/poll'&&method==='GET'){
      const after=Number(url.searchParams.get('after')||0);
      const calls=dbRead('calls').filter(c=>{
        if(c.from!==u.id&&c.to!==u.id) return false;
        const active=c.status==='ringing'||c.status==='accepted';
        return active || new Date(c.createdAt).getTime()>=after;
      }).sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
      return writeJson(res,200,{calls,serverTime:Date.now()});
    }
    if(pathname==='/api/calls/quality'&&method==='POST'){ const b=await jsonBody(req); const c=dbRead('calls').find(x=>x.id===b.callId); if(!c||![c.from,c.to].includes(u.id)) return writeJson(res,404,{error:'NOT_FOUND'}); const q={id:id('cq'),callId:c.id,userId:u.id,at:now(),rttMs:Number(b.rttMs)||0,packetsLost:Number(b.packetsLost)||0,packetsReceived:Number(b.packetsReceived)||0,jitterMs:Number(b.jitterMs)||0,bitrateKbps:Number(b.bitrateKbps)||0,score:Math.max(0,Math.min(100,Number(b.score)||0))}; mutate('callQuality',a=>[q,...a].slice(0,5000)); return writeJson(res,200,{ok:true}); }
    if(pathname==='/api/calls/history'&&method==='GET'){ return writeJson(res,200,{items:dbRead('calls').filter(c=>c.from===u.id||c.to===u.id).sort((a,b)=>(b.endedAt||b.createdAt).localeCompare(a.endedAt||a.createdAt)).slice(0,100).map(c=>({...c,other:publicUser(userFromId(c.from===u.id?c.to:c.from)),quality:dbRead('callQuality').filter(q=>q.callId===c.id).sort((a,b)=>b.at.localeCompare(a.at))[0]||null}))}); }
    if(pathname==='/api/calls/signal'&&method==='POST'){
      const b=await jsonBody(req);
      if(!b.callId||!b.payload||typeof b.payload.kind!=='string') return writeJson(res,400,{error:'BAD_SIGNAL'});
      const c=dbRead('calls').find(x=>x.id===b.callId);
      if(!c) return writeJson(res,404,{error:'CALL_NOT_FOUND'});
      if(![c.from,c.to].includes(u.id)) return writeJson(res,403,{error:'FORBIDDEN'});
      if(['ended','rejected','missed'].includes(c.status)) return writeJson(res,409,{error:'CALL_NOT_ACTIVE'});
      const s={id:id('sig'),callId:c.id,from:u.id,to:u.id===c.from?c.to:c.from,payload:b.payload,createdAt:now(),seen:false};
      mutate('callSignals',a=>[s,...a].slice(0,10000));
      return writeJson(res,200,{ok:true,signalId:s.id});
    }
    if(pathname==='/api/calls/signals'&&method==='GET'){
      const cid=url.searchParams.get('callId');
      if(!cid) return writeJson(res,400,{error:'CALL_ID_REQUIRED'});
      const c=dbRead('calls').find(x=>x.id===cid);
      if(!c) return writeJson(res,404,{error:'CALL_NOT_FOUND'});
      if(![c.from,c.to].includes(u.id)) return writeJson(res,403,{error:'FORBIDDEN'});
      const items=dbRead('callSignals').filter(s=>s.callId===cid&&s.to===u.id&&!s.seen).sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
      return writeJson(res,200,{items});
    }
    if(pathname==='/api/calls/signals/ack'&&method==='POST'){
      const b=await jsonBody(req);
      const ids=Array.isArray(b.ids)?b.ids.filter(Boolean).map(String).slice(0,200):[];
      if(!ids.length) return writeJson(res,200,{ok:true,acked:0});
      const set=new Set(ids);
      const own=dbRead('callSignals').filter(x=>set.has(x.id)&&x.to===u.id);
      if(own.length) mutate('callSignals',a=>a.map(x=>set.has(x.id)&&x.to===u.id?{...x,seen:true,seenAt:now()}:x));
      return writeJson(res,200,{ok:true,acked:own.length});
    }

    // Live broadcast (host <-> viewers signaling via stream.json + streamSignals.json)
    if(pathname==='/api/stream'&&method==='GET'){ let s=normalizeLiveStream(dbRead('stream')[0]||null); if(s && JSON.stringify(s)!==JSON.stringify(dbRead('stream')[0]||null)) dbWrite('stream',[s]); return writeJson(res,200,{stream:s}); }
    if(pathname==='/api/stream/start'&&method==='POST'){ const existing=normalizeLiveStream(dbRead('stream')[0]||null); if(existing&&existing.status==='live') return writeJson(res,409,{error:'STREAM_ACTIVE'}); const b=await jsonBody(req); const ts=now(); const s={id:id('stream'),hostId:u.id,title:safeText(b.title,120)||`${u.displayName} Live`,status:'live',startedAt:ts,heartbeatAt:ts,endedAt:null,viewerIds:[],viewerSeen:{[u.id]:Date.now()}}; dbWrite('stream',[s]); return writeJson(res,200,{stream:s}); }
    if(pathname==='/api/stream/end'&&method==='POST'){ const s=dbRead('stream')[0]; if(!s||s.hostId!==u.id) return writeJson(res,403,{error:'FORBIDDEN'}); s.status='ended'; s.endedAt=now(); s.viewerIds=[]; s.viewerSeen={}; dbWrite('stream',[s]); mutate('streamSignals',a=>a.filter(x=>x.streamId!==s.id)); return writeJson(res,200,{stream:s}); }
    if(pathname==='/api/stream/join'&&method==='POST'){ const s=normalizeLiveStream(dbRead('stream')[0]||null); if(!s||s.status!=='live') return writeJson(res,404,{error:'NO_STREAM'}); s.viewerSeen=s.viewerSeen||{}; if(!s.viewerIds.includes(u.id)) s.viewerIds.push(u.id); s.viewerSeen[u.id]=Date.now(); dbWrite('stream',[s]); return writeJson(res,200,{stream:s}); }
    if(pathname==='/api/stream/leave'&&method==='POST'){ const s=dbRead('stream')[0]; if(s){s.viewerIds=s.viewerIds.filter(x=>x!==u.id); if(s.viewerSeen) delete s.viewerSeen[u.id]; dbWrite('stream',[s]);} return writeJson(res,200,{ok:true}); }
    if(pathname==='/api/stream/heartbeat'&&method==='POST'){ const s=normalizeLiveStream(dbRead('stream')[0]||null); if(!s||s.status!=='live'||![s.hostId,...s.viewerIds].includes(u.id)) return writeJson(res,404,{error:'NO_STREAM'}); s.heartbeatAt=now(); s.viewerSeen=s.viewerSeen||{}; s.viewerSeen[u.id]=Date.now(); if(!s.viewerIds.includes(u.id)&&u.id!==s.hostId)s.viewerIds.push(u.id); dbWrite('stream',[s]); return writeJson(res,200,{ok:true,stream:s}); }
    if(pathname==='/api/stream/signal'&&method==='POST'){ const b=await jsonBody(req); const s=dbRead('stream')[0]; if(!s||s.id!==b.streamId||(![s.hostId,...s.viewerIds].includes(u.id))) return writeJson(res,403,{error:'FORBIDDEN'}); const to=b.to||s.hostId; const x={id:id('ss'),streamId:s.id,from:u.id,to,payload:b.payload,createdAt:now(),seen:false}; mutate('streamSignals',a=>[x,...a]); return writeJson(res,200,{ok:true}); }
    if(pathname==='/api/stream/signals'&&method==='GET'){ const sid=url.searchParams.get('streamId'); const items=dbRead('streamSignals').filter(x=>x.streamId===sid&&x.to===u.id&&!x.seen).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)); if(items.length) mutate('streamSignals',a=>a.map(x=>items.some(i=>i.id===x.id)?{...x,seen:true}:x)); return writeJson(res,200,{items}); }

    // Admin
    if(pathname.startsWith('/api/admin/')){
      if(u.role!=='admin') return writeJson(res,403,{error:'ADMIN_REQUIRED'});

      if(pathname==='/api/admin/media'&&method==='GET'){
        const files=new Set();
        const items=dbRead('media').map(x=>{try{const st=fs.statSync(path.join(PUBLIC,x.path.replace(/^\//,''))); files.add(path.basename(x.path)); return {...x,exists:true,bytes:st.size};}catch{return {...x,exists:false,bytes:0};}});
        return writeJson(res,200,{items:items.slice(0,500),orphanCount:[...fs.readdirSync(UPLOADS).filter(n=>!files.has(n))].length});
      }
      if(pathname==='/api/admin/media/orphans'&&method==='POST'){
        const keep=new Set(dbRead('media').map(x=>path.basename(x.path)));
        let removed=0; for(const name of fs.readdirSync(UPLOADS)){if(keep.has(name))continue; try{fs.unlinkSync(path.join(UPLOADS,name));removed++;}catch{}}
        logAdmin(u.id,'media.cleanup',null,{removed}); return writeJson(res,200,{ok:true,removed});
      }
      if(pathname==='/api/admin/media/delete'&&method==='POST'){
        const b=await jsonBody(req); const item=dbRead('media').find(x=>x.id===b.mediaId); if(!item)return writeJson(res,404,{error:'NOT_FOUND'}); try{fs.unlinkSync(path.join(PUBLIC,item.path.replace(/^\//,'')))}catch{}; mutate('media',a=>a.filter(x=>x.id!==item.id)); logAdmin(u.id,'media.delete',item.id); return writeJson(res,200,{ok:true});
      }
      if(pathname==='/api/admin/system'&&method==='GET') return writeJson(res,200,{version:APP_VERSION,node:process.version,platform:process.platform,uptime:Math.floor(process.uptime()),dataFiles:DB_FILES.length,backupFiles:countFiles(BACKUPS),uploadsFiles:countFiles(UPLOADS),uploadsBytes:dirSize(UPLOADS),mediaRecords:dbRead('media').length,nativePush:{configured:nativePushConfigured(),devices:dbRead('nativePushTokens').filter(x=>!x.revokedAt).length},memory:{rss:process.memoryUsage().rss,heapUsed:process.memoryUsage().heapUsed},activeSessions:dbRead('sessions').filter(x=>x.expiresAt>Date.now()).length});
      if(pathname==='/api/admin/push/test'&&method==='POST'){ if(!pushConfigured()&&!nativePushConfigured()) return writeJson(res,503,{error:'PUSH_NOT_CONFIGURED'}); const b=await jsonBody(req); const target=userFromId(b.userId||u.id); if(!target)return writeJson(res,404,{error:'NOT_FOUND'}); const payload={title:safeText(b.title,100)||'LUTSA',body:safeText(b.body,240)||'اختبار إشعار',url:safeText(b.url,300)||'/',tag:'admin-test',kind:'notification'}; const web=pushConfigured()?await sendPushNotification(target.id,payload):{configured:false,delivered:0,removed:0}; const native=nativePushConfigured()?await sendNativePushNotification(target.id,payload):{configured:false,delivered:0,removed:0}; logAdmin(u.id,'push.test',target.id,{web,native}); return writeJson(res,200,{ok:true,web,native}); }
      if(pathname==='/api/admin/push/config'&&method==='GET') return writeJson(res,200,{configured:pushConfigured(),publicKey:getVapidPublicKey()||'',subject:process.env.VAPID_SUBJECT||''});
      if(pathname==='/api/admin/audit'&&method==='GET') return writeJson(res,200,{items:dbRead('audit').sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,200).map(x=>({...x,actor:publicUser(userFromId(x.actorId))}))});
      if(pathname==='/api/admin/backup'&&method==='GET'){ const snap=backupSnapshot(); const filename=`lutsa-backup-${new Date().toISOString().replace(/[:.]/g,'-')}.json`; const archive=path.join(BACKUPS,filename); fs.writeFileSync(archive,JSON.stringify(snap,null,2),'utf8'); logAdmin(u.id,'backup.create',null,{filename}); return writeDownloadJson(res,filename,snap); }
      if(pathname==='/api/admin/restore'&&method==='POST'){ const b=await jsonBody(req); const snap=b.snapshot; const error=validateSnapshot(snap); if(error) return writeJson(res,400,{error}); const before=backupSnapshot(); const restoreName=`pre-restore-${new Date().toISOString().replace(/[:.]/g,'-')}.json`; fs.writeFileSync(path.join(BACKUPS,restoreName),JSON.stringify(before,null,2),'utf8'); restoreSnapshot(snap); logAdmin(u.id,'backup.restore',null,{sourceVersion:snap.version,restorePoint:restoreName}); return writeJson(res,200,{ok:true,restorePoint:restoreName,version:APP_VERSION}); }
      if(pathname==='/api/admin/stats'&&method==='GET') return writeJson(res,200,{users:dbRead('users').length,activeUsers:dbRead('users').filter(x=>x.lastSeenAt&&Date.now()-new Date(x.lastSeenAt).getTime()<120000).length,posts:dbRead('posts').filter(p=>!p.deleted).length,stories:dbRead('stories').filter(x=>new Date(x.expiresAt)>Date.now()).length,messages:dbRead('messages').length,groups:dbRead('groups').length,groupMembers:dbRead('groupMembers').length,pages:dbRead('pages').length,pageFollowers:dbRead('pageFollows').length,marketplace:dbRead('marketplace').length,events:dbRead('events').length,calls:dbRead('calls').length,videoCalls:dbRead('calls').filter(x=>x.type==='video').length,streams:dbRead('stream').filter(s=>normalizeLiveStream(s)?.status==='live').length,streamViewers:(normalizeLiveStream(dbRead('stream')[0])?.viewerIds||[]).length,callQuality:dbRead('callQuality').length,reports:dbRead('reports').length,audit:dbRead('audit').length,openReports:dbRead('reports').filter(x=>x.status==='open').length,media:dbRead('media').length,uploadFiles:countFiles(UPLOADS),uploadBytes:dirSize(UPLOADS)});
      if(pathname==='/api/admin/users'&&method==='GET') return writeJson(res,200,{users:dbRead('users').map(publicUser)});
      if(pathname==='/api/admin/role'&&method==='POST'){ const b=await jsonBody(req); const target=userFromId(b.userId); if(!target) return writeJson(res,404,{error:'NOT_FOUND'}); const admins=dbRead('users').filter(x=>x.role==='admin'&&!x.disabled); if(target.id===u.id&&b.role!=='admin'&&admins.length<=1)return writeJson(res,400,{error:'LAST_ADMIN'}); mutate('users',a=>a.map(x=>x.id===target.id?{...x,role:b.role==='admin'?'admin':'user'}:x)); logAdmin(u.id,'user.role',target.id,{role:b.role==='admin'?'admin':'user'}); return writeJson(res,200,{ok:true}); }
      if(pathname==='/api/admin/user-status'&&method==='POST'){ const b=await jsonBody(req); const target=userFromId(b.userId); if(!target)return writeJson(res,404,{error:'NOT_FOUND'}); if(target.id===u.id)return writeJson(res,400,{error:'SELF_ACTION'}); mutate('users',a=>a.map(x=>x.id===target.id?{...x,disabled:Boolean(b.disabled)}:x)); mutate('sessions',a=>a.filter(x=>x.userId!==target.id)); logAdmin(u.id,'user.status',target.id,{disabled:Boolean(b.disabled)}); return writeJson(res,200,{ok:true,disabled:Boolean(b.disabled)}); }
      if(pathname==='/api/admin/reports'&&method==='GET') return writeJson(res,200,{reports:dbRead('reports').sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(r=>({...r,reporter:publicUser(userFromId(r.reporterId)),targetPost:dbRead('posts').find(p=>p.id===r.targetId)}))});
      if(pathname==='/api/admin/reports/action'&&method==='POST'){ const b=await jsonBody(req); const allowed=['open','reviewing','resolved','rejected']; if(!allowed.includes(b.status)) return writeJson(res,400,{error:'BAD_STATUS'}); mutate('reports',a=>a.map(x=>x.id===b.reportId?{...x,status:b.status,reviewedBy:u.id,reviewedAt:now()}:x)); logAdmin(u.id,'report.status',b.reportId,{status:b.status}); return writeJson(res,200,{ok:true}); }
      if(pathname==='/api/admin/posts'&&method==='GET') return writeJson(res,200,{posts:dbRead('posts').sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,100).map(p=>serializePost(p,u))});
      if(pathname==='/api/admin/posts/delete'&&method==='POST'){const b=await jsonBody(req);const p=dbRead('posts').find(x=>x.id===b.postId);if(!p)return writeJson(res,404,{error:'NOT_FOUND'});mutate('posts',a=>a.map(x=>x.id===p.id?{...x,deleted:true,deletedAt:now(),deletedBy:u.id}:x)); logAdmin(u.id,'post.delete',p.id); return writeJson(res,200,{ok:true});}
    }

    return writeJson(res,404,{error:'NOT_FOUND'});
  } catch (e) {
    console.error(e);
    return writeJson(res,500,{error:'SERVER_ERROR',message:process.env.NODE_ENV==='development'?e.message:undefined});
  }
}

const typingState = new Map();
setInterval(()=>{
  const cutoff=Date.now()-SESSION_TTL; mutate('sessions',a=>a.filter(s=>s.expiresAt>Date.now()));
  for(const [k,v] of typingState) if(Date.now()-v.at>10000) typingState.delete(k);
},60000);

// Seed admin if the database is empty.
if(dbRead('users').length===0){
  const hp=hashPassword(process.env.ADMIN_PASSWORD||'Admin@12345');
  dbWrite('users',[{id:'usr_admin',username:'admin',displayName:'LUTSA Admin',bio:'',avatar:'',cover:'',role:'admin',passwordHash:hp.hash,passwordSalt:hp.salt,privacy:{messageWho:'everyone',profile:'public',readReceipts:true,activityStatus:true},notificationPrefs:notificationDefaults(),createdAt:now(),lastSeenAt:now()}]);
  console.log(`Seeded admin user: admin / ${process.env.ADMIN_PASSWORD || 'Admin@12345'} (change immediately)`);
}

const SERVER_VERSION=APP_VERSION;
const server=http.createServer((req,res)=>{ res.setHeader('X-LUTSA-Version',SERVER_VERSION); res.setHeader('X-LUTSA-API-Version',APP_VERSION); router(req,res); });
server.listen(PORT,HOST,()=>console.log(`${APP_NAME} listening on http://${HOST}:${PORT}`));
