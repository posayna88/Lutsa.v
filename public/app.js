const $=s=>document.querySelector(s); const $$=s=>[...document.querySelectorAll(s)];
const savedUi=JSON.parse(localStorage.getItem('lutsa_ui')||'{}');
const state={user:null,lang:savedUi.lang||'ar',theme:savedUi.theme||'system',page:'home',feedTab:'home',feedItems:[],feedCursor:null,feedHasMore:true,feedLoading:false,feedObserver:null,feedInitialized:false,installPrompt:null,lastNotificationId:null,wakeLock:null,networkToastAt:0,bootstrap:null,activeChat:null,messengerSearch:'',chatBefore:null,chatHasOlder:false,chatLoadingOlder:false,chatFirstMessageId:null,chatLastMessageAt:0,call:null,pc:null,localStream:null,remoteStream:null,callPollTimer:null,signalTimer:null,streamTimer:null,typingTimer:null,typingPollTimer:null,recording:null,chatPollTimer:null,notificationPollTimer:null,ringTimer:null,callTimeout:null,callStartedAt:null,callStatsTimer:null,callReconnectTimer:null,callReconnectBusy:false,liveHostStream:null,liveActive:false,liveId:null,liveHeartbeatTimer:null,liveCountTimer:null,livePeers:null,profileTab:'posts',nativeFcmToken:'',groupId:null,pageId:null,savedCollectionId:null,replyTo:null,storyItems:[],storyIndex:0};
function saveUi(){localStorage.setItem('lutsa_ui',JSON.stringify({lang:state.lang,theme:state.theme}))}
function applyTheme(){const mode=state.theme||'system';document.documentElement.dataset.theme=mode;document.body.classList.toggle('dark',mode==='dark'||(mode==='system'&&matchMedia('(prefers-color-scheme: dark)').matches));}
function cycleTheme(){state.theme=state.theme==='light'?'dark':state.theme==='dark'?'system':'light';saveUi();applyTheme();toast(state.theme==='dark'?'الوضع الليلي':state.theme==='light'?'الوضع النهاري':'وضع النظام');}
function shellLabel(sel,txt){const el=$(sel);if(!el)return;if('placeholder' in el)el.placeholder=txt;else el.textContent=txt;}
function showSkeleton(){const p=$('#page');if(p)p.innerHTML='<div class="skeleton-stack"><div class="skeleton hero"></div><div class="skeleton-row"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div><div class="skeleton big"></div></div>';}
function closeFloatingPopovers(except){['searchPopover','notificationPopover'].forEach(id=>{if(id!==except)$('#'+id)?.classList.add('hidden')})}
function renderQuickSearch(d,q){const pop=$('#searchPopover');if(!pop)return;const users=(d.users||[]).slice(0,5),posts=(d.posts||[]).slice(0,3),groups=(d.groups||[]).slice(0,3),pages=(d.pages||[]).slice(0,3);pop.innerHTML=`<div class="search-pop-head"><b>نتائج سريعة</b><span>${esc(q)}</span></div>${users.length?`<div class="search-pop-section"><small>👤 الأشخاص</small>${users.map(u=>`<button class="search-hit" data-user="${u.id}">${avatar(u,'avatar-mini')}<span><b>${esc(u.displayName)}</b><small>@${esc(u.username)}</small></span></button>`).join('')}</div>`:''}${posts.length?`<div class="search-pop-section"><small>📰 المنشورات</small>${posts.map(p=>`<button class="search-hit" data-post="${p.id}"><span>📰</span><span>${esc((p.text||'منشور').slice(0,70))}</span></button>`).join('')}</div>`:''}${groups.length?`<div class="search-pop-section"><small>👥 المجموعات</small>${groups.map(g=>`<button class="search-hit" data-group="${g.id}"><span>👥</span><span>${esc(g.name)}</span></button>`).join('')}</div>`:''}${pages.length?`<div class="search-pop-section"><small>📄 الصفحات</small>${pages.map(g=>`<button class="search-hit" data-page-id="${g.id}"><span>📄</span><span>${esc(g.name)}</span></button>`).join('')}</div>`:''}${!users.length&&!posts.length&&!groups.length&&!pages.length?'<div class="small search-empty">لا توجد نتائج سريعة</div>':''}<button class="search-all" id="searchAllBtn">عرض كل النتائج</button>`;pop.classList.remove('hidden');closeFloatingPopovers('searchPopover');$$(".search-hit[data-user]").forEach(b=>b.onclick=()=>{pop.classList.add('hidden');setPage('profile',{profileUid:b.dataset.user})});$$(".search-hit[data-post]").forEach(b=>b.onclick=()=>{pop.classList.add('hidden');openSharedPost(b.dataset.post)});$$(".search-hit[data-group]").forEach(b=>b.onclick=()=>{pop.classList.add('hidden');openGroupById(b.dataset.group)});$$(".search-hit[data-page-id]").forEach(b=>b.onclick=()=>{pop.classList.add('hidden');openPageById(b.dataset.pageId)});$('#searchAllBtn')?.addEventListener('click',()=>{$('#searchPopover')?.classList.add('hidden');openFullSearch(q)});}
async function openFullSearch(q){if(!q)return;const d=await api('/api/search?q='+encodeURIComponent(q));showModal(`<h3>بحث شامل: ${esc(q)}</h3><div class="search-results-grid"><section><h4>👤 الأشخاص</h4>${userRows(d.users,'عرض','viewUser')||'<div class="small">لا يوجد</div>'}</section><section><h4>📰 المنشورات</h4>${(d.posts||[]).map(p=>`<div class="search-direct-card"><div class="small">${esc(p.author?.displayName||'')}</div><p>${esc((p.text||'منشور').slice(0,120))}</p><button class="btn directPost" data-id="${p.id}">فتح المنشور</button><button class="btn shareDirectPost" data-id="${p.id}">↗ مشاركة الرابط</button></div>`).join('')||'<div class="small">لا يوجد</div>'}</section><section><h4>👥 المجموعات</h4>${(d.groups||[]).map(g=>`<div class="search-direct-card"><b>${esc(g.name)}</b><p>${esc(g.description||'')}</p><button class="btn directGroup" data-id="${g.id}">فتح المجموعة</button><button class="btn shareDirectGroup" data-id="${g.id}">↗ مشاركة</button></div>`).join('')||'<div class="small">لا يوجد</div>'}</section><section><h4>📄 الصفحات</h4>${(d.pages||[]).map(p=>`<div class="search-direct-card"><b>${esc(p.name)}</b><p>${esc(p.description||'')}</p><button class="btn directPage" data-id="${p.id}">فتح الصفحة</button><button class="btn shareDirectPage" data-id="${p.id}">↗ مشاركة</button></div>`).join('')||'<div class="small">لا يوجد</div>'}</section><section><h4>🛍️ Marketplace</h4>${(d.marketplace||[]).map(x=>`<div class="card panel"><b>${esc(x.title)}</b><p>${esc(x.price||'')}</p></div>`).join('')||'<div class="small">لا يوجد</div>'}</section><section><h4>📅 الأحداث</h4>${(d.events||[]).map(x=>`<div class="card panel"><b>${esc(x.title)}</b><p>${new Date(x.date).toLocaleString()}</p></div>`).join('')||'<div class="small">لا يوجد</div>'}</section></div>`);$$('.viewUser').forEach(x=>x.onclick=()=>{closeModal();setPage('profile',{profileUid:x.dataset.id})});$$('.directPost').forEach(x=>x.onclick=()=>openSharedPost(x.dataset.id));$$('.shareDirectPost').forEach(x=>x.onclick=()=>shareEntity('post',x.dataset.id,'منشور على LUTSA'));$$('.directGroup').forEach(x=>x.onclick=()=>openGroupById(x.dataset.id));$$('.shareDirectGroup').forEach(x=>x.onclick=()=>shareEntity('group',x.dataset.id));$$('.directPage').forEach(x=>x.onclick=()=>openPageById(x.dataset.id));$$('.shareDirectPage').forEach(x=>x.onclick=()=>shareEntity('page',x.dataset.id));}
async function refreshNotificationPopover(){const p=$('#notificationPopover');if(!p)return;try{const d=await api('/api/notifications');const items=(d.items||[]).slice(0,6);p.innerHTML=`<div class="popover-title"><b>الإشعارات</b><button class="btn" id="popoverReadAll">تعليم الكل</button></div>${items.map(n=>`<button class="notify-hit ${n.read?'':'unread'}" data-id="${n.id}"><span class="notification-icon">${n.type==='message'?'💬':n.type==='call'?'📞':n.type==='friend'?'👥':n.type==='follow'?'👤':'🔔'}</span><span><b>${esc(n.title)}</b><small>${esc(n.body)}</small></span></button>`).join('')||'<div class="small">لا توجد إشعارات</div>'}<button class="search-all" id="openNotificationsBtn">عرض مركز الإشعارات</button>`;p.classList.remove('hidden');closeFloatingPopovers('notificationPopover');$$('.notify-hit').forEach(b=>b.onclick=async()=>{await api('/api/notifications/read',{method:'POST',body:JSON.stringify({id:b.dataset.id})}).catch(()=>{});const n=d.items.find(x=>x.id===b.dataset.id);p.classList.add('hidden');if(n?.meta?.url&&n.meta.url!=='/'){location.href=n.meta.url;return;}if(n?.meta?.userId)setPage('profile',{profileUid:n.meta.userId});else if(n?.meta?.callId)setPage('calls');else if(n?.meta?.conversationId&&n.meta.userId)openMessenger(n.meta.userId);});$('#popoverReadAll')?.addEventListener('click',async()=>{await api('/api/notifications/read',{method:'POST',body:JSON.stringify({all:true})});await refreshNotificationPopover()});$('#openNotificationsBtn')?.addEventListener('click',()=>{p.classList.add('hidden');setPage('notifications')});}catch{p.classList.add('hidden')}}
const I18N={ar:{home:'الرئيسية',friends:'الأصدقاء',messenger:'Messenger',stories:'Stories',reels:'Reels',groups:'المجموعات',pages:'الصفحات',marketplace:'Marketplace',events:'الأحداث',memories:'ذكرياتك',calls:'المكالمات',live:'البث المباشر',settings:'الإعدادات',media:'وسائطي',saved:'المحفوظات',admin:'الإدارة'},en:{home:'Home',friends:'Friends',messenger:'Messenger',stories:'Stories',reels:'Reels',groups:'Groups',pages:'Pages',marketplace:'Marketplace',events:'Events',memories:'Memories',calls:'Calls',live:'Live',settings:'Settings',media:'My Media',saved:'Saved',admin:'Admin'}};
async function api(path,opt={}){const r=await fetch(path,{credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json',...(opt.headers||{})},...opt}); const t=await r.text(); let d={}; try{d=t?JSON.parse(t):{}}catch{} if(!r.ok){ if(r.status===404 && path==='/api/calls/signal'){ d={...d,error:d.error||'SIGNAL_ROUTE_NOT_FOUND',diagnostic:'الخادم الذي يعمل خلف هذا الرابط لا يشغّل نسخة LUTSA التي تحتوي على /api/calls/signal. تأكد من تشغيل server.js من نسخة LUTSA الحالية.'}; } throw Object.assign(new Error(d.error||'Request failed'),{data:d,status:r.status,serverVersion:r.headers.get('x-lutsa-version')||''}); } return d;}
async function getShareLink(type,id){const d=await api('/api/share/link?type='+encodeURIComponent(type)+'&id='+encodeURIComponent(id));return d.url;}
async function shareUrl(url,title='LUTSA Social',text=''){try{if(navigator.share){await navigator.share({title,text,url});return true;}await navigator.clipboard.writeText(url);toast('تم نسخ الرابط');return true;}catch(e){if(e?.name!=='AbortError')toast('تعذر مشاركة الرابط');return false;}}
async function shareEntity(type,id,title='LUTSA Social'){try{const url=await getShareLink(type,id);return shareUrl(url,title,title==='LUTSA Social'?'رابط من LUTSA':`شارك ${title}`);}catch(e){toast(e.data?.error||'تعذر إنشاء رابط المشاركة');return false;}}
async function openSharedPost(id){try{const d=await api('/api/posts/'+encodeURIComponent(id));closeFloatingPopovers();showModal(`<div class=\"shared-detail\">${renderPost(d.post)}<div class=\"entity-actions\"><button class=\"primary\" id=\"shareSharedPost\">↗ مشاركة الرابط</button><button class=\"btn\" id=\"openPostAuthor\">👤 صاحب المنشور</button></div></div>`);bindPostActionsOnly();$('#shareSharedPost')?.addEventListener('click',()=>shareEntity('post',id,'منشور على LUTSA'));$('#openPostAuthor')?.addEventListener('click',()=>{closeModal();setPage('profile',{profileUid:d.post.author.id})});}catch(e){toast(e.data?.error||'تعذر فتح المنشور');}}
async function openGroupById(id){try{const d=await api('/api/groups/'+encodeURIComponent(id));showModal(`<div class="entity-detail"><div class="entity-cover large-cover" style="${d.group.cover?`background-image:url('${d.group.cover}')`:''}"></div><div class="section-title"><div><h2>${esc(d.group.name)}</h2><p>${esc(d.group.description||'')}</p><small>${d.group.members} أعضاء ${d.group.privacy==='private'?'· 🔒 خاصة':'· 🌍 عامة'}</small></div><button class="btn" id="shareGroupLink">↗ مشاركة</button></div><div class="entity-actions">${d.group.isMember?'<span class="small">✅ أنت عضو</span>':'<button class="primary" id="groupJoinLink">＋ انضمام</button>'}</div>${d.group.isMember?`<div class="inline-composer"><textarea id="groupPostText" class="field" placeholder="اكتب منشورًا في المجموعة..."></textarea><button class="primary" id="groupPostSend">نشر</button></div>`:''}<div class="detail-posts">${(d.posts||[]).map(renderPost).join('')||'<div class="small">لا توجد منشورات في المجموعة.</div>'}</div></div>`);bindPostActionsOnly();$('#shareGroupLink')?.addEventListener('click',()=>shareEntity('group',id,d.group.name));$('#groupJoinLink')?.addEventListener('click',async()=>{await api('/api/groups/join',{method:'POST',body:JSON.stringify({groupId:id})});await openGroupById(id)});$('#groupPostSend')?.addEventListener('click',async()=>{const text=$('#groupPostText')?.value?.trim();if(!text)return toast('اكتب المنشور');await api('/api/groups/post',{method:'POST',body:JSON.stringify({groupId:id,text})});await openGroupById(id);});}catch(e){toast(e.data?.error||'تعذر فتح المجموعة');}}
async function openPageById(id){try{const d=await api('/api/pages/'+encodeURIComponent(id));const isOwner=d.page.ownerId===state.user.id;showModal(`<div class="entity-detail"><div class="entity-cover large-cover" style="${d.page.cover?`background-image:url('${d.page.cover}')`:''}"></div><div class="section-title"><div><h2>${esc(d.page.name)}</h2><p>${esc(d.page.description||'')}</p><small>${d.page.followers} متابع · ${esc(d.page.category||'عام')}</small></div><button class="btn" id="sharePageLink">↗ مشاركة</button></div><div class="entity-actions"><button class="primary pageLinkFollow">${d.page.following?'إلغاء المتابعة':'متابعة'}</button></div>${isOwner?`<div class="inline-composer"><textarea id="pagePostText" class="field" placeholder="اكتب منشورًا على الصفحة..."></textarea><button class="primary" id="pagePostSend">نشر</button></div>`:''}<div class="detail-posts">${(d.posts||[]).map(renderPost).join('')||'<div class="small">لا توجد منشورات في الصفحة.</div>'}</div></div>`);bindPostActionsOnly();$('#sharePageLink')?.addEventListener('click',()=>shareEntity('page',id,d.page.name));$('.pageLinkFollow')?.addEventListener('click',async()=>{await api('/api/pages/follow',{method:'POST',body:JSON.stringify({pageId:id})});await openPageById(id)});$('#pagePostSend')?.addEventListener('click',async()=>{const text=$('#pagePostText')?.value?.trim();if(!text)return toast('اكتب المنشور');await api('/api/pages/post',{method:'POST',body:JSON.stringify({pageId:id,text})});await openPageById(id);});}catch(e){toast(e.data?.error||'تعذر فتح الصفحة');}}
function esc(s=''){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function initials(n='A'){return n.split(/\s+/).map(x=>x[0]).slice(0,2).join('').toUpperCase();}
function avatar(u,cls='avatar'){return u?.avatar?`<img class="${cls}" src="${u.avatar}">`:`<div class="${cls}">${esc(initials(u?.displayName||'A'))}</div>`}
function toast(s){const el=$('#toast');el.textContent=s;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),2400)}
function notifyViaSW(title,body,url='/'){try{if(window.LutsaNative?.isAndroid&&window.LutsaNative?.notify){window.LutsaNative.notify(String(title||'LUTSA'),String(body||''),String(url||'/'));return;}if(!('serviceWorker'in navigator))return; navigator.serviceWorker.ready.then(reg=>{if(window.Notification?.permission==='granted'&&reg.showNotification)reg.showNotification(title,{body,icon:'/assets/icon.svg',badge:'/assets/icon.svg',data:{url},tag:'lutsa-'+Date.now()})}).catch(()=>{});}catch{}}
function handleNativeCallAction(){try{const q=new URLSearchParams(location.search);const action=q.get('callAction');const callId=q.get('callId');if(!action||!callId)return;history.replaceState({},'',location.pathname);const run=async()=>{try{const d=await api('/api/calls/poll?after='+(Date.now()-60000));const c=d.calls?.find(x=>x.id===callId);if(!c){toast('المكالمة غير موجودة أو انتهت');return;}if(action==='open'){if(c.status==='ringing'&&!state.call)showIncoming(c);else if(c.status==='accepted'&&!state.call){state.call={...c,peerId:c.from===state.user?.id?c.to:c.from,initiator:false};await acceptLocalAndPeer(false);showCallOverlay();}return;}if(action==='accept'){if(c.status==='ringing')await api('/api/calls/action',{method:'POST',body:JSON.stringify({callId,action:'accept'})});const fresh=(await api('/api/calls/poll?after='+(Date.now()-60000))).calls?.find(x=>x.id===callId);if(fresh&&fresh.status==='accepted'){state.call={...fresh,peerId:fresh.from===state.user?.id?fresh.to:fresh.from,initiator:false};await acceptLocalAndPeer(false);showCallOverlay();}}else if(action==='reject'&&c.status==='ringing'){await api('/api/calls/action',{method:'POST',body:JSON.stringify({callId,action:'reject'})})}else if(action==='end'&&(c.status==='ringing'||c.status==='accepted')){await api('/api/calls/action',{method:'POST',body:JSON.stringify({callId,action:'end'})})}}catch(e){console.warn('native call action',e);toast(callErrorMessage(e))} };setTimeout(run,500);}catch{}}
async function enableNotifications(){if(!('Notification'in window)){toast('هذا المتصفح لا يدعم الإشعارات');return 'unsupported'} const p=await Notification.requestPermission(); if(p==='granted'){const push=await registerPushSubscription();toast(push?'تم تفعيل الإشعارات والدفع الخلفي':'تم تفعيل إشعارات المتصفح');return p} toast('لم يتم السماح بالإشعارات');return p}
async function registerPushSubscription(){try{if(!('serviceWorker'in navigator)||!('PushManager'in window))return false; const reg=await navigator.serviceWorker.ready; const key=(await api('/api/push/status')).publicKey||''; if(!key)return false; const sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key}); await api('/api/push/subscribe',{method:'POST',body:JSON.stringify({subscription:sub.toJSON()})}); return true}catch{return false}}
async function registerNativePushToken(token){
  try{
    if(!window.LutsaNative?.isAndroid||!token||!state.user)return false;
    if(state.nativeFcmToken===token)return true;
    let deviceId=localStorage.getItem('lutsa_device_id');
    if(!deviceId){deviceId=(crypto.randomUUID?crypto.randomUUID():'dev_'+Math.random().toString(36).slice(2));localStorage.setItem('lutsa_device_id',deviceId);}
    const d=await api('/api/push/native/register',{method:'POST',body:JSON.stringify({fcmToken:token,deviceId,platform:'android'})});
    if(d.accessToken)window.LutsaNative.saveNativeAccessToken?.(d.accessToken);
    state.nativeFcmToken=token;
    return true;
  }catch(e){console.warn('native push registration',e);return false;}
}
window.lutsaRegisterNativeFcmToken=registerNativePushToken;
function bindInstallPrompt(){window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();state.installPrompt=e;$('#installBanner')?.classList.remove('hidden')});$('#installBtn')?.addEventListener('click',async()=>{if(!state.installPrompt)return;state.installPrompt.prompt();await state.installPrompt.userChoice;state.installPrompt=null;$('#installBanner')?.classList.add('hidden')});$('#installDismiss')?.addEventListener('click',()=>$('#installBanner')?.classList.add('hidden'));window.addEventListener('appinstalled',()=>{$('#installBanner')?.classList.add('hidden');toast('تم تثبيت LUTSA بنجاح')});}
function updateNetworkUI(){const el=$('#networkBanner');if(!el)return;el.classList.toggle('hidden',navigator.onLine);if(!navigator.onLine)toast('لا يوجد اتصال بالإنترنت');}
async function acquireWakeLock(){try{if('wakeLock'in navigator&&!state.wakeLock)state.wakeLock=await navigator.wakeLock.request('screen')}catch{} }
function releaseWakeLock(){try{state.wakeLock?.release();state.wakeLock=null}catch{}}
async function switchCamera(){
  const stream=state.localStream;if(!stream||state.call?.type!=='video'||!state.pc)return;
  const current=stream.getVideoTracks()[0];if(!current)return;
  const facing=current.getSettings?.().facingMode==='environment'?'user':'environment';
  try{
    const next=await navigator.mediaDevices.getUserMedia({audio:false,video:{width:{ideal:1280},height:{ideal:720},facingMode:{ideal:facing}}});
    const nextTrack=next.getVideoTracks()[0];if(!nextTrack)return;
    const sender=state.pc.getSenders().find(x=>x.track?.kind==='video');
    if(sender)await sender.replaceTrack(nextTrack);
    stream.removeTrack(current);current.stop();stream.addTrack(nextTrack);
    const lv=$('#localVideo');if(lv){lv.srcObject=stream;lv.play().catch(()=>{})}
  }catch(e){console.warn('camera switch',e);toast('تعذر تبديل الكاميرا')}
}
function showModal(html){$('#modalBody').innerHTML=html;$('#modal').classList.remove('hidden')} function closeModal(){if(state.liveActive&&!state._closingLive){state._closingLive=true;leaveLiveSession().finally(()=>{state._closingLive=false}) ;return;}$('#modal').classList.add('hidden')}
window.App={closeModal};
function mediaHtml(media){if(!media)return ''; if(media.mime?.startsWith('video')||media.kind?.startsWith('video'))return `<video class="post-media" controls playsinline preload="metadata" src="${media.path}"></video>`; return `<img class="post-media" src="${media.path}" loading="lazy">`;}
function renderPost(p){const r=Object.entries(p.reactionSummary||{}).reduce((a,[k,v])=>a+`${k}:${v} `,'');const renderComment=c=>`<div class="comment-item"><div class="user-row"><b>${esc(c.author?.displayName||'')}</b><span>${esc(c.text)}</span><small>${new Date(c.createdAt).toLocaleString()}</small></div><div class="comment-actions"><button class="btn replyComment" data-post="${p.id}" data-parent="${c.id}">↩ رد</button>${c.author?.id===state.user?.id?`<button class="btn deleteComment" data-id="${c.id}">🗑️</button>`:''}</div>${(c.replies||[]).slice(0,5).map(renderComment).join('')}</div>`;return `<article class="card post ${p.isReel?'reel-post':''}" data-post="${p.id}"><div class="post-head">${avatar(p.author)}<div class="meta"><strong>${esc(p.author?.displayName||'')}</strong><small>@${esc(p.author?.username||'')} · ${new Date(p.createdAt).toLocaleString()}</small></div><button class="icon-btn post-menu" data-id="${p.id}">⋯</button></div>${p.sharedPostId?`<div class="small">↗ منشور تمت مشاركته</div>`:''}<div class="post-text">${esc(p.text||'')}</div>${mediaHtml(p.media)}<div class="small">${esc(r)}</div><div class="post-actions"><button class="react" data-id="${p.id}">👍 ${p.myReaction||''}</button><button class="comment" data-id="${p.id}">💬 ${p.commentCount ?? (p.comments?.length || 0)}</button><button class="share" data-id="${p.id}">↗ مشاركة</button><button class="save" data-id="${p.id}">🔖 ${p.savedBy?.includes?.(state.user?.id)?'محفوظ':''}</button><button class="collectionSave" data-id="${p.id}">📁 حفظ في مجموعة</button></div><div class="comments">${(p.comments||[]).slice(-6).map(renderComment).join('')}</div></article>`;}
function renderStories(items){const seen=new Set(),ordered=[];for(const st of [...items].sort((a,b)=>b.createdAt.localeCompare(a.createdAt))){if(seen.has(st.authorId))continue;seen.add(st.authorId);ordered.push(st);}const arr=[{id:'create',author:state.user,title:'قصتك',create:true},...ordered.map(st=>({...st,title:st.authorId===state.user.id?'قصتك':(st.author?.displayName||'')}))];return `<div class="story-strip">${arr.map(st=>`<div class="story-card ${st.viewedByMe?'story-viewed':''}" data-story="${st.id}">${st.create?`<div style="display:grid;place-items:center;height:100%;font-size:34px">＋</div>`:(st.media?.kind?.startsWith('video')?`<video src="${st.media.path}" muted></video>`:`<img src="${st.media.path}">`)}<div class="story-name">${esc(st.title)}</div>${!st.create?`<small class="story-views">👁️ ${st.viewsCount||0}</small>`:''}</div>`).join('')}</div>`}
function composer(){return `<div class="card composer"><div class="composer-row">${avatar(state.user)}<textarea id="postText" placeholder="بماذا تفكر؟ / What's on your mind?"></textarea></div><div class="composer-options"><select id="postVisibility" class="field"><option value="public">🌍 عام</option><option value="friends">👥 الأصدقاء</option><option value="private">🔒 أنا فقط</option></select><label class="check-pill"><input id="isReel" type="checkbox"> 🎬 نشر كـ Reel</label></div><div class="composer-actions"><label class="btn">🖼️ صورة/فيديو <input id="postFile" type="file" accept="image/*,video/*" hidden></label><button class="primary" id="publishPost">نشر</button></div></div>`}
function pageHome(){const b=state.bootstrap||{}; const posts=state.feedItems.length?state.feedItems:(b.posts||[]); return `${renderStories(b.stories||[])}<div class="feed-tabs"><button class="${state.feedTab==='home'?'active':''}" data-feed="home">الرئيسية</button><button class="${state.feedTab==='latest'?'active':''}" data-feed="latest">الأحدث</button><button class="${state.feedTab==='video'?'active':''}" data-feed="video">الفيديو</button></div>${composer()}<div id="feed">${posts.map(renderPost).join('')||'<div class="card panel">لا توجد منشورات في هذا القسم.</div>'}</div><div id="feedMore" class="feed-more">${state.feedHasMore?'تحميل المزيد…':'لا توجد منشورات أخرى'}</div>`}
function pageFriends(){return `<div class="section-title"><h2>الأصدقاء</h2><button class="primary" id="searchFriends">بحث</button></div><div id="friendsContent" class="card panel">تحميل...</div>`}
function userRows(arr,actionLabel='إضافة',actionClass='addFriend'){return `<div class="list">${arr.map(u=>`<div class="user-row">${avatar(u)}<div class="meta"><b>${esc(u.displayName)}</b><small>@${esc(u.username)} ${u.mutual?`· ${u.mutual} أصدقاء مشتركون`:''}</small></div><button class="${actionClass}" data-id="${u.id}">${actionLabel}</button></div>`).join('')}</div>`}
async function loadFriends(){const d=await api('/api/friends/list');$('#friendsContent').innerHTML=`<h3>طلبات واردة</h3>${d.incoming.length?d.incoming.map(r=>`<div class="user-row">${avatar(r.fromUser)}<div class="meta"><b>${esc(r.fromUser.displayName)}</b><small>طلب صداقة</small></div><button class="acceptFriend" data-id="${r.id}">✅</button><button class="rejectFriend" data-id="${r.id}">❌</button></div>`).join(''):'<div class="small">لا توجد طلبات</div>'}<hr><h3>اقتراحات</h3>${userRows(d.suggestions)}<hr><h3>أصدقاؤك</h3>${userRows(d.friends,'مراسلة','messageUser')}</div>`; $$('#friendsContent .addFriend').forEach(x=>x.onclick=async()=>{await api('/api/friends/request',{method:'POST',body:JSON.stringify({userId:x.dataset.id})});toast('تم إرسال الطلب');x.textContent='تم الإرسال'});$$('#friendsContent .acceptFriend').forEach(x=>x.onclick=async()=>{await api('/api/friends/action',{method:'POST',body:JSON.stringify({requestId:x.dataset.id,action:'accept'})});loadFriends()});$$('#friendsContent .rejectFriend').forEach(x=>x.onclick=async()=>{await api('/api/friends/action',{method:'POST',body:JSON.stringify({requestId:x.dataset.id,action:'reject'})});loadFriends()});$$('#friendsContent .messageUser').forEach(x=>x.onclick=()=>openMessenger(x.dataset.id));}
function pageMessenger(){return `<div class="card conversation-layout" id="messengerLayout"><div class="chat-list"><div class="section-title"><div><h3>Messenger</h3><small class="small">محادثاتك ورسائلك</small></div><button class="btn" id="msgSearch">🔎</button></div><div class="messenger-search"><input id="messengerSearch" class="field" placeholder="بحث في Messenger..." value="${esc(state.messengerSearch)}"><button class="btn" id="clearMsgSearch">×</button></div><div id="conversations">جارٍ التحميل...</div></div><div id="chatArea" class="chat-area"><div class="panel" style="margin:auto;text-align:center"><div style="font-size:42px">💬</div><h3>اختر محادثة</h3><p class="small">ابدأ محادثة من الأصدقاء أو ابحث عن مستخدم</p></div></div></div>`}
async function loadConversations(){
  const q=state.messengerSearch.trim();
  const d=q?await api('/api/messenger/search?q='+encodeURIComponent(q)):await api('/api/messenger');
  const box=$('#conversations'); if(!box)return;
  if(q){
    box.innerHTML=(d.users||[]).map(u=>`<div class="user-row chat-select" data-id="${u.id}">${avatar(u)}<div class="meta"><b>${esc(u.displayName)}</b><small>@${esc(u.username)} ${u.isOnline?'· 🟢 متصل':'· ⚪ غير متصل'}</small></div><button class="btn">مراسلة</button></div>`).join('')||'<div class="small">لا يوجد مستخدمون بهذا الاسم</div>';
  }else{
    box.innerHTML=d.conversations.length?d.conversations.map(c=>`<div class="user-row chat-select ${state.activeChat===c.user.id?'selected-chat':''}" data-id="${c.user.id}">${avatar(c.user)}<div class="meta"><b>${esc(c.user.displayName)}</b><small>${esc(c.lastMessage.text||'مرفق')}${c.isTyping?' · يكتب الآن…':''}</small></div>${c.unread?`<em class="unread-count">${c.unread}</em>`:''}</div>`).join(''):'<div class="small">لا توجد محادثات بعد</div>';
  }
  $$('.chat-select').forEach(x=>x.onclick=()=>openMessenger(x.dataset.id));
}
async function ensureMessengerView(){
  let chat=$('#chatArea');
  if(chat) return chat;
  state.page='messenger';
  await renderPage();
  return $('#chatArea');
}
async function openMessenger(uid){
  if(!uid) return;
  state.activeChat=uid;
  const chat=await ensureMessengerView();
  if(!chat){toast('تعذر فتح Messenger');return;}
  $('#messengerLayout')?.classList.add('chat-open');
  state.chatBefore=null; state.chatHasOlder=false; state.chatLastMessageAt=0; const d=await api('/api/messenger/'+uid+'?limit=80'); state.chatBefore=d.nextBefore||null; state.chatHasOlder=Boolean(d.hasOlder); state.chatLastMessageAt=(d.messages||[]).reduce((m,x)=>Math.max(m,new Date(x.createdAt).getTime()),0);
  state.replyTo=null; chat.innerHTML=`<div class="chat-head"><button class="icon-btn chat-back" id="chatBack">←</button>${avatar(d.user)}<div class="meta"><b>${esc(d.user.displayName)}</b><small id="presenceText">${d.user.isOnline?'🟢 متصل':'⚪ غير متصل'}</small><small id="typingText" class="typing-text hidden">يكتب الآن…</small></div><div class="chat-head-actions"><button class="icon-btn" id="audioCall" title="مكالمة صوتية">📞</button><button class="icon-btn" id="videoCall" title="مكالمة فيديو">🎥</button></div></div><div id="messages" class="messages"></div><div id="replyBar" class="reply-bar hidden"></div><div class="chat-input"><button class="btn" id="emojiMsg" title="إيموجي">😊</button><input id="msgInput" placeholder="اكتب رسالة..." autocomplete="off"><label class="btn attach-btn">🖼️<input id="msgFile" type="file" accept="image/*,.pdf,.zip,.doc,.docx,.txt" hidden></label><button class="btn" id="voiceBtn" title="رسالة صوتية">🎙️</button><button class="primary" id="sendMsg">إرسال</button></div>`;
  renderMessages(d.messages||[],false);
  $('#chatBack').onclick=()=>{$('#messengerLayout')?.classList.remove('chat-open');state.activeChat=null;loadConversations()};
  $('#sendMsg').onclick=sendMessage;
  $('#msgInput').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMessage()}};
  $('#msgInput').oninput=()=>{api('/api/messages/typing',{method:'POST',body:JSON.stringify({to:uid})}).catch(()=>{});};
  $('#audioCall').onclick=()=>startCall(uid,'audio');
  $('#videoCall').onclick=()=>startCall(uid,'video');
  $('#voiceBtn').onclick=recordVoice;
  $('#emojiMsg').onclick=()=>{const input=$('#msgInput');if(input){input.value+=' 😊';input.focus()}};
  $('#replyBar')?.addEventListener('click',e=>{if(e.target.closest('.reply-cancel')){state.replyTo=null;renderReplyBar();}});
  renderReplyBar();
  $('#msgFile').onchange=()=>{const f=$('#msgFile').files?.[0];if(f)toast('جاهز للإرسال: '+f.name)};
  $('#messages').onscroll=()=>{const box=$('#messages');if(box&&box.scrollTop<120)loadOlderMessages();};
  if(state.typingPollTimer)clearInterval(state.typingPollTimer);
  state.typingPollTimer=setInterval(async()=>{if(state.activeChat!==uid||!$('#typingText'))return;try{const t=await api('/api/messages/typing?with='+encodeURIComponent(uid));$('#typingText')?.classList.toggle('hidden',!t.typing)}catch{}},1200);
  if(!state.chatPollTimer)state.chatPollTimer=setInterval(async()=>{if(!state.activeChat||document.visibilityState!=='visible'||state.page!=='messenger')return;try{const after=state.chatLastMessageAt?('&after='+state.chatLastMessageAt):'';const x=await api('/api/messenger/'+state.activeChat+'?limit=80'+after);if((x.messages||[]).length){renderMessages(x.messages,true);state.chatLastMessageAt=Math.max(state.chatLastMessageAt,...x.messages.map(m=>new Date(m.createdAt).getTime()));}const p=$('#presenceText');if(p)p.textContent=x.user.isOnline?'🟢 متصل':'⚪ غير متصل'}catch{}},4200);
}
function messageHtml(m){
  const reactions=Object.entries(m.reactionSummary||{}).map(([k,v])=>({like:'👍',love:'❤️',care:'🥰',haha:'😂',wow:'😮',sad:'😢',angry:'😡'}[k]||k)+' '+v).join(' · ');
  const reply=m.replyTo?`<div class="msg-reply"><b>رد على</b><span>${esc(m.replyTo.text||'مرفق')}</span></div>`:'';
  let media='';
  if(m.media?.kind==='video') media=`<video controls playsinline src="${m.media.path}" class="chat-media"></video>`;
  else if(m.media?.kind==='image') media=`<img src="${m.media.path}" class="chat-media" loading="lazy">`;
  else if(m.media) media=`<a class="file-link" href="${m.media.path}" target="_blank" rel="noopener">📎 ${esc(m.media.name||'ملف')}</a>`;
  const actions=!m.deleted?`<button class="msg-react" data-id="${m.id}" title="تفاعل">😊</button><button class="msg-reply-btn" data-id="${m.id}" title="رد">↩</button>`:'';
  const own=m.from===state.user.id&&!m.deleted;
  return `<div class="bubble ${m.from===state.user.id?'mine':''} ${m.deleted?'deleted-msg':''}" data-msg="${m.id}">${m.deleted?'<i>تم حذف الرسالة</i>':`${reply}<span class="msg-text">${esc(m.text||'')}</span>${media}${m.voice?`<audio controls preload="metadata" src="${m.voice.path}"></audio>`:''}` }<small class="msg-meta">${m.editedAt&&!m.deleted?'معدلة · ':''}${m.readAt?'✓✓':'✓'} · ${new Date(m.createdAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</small>${reactions?`<div class="msg-reactions">${esc(reactions)}</div>`:''}<div class="msg-tools">${actions}<button class="msg-copy" data-id="${m.id}" title="نسخ الرسالة">📋</button>${own?`<button class="msg-edit" data-id="${m.id}" title="تعديل">✏️</button><button class="msg-delete" data-id="${m.id}" title="حذف">🗑️</button>`:''}</div></div>`;
}
function renderMessages(messages,append=true){
  const old=$('#messages');if(!old)return;
  const html=(messages||[]).map(messageHtml).join('');
  if(append&&messages.length){const stick=old.scrollHeight-old.scrollTop-old.clientHeight<80;old.insertAdjacentHTML('beforeend',html);if(stick)old.scrollTop=old.scrollHeight;}
  else{old.innerHTML=html;old.scrollTop=old.scrollHeight;}
  bindMessageActions();
}
function renderReplyBar(){const bar=$('#replyBar');if(!bar)return;bar.classList.toggle('hidden',!state.replyTo);bar.innerHTML=state.replyTo?`<div><b>↩ رد على</b><span>${esc(state.replyTo.text||'مرفق')}</span></div><button class="icon-btn reply-cancel" type="button">×</button>`:'';}
function openMessageReaction(id){showModal(`<h3>تفاعل مع الرسالة</h3><div class="reaction-picker">${[['like','👍'],['love','❤️'],['care','🥰'],['haha','😂'],['wow','😮'],['sad','😢'],['angry','😡']].map(([k,e])=>`<button class="chip messageReactionPick" data-id="${id}" data-type="${k}">${e}</button>`).join('')}</div>`);$$('.messageReactionPick').forEach(b=>b.onclick=async()=>{try{await api('/api/messages/react',{method:'POST',body:JSON.stringify({messageId:b.dataset.id,type:b.dataset.type})});closeModal();await openMessenger(state.activeChat);}catch(e){toast(e.data?.error||'تعذر إضافة التفاعل')}});}
function bindMessageActions(){
  $$('.msg-copy').forEach(b=>{if(b.dataset.bound==='1')return;b.dataset.bound='1';b.onclick=async()=>{const node=document.querySelector(`[data-msg="${b.dataset.id}"]`);const txt=node?.querySelector('.msg-text')?.textContent||'';if(!txt)return toast('لا يوجد نص لنسخه');try{await navigator.clipboard.writeText(txt.trim());toast('تم نسخ الرسالة')}catch{toast('تعذر نسخ الرسالة')}}});
  $$('.msg-react').forEach(b=>{if(b.dataset.bound==='1')return;b.dataset.bound='1';b.onclick=()=>openMessageReaction(b.dataset.id)});
  $$('.msg-reply-btn').forEach(b=>{if(b.dataset.bound==='1')return;b.dataset.bound='1';b.onclick=()=>{const node=document.querySelector(`[data-msg="${b.dataset.id}"]`);state.replyTo={id:b.dataset.id,text:node?.querySelector('.msg-text')?.textContent||'مرفق'};renderReplyBar();$('#msgInput')?.focus();}});
  $$('.msg-edit').forEach(b=>{if(b.dataset.bound==='1')return;b.dataset.bound='1';b.onclick=async()=>{const node=document.querySelector(`[data-msg="${b.dataset.id}"]`);const current=node?.querySelector('.msg-text')?.textContent||'';showModal(`<h3>تعديل الرسالة</h3><textarea id="editMsgText" class="field">${esc(current)}</textarea><button class="primary" id="saveEditMsg">حفظ</button>`);$('#saveEditMsg').onclick=async()=>{try{await api('/api/messages/edit',{method:'POST',body:JSON.stringify({messageId:b.dataset.id,text:$('#editMsgText').value})});closeModal();await openMessenger(state.activeChat);}catch(e){toast(e.data?.error==='EDIT_WINDOW_EXPIRED'?'انتهت مدة تعديل الرسالة':e.data?.error||'تعذر تعديل الرسالة')}};};});
  $$('.msg-delete').forEach(b=>{if(b.dataset.bound==='1')return;b.dataset.bound='1';b.onclick=async()=>{try{await api('/api/messages/delete',{method:'POST',body:JSON.stringify({messageId:b.dataset.id})});await openMessenger(state.activeChat)}catch(e){toast(e.data?.error||'تعذر حذف الرسالة')}}});
}
async function loadOlderMessages(){
  if(state.chatLoadingOlder||!state.activeChat||!state.chatBefore||!state.chatHasOlder)return;
  const box=$('#messages');if(!box)return;state.chatLoadingOlder=true;const before=state.chatBefore;const oldHeight=box.scrollHeight;
  try{const x=await api('/api/messenger/'+state.activeChat+'?limit=80&before='+encodeURIComponent(before));const incoming=x.messages||[];if(incoming.length){box.insertAdjacentHTML('afterbegin',incoming.map(messageHtml).join(''));bindMessageActions();state.chatBefore=x.nextBefore||null;state.chatHasOlder=Boolean(x.hasOlder);box.scrollTop=box.scrollHeight-oldHeight;}}
  catch{toast('تعذر تحميل الرسائل القديمة')}finally{state.chatLoadingOlder=false;}
}
async function sendMessage(){const input=$('#msgInput');const f=$('#msgFile');if(!input||!state.activeChat)return;let media=null;if(f?.files?.[0])media=await uploadFile(f.files[0]);const text=input.value.trim();if(!text&&!media)return;try{await api('/api/messages/send',{method:'POST',body:JSON.stringify({to:state.activeChat,text,media,replyTo:state.replyTo?.id||null})});input.value='';if(f)f.value='';state.replyTo=null;renderReplyBar();await openMessenger(state.activeChat);await loadConversations();}catch(e){toast(e.data?.error||'تعذر إرسال الرسالة')}}
async function recordVoice(){
  if(state.recording){state.recording.stop();toast('جارٍ تجهيز الرسالة الصوتية...');return}
  if(!state.activeChat)return;
  try{
    const s=await navigator.mediaDevices.getUserMedia({audio:true});
    const rec=new MediaRecorder(s);const chunks=[];rec.ondataavailable=e=>e.data.size&&chunks.push(e.data);
    rec.onstop=async()=>{s.getTracks().forEach(t=>t.stop());const blob=new Blob(chunks,{type:rec.mimeType||'audio/webm'});const file=new File([blob],'voice.webm',{type:blob.type});try{const media=await uploadFile(file);await api('/api/messages/send',{method:'POST',body:JSON.stringify({to:state.activeChat,text:'🎙️ رسالة صوتية',voice:media})});toast('تم إرسال الرسالة الصوتية');await openMessenger(state.activeChat)}catch(e){toast('تعذر إرسال الرسالة الصوتية')}finally{state.recording=null;$('#voiceBtn')&&( $('#voiceBtn').textContent='🎙️')}};
    rec.start();state.recording=rec;$('#voiceBtn').textContent='⏹️';toast('جاري التسجيل… اضغط مرة أخرى للإيقاف');
  }catch{toast('تعذر الوصول للميكروفون')}
}
async function validateUploadFile(file){
  const max=25*1024*1024;
  if(!file)return 'NO_FILE';
  if(file.size>max)return 'FILE_TOO_LARGE';
  const allowed=/^(image\/(jpeg|png|webp|gif|avif)|video\/(mp4|webm|quicktime)|audio\/(webm|ogg|mpeg|wav)|application\/(pdf|zip))$/i;
  if(!allowed.test(file.type||''))return 'UNSUPPORTED_MEDIA_TYPE';
  return '';
}
async function uploadFile(file){const v=await validateUploadFile(file);if(v)throw Object.assign(new Error(v),{data:{error:v}});const data=await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=rej;r.readAsDataURL(file)});const d=await api('/api/media',{method:'POST',body:JSON.stringify({data,name:file.name})});return {path:d.path,mime:d.mime,kind:d.kind||file.type||d.mime,name:file.name,id:d.id};}
async function pageStories(){const d=await api('/api/stories');return `<div class="section-title"><h2>Stories</h2><button class="primary" id="createStory">＋ إنشاء قصة</button></div>${renderStories(d.stories)}<div class="card panel"><p>القصص تختفي تلقائيًا بعد 24 ساعة.</p></div>`}
async function pageReels(){const d=await api('/api/posts?tab=reels');return genericSection('Reels',`<div class="reels-shell">${d.posts.map(renderPost).join('')||'<div class="card panel">لا توجد Reels بعد. أنشئ منشور فيديو واختر «نشر كـ Reel».</div>'}</div>`)}
function genericSection(title,html){return `<div class="section-title"><h2>${title}</h2></div>${html}`}
async function pageGroups(){const d=await api('/api/groups');return genericSection('المجموعات',`<div class="toolbar-row"><button class="primary" id="newGroup">＋ إنشاء مجموعة</button><input id="groupSearch" class="field" placeholder="بحث في المجموعات..."></div><div id="groupsGrid" class="grid" style="margin-top:12px">${d.groups.map(g=>`<div class="card panel entity-card"><div class="entity-cover" style="${g.cover?`background-image:url('${g.cover}')`:''}"></div><div class="entity-body"><h3>${esc(g.name)}</h3><p>${esc(g.description||'')}</p><small>${g.members} أعضاء · ${g.privacy==='private'?'🔒 خاصة':'🌍 عامة'} · ${g.isMember?'✅ أنت عضو':''}</small><div class="entity-actions"><button class="btn openGroup" data-id="${g.id}">فتح</button><button class="btn shareGroup" data-id="${g.id}">↗</button>${g.isMember?`<button class="btn leaveGroup" data-id="${g.id}">مغادرة</button>`:`<button class="primary joinGroup" data-id="${g.id}">انضمام</button>`}</div></div></div>`).join('')||'<div class="card panel">لا توجد مجموعات بعد.</div>'}</div>`)}
async function pagePages(){const d=await api('/api/pages');return genericSection('الصفحات',`<div class="toolbar-row"><button class="primary" id="newPage">＋ إنشاء صفحة</button><input id="pageSearch" class="field" placeholder="بحث في الصفحات..."></div><div class="grid" style="margin-top:12px">${d.pages.map(p=>`<div class="card panel entity-card"><div class="page-avatar">${p.avatar?`<img src="${p.avatar}">`:`${esc(initials(p.name))}`}</div><div class="entity-body"><h3>${esc(p.name)}</h3><p>${esc(p.description||'')}</p><small>${esc(p.category||'عام')} · ${p.followers} متابع · ${p.following?'✅ تتابع':''}</small><div class="entity-actions"><button class="btn openPage" data-id="${p.id}">فتح</button><button class="btn sharePage" data-id="${p.id}">↗</button><button class="${p.following?'btn':'primary'} followPage" data-id="${p.id}">${p.following?'إلغاء المتابعة':'متابعة'}</button></div></div></div>`).join('')||'<div class="card panel">لا توجد صفحات بعد.</div>'}</div>`)}
async function pageMarketplace(){const d=await api('/api/marketplace');return genericSection('Marketplace',`<div class="toolbar-row marketplace-toolbar"><button class="primary" id="newItem">＋ إنشاء إعلان</button><input id="marketSearch" class="field" placeholder="ابحث في Marketplace..."><select id="marketCat" class="field"><option value="">كل التصنيفات</option><option>سيارات</option><option>إلكترونيات</option><option>ملابس</option><option>منزل</option><option>خدمات</option><option>other</option></select><select id="marketSort" class="field"><option value="newest">الأحدث</option><option value="price_asc">السعر الأقل</option><option value="price_desc">السعر الأعلى</option></select></div><div id="marketGrid" class="grid marketplace-grid">${d.items.map(renderMarketplaceItem).join('')||'<div class="card panel">لا توجد إعلانات.</div>'}</div>`)}
function renderMarketplaceItem(x){return `<article class="card panel market-card">${x.media?.path?`<img src="${x.media.path}" class="market-img">`:`<div class="market-placeholder">🛍️</div>`}<div class="market-content"><div class="small">${esc(x.category||'other')}</div><h3>${esc(x.title)}</h3><div class="market-price">${esc(x.price||'حسب الاتفاق')}</div><p>${esc(x.description||'')}</p><small>📍 ${esc(x.location||'')}</small><div class="seller-line">${avatar(x.seller)}<span>${esc(x.seller?.displayName||'البائع')}</span></div><div class="entity-actions">${x.sellerId===state.user.id?`<button class="btn deleteMarket" data-id="${x.id}">🗑️ حذف</button>`:`<button class="primary contactSeller" data-id="${x.sellerId}">💬 التواصل مع البائع</button>`}</div></div></article>`}
async function pageMemories(){const d=await api('/api/memories');return genericSection('ذكرياتك',`<div class="card panel"><p>منشورات قديمة تعود إلى نفس التاريخ التقريبي من السنوات السابقة.</p></div>${(d.items||[]).map(renderPost).join('')||'<div class="card panel">لا توجد ذكريات لهذا اليوم.</div>'}`)}
async function pageEvents(){const d=await api('/api/events');return genericSection('الأحداث',`<div class="toolbar-row"><button class="primary" id="newEvent">＋ إنشاء حدث</button><select id="eventFilter" class="field"><option value="all">كل الأحداث</option><option value="upcoming">القادمة</option><option value="mine">أحداثي</option></select></div><div id="eventsGrid" class="grid" style="margin-top:12px">${d.events.map(renderEventCard).join('')||'<div class="card panel">لا توجد أحداث.</div>'}</div>`)}
function renderEventCard(e){const status=e.myStatus;return `<article class="card panel event-card"><div class="event-date"><b>${new Date(e.date).toLocaleDateString()}</b><small>${new Date(e.date).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</small></div><h3>${esc(e.title)}</h3><p>${esc(e.description||'')}</p><p>📍 ${esc(e.location||'')}</p><small>المضيف: ${esc(e.host?.displayName||'')}</small><div class="event-counts">✅ ${e.counts.going} · ⭐ ${e.counts.interested}</div><div class="entity-actions"><button class="${status==='going'?'primary':'btn'} rsvp" data-id="${e.id}" data-status="going">✅ سأحضر</button><button class="${status==='interested'?'primary':'btn'} rsvp" data-id="${e.id}" data-status="interested">⭐ مهتم</button>${status?`<button class="btn rsvp" data-id="${e.id}" data-status="none">إلغاء</button>`:''}${e.hostId===state.user.id?`<button class="btn deleteEvent" data-id="${e.id}">🗑️</button>`:''}</div></article>`}
async function pageCalls(){const d=await api('/api/calls/history');const labels={ringing:'جاري الاتصال',accepted:'متصل',rejected:'مرفوضة',missed:'فائتة',ended:'انتهت'};return genericSection('سجل المكالمات',`<div class="card panel call-history">${d.items.map(c=>`<div class="user-row call-row"><div class="call-icon">${c.type==='video'?'🎥':'📞'}</div><div class="meta"><b>${esc(c.other?.displayName||'مستخدم')}</b><small>${labels[c.status]||c.status} · ${new Date(c.createdAt).toLocaleString()}</small></div><span class="call-status ${c.status}">${labels[c.status]||c.status}</span></div>`).join('')||'<div class="small">لا يوجد سجل مكالمات</div>'}</div>`)}
async function pageNotifications(){const d=await api('/api/notifications');const perm=('Notification' in window)?Notification.permission:'unsupported';return genericSection('مركز الإشعارات',`<div class="card panel notification-tools"><div><b>إشعارات المتصفح</b><div class="small">الحالة: ${perm}</div></div><button class="btn" id="enableNotifications">🔔 تفعيل</button><button class="btn" id="installPwaNow">📲 تثبيت التطبيق</button><button class="btn" id="readAll">تعليم الكل كمقروء</button><button class="btn danger-btn" id="clearNotifications">🗑️ مسح الكل</button></div><div class="list" style="margin-top:12px">${d.items.map(n=>`<div class="card panel notification-item ${n.read?'read':'unread'}"><div class="notification-icon">${n.type==='message'?'💬':n.type==='call'?'📞':n.type==='friend'?'👥':n.type==='follow'?'👤':'🔔'}</div><div><b>${esc(n.title)}</b><p>${esc(n.body)}</p><small>${new Date(n.createdAt).toLocaleString()}</small></div><button class="btn deleteNotification" data-id="${n.id}">×</button></div>`).join('')||'<div class="small">لا توجد إشعارات</div>'}</div>`) }
async function pageSettings(){
  const d=await api('/api/settings'); const p=d.privacy||{}; const n=d.notifications||{};
  const native=!!window.LutsaNative?.isAndroid; let bio='';
  if(native){let available=false,enabled=false;try{available=!!window.LutsaNative.isBiometricAvailable();enabled=!!window.LutsaNative.isBiometricEnabled();}catch{}
    bio=available?`<label><input type="checkbox" id="biometricLock" ${enabled?'checked':''}> 🔐 قفل LUTSA بالبصمة بعد الخمول</label><small class="small">يطلب التحقق بعد عودة التطبيق من الخلفية لمدة 30 ثانية أو أكثر.</small><br>`:`<small class="small">المصادقة الحيوية غير متاحة على هذا الجهاز.</small><br>`;}
  const sessions=await api('/api/sessions').catch(()=>({items:[]}));
  return genericSection('الإعدادات',`
  <div class="card panel ui-preferences"><h3>المظهر واللغة</h3><div class="settings-grid compact-settings"><label>اللغة <select id="uiLanguage"><option value="ar" ${state.lang==='ar'?'selected':''}>العربية</option><option value="en" ${state.lang==='en'?'selected':''}>English</option></select></label><label>المظهر <select id="uiTheme"><option value="system" ${state.theme==='system'?'selected':''}>تلقائي</option><option value="light" ${state.theme==='light'?'selected':''}>فاتح</option><option value="dark" ${state.theme==='dark'?'selected':''}>داكن</option></select></label></div><p class="small">يُحفظ الاختيار على هذا الجهاز ويُطبّق على PWA ونسخة الهاتف.</p></div>
  <div class="card panel settings-panel"><h3>الخصوصية</h3>
    <label>من يستطيع مراسلتي <select id="messageWho"><option value="everyone" ${p.messageWho==='everyone'?'selected':''}>الجميع</option><option value="friends" ${p.messageWho==='friends'?'selected':''}>الأصدقاء</option><option value="nobody" ${p.messageWho==='nobody'?'selected':''}>لا أحد</option></select></label><br>
    <label>خصوصية الملف <select id="profilePrivacy"><option value="public" ${p.profile==='public'?'selected':''}>عام</option><option value="friends" ${p.profile==='friends'?'selected':''}>الأصدقاء</option></select></label><br>
    <label><input type="checkbox" id="readReceipts" ${p.readReceipts!==false?'checked':''}> إيصالات القراءة</label><br>
    <label><input type="checkbox" id="activityStatus" ${p.activityStatus!==false?'checked':''}> حالة النشاط</label>
    <hr><h3>إشعارات</h3>
    <div class="settings-grid">
      <label><input type="checkbox" id="notifMessages" ${n.messages!==false?'checked':''}> 💬 الرسائل</label>
      <label><input type="checkbox" id="notifCalls" ${n.calls!==false?'checked':''}> 📞 المكالمات</label>
      <label><input type="checkbox" id="notifFriends" ${n.friends!==false?'checked':''}> 👥 طلبات الصداقة</label>
      <label><input type="checkbox" id="notifFollows" ${n.follows!==false?'checked':''}> 👤 المتابعون</label>
      <label><input type="checkbox" id="notifReactions" ${n.reactions!==false?'checked':''}> 👍 التفاعلات</label>
      <label><input type="checkbox" id="notifComments" ${n.comments!==false?'checked':''}> 💬 التعليقات</label>
      <label><input type="checkbox" id="notifShares" ${n.shares!==false?'checked':''}> ↗ المشاركات</label>
      <label><input type="checkbox" id="notifEvents" ${n.events!==false?'checked':''}> 📅 الأحداث</label>
      <label><input type="checkbox" id="notifGroups" ${n.groups!==false?'checked':''}> 👥 المجموعات</label>
      <label><input type="checkbox" id="notifPages" ${n.pages!==false?'checked':''}> 📄 الصفحات</label>
      <label><input type="checkbox" id="notifGeneral" ${n.general!==false?'checked':''}> 🔔 الأخرى</label>
    </div>
    <hr>${bio}
    <button class="primary" id="saveSettings">حفظ الإعدادات</button>
    <button class="btn" id="enableNotificationsFromSettings">🔔 إشعارات المتصفح</button>
    <button class="btn" id="changePassword">🔐 تغيير كلمة المرور</button>
    <button class="btn" id="exportData">📥 تنزيل بياناتي</button>
    <button class="btn" id="revokeSessions">🔒 تسجيل الخروج من الأجهزة الأخرى</button>
    <button class="btn danger-btn" id="deleteAccount">🗑️ حذف الحساب</button>
  </div>
  <div class="card panel" style="margin-top:12px"><h3>الأجهزة والجلسات</h3><p class="small">راجع الجلسات المفتوحة وأنهِ أي جلسة لا تعرفها.</p><div id="sessionList">${(sessions.items||[]).map(x=>`<div class="user-row"><div class="meta"><b>${x.current?'🟢 هذا الجهاز':'📱 جهاز آخر'}</b><small>${esc(x.label||'')} ${esc(x.userAgent||'')} · ${new Date(x.createdAt).toLocaleString()}</small></div>${x.current?'':`<button class="btn revoke-one-session" data-id="${x.sessionKey}">إنهاء</button>`}</div>`).join('')||'<div class="small">لا توجد جلسات أخرى.</div>'}</div></div>`);
}
async function pageProfile(uid=state.user.id){const d=await api('/api/users/'+uid); const media=d.posts.filter(p=>p.media); const tab=state.profileTab||'posts'; const body=d.privateProfile?`<div class="card panel privacy-banner">🔒 هذا الملف متاح للأصدقاء فقط. أضف المستخدم إلى أصدقائك لعرض المنشورات والوسائط.</div>`:tab==='about'?`<div class="card panel profile-about"><h3>حول</h3><p><b>الاسم:</b> ${esc(d.user.displayName)}</p><p><b>اسم المستخدم:</b> @${esc(d.user.username)}</p><p><b>السيرة:</b> ${esc(d.user.bio||'لا توجد سيرة بعد')}</p><p><b>تاريخ الانضمام:</b> ${new Date(d.user.createdAt).toLocaleDateString()}</p></div>`:tab==='media'?`<div class="media-grid">${media.map(p=>p.media?.kind?.startsWith('video')?`<video controls playsinline src="${p.media.path}"></video>`:`<img src="${p.media.path}" loading="lazy">`).join('')||'<div class="card panel">لا توجد صور أو فيديوهات.</div>'}</div>`:`<div class="profile-posts">${d.posts.map(renderPost).join('')||'<div class="card panel">لا توجد منشورات بعد.</div>'}</div>`; return `<div class="card profile-card"><div class="profile-cover" style="${d.user.cover?`background-image:url('${d.user.cover}')`:''}"></div><div class="profile-block"><div class="profile-main">${avatar(d.user,'avatar')}<div class="profile-ident"><h2>${esc(d.user.displayName)}</h2><p>@${esc(d.user.username)} · ${d.user.isOnline?'🟢 متصل':'⚪ غير متصل'}</p></div><div class="profile-actions">${uid===state.user.id?'<button class="primary" id="editProfile">✏️ تعديل الملف</button><button class="btn" id="shareProfile">↗ مشاركة</button>':`<button class="primary" id="followProfile" data-id="${uid}">${d.relationship.following?'إلغاء المتابعة':'متابعة'}</button><button class="btn" id="friendProfile" data-id="${uid}">${d.relationship.status==='accepted'?'إزالة الصداقة':'إضافة صديق'}</button><button class="btn" id="messageProfile" data-id="${uid}">💬 رسالة</button><button class="btn" id="callProfile" data-id="${uid}">📞 اتصال</button><button class="btn" id="shareProfile">↗ مشاركة</button>`}</div></div><p class="profile-bio">${esc(d.user.bio||'')}</p><div class="stats"><div class="stat"><b>${d.counts.posts}</b>منشورات</div><div class="stat"><b>${d.counts.media}</b>وسائط</div><div class="stat"><b>${d.counts.followers}</b>متابعون</div><div class="stat"><b>${d.counts.following}</b>يتابع</div></div><div class="profile-tabs"><button class="${tab==='posts'?'active':''}" data-profile-tab="posts">المنشورات</button><button class="${tab==='about'?'active':''}" data-profile-tab="about">حول</button><button class="${tab==='media'?'active':''}" data-profile-tab="media">الصور والفيديو</button></div></div></div><div style="margin-top:14px">${body}</div>`}
async function pageLive(){const d=await api('/api/stream');const s=d.stream;return genericSection('البث المباشر',s?`<div class="card panel"><div class="live-box"><div><div style="font-size:38px">🔴</div><h2>${esc(s.title)}</h2><p>${s.viewerIds.length} مشاهد</p><button class="primary" id="joinLive">دخول البث</button>${s.hostId===state.user.id?`<button class="btn" id="endLive">إنهاء البث</button>`:''}</div></div></div>`:`<div class="card panel"><p>لا يوجد بث مباشر حاليًا.</p><button class="primary" id="startLive">🔴 بدء بث مباشر</button></div>`)}

async function pageMedia(){
  const d=await api('/api/media');
  return genericSection('ملفاتي ووسائطي',`<div class="card panel media-center"><div class="section-title"><div><h3>مركز الوسائط</h3><p class="small">الملفات التي رفعتها إلى LUTSA. الحذف هنا يحذف الملف من الخادم أيضًا.</p></div><button class="primary" id="refreshMedia">🔄 تحديث</button></div><div class="media-manager-grid">${(d.items||[]).map(m=>`<div class="media-manager-item"><div class="media-thumb">${m.kind==='video'?`<video src="${m.path}" muted></video>`:m.kind==='image'?`<img src="${m.path}" loading="lazy">`:m.kind==='audio'?`<audio src="${m.path}" controls></audio>`:`📄`}</div><div class="media-meta"><b>${esc(m.name||m.id)}</b><small>${esc(m.kind)} · ${Math.round(m.size/1024)} KB</small></div><button class="btn danger-btn deleteMedia" data-id="${m.id}">🗑️ حذف</button></div>`).join('')||'<div class="small">لا توجد وسائط مرفوعة.</div>'}</div></div>`);
}
async function pageSaved(){const d=await api('/api/collections');const groups=(d.collections||[]).map(c=>`<div class="card panel saved-collection"><div class="section-title"><div><h3>📁 ${esc(c.name)}</h3><small>${c.count} منشور</small></div><div><button class="btn openCollection" data-id="${c.id}">فتح</button><button class="btn danger-btn deleteCollection" data-id="${c.id}">🗑️</button></div></div></div>`).join('');return genericSection('المحفوظات',`<div class="card panel"><div class="toolbar-row"><input id="collectionName" class="field" placeholder="اسم مجموعة جديدة"><button class="primary" id="createCollection">＋ إنشاء مجموعة</button></div></div>${groups||'<div class="card panel">لا توجد مجموعات محفوظات بعد.</div>'}<div id="savedCollectionView"></div>`)}
async function pageAdmin(){
  const [s,r,u,po,sys,audit,med,pushCfg]=await Promise.all([api('/api/admin/stats'),api('/api/admin/reports'),api('/api/admin/users'),api('/api/admin/posts'),api('/api/admin/system'),api('/api/admin/audit'),api('/api/admin/media'),api('/api/admin/push/config')]);
  const cards=[['users','المستخدمون','👥'],['activeUsers','نشطون الآن','🟢'],['posts','المنشورات','📰'],['stories','Stories','📖'],['messages','الرسائل','💬'],['groups','المجموعات','👥'],['groupMembers','أعضاء المجموعات','🧑‍🤝‍🧑'],['pages','الصفحات','📄'],['pageFollowers','متابعو الصفحات','👤'],['marketplace','الإعلانات','🛍️'],['events','الأحداث','📅'],['calls','المكالمات','📞'],['videoCalls','فيديو','🎥'],['streams','بث مباشر','🔴'],['streamViewers','مشاهدو البث','👀'],['reports','البلاغات','⚑'],['openReports','بلاغات مفتوحة','⚠️'],['audit','السجل الإداري','🛡️']];
  return genericSection('لوحة الإدارة',`<div class="admin-tools card panel"><div><h3>الأمان والنسخ الاحتياطي</h3><p class="small">إدارة JSON والنسخ الاحتياطي وسجل العمليات. النسخة الاحتياطية لا تتضمن الجلسات أو إشارات WebRTC المؤقتة.</p></div><div class="toolbar-row"><button class="primary" id="createBackup">💾 تنزيل نسخة احتياطية</button><label class="btn">↩️ استعادة JSON<input id="restoreFile" type="file" accept="application/json,.json" hidden></label><button class="btn" id="refreshAdmin">🔄 تحديث</button></div><div class="system-mini"><span>Node ${esc(sys.node)}</span><span>Uptime ${esc(String(sys.uptime))}s</span><span>Uploads ${esc(String(sys.uploadsFiles))} ملف · ${Math.round((sys.uploadsBytes||0)/1024/1024*10)/10} MB</span><span>Backups ${esc(String(sys.backupFiles))}</span><span>Push ${pushCfg.configured?'✅ VAPID':'⚪ غير مفعّل'}</span></div><div class="toolbar-row" style="margin-top:10px">${pushCfg.configured?`<button class="btn" id="adminPushTest">🔔 اختبار إشعار Push</button>`:`<span class="small">لتفعيل Push الحقيقي أضف VAPID_PUBLIC_KEY وVAPID_PRIVATE_KEY_B64 وVAPID_SUBJECT إلى .env</span>`}</div></div><div class="card panel media-admin-panel"><div class="section-title"><div><h3>🗂️ إدارة الوسائط</h3><small class="small">${med.items.length} سجل · ${med.orphanCount} ملفات غير مرتبطة بسجل JSON</small></div><button class="btn" id="cleanupOrphanMedia">🧹 تنظيف الملفات غير المرتبطة</button></div><div class="media-admin-list">${med.items.slice(0,30).map(m=>`<div class="user-row"><div class="media-admin-kind">${m.kind==='image'?'🖼️':m.kind==='video'?'🎥':m.kind==='audio'?'🎙️':'📄'}</div><div class="meta"><b>${esc(m.name||m.id)}</b><small>${esc(m.ownerId)} · ${Math.round((m.bytes||m.size||0)/1024)} KB · ${m.exists?'✅':'❌'}</small></div><button class="btn danger-btn adminMediaDelete" data-id="${m.id}">🗑️</button></div>`).join('')||'<div class="small">لا توجد وسائط مسجلة.</div>'}</div></div><div class="admin-stats-grid">${cards.map(([k,l,ic])=>`<div class="admin-stat"><span>${ic}</span><b>${s[k]??0}</b><small>${l}</small></div>`).join('')}</div><div class="admin-columns"><div class="card panel"><div class="section-title"><h3>المستخدمون والصلاحيات</h3><input id="adminUserSearch" class="field admin-search" placeholder="بحث عن مستخدم..."></div><div id="adminUsersList">${u.users.map(x=>`<div class="user-row admin-user-row" data-search="${esc((x.displayName+' '+x.username).toLowerCase())}">${avatar(x)}<div class="meta"><b>${esc(x.displayName)}</b><small>@${esc(x.username)} · ${x.isOnline?'🟢':'⚪'} ${x.disabled?'· موقوف':''}</small></div><select class="roleSelect" data-id="${x.id}"><option value="user" ${x.role==='user'?'selected':''}>user</option><option value="admin" ${x.role==='admin'?'selected':''}>admin</option></select>${x.id!==state.user.id?`<button class="btn userDisable" data-id="${x.id}" data-disabled="${x.disabled?'false':'true'}">${x.disabled?'تفعيل':'إيقاف'}</button>`:''}</div>`).join('')}</div></div><div class="card panel"><h3>البلاغات</h3>${r.reports.slice(0,50).map(x=>`<div class="user-row"><div class="meta"><b>${esc(x.reason||'بلاغ')}</b><small>${esc(x.status)} · ${new Date(x.createdAt).toLocaleString()}</small></div><select class="reportStatus" data-id="${x.id}"><option value="open" ${x.status==='open'?'selected':''}>مفتوح</option><option value="reviewing" ${x.status==='reviewing'?'selected':''}>قيد المراجعة</option><option value="resolved" ${x.status==='resolved'?'selected':''}>تم الحل</option><option value="rejected" ${x.status==='rejected'?'selected':''}>مرفوض</option></select></div>`).join('')||'<div class="small">لا توجد بلاغات</div>'}</div><div class="card panel"><h3>إدارة المنشورات</h3>${po.posts.slice(0,50).map(x=>`<div class="user-row"><div class="meta"><b>${esc(x.author?.displayName||'')}</b><small>${esc((x.text||'').slice(0,100))}</small></div>${x.deleted?'<span class="small">محذوف</span>':`<button class="btn adminDeletePost" data-id="${x.id}">🗑️ حذف</button>`}</div>`).join('')||'<div class="small">لا توجد منشورات</div>'}</div></div><div class="card panel admin-audit"><h3>السجل الإداري</h3>${audit.items.slice(0,80).map(x=>`<div class="user-row"><div class="meta"><b>${esc(x.action)}</b><small>${esc(x.actor?.displayName||'Admin')} · ${new Date(x.createdAt).toLocaleString()} ${x.targetId?`· ${esc(x.targetId)}`:''}</small></div></div>`).join('')||'<div class="small">لا توجد عمليات مسجلة</div>'}</div>`)}

async function renderPage(){const p=state.page;let html='';try{showSkeleton();if(p==='home')html=pageHome();else if(p==='friends'){html=pageFriends()}else if(p==='messenger'){html=pageMessenger()}else if(p==='stories'){html=await pageStories()}else if(p==='reels'){html=await pageReels()}else if(p==='groups'){html=await pageGroups()}else if(p==='pages'){html=await pagePages()}else if(p==='marketplace'){html=await pageMarketplace()}else if(p==='events'){html=await pageEvents()}else if(p==='memories'){html=await pageMemories()}else if(p==='calls'){html=await pageCalls()}else if(p==='notifications'){html=await pageNotifications()}else if(p==='settings'){html=await pageSettings()}else if(p==='live'){html=await pageLive()}else if(p==='profile'){html=await pageProfile(state.profileUid||state.user.id)}else if(p==='admin'){html=await pageAdmin()}else html=pageHome();$('#page').innerHTML=html; bindPage(); enhanceReels(); if(p==='friends')loadFriends();if(p==='messenger')loadConversations();updateNav();}catch(e){toast(e.data?.error||e.message);console.error(e)}}
function resetFeed(items=[],cursor=null,hasMore=true){state.feedItems=[...(items||[])];state.feedCursor=cursor;state.feedHasMore=hasMore;state.feedInitialized=true;state.bootstrap=state.bootstrap||{};state.bootstrap.posts=state.feedItems;}
async function loadFeedPage(reset=false){
  if(state.feedLoading) return;
  if(!reset && !state.feedHasMore) return;
  state.feedLoading=true;
  try{
    const q=new URLSearchParams({tab:state.feedTab||'home',limit:'15'});
    if(!reset&&state.feedCursor)q.set('cursor',state.feedCursor);
    const d=await api('/api/posts?'+q.toString());
    if(reset) state.feedItems=[];
    const seen=new Set(state.feedItems.map(x=>x.id));
    for(const p of (d.posts||[])) if(!seen.has(p.id)) state.feedItems.push(p);
    state.feedCursor=d.nextCursor||null; state.feedHasMore=Boolean(d.hasMore);
    state.bootstrap=state.bootstrap||{}; state.bootstrap.posts=state.feedItems;
    const box=$('#feed'); if(box) box.innerHTML=state.feedItems.map(renderPost).join('')||'<div class="card panel">لا توجد منشورات في هذا القسم.</div>';
    const more=$('#feedMore'); if(more){more.textContent=state.feedHasMore?'تحميل المزيد…':'لا توجد منشورات أخرى';}
    bindPostActionsOnly();
  }catch(e){toast(e.data?.error||'تعذر تحميل المنشورات');}
  finally{state.feedLoading=false;}
}
function observeFeedMore(){
  state.feedObserver?.disconnect?.();
  const target=$('#feedMore'); if(!target) return;
  state.feedObserver=new IntersectionObserver(entries=>{for(const e of entries){if(e.isIntersecting) loadFeedPage(false)}},{rootMargin:'700px 0px'});
  state.feedObserver.observe(target);
}
function bindPostActionsOnly(){
  $$('.react').forEach(b=>b.onclick=()=>{
    const emojis={like:'👍',love:'❤️',care:'🥰',haha:'😂',wow:'😮',sad:'😢',angry:'😡'};
    showModal(`<h3>اختر التفاعل</h3><div style="display:flex;gap:8px;justify-content:center;font-size:28px">${Object.entries(emojis).map(([x,e])=>`<button class="chip reactionPick" data-type="${x}" data-id="${b.dataset.id}">${e}</button>`).join('')}</div>`);
    $$('.reactionPick').forEach(x=>x.onclick=async()=>{await api('/api/posts/react',{method:'POST',body:JSON.stringify({postId:x.dataset.id,type:x.dataset.type})});closeModal();state.bootstrap=await api('/api/bootstrap');resetFeed(state.bootstrap.posts||[],null,true);renderPage();});
  });
  $$('.comment').forEach(b=>b.onclick=()=>{showModal(`<h3>تعليق</h3><textarea id="commentText" class="field"></textarea><button class="primary" id="sendComment">إرسال</button>`);$('#sendComment').onclick=async()=>{await api('/api/posts/comment',{method:'POST',body:JSON.stringify({postId:b.dataset.id,text:$('#commentText').value})});closeModal();state.bootstrap=await api('/api/bootstrap');resetFeed(state.bootstrap.posts||[],null,true);renderPage()};});
  $$('.replyComment').forEach(b=>b.onclick=()=>{showModal(`<h3>الرد على التعليق</h3><textarea id="replyText" class="field"></textarea><button class="primary" id="sendReply">إرسال</button>`);$('#sendReply').onclick=async()=>{await api('/api/posts/comment',{method:'POST',body:JSON.stringify({postId:b.dataset.post,parentId:b.dataset.parent,text:$('#replyText').value})});closeModal();state.bootstrap=await api('/api/bootstrap');resetFeed(state.bootstrap.posts||[],null,true);renderPage()};});
  $$('.deleteComment').forEach(b=>b.onclick=async()=>{await api('/api/posts/comment/'+b.dataset.id,{method:'DELETE'});state.bootstrap=await api('/api/bootstrap');resetFeed(state.bootstrap.posts||[],null,true);renderPage();});
  $$('.share').forEach(b=>b.onclick=()=>{showModal(`<h3>مشاركة المنشور</h3><textarea id="shareText" class="field" placeholder="تعليق اختياري"></textarea><button class="primary" id="doShare">مشاركة</button>`);$('#doShare').onclick=async()=>{await api('/api/posts/share',{method:'POST',body:JSON.stringify({postId:b.dataset.id,comment:$('#shareText').value})});closeModal();state.bootstrap=await api('/api/bootstrap');resetFeed(state.bootstrap.posts||[],null,true);renderPage()};});
  $$('.save').forEach(b=>b.onclick=async()=>{await api('/api/posts/save',{method:'POST',body:JSON.stringify({postId:b.dataset.id})});state.bootstrap=await api('/api/bootstrap');resetFeed(state.bootstrap.posts||[],null,true);renderPage();});
  $$('.collectionSave').forEach(b=>b.onclick=async()=>{let d=await api('/api/collections');if(!d.collections?.length){const name=prompt('اسم مجموعة الحفظ');if(!name)return;await api('/api/collections',{method:'POST',body:JSON.stringify({name})});d=await api('/api/collections');}const names=d.collections.map(c=>c.name).join(' | ');const choice=prompt('اكتب اسم المجموعة:\n'+names);const c=d.collections.find(x=>x.name===choice)||d.collections[0];await api('/api/collections/items',{method:'POST',body:JSON.stringify({collectionId:c.id,postId:b.dataset.id})});toast('تم حفظ المنشور في المجموعة');});
  $$('.post-menu').forEach(b=>b.onclick=()=>showPostMenu(b.dataset.id));
}
function bindPage(){
  $$('[data-feed]').forEach(b=>b.onclick=async()=>{state.feedTab=b.dataset.feed;state.feedItems=[];state.feedCursor=null;state.feedHasMore=true;state.feedInitialized=true;await loadFeedPage(true);renderPage();});
  if(state.page==='home') observeFeedMore();
  $('#publishPost')?.addEventListener('click',async()=>{
    const txt=$('#postText')?.value||''; const f=$('#postFile')?.files?.[0];
    let media=null; if(f) media=await uploadFile(f);
    const isReel=Boolean($('#isReel')?.checked)&&Boolean(media?.kind?.startsWith('video'));
    await api('/api/posts',{method:'POST',body:JSON.stringify({text:txt,media,visibility:$('#postVisibility')?.value||'public',isReel})});
    toast('تم نشر المنشور'); state.bootstrap=await api('/api/bootstrap'); resetFeed(state.bootstrap.posts||[],null,true); renderPage();
  });
  bindPostActionsOnly();
  $$('.story-card').forEach(s=>s.onclick=()=>s.dataset.story==='create'?openStoryModal():showStory(s.dataset.story));
  $('#createStory')?.addEventListener('click',openStoryModal);
  $('#newGroup')?.addEventListener('click',()=>showModal(`<h3>إنشاء مجموعة</h3><input id="gName" class="field" placeholder="اسم المجموعة"><textarea id="gDesc" class="field"></textarea><button class="primary" id="gSave">إنشاء</button>`));
  $('#newPage')?.addEventListener('click',()=>showModal(`<h3>إنشاء صفحة</h3><input id="pName" class="field" placeholder="اسم الصفحة"><textarea id="pDesc" class="field"></textarea><button class="primary" id="pSave">إنشاء</button>`));
  $('#newItem')?.addEventListener('click',()=>showModal(`<h3>إنشاء إعلان</h3><div class="form-grid"><input id="mTitle" class="field" placeholder="العنوان"><input id="mPrice" class="field" placeholder="السعر"><input id="mCat" class="field" placeholder="التصنيف"><input id="mLoc" class="field" placeholder="الموقع"><textarea id="mDesc" class="field full"></textarea><input id="mFile" type="file" accept="image/*" class="full"></div><button class="primary" id="mSave">نشر الإعلان</button>`));
  $('#newEvent')?.addEventListener('click',()=>showModal(`<h3>إنشاء حدث</h3><div class="form-grid"><input id="eTitle" class="field" placeholder="العنوان"><input id="eDate" class="field" type="datetime-local"><input id="eLoc" class="field full" placeholder="المكان"><textarea id="eDesc" class="field full"></textarea></div><button class="primary" id="eSave">إنشاء</button>`));
  $$('.joinGroup').forEach(b=>b.onclick=async()=>{await api('/api/groups/join',{method:'POST',body:JSON.stringify({groupId:b.dataset.id})});toast('تم الانضمام');renderPage();});
  $$('.followPage').forEach(b=>b.onclick=async()=>{await api('/api/pages/follow',{method:'POST',body:JSON.stringify({pageId:b.dataset.id})});toast('تم تحديث المتابعة');renderPage();});
  $$('.rsvp').forEach(b=>b.onclick=async()=>{await api('/api/events/rsvp',{method:'POST',body:JSON.stringify({eventId:b.dataset.id,status:b.dataset.status})});renderPage();});
  $('#createCollection')?.addEventListener('click',async()=>{const name=$('#collectionName')?.value||'';if(!name.trim())return toast('اكتب اسم المجموعة');await api('/api/collections',{method:'POST',body:JSON.stringify({name})});renderPage();});
  $$('.deleteCollection').forEach(b=>b.onclick=async()=>{if(!confirm('حذف مجموعة الحفظ؟'))return;await api('/api/collections/'+b.dataset.id,{method:'DELETE'});renderPage();});
  $$('.openCollection').forEach(b=>b.onclick=async()=>{const d=await api('/api/collections/items?collectionId='+encodeURIComponent(b.dataset.id));const box=$('#savedCollectionView');if(box)box.innerHTML=`<div class="section-title"><h3>📁 ${esc(d.collection.name)}</h3></div>${(d.posts||[]).map(renderPost).join('')||'<div class="card panel">لا توجد منشورات.</div>'}`;bindPostActionsOnly();});
  $('#readAll')?.addEventListener('click',async()=>{await api('/api/notifications/read',{method:'POST',body:JSON.stringify({all:true})});renderPage();});
  $('#clearNotifications')?.addEventListener('click',async()=>{if(!confirm('مسح كل الإشعارات؟'))return;await api('/api/notifications/delete',{method:'POST',body:JSON.stringify({all:true})});renderPage();});
  $$('.deleteNotification').forEach(b=>b.onclick=async()=>{await api('/api/notifications/delete',{method:'POST',body:JSON.stringify({id:b.dataset.id})});renderPage();});$('#enableNotifications')?.addEventListener('click',enableNotifications);$('#installPwaNow')?.addEventListener('click',async()=>{if(state.installPrompt){state.installPrompt.prompt();await state.installPrompt.userChoice;state.installPrompt=null;return}toast('استخدم قائمة المتصفح لتثبيت LUTSA عندما لا يظهر زر التثبيت')});
  $('#enableNotifications, #enableNotificationsFromSettings')?.addEventListener('click',requestBrowserNotifications);
  $('#messengerSearch')?.addEventListener('input',e=>{clearTimeout(window.__lutsaMsgSearch);window.__lutsaMsgSearch=setTimeout(()=>{state.messengerSearch=e.target.value;loadConversations()},250)});
  $('#clearMsgSearch')?.addEventListener('click',()=>{state.messengerSearch='';const i=$('#messengerSearch');if(i)i.value='';loadConversations()});
  $('#startLive')?.addEventListener('click',async()=>{const title=prompt('عنوان البث')||'LUTSA Live';await api('/api/stream/start',{method:'POST',body:JSON.stringify({title})});renderPage();});
  $('#endLive')?.addEventListener('click',async()=>{await api('/api/stream/end',{method:'POST',body:JSON.stringify({})});renderPage();});
  $('#joinLive')?.addEventListener('click',joinLive);
  $('#saveSettings')?.addEventListener('click',async()=>{
    await api('/api/settings',{method:'PATCH',body:JSON.stringify({messageWho:$('#messageWho').value,profile:$('#profilePrivacy').value,readReceipts:$('#readReceipts').checked,activityStatus:$('#activityStatus').checked,notifications:{messages:$('#notifMessages')?.checked,calls:$('#notifCalls')?.checked,friends:$('#notifFriends')?.checked,follows:$('#notifFollows')?.checked,reactions:$('#notifReactions')?.checked,comments:$('#notifComments')?.checked,shares:$('#notifShares')?.checked,events:$('#notifEvents')?.checked,groups:$('#notifGroups')?.checked,pages:$('#notifPages')?.checked,general:$('#notifGeneral')?.checked}})}); toast('تم الحفظ');
  });
  $('#exportData')?.addEventListener('click',()=>{window.location.href='/api/account/export'});
  $$('.revoke-one-session').forEach(b=>b.onclick=async()=>{try{await api('/api/sessions/revoke',{method:'POST',body:JSON.stringify({sessionKey:b.dataset.id})});toast('تم إنهاء الجلسة');renderPage()}catch(e){toast(e.data?.error||'تعذر إنهاء الجلسة')}});
  $('#biometricLock')?.addEventListener('change',e=>{try{window.LutsaNative?.setBiometricEnabled(!!e.target.checked);toast(e.target.checked?'تم تفعيل قفل البصمة':'تم إيقاف قفل البصمة')}catch{}});
  $('#changePassword')?.addEventListener('click',()=>{
    showModal(`<h3>تغيير كلمة المرور</h3><input id="curPass" type="password" class="field" placeholder="الحالية"><input id="newPass" type="password" class="field" placeholder="الجديدة"><button class="primary" id="cpSave">حفظ</button>`);
    $('#cpSave').onclick=async()=>{try{await api('/api/password',{method:'POST',body:JSON.stringify({current:$('#curPass').value,newPassword:$('#newPass').value})});toast('تم تغيير كلمة المرور');closeModal();}catch(e){toast(e.data?.error==='BAD_CURRENT'?'كلمة المرور الحالية غير صحيحة':'تعذر تغيير كلمة المرور');}};
  });
  $('#deleteAccount')?.addEventListener('click',()=>{
    showModal(`<h3>حذف الحساب</h3><p>سيتم حذف الحساب والبيانات المرتبطة به.</p><input id="delPass" type="password" class="field" placeholder="كلمة المرور"><button class="primary" id="delSave">تأكيد حذف الحساب</button>`);
    $('#delSave').onclick=async()=>{try{await api('/api/account/delete',{method:'POST',body:JSON.stringify({password:$('#delPass').value})});location.reload();}catch{toast('كلمة المرور غير صحيحة');}};
  });
  $('#editProfile')?.addEventListener('click',()=>{
    showModal(`<h3>تعديل الملف</h3><input id="dName" class="field" value="${esc(state.user.displayName)}"><textarea id="dBio" class="field">${esc(state.user.bio||'')}</textarea><div class="form-grid"><label>صورة شخصية<input id="avFile" type="file" accept="image/*"></label><label>صورة غلاف<input id="covFile" type="file" accept="image/*"></label></div><button class="primary" id="profSave">حفظ</button>`);
    $('#profSave').onclick=async()=>{
      try{
        let avatarPath=state.user.avatar,coverPath=state.user.cover;
        const av=$('#avFile')?.files?.[0],cov=$('#covFile')?.files?.[0];
        if(av) avatarPath=(await uploadFile(av)).path;
        if(cov) coverPath=(await uploadFile(cov)).path;
        const d=await api('/api/users/profile',{method:'PATCH',body:JSON.stringify({displayName:$('#dName').value,bio:$('#dBio').value,avatar:avatarPath,cover:coverPath})});
        state.user=d.user;
        closeModal();
        state.bootstrap=await api('/api/bootstrap');
        renderPage();
      }catch(e){console.error('profile save failed',e);toast(e.data?.error||'تعذر حفظ الملف');}
    };
  });
  $('#followProfile')?.addEventListener('click',async e=>{await api('/api/users/follow',{method:'POST',body:JSON.stringify({userId:e.target.dataset.id})});renderPage();});
  $('#friendProfile')?.addEventListener('click',async e=>{const idv=e.target.dataset.id;try{const d=await api('/api/users/'+idv);if(d.relationship.status==='accepted'){await api('/api/friends/remove',{method:'POST',body:JSON.stringify({userId:idv})});toast('تمت إزالة الصداقة');}else{await api('/api/friends/request',{method:'POST',body:JSON.stringify({userId:idv})});toast('تم إرسال طلب الصداقة');}state.profileTab='posts';renderPage();}catch(err){toast(err.data?.error||'تعذر تحديث الصداقة')}});
  $('#messageProfile')?.addEventListener('click',e=>openMessenger(e.target.dataset.id));
  $('#callProfile')?.addEventListener('click',e=>startCall(e.target.dataset.id,'audio'));
  $$('.reportStatus').forEach(s=>s.onchange=async()=>{await api('/api/admin/reports/action',{method:'POST',body:JSON.stringify({reportId:s.dataset.id,status:s.value})});toast('تم تحديث البلاغ');});$$('.roleSelect').forEach(s=>s.onchange=async()=>{await api('/api/admin/role',{method:'POST',body:JSON.stringify({userId:s.dataset.id,role:s.value})});toast('تم تحديث الصلاحية');});
  $$('.userDisable').forEach(b=>b.onclick=async()=>{await api('/api/admin/user-status',{method:'POST',body:JSON.stringify({userId:b.dataset.id,disabled:b.dataset.disabled==='true'})});toast(b.dataset.disabled==='true'?'تم إيقاف المستخدم':'تم تفعيل المستخدم');renderPage()});$$('.adminDeletePost').forEach(b=>b.onclick=async()=>{if(confirm('حذف المنشور؟')){await api('/api/admin/posts/delete',{method:'POST',body:JSON.stringify({postId:b.dataset.id})});renderPage()}});
  // modal action buttons created by page-specific actions are bound immediately after creation.
  $$('.openGroup').forEach(b=>b.onclick=()=>openGroupById(b.dataset.id));
  $$('.shareGroup').forEach(b=>b.onclick=()=>shareEntity('group',b.dataset.id));
  $$('.sharePage').forEach(b=>b.onclick=()=>shareEntity('page',b.dataset.id));
  $$('.openPage').forEach(b=>b.onclick=()=>openPageById(b.dataset.id));
  $$('.leaveGroup').forEach(b=>b.onclick=async()=>{await api('/api/groups/leave',{method:'POST',body:JSON.stringify({groupId:b.dataset.id})});renderPage()});
  $('#groupSearch')?.addEventListener('input',e=>{const q=e.target.value.toLowerCase();$$('#groupsGrid .entity-card').forEach(c=>c.classList.toggle('hidden',!c.textContent.toLowerCase().includes(q)))});
  $('#pageSearch')?.addEventListener('input',e=>{const q=e.target.value.toLowerCase();$$('.entity-card').forEach(c=>c.classList.toggle('hidden',!c.textContent.toLowerCase().includes(q)))});
  async function refreshMarketplace(){const q=$('#marketSearch')?.value||'',cat=$('#marketCat')?.value||'',sort=$('#marketSort')?.value||'newest';const d=await api('/api/marketplace?q='+encodeURIComponent(q)+'&category='+encodeURIComponent(cat)+'&sort='+encodeURIComponent(sort));const box=$('#marketGrid');if(box)box.innerHTML=d.items.map(renderMarketplaceItem).join('')||'<div class="card panel">لا توجد إعلانات.</div>';bindPage();}
  $('#marketSearch')?.addEventListener('input',()=>{clearTimeout(window.__mktTimer);window.__mktTimer=setTimeout(refreshMarketplace,250)});$('#marketCat')?.addEventListener('change',refreshMarketplace);$('#marketSort')?.addEventListener('change',refreshMarketplace);
  $$('.contactSeller').forEach(b=>b.onclick=()=>openMessenger(b.dataset.id));
  $$('.deleteMarket').forEach(b=>b.onclick=async()=>{if(confirm('حذف الإعلان؟')){await api('/api/marketplace/delete',{method:'POST',body:JSON.stringify({itemId:b.dataset.id})});renderPage()}});
  $('#eventFilter')?.addEventListener('change',async e=>{const all=await api('/api/events');let a=all.events;if(e.target.value==='upcoming')a=a.filter(x=>new Date(x.date)>=new Date());if(e.target.value==='mine')a=a.filter(x=>x.hostId===state.user.id);const box=$('#eventsGrid');if(box)box.innerHTML=a.map(renderEventCard).join('')||'<div class="card panel">لا توجد أحداث.</div>';bindPage()});
  $$('.deleteEvent').forEach(b=>b.onclick=async()=>{if(confirm('حذف الحدث؟')){await api('/api/events/delete',{method:'POST',body:JSON.stringify({eventId:b.dataset.id})});renderPage()}});
  $$('.roleSelect').forEach(b=>b.onchange=async()=>{try{await api('/api/admin/role',{method:'POST',body:JSON.stringify({userId:b.dataset.id,role:b.value})});toast('تم تحديث الصلاحية')}catch(e){toast(e.data?.error||'تعذر تغيير الصلاحية');renderPage()}});
  $$('.userDisable').forEach(b=>b.onclick=async()=>{try{await api('/api/admin/user-status',{method:'POST',body:JSON.stringify({userId:b.dataset.id,disabled:b.dataset.disabled==='true'})});renderPage()}catch(e){toast(e.data?.error||'تعذر تحديث المستخدم')}});
  $$('.reportStatus').forEach(b=>b.onchange=async()=>{try{await api('/api/admin/reports/action',{method:'POST',body:JSON.stringify({reportId:b.dataset.id,status:b.value})});toast('تم تحديث البلاغ')}catch(e){toast(e.data?.error||'تعذر تحديث البلاغ')}});
  $$('.adminDeletePost').forEach(b=>b.onclick=async()=>{if(!confirm('حذف المنشور؟'))return;try{await api('/api/admin/posts/delete',{method:'POST',body:JSON.stringify({postId:b.dataset.id})});renderPage()}catch(e){toast(e.data?.error||'تعذر حذف المنشور')}});
  $('#gSave')?.addEventListener('click',async()=>{await api('/api/groups',{method:'POST',body:JSON.stringify({name:$('#gName').value,description:$('#gDesc').value})});closeModal();renderPage();});
  $('#pSave')?.addEventListener('click',async()=>{await api('/api/pages',{method:'POST',body:JSON.stringify({name:$('#pName').value,description:$('#pDesc').value})});closeModal();renderPage();});
  $('#mSave')?.addEventListener('click',async()=>{let media=null;const f=$('#mFile')?.files?.[0];if(f)media=await uploadFile(f);await api('/api/marketplace',{method:'POST',body:JSON.stringify({title:$('#mTitle').value,price:$('#mPrice').value,category:$('#mCat').value,location:$('#mLoc').value,description:$('#mDesc').value,media})});closeModal();renderPage();});
  $$('.deleteMedia').forEach(b=>b.onclick=async()=>{if(!confirm('حذف هذا الملف من الخادم؟'))return;try{await api('/api/media/'+b.dataset.id,{method:'DELETE'});renderPage()}catch(e){toast(e.data?.error||'تعذر حذف الملف')}});
  $('#refreshMedia')?.addEventListener('click',()=>renderPage());
  $('#revokeSessions')?.addEventListener('click',async()=>{if(confirm('تسجيل الخروج من جميع الأجهزة الأخرى؟')){await api('/api/sessions/revoke-all',{method:'POST'});toast('تم إنهاء الجلسات الأخرى');renderPage();}});
  $('#createBackup')?.addEventListener('click',()=>{window.location.href='/api/admin/backup'});
  $('#refreshAdmin')?.addEventListener('click',()=>renderPage());
  $('#cleanupOrphanMedia')?.addEventListener('click',async()=>{if(!confirm('حذف الملفات الموجودة على القرص ولا يملك النظام سجلًا لها؟'))return;try{const d=await api('/api/admin/media/orphans',{method:'POST'});toast('تم تنظيف '+(d.removed||0)+' ملف');renderPage()}catch(e){toast(e.data?.error||'تعذر التنظيف')}});
  $$('.adminMediaDelete').forEach(b=>b.onclick=async()=>{if(!confirm('حذف هذا الملف؟'))return;try{await api('/api/admin/media/delete',{method:'POST',body:JSON.stringify({mediaId:b.dataset.id})});renderPage()}catch(e){toast(e.data?.error||'تعذر حذف الوسيط')}});
  $('#restoreFile')?.addEventListener('change',async e=>{const f=e.target.files?.[0];if(!f)return;try{const snap=JSON.parse(await f.text()); if(!snap?.files)throw new Error('INVALID_BACKUP'); if(!confirm('استعادة هذه النسخة ستستبدل بيانات التطبيق الحالية. هل تريد المتابعة؟'))return; await api('/api/admin/restore',{method:'POST',body:JSON.stringify({snapshot:snap})}); alert('تمت الاستعادة. سيتم تحديث الصفحة.'); location.reload();}catch(err){toast(err.data?.error||err.message||'تعذر الاستعادة')}finally{e.target.value='';}});
  $('#adminUserSearch')?.addEventListener('input',e=>{const q=e.target.value.trim().toLowerCase();$$('.admin-user-row').forEach(row=>row.hidden=q&&!row.dataset.search.includes(q));});
  $('#eSave')?.addEventListener('click',async()=>{await api('/api/events',{method:'POST',body:JSON.stringify({title:$('#eTitle').value,date:$('#eDate').value,location:$('#eLoc').value,description:$('#eDesc').value})});closeModal();renderPage();});
  $('#msgSearch')?.addEventListener('click',()=>{const q=prompt('بحث داخل Messenger');if(q)toast('ميزة البحث الأساسية محفوظة عبر محادثاتك');});
  $('#uiTheme')?.addEventListener('change',e=>{state.theme=e.target.value;saveUi();applyTheme()});
  $('#uiLanguage')?.addEventListener('change',async e=>{state.lang=e.target.value;localize();await renderPage()});
  $('#shareProfile')?.addEventListener('click',()=>shareEntity('profile',state.profileUid||state.user.id,d.user.displayName));
}
async function showPostMenu(postId){const p=(state.bootstrap?.posts||[]).find(x=>x.id===postId);const own=p?.author?.id===state.user.id;showModal(`<h3>خيارات المنشور</h3><button class="btn" id="reportPost">⚑ إبلاغ</button>${own?`<button class="btn" id="editPost">✏️ تعديل</button><button class="btn" id="deletePost">🗑️ حذف</button>`:''}<button class="btn" id="sharePost2">↗ مشاركة في Feed</button><button class="btn" id="sharePostLink">🔗 مشاركة الرابط</button>`);$('#reportPost').onclick=async()=>{await api('/api/posts/report',{method:'POST',body:JSON.stringify({postId,reason:'محتوى مخالف'})});toast('تم إرسال البلاغ');closeModal()};$('#editPost')?.addEventListener('click',()=>showModal(`<h3>تعديل المنشور</h3><textarea id="editText" class="field">${esc(p.text||'')}</textarea><button class="primary" id="editSave">حفظ</button>`));$('#editSave')?.addEventListener('click',async()=>{await api('/api/posts/'+postId,{method:'PATCH',body:JSON.stringify({text:$('#editText').value})});closeModal();state.bootstrap=await api('/api/bootstrap');renderPage()});$('#deletePost')?.addEventListener('click',async()=>{if(confirm('حذف المنشور؟')){await api('/api/posts/'+postId,{method:'DELETE'});closeModal();state.bootstrap=await api('/api/bootstrap');renderPage()}});$('#sharePost2')?.addEventListener('click',async()=>{await api('/api/posts/share',{method:'POST',body:JSON.stringify({postId,comment:''})});closeModal();toast('تمت المشاركة')});$('#sharePostLink')?.addEventListener('click',()=>{closeModal();shareEntity('post',postId,'منشور على LUTSA')})}
function openStoryModal(){showModal(`<h3>إنشاء قصة</h3><input id="sFile" type="file" accept="image/*,video/*" class="field"><input id="sCaption" class="field" placeholder="نص القصة"><button class="primary" id="sSave">نشر</button>`);$('#sSave').onclick=async()=>{const f=$('#sFile').files[0];if(!f)return toast('اختر صورة أو فيديو');const media=await uploadFile(f);await api('/api/stories',{method:'POST',body:JSON.stringify({media,caption:$('#sCaption').value})});closeModal();toast('تم نشر القصة');renderPage()}}
async function showStory(sid){const d=await api('/api/stories');state.storyItems=d.stories||[];state.storyIndex=state.storyItems.findIndex(x=>x.id===sid);if(state.storyIndex<0)return;await showStoryAt(state.storyIndex);}
async function showStoryAt(index){const st=state.storyItems[index];if(!st)return;state.storyIndex=index;await api('/api/stories/view',{method:'POST',body:JSON.stringify({storyId:st.id})}).catch(()=>{});const total=state.storyItems.length;showModal(`<div class="story-viewer"><div class="story-progress">${state.storyItems.map((_,i)=>`<span class="${i<=index?'done':''}"></span>`).join('')}</div><div class="story-view-head">${avatar(st.author)}<div><b>${esc(st.author.displayName)}</b><small>${new Date(st.createdAt).toLocaleString()}</small></div><button class="icon-btn" id="shareStoryView">↗</button></div><div class="story-view-media">${mediaHtml(st.media)}</div><p>${esc(st.caption||'')}</p><div class="story-nav"><button class="icon-btn" id="storyPrev" ${index<=0?'disabled':''}>‹</button><div class="story-actions"><button class="chip storyReact" data-id="${st.id}" data-type="like">👍 ${st.reactionSummary?.like||0}</button><button class="chip storyReact" data-id="${st.id}" data-type="love">❤️ ${st.reactionSummary?.love||0}</button><button class="chip storyReact" data-id="${st.id}" data-type="haha">😂 ${st.reactionSummary?.haha||0}</button><small>👁️ ${st.viewsCount||0}</small></div><button class="icon-btn" id="storyNext" ${index>=total-1?'disabled':''}>›</button></div></div>`);$('#storyPrev')?.addEventListener('click',()=>showStoryAt(index-1));$('#storyNext')?.addEventListener('click',()=>showStoryAt(index+1));$('#shareStoryView')?.addEventListener('click',()=>shareEntity('story',st.id,`قصة ${st.author.displayName}`));$$('.storyReact').forEach(b=>b.onclick=async()=>{await api('/api/stories/react',{method:'POST',body:JSON.stringify({storyId:b.dataset.id,type:b.dataset.type})});const fresh=await api('/api/stories');state.storyItems=fresh.stories||state.storyItems;await showStoryAt(index);});}

// Calls
function callPeerId(){
  const c=state.call;
  if(!c||!state.user)return null;
  return c.peerId || (c.from===state.user.id?c.to:c.from);
}
function setCallStatus(text){const el=$('#callStatus');if(el)el.textContent=text;}
function callErrorMessage(e){
  const code=e?.data?.error||e?.message||'';
  const map={
    CALL_BUSY:'المستخدم مشغول بمكالمة أخرى',
    INVALID:'لا يمكن الاتصال بهذا المستخدم',
    AUTH_REQUIRED:'انتهت جلسة الدخول، سجّل الدخول مرة أخرى',
    CALL_NOT_ACTIVE:'المكالمة انتهت بالفعل',
    SIGNAL_ROUTE_NOT_FOUND:'الخادم الحالي لا يحتوي على مسار إشارات المكالمات',
    METERED_EMPTY_ICE_SERVERS:'لم يتم تحميل خوادم TURN'
  };
  return map[code]||'تعذر إتمام المكالمة. افتح أدوات المطور لرؤية تفاصيل الخطأ.';
}
async function startCall(to,type){
  if(state.call){toast('لديك مكالمة قيد التشغيل');return;}
  if(!navigator.mediaDevices?.getUserMedia||!window.RTCPeerConnection){toast('المتصفح لا يدعم مكالمات WebRTC');return;}
  try{
    const h=await api('/api/health');
    if(h.signalRoute!==true) throw new Error('SIGNAL_ROUTE_NOT_ENABLED');
    const cfg=await api('/api/config');
    if(!cfg.webrtc?.iceServers?.length) throw new Error('NO_ICE_SERVERS');
    if(cfg.turn?.configured!==true) toast('تنبيه: لا يوجد TURN مفعّل؛ المكالمة قد لا تعمل بين بعض الشبكات');
    const d=await api('/api/calls/start',{method:'POST',body:JSON.stringify({to,type:type==='audio'?'audio':'video'})});
    if(!d?.call?.id) throw new Error('CALL_CREATE_FAILED');
    state.call={...d.call,peerId:to,initiator:true,connected:false};
    await prepareCallConnection(true,cfg);
    showCallOverlay();
  }catch(e){
    console.error('startCall failed',e);
    resetCallState();
    toast(callErrorMessage(e));
  }
}
async function sendCallSignal(payload){
  const callId=state.call?.id;
  if(!callId) throw new Error('CALL_ID_MISSING');
  return api('/api/calls/signal',{method:'POST',body:JSON.stringify({callId,payload})});
}
async function drainPendingIce(){
  if(!state.pc||!state.pc.remoteDescription?.type||!state.pendingIceCandidates?.length)return;
  const pending=state.pendingIceCandidates.splice(0);
  for(const candidate of pending){try{await state.pc.addIceCandidate(candidate)}catch(e){console.warn('queued ICE failed',e)}}
}
async function addCallIceCandidate(candidate){
  if(!candidate)return;
  if(!state.pc?.remoteDescription?.type){state.pendingIceCandidates=state.pendingIceCandidates||[];state.pendingIceCandidates.push(candidate);return;}
  try{await state.pc.addIceCandidate(candidate)}catch(e){console.warn('ICE candidate failed',e)}
}
async function attachRemoteCallMedia(stream){
  if(!stream)return;
  state.remoteStream=stream;
  const rv=$('#remoteVideo');
  if(!rv)return;
  rv.srcObject=stream;
  rv.autoplay=true;rv.playsInline=true;rv.muted=false;
  try{await rv.play();$('#resumeAudioBtn')?.remove();}
  catch{
    let b=$('#resumeAudioBtn');
    if(!b){
      b=document.createElement('button');b.id='resumeAudioBtn';b.className='primary';b.textContent='🔊 تشغيل الصوت';
      const controls=$('.call-overlay .live-controls');controls?.prepend(b);
    }
    b.onclick=async()=>{try{await rv.play();b.remove()}catch{toast('اضغط مرة أخرى لتشغيل الصوت')}};
  }
}
async function prepareCallConnection(initiator,cfg){
  if(!state.call?.id) throw new Error('CALL_ID_MISSING');
  if(state.pc){try{state.pc.close()}catch{}state.pc=null}
  state.pendingIceCandidates=[];
  state.callStartedAt=state.callStartedAt||null;
  const iceServers=cfg?.webrtc?.iceServers||[];
  state.pc=new RTCPeerConnection({
    iceServers,
    iceTransportPolicy:'all',
    bundlePolicy:'max-bundle',
    rtcpMuxPolicy:'require',
    iceCandidatePoolSize:4
  });
  try{
    state.localStream=await navigator.mediaDevices.getUserMedia({
      audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},
      video:state.call.type==='video'?{width:{ideal:1280,max:1920},height:{ideal:720,max:1080},facingMode:'user'}:false
    });
  }catch(e){
    try{state.pc.close()}catch{}state.pc=null;
    throw Object.assign(new Error(e?.name||'MEDIA_PERMISSION_DENIED'),{cause:e});
  }
  await acquireWakeLock();try{window.LutsaNative?.setCallActive?.(true)}catch{}
  state.localStream.getTracks().forEach(t=>state.pc.addTrack(t,state.localStream));
  state.pc.ontrack=e=>{
    let stream=e.streams?.[0];
    if(!stream){
      stream=state.remoteStream||new MediaStream();
      if(!stream.getTracks().some(t=>t.id===e.track.id))stream.addTrack(e.track);
    }
    attachRemoteCallMedia(stream).catch(()=>{});
  };
  state.pc.onicecandidate=e=>{if(e.candidate)sendCallSignal({kind:'ice',candidate:e.candidate.toJSON?.()||e.candidate}).catch(err=>console.warn('ICE signal failed',err));};
  state.pc.onicecandidateerror=e=>console.warn('ICE candidate error',e);
  state.pc.oniceconnectionstatechange=()=>{
    const st=state.pc?.iceConnectionState;
    if(st==='checking')setCallStatus('فحص الاتصال…');
    else if(st==='connected'||st==='completed'){setCallStatus('متصل');state.callStartedAt=state.callStartedAt||Date.now();updateCallQuality();startCallQualityPolling();}
    else if(st==='disconnected'){setCallStatus('انقطع الاتصال… إعادة المحاولة');scheduleCallReconnect();}
    else if(st==='failed'){setCallStatus('تعذر الاتصال — إعادة المحاولة');scheduleCallReconnect();}
  };
  state.pc.onconnectionstatechange=()=>{
    const cs=state.pc?.connectionState;
    if(cs==='connected'){setCallStatus('متصل');state.callStartedAt=state.callStartedAt||Date.now();updateCallQuality();startCallQualityPolling();}
    else if(cs==='connecting')setCallStatus('جاري الاتصال…');
    else if(cs==='disconnected')setCallStatus('الاتصال متقطع…');
    else if(cs==='failed')setCallStatus('تعذر الاتصال');
  };
  state.pc.onsignalingstatechange=()=>console.debug('LUTSA signalingState',state.pc?.signalingState);
  if(initiator){
    const offer=await state.pc.createOffer({offerToReceiveAudio:true,offerToReceiveVideo:state.call.type==='video'});
    await state.pc.setLocalDescription(offer);
    await sendCallSignal({kind:'offer',sdp:state.pc.localDescription});
  }
  await drainPendingIce();
}
async function acceptLocalAndPeer(initiator){
  const cfg=await api('/api/config');
  await prepareCallConnection(Boolean(initiator),cfg);
}
async function createRestartOffer(){
  if(!state.pc||!state.call)return;
  if(state.pc.signalingState!=='stable'){
    try{await state.pc.setLocalDescription({type:'rollback'})}catch{}
  }
  const offer=await state.pc.createOffer({iceRestart:true,offerToReceiveAudio:true,offerToReceiveVideo:state.call.type==='video'});
  await state.pc.setLocalDescription(offer);
  await sendCallSignal({kind:'offer',sdp:state.pc.localDescription,iceRestart:true});
  setCallStatus('إعادة الاتصال…');
}
async function restartCallIce(manual=false){
  if(!state.call||!state.pc){toast('لا توجد مكالمة نشطة');return false;}
  if(!navigator.onLine){toast('لا يوجد اتصال بالإنترنت');return false;}
  if(state.callReconnectBusy)return false;
  state.callReconnectBusy=true;
  clearTimeout(state.callReconnectTimer);
  try{
    if(!state.call.initiator){
      await sendCallSignal({kind:'reconnect-request'});
      setCallStatus('نطلب إعادة الاتصال…');
      if(manual)toast('تم طلب إعادة الاتصال من الطرف الآخر');
    }else{
      await createRestartOffer();
    }
    return true;
  }catch(e){console.warn('restartCallIce failed',e);if(manual)toast('تعذرت إعادة المحاولة');return false;}
  finally{setTimeout(()=>{state.callReconnectBusy=false},1200)}
}
function scheduleCallReconnect(){
  if(!state.call||!state.pc||state.callReconnectBusy)return;
  clearTimeout(state.callReconnectTimer);
  state.callReconnectTimer=setTimeout(()=>restartCallIce(false),1500);
}
function resetCallState(){
  stopRingtone();
  clearInterval(state._callClock);
  clearInterval(state.callStatsTimer);
  clearTimeout(state.callTimeout);
  clearTimeout(state.callReconnectTimer);
  state._callClock=null;state.callStatsTimer=null;state.callTimeout=null;state.callReconnectTimer=null;
  try{state.pc?.close()}catch{}
  try{state.localStream?.getTracks().forEach(t=>t.stop())}catch{}
  try{state.remoteStream?.getTracks().forEach(t=>t.stop())}catch{}
  state.pc=null;state.localStream=null;state.remoteStream=null;state.pendingIceCandidates=[];state.call=null;state.callStartedAt=null;state.callReconnectBusy=false;
  releaseWakeLock();
  try{window.LutsaNative?.setCallActive?.(false)}catch{}
  const overlay=$('#callOverlay');if(overlay)overlay.remove();
}
async function updateCallQuality(){
  if(!state.pc||!state.call)return;
  try{
    const stats=await state.pc.getStats();
    let rtt=0,lost=0,received=0,jitter=0,bytes=0;
    stats.forEach(x=>{
      if(x.type==='candidate-pair'&&x.state==='succeeded'&&(x.currentRoundTripTime!=null))rtt=Math.max(rtt,Math.round(x.currentRoundTripTime*1000));
      if(x.type==='inbound-rtp'&&(x.kind==='audio'||x.kind==='video')){lost+=Number(x.packetsLost||0);received+=Number(x.packetsReceived||0);jitter=Math.max(jitter,Number(x.jitter||0)*1000);}
      if(x.type==='outbound-rtp'&&(x.kind==='audio'||x.kind==='video'))bytes+=Number(x.bytesSent||0);
    });
    const t=Date.now();
    const prev=state._callStats||{};const dt=Math.max(1,t-(prev.at||t));
    const bitrate=bytes&&prev.bytes?Math.max(0,Math.round((bytes-prev.bytes)*8/dt)):0;
    state._callStats={at:t,bytes};
    const lossPct=(lost+received)?(lost/(lost+received))*100:0;
    const score=Math.max(0,Math.min(100,Math.round(100-Math.min(60,rtt/8)-Math.min(30,lossPct*4)-Math.min(10,jitter/20))));
    const label=score>=85?'ممتاز':score>=65?'جيد':score>=45?'متوسط':'ضعيف';
    const el=$('#callQuality');if(el)el.textContent=`${label}${rtt?` · ${rtt}ms`:''}`;
    if(state.call.id)api('/api/calls/quality',{method:'POST',body:JSON.stringify({callId:state.call.id,rttMs:rtt,packetsLost:lost,packetsReceived:received,jitterMs:Math.round(jitter),bitrateKbps:bitrate,score})}).catch(()=>{});
  }catch(e){console.debug('call stats',e)}
}
function startCallQualityPolling(){
  clearInterval(state.callStatsTimer);
  state.callStatsTimer=setInterval(()=>updateCallQuality(),5000);
}
function showCallOverlay(){
  let el=$('#callOverlay');if(!el){el=document.createElement('div');el.id='callOverlay';document.body.appendChild(el)}
  el.className='call-overlay active';
  const peer=userFromIdCache(callPeerId())||{displayName:'المستخدم'};
  el.innerHTML=`<div class="call-top"><div>${avatar(peer)}</div><div><b>${esc(peer.displayName)}</b><div id="callStatus">${state.call?.initiator?'جاري الاتصال…':'جاري تجهيز المكالمة…'}</div></div><span class="call-quality" id="callQuality">جودة —</span><span class="call-type">${state.call?.type==='video'?'🎥':'📞'}</span></div><div class="video-grid ${state.call?.type==='audio'?'audio-only':''}"><video id="localVideo" autoplay muted playsinline></video><video id="remoteVideo" autoplay playsinline></video></div><div class="call-timer" id="callTimer"></div><div class="live-controls"><button class="btn" id="muteBtn">🔇</button><button class="btn speaker-btn" id="speakerBtn">🔊</button><button class="btn" id="camBtn">🎥</button><button class="btn" id="switchCamBtn">🔄</button><button class="btn" id="fullscreenCallBtn">⛶</button><button class="btn" id="pipCallBtn">▣</button><button class="btn" id="reconnectCallBtn">↻</button><button class="primary hangup" id="hangupBtn">🔴 إنهاء</button></div>`;
  const lv=$('#localVideo');if(lv&&state.localStream){lv.srcObject=state.localStream;lv.play().catch(()=>{})}
  if(state.remoteStream)attachRemoteCallMedia(state.remoteStream).catch(()=>{});
  $('#muteBtn').onclick=()=>{const t=state.localStream?.getAudioTracks()[0];if(t){t.enabled=!t.enabled;$('#muteBtn').textContent=t.enabled?'🔇':'🎙️'}};
  $('#camBtn').style.display=state.call?.type==='video'?'':'none';
  $('#switchCamBtn').style.display=state.call?.type==='video'?'':'none';
  $('#camBtn').onclick=()=>{const t=state.localStream?.getVideoTracks()[0];if(t){t.enabled=!t.enabled;$('#camBtn').textContent=t.enabled?'🎥':'🚫'}};
  $('#switchCamBtn').onclick=switchCamera;
  $('#fullscreenCallBtn').onclick=()=>{const target=$('#callOverlay');if(target?.requestFullscreen)target.requestFullscreen().catch(()=>{})};
  $('#pipCallBtn').onclick=async()=>{const v=$('#remoteVideo');if(!v||!document.pictureInPictureEnabled||!v.requestPictureInPicture)return;try{await v.requestPictureInPicture()}catch{toast('العرض المصغر غير متاح الآن')}};
  $('#reconnectCallBtn').onclick=()=>restartCallIce(true);
  $('#speakerBtn').onclick=()=>{const v=$('#remoteVideo');if(v){v.muted=!v.muted;$('#speakerBtn').textContent=v.muted?'🔈':'🔊';if(!v.muted)v.play().catch(()=>{})}};
  $('#hangupBtn').onclick=endCall;
  startCallTimer();
}
function startCallTimer(){clearInterval(state._callClock);const el=$('#callTimer');if(!el)return;const started=state.callStartedAt||Date.now();state._callClock=setInterval(()=>{const s=Math.max(0,Math.floor((Date.now()-started)/1000));el.textContent=`${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`},1000)}
async function endCall(){
  if(!state.call)return;
  const cid=state.call.id;
  try{window.LutsaNative?.clearCallNotification?.(String(cid));}catch{}
  try{await api('/api/calls/action',{method:'POST',body:JSON.stringify({callId:cid,action:'end'})})}catch(e){console.warn('end call',e)}
  resetCallState();
}
async function pollCalls(){
  if(!state.user)return;
  try{
    const d=await api('/api/calls/poll?after='+(Date.now()-30000));
    for(const c of d.calls||[]){
      if(c.to===state.user.id&&c.status==='ringing'&&!state.call){showIncoming(c);continue;}
      if(state.call&&c.id===state.call.id){
        state.call={...state.call,...c};
        if(c.status==='accepted'){
          if(state.call.initiator){state.call.connected=state.call.connected||false;if(state.pc)setCallStatus(state.pc.connectionState==='connected'?'متصل':'جاري الاتصال…');}
          else if(state.pc)setCallStatus('جاري الاتصال…');
        }
        if(['ended','rejected','missed'].includes(c.status)){
          try{window.LutsaNative?.clearCallNotification?.(String(c.id));}catch{}
          toast(c.status==='rejected'?'تم رفض المكالمة':c.status==='missed'?'📵 مكالمة فائتة':'انتهت المكالمة');
          resetCallState();
        }
      }
    }
  }catch(e){console.warn('call poll',e)}
}
function startRingtone(){stopRingtone();try{const C=window.AudioContext||window.webkitAudioContext;if(!C)return;const ctx=new C();let on=true;const beep=()=>{if(!on)return;const o=ctx.createOscillator(),g=ctx.createGain();o.frequency.value=660;o.type='sine';g.gain.setValueAtTime(.0001,ctx.currentTime);g.gain.exponentialRampToValueAtTime(.12,ctx.currentTime+.03);g.gain.exponentialRampToValueAtTime(.0001,ctx.currentTime+.35);o.connect(g).connect(ctx.destination);o.start();o.stop(ctx.currentTime+.38)};beep();state.ringTimer=setInterval(beep,1200);state._ringStop=()=>{on=false;clearInterval(state.ringTimer);state.ringTimer=null;ctx.close().catch(()=>{})}}catch{}}
function stopRingtone(){try{state._ringStop?.()}catch{}state._ringStop=null}
function requestBrowserNotifications(){enableNotifications().catch(()=>toast('تعذر تفعيل الإشعارات'))}
function showIncoming(c){
  if(state.call)return;
  state.call={...c,peerId:c.from,initiator:false,connected:false};
  const from=userFromIdCache(c.from);startRingtone();
  if(window.LutsaNative?.isAndroid&&window.LutsaNative?.notifyIncomingCall){try{window.LutsaNative.notifyIncomingCall(String(c.id),String(from?.displayName||'مستخدم'),String(c.type||'audio'));}catch{}}else if('Notification'in window&&Notification.permission==='granted')new Notification('مكالمة واردة / Incoming call',{body:`${from?.displayName||'مستخدم'} يتصل بك`,icon:'/assets/icon.svg'});
  let el=$('#callOverlay');if(!el){el=document.createElement('div');el.id='callOverlay';document.body.appendChild(el)}
  el.innerHTML=`<div class="incoming-call"><div class="incoming-avatar">${avatar(from||{displayName:'U'})}</div><div class="small">مكالمة واردة</div><h3>${esc(from?.displayName||'مستخدم')}</h3><p>${c.type==='video'?'🎥 مكالمة فيديو':'📞 مكالمة صوتية'}</p><div class="call-incoming-actions"><button class="reject-call" id="rejectIncoming">❌ رفض</button><button class="accept-call" id="acceptIncoming">✅ قبول</button></div></div>`;
  el.className='call-overlay incoming';
  $('#acceptIncoming').onclick=async()=>{
    stopRingtone();try{window.LutsaNative?.clearCallNotification?.(String(c.id));}catch{}
    try{
      await api('/api/calls/action',{method:'POST',body:JSON.stringify({callId:c.id,action:'accept'})});
      state.call={...state.call,status:'accepted'};
      await acceptLocalAndPeer(false);
      showCallOverlay();
    }catch(e){toast(callErrorMessage(e));resetCallState();}
  };
  $('#rejectIncoming').onclick=async()=>{stopRingtone();try{window.LutsaNative?.clearCallNotification?.(String(c.id));}catch{}await api('/api/calls/action',{method:'POST',body:JSON.stringify({callId:c.id,action:'reject'})}).catch(()=>{});resetCallState()};
  clearTimeout(state.callTimeout);state.callTimeout=setTimeout(async()=>{if(state.call?.id===c.id&&state.call.status==='ringing'){stopRingtone();await api('/api/calls/action',{method:'POST',body:JSON.stringify({callId:c.id,action:'missed'})}).catch(()=>{});toast('مكالمة فائتة');resetCallState()}},30000);
}
function userFromIdCache(id){return state.bootstrap?.people?.find(x=>x.id===id)||null}
async function pollSignals(){
  if(!state.call)return;
  try{
    const d=await api('/api/calls/signals?callId='+encodeURIComponent(state.call.id));
    const ack=[];
    for(const x of d.items||[]){
      const p=x.payload||{};
      try{
        if(p.kind==='offer'){
          if(!state.pc) await acceptLocalAndPeer(false);
          if(!state.pc)continue;
          if(state.pc.signalingState!=='stable'){
            try{await state.pc.setLocalDescription({type:'rollback'})}catch{}
          }
          await state.pc.setRemoteDescription(p.sdp);
          await drainPendingIce();
          const ans=await state.pc.createAnswer();
          await state.pc.setLocalDescription(ans);
          await sendCallSignal({kind:'answer',sdp:state.pc.localDescription});
        }else if(p.kind==='answer'){
          if(state.pc&&p.sdp&&(state.pc.signalingState==='have-local-offer')){await state.pc.setRemoteDescription(p.sdp);await drainPendingIce();}
        }else if(p.kind==='ice'){
          await addCallIceCandidate(p.candidate);
        }else if(p.kind==='reconnect-request'){
          if(state.call.initiator&&state.pc)await createRestartOffer();
        }
        ack.push(x.id);
      }catch(e){console.warn('call signal process failed',p.kind,e)}
    }
    if(ack.length)api('/api/calls/signals/ack',{method:'POST',body:JSON.stringify({ids:ack})}).catch(e=>console.warn('signal ack failed',e));
  }catch(e){console.warn('signal poll',e)}
}

// Broadcast: mesh WebRTC, one peer connection per viewer.
const livePeers=new Map();
async function joinLive(){
  const d=await api('/api/stream/join',{method:'POST',body:JSON.stringify({})});
  const s=d.stream;if(!s)return;state.liveActive=true;state.liveId=s.id;
  showModal(`<h3>${esc(s.title)}</h3><div class="live-box"><video id="liveRemote" autoplay playsinline controls></video><div class="live-status" id="liveStatus">🔴 مباشر</div></div><p>المشاهدون: <span id="viewerCount">${s.viewerIds.length}</span></p><div class="entity-actions live-session-actions"><button class="btn" id="leaveLive">خروج</button>${s.hostId===state.user.id?`<button class="btn danger-btn" id="endLiveNow">إنهاء البث</button>`:''}</div>`);
  $('#leaveLive')?.addEventListener('click',leaveLiveSession);$('#endLiveNow')?.addEventListener('click',async()=>{await api('/api/stream/end',{method:'POST'}).catch(()=>{});await leaveLiveSession(true);toast('تم إنهاء البث');renderPage()});
  const cfg=await api('/api/config');
  if(s.hostId===state.user.id){
    const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:{width:{ideal:1280},height:{ideal:720},facingMode:'user'}});
    state.liveHostStream=stream;const v=$('#liveRemote');if(v){v.srcObject=stream;v.muted=true;}
    await hostLivePeers(s,cfg,stream);
  }else{
    const pc=new RTCPeerConnection(cfg.webrtc);livePeers.set('host',pc);
    pc.ontrack=e=>{const v=$('#liveRemote');if(v){v.srcObject=e.streams[0];v.muted=false;v.play().catch(()=>{})}};
    pc.onicecandidate=e=>{if(e.candidate)api('/api/stream/signal',{method:'POST',body:JSON.stringify({streamId:s.id,to:s.hostId,payload:{kind:'ice',candidate:e.candidate}})}).catch(()=>{});};
    const off=await pc.createOffer();await pc.setLocalDescription(off);await api('/api/stream/signal',{method:'POST',body:JSON.stringify({streamId:s.id,to:s.hostId,payload:{kind:'offer',sdp:off}})});pollLiveSignals(s.id,cfg);
  }
  clearInterval(state.liveHeartbeatTimer);state.liveHeartbeatTimer=setInterval(()=>api('/api/stream/heartbeat',{method:'POST',body:JSON.stringify({streamId:s.id})}).catch(()=>{}),15000);
  clearInterval(state.liveCountTimer);state.liveCountTimer=setInterval(async()=>{try{const x=await api('/api/stream');const st=x.stream;if(!st||st.id!==s.id||st.status!=='live'){document.querySelector('#liveStatus')?.replaceChildren(document.createTextNode('انتهى البث'));await leaveLiveSession(true);return;}const c=$('#viewerCount');if(c)c.textContent=st.viewerIds.length;}catch{}},4000);
}
async function leaveLiveSession(fromEnd=false){clearInterval(state.liveHeartbeatTimer);clearInterval(state.liveCountTimer);state.liveHeartbeatTimer=null;state.liveCountTimer=null;const sid=state.liveId;state.liveActive=false;state.liveId=null;state.liveHostStream?.getTracks().forEach(t=>t.stop());state.liveHostStream=null;try{for(const pc of livePeers.values())pc.close()}catch{}livePeers.clear();if(sid&&!fromEnd)await api('/api/stream/leave',{method:'POST',body:JSON.stringify({streamId:sid})}).catch(()=>{});closeModal();}
async function hostLivePeers(s,cfg,stream){for(const vid of s.viewerIds){if(vid===state.user.id)continue;createHostPeer(s,cfg,stream,vid)}pollLiveSignals(s.id,cfg)}
async function createHostPeer(s,cfg,stream,vid){
  const pc=new RTCPeerConnection(cfg.webrtc);
  stream.getTracks().forEach(t=>pc.addTrack(t,stream));
  pc.onicecandidate=e=>{if(e.candidate)api('/api/stream/signal',{method:'POST',body:JSON.stringify({streamId:s.id,to:vid,payload:{kind:'ice',candidate:e.candidate}})}).catch(()=>{});};
  livePeers.set(vid,pc);
  const off=await pc.createOffer();
  await pc.setLocalDescription(off);
  await api('/api/stream/signal',{method:'POST',body:JSON.stringify({streamId:s.id,to:vid,payload:{kind:'offer',sdp:off}})});
}
async function pollLiveSignals(sid,cfg){
  clearInterval(state.streamTimer);
  state.streamTimer=setInterval(async()=>{
    try{
      const d=await api('/api/stream/signals?streamId='+encodeURIComponent(sid));
      for(const x of d.items){
        const p=x.payload;
        if(p.kind==='offer'&&!livePeers.has(x.from)){
          const pc=new RTCPeerConnection(cfg.webrtc);
          livePeers.set(x.from,pc);
          if(state.liveHostStream) state.liveHostStream.getTracks().forEach(t=>pc.addTrack(t,state.liveHostStream));
          pc.onicecandidate=e=>{
            if(e.candidate) api('/api/stream/signal',{method:'POST',body:JSON.stringify({streamId:sid,to:x.from,payload:{kind:'ice',candidate:e.candidate}})}).catch(()=>{});
          };
          await pc.setRemoteDescription(p.sdp);
          const ans=await pc.createAnswer();
          await pc.setLocalDescription(ans);
          await api('/api/stream/signal',{method:'POST',body:JSON.stringify({streamId:sid,to:x.from,payload:{kind:'answer',sdp:ans}})});
        }else if(p.kind==='answer'){
          const pc=livePeers.get(x.from); if(pc) await pc.setRemoteDescription(p.sdp);
        }else if(p.kind==='ice'){
          const pc=livePeers.get(x.from); if(pc) await pc.addIceCandidate(p.candidate).catch(()=>{});
        }
      }
    }catch{}
  },1500);
}
function applyAuthMode(mode){$('#loginForm').classList.toggle('hidden',mode!=='login');$('#registerForm').classList.toggle('hidden',mode!=='register');$$('.auth-tabs button').forEach(b=>b.classList.toggle('active',b.dataset.auth===mode));}
function enhanceReels(){const vids=$$('.reels-shell video');if(!vids.length)return;const obs=new IntersectionObserver(entries=>entries.forEach(e=>{const v=e.target;if(e.isIntersecting&&e.intersectionRatio>=.65){v.play().catch(()=>{})}else v.pause()}),{threshold:[0,.65,1]});vids.forEach(v=>{v.muted=true;v.loop=true;obs.observe(v);v.addEventListener('click',()=>{v.muted=!v.muted;toast(v.muted?'تم كتم Reels':'تم تشغيل صوت Reels')},{passive:true});});}
function updateNav(){$$('.nav, .mobile-nav [data-page]').forEach(b=>b.classList.toggle('active',b.dataset.page===state.page)); $$('.admin-only').forEach(x=>x.classList.toggle('hidden',state.user?.role!=='admin'));}
function setPage(p,extra={}){state.page=p;Object.assign(state,extra);if(p==='profile')state.profileUid=extra.profileUid||state.user?.id;window.scrollTo({top:0,behavior:'smooth'});if(p==='profile'&&!('profileTab' in extra))state.profileTab='posts';$('#sidebar').classList.remove('open');renderPage()}
async function afterLogin(){state.user=(await api('/api/auth/me')).user; if(!state.user)return;$('#auth').classList.add('hidden');$('#app').classList.remove('hidden');state.bootstrap=await api('/api/bootstrap'); resetFeed(state.bootstrap.posts||[],state.bootstrap.feed?.nextCursor||null,state.bootstrap.feed?.hasMore!==false); $('.avatar-mini').textContent=initials(state.user.displayName);if(window.LutsaNative?.isAndroid&&window.LutsaNative.getFcmToken){registerNativePushToken(window.LutsaNative.getFcmToken()).catch(()=>{});}setPage('home');navigator.serviceWorker?.register('/sw.js').then(async reg=>{await reg.update(); if(window.Notification?.permission==='granted') registerPushSubscription().catch(()=>{});}).catch(()=>{});bindInstallPrompt();updateNetworkUI();window.addEventListener('online',updateNetworkUI);window.addEventListener('offline',updateNetworkUI);document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){api('/api/presence/ping',{method:'POST'}).catch(()=>{});navigator.serviceWorker?.ready.then(r=>r.update()).catch(()=>{})}});startPolling();api('/api/presence/ping',{method:'POST'}).catch(()=>{});}
function startPolling(){
  clearInterval(state.callPollTimer); clearInterval(state.signalTimer);
  state.callPollTimer=setInterval(pollCalls,2000); state.signalTimer=setInterval(pollSignals,1300);
  clearInterval(state.notificationPollTimer);
  state.notificationPollTimer=setInterval(async()=>{if(document.visibilityState!=='visible')return;
    try{
      const n=await api('/api/notifications');
      const prev=Number($('#notifBadge').textContent||0);
      $('#notifBadge').textContent=n.unread||'';
      if(n.unread>prev && state.page!=='notifications' && 'Notification' in window && Notification.permission==='granted'){
        const latest=n.items?.find(x=>!x.read);
        if(latest){state.lastNotificationId=latest.id;notifyViaSW(latest.title,latest.body,latest.meta?.url||'/');}
      }
      const c=await api('/api/messenger');
      $('#msgBadge').textContent=c.conversations.reduce((a,x)=>a+(x.unread||0),0)||'';
    }catch{}
  },5000);
}
function localize(){document.documentElement.dir=state.lang==='ar'?'rtl':'ltr';document.documentElement.lang=state.lang;$('#langBtn').textContent=state.lang==='ar'?'EN':'AR';shellLabel('#globalSearch',state.lang==='ar'?'ابحث عن أشخاص ومنشورات ومجموعات وصفحات':'Search people, posts, groups and pages');$$('.nav').forEach(b=>{const k=b.dataset.page;const span=b.querySelector('span');if(span&&I18N[state.lang][k])span.textContent=I18N[state.lang][k]});saveUi();}
$('#loginForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);try{await api('/api/auth/login',{method:'POST',body:JSON.stringify(Object.fromEntries(f))});afterLogin()}catch{toast('بيانات الدخول غير صحيحة')}};
$('#registerForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);try{await api('/api/auth/register',{method:'POST',body:JSON.stringify(Object.fromEntries(f))});afterLogin()}catch(e){toast(e.data?.error==='USERNAME_TAKEN'?'اسم المستخدم مستخدم بالفعل':'تعذر إنشاء الحساب')}};
$$('.auth-tabs button').forEach(b=>b.onclick=()=>applyAuthMode(b.dataset.auth));
$('#logoutBtn').onclick=async()=>{try{if(window.LutsaNative?.isAndroid)await api('/api/push/native/revoke-all',{method:'POST'});}catch{} try{window.LutsaNative?.revokeNativeAccessToken?.();}catch{} await api('/api/auth/logout',{method:'POST'});location.reload()};
$('#langBtn').onclick=async()=>{state.lang=state.lang==='ar'?'en':'ar';localize();await renderPage()};$('#themeBtn').onclick=()=>cycleTheme();$('#profileTop').onclick=()=>setPage('profile');$('#notifBtn').onclick=async e=>{e.stopPropagation();if($('#notificationPopover')?.classList.contains('hidden'))await refreshNotificationPopover();else $('#notificationPopover')?.classList.add('hidden')};
document.addEventListener('click',e=>{if(!e.target.closest('.searchbox')&&!e.target.closest('#notifBtn')&&!e.target.closest('#notificationPopover'))closeFloatingPopovers()});document.addEventListener('keydown',e=>{if(e.key==='/'&&!/input|textarea|select/i.test(e.target.tagName)){e.preventDefault();$('#globalSearch')?.focus()}if(e.key==='Escape'){closeFloatingPopovers();$('#modal')?.classList.add('hidden')}});
$('#nav').onclick=e=>{const b=e.target.closest('[data-page]');if(b)setPage(b.dataset.page)};$$('.mobile-nav button').forEach(b=>b.onclick=()=>setPage(b.dataset.page));$('#mobileMenu').onclick=()=>$('#sidebar').classList.toggle('open');let searchTimer=null;$('#globalSearch').oninput=e=>{const q=e.target.value.trim();clearTimeout(searchTimer);if(q.length<2){$('#searchPopover')?.classList.add('hidden');return;}searchTimer=setTimeout(async()=>{try{const d=await api('/api/search?q='+encodeURIComponent(q));renderQuickSearch(d,q)}catch{}},240)};$('#globalSearch').onkeydown=e=>{if(e.key==='Escape'){e.target.value='';$('#searchPopover')?.classList.add('hidden');e.target.blur();return;}if(e.key!=='Enter')return;const q=e.target.value.trim();if(q)openFullSearch(q)};
applyTheme();localize();
(async()=>{try{const d=await api('/api/auth/me');if(d.user){await afterLogin();handleNativeCallAction();const q=new URLSearchParams(location.search);const qp=q.get('page');if(qp==='post'&&q.get('postId'))return openSharedPost(q.get('postId'));if(qp==='group'&&q.get('gid'))return openGroupById(q.get('gid'));if(qp==='page'&&q.get('pid'))return openPageById(q.get('pid'));if(qp==='stories'&&q.get('storyId'))return showStory(q.get('storyId'));if(qp==='messenger'){setPage('messenger');if(q.get('uid'))setTimeout(()=>openMessenger(q.get('uid')),50);return;}if(qp&&['home','calls','profile','saved'].includes(qp)){const uid=q.get('uid');setPage(qp,uid?{profileUid:uid}:{})}}}catch(e){console.warn('startup',e)}})();
