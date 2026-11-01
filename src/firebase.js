import {initializeApp,deleteApp} from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js';
import {getAuth,onAuthStateChanged,signInWithEmailAndPassword,sendPasswordResetEmail,sendEmailVerification,signOut as firebaseSignOut,createUserWithEmailAndPassword,setPersistence,inMemoryPersistence,deleteUser} from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js';
import {getFirestore,doc,collection,getDocFromServer,getDocsFromServer,runTransaction,writeBatch,Timestamp,serverTimestamp} from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js';
import {firebaseConfig,OWNER_UID} from './config';
import {validateBackup} from './backup';
import {online,cacheData,cachedData,clearCache,queueEntries,enqueue,flushQueue,notify} from './offline';
const app=initializeApp(firebaseConfig);export const auth=getAuth(app);const db=getFirestore(app);
export {onAuthStateChanged,signInWithEmailAndPassword,sendPasswordResetEmail,sendEmailVerification};
const stateRef=doc(db,'system','state');
const record=(generation,table,id)=>doc(db,'datasets',generation,table,id);
const text=(value,max=200)=>typeof value==='string'?value.trim().slice(0,max):'';
const methods=['Cash','Mobile Money','Bank transfer'];
const nowISO=()=>new Date().toISOString();
const timestamp=s=>Timestamp.fromDate(new Date(s));
const plus30=s=>new Date(new Date(s).getTime()+30*86400000).toISOString();
function requireUser(){if(!auth.currentUser)throw Error('Please sign in.');return auth.currentUser;}
async function operator(){const user=requireUser();const s=await getDocFromServer(doc(db,'users',user.uid));if(user.uid===OWNER_UID)return {uid:user.uid,email:user.email.toLowerCase(),name:s.data()?.name||user.displayName||'Administrator',role:'admin',active:true};if(!s.exists()||s.data().active!==true)throw Error('Your account has not been enabled by the admin.');return {...s.data(),uid:user.uid};}
function readable(row){const r={...row};for(const [stored,display] of [['recordedAt','created'],['expiresAt','expires'],['enteredAt','entered'],['exitedAt','exited'],['periodEndAt','period_end']])if(r[stored]?.toDate){const event=display==='entered'||display==='created'?r.capturedAt:display==='exited'?r.exitCapturedAt:null;r[display]=(event?.toDate?event:r[stored]).toDate().toISOString();}for(const k of ['recordedAt','expiresAt','enteredAt','exitedAt','periodEndAt'])delete r[k];return r;}
async function rows(g,t){return (await getDocsFromServer(collection(db,'datasets',g,t))).docs.map(d=>readable({...d.data(),id:t==='settings'?1:d.id}));}
async function getOnlineData(attempt=0){const me=await operator(),s=await getDocFromServer(stateRef);if(!s.exists()){if(me.uid===OWNER_UID)return {setup:true,email:me.email};throw Error('The admin has not activated this gym yet.');}const state=s.data();const [members,payments,attendance,settings,audit]=await Promise.all(['members','payments','attendance','settings','audit'].map(t=>t==='audit'&&me.role!=='admin'?Promise.resolve([]):rows(state.active,t)));const end=(await getDocFromServer(stateRef)).data();if(end.revision!==state.revision||end.active!==state.active){if(attempt<2)return getOnlineData(attempt+1);throw Error('Records changed while loading. Please refresh.');}const staff=me.role==='admin'?(await getDocsFromServer(collection(db,'users'))).docs.map(d=>({...d.data(),uid:d.id})):[];return {me,email:me.email,datasetId:state.active,members,payments,attendance,settings,staff,audit:me.role==='admin'?audit.sort((a,b)=>b.created.localeCompare(a.created)).slice(0,100):[],allAudit:audit};}
async function backup(safety=false){const me=await operator();if(me.role!=='admin')throw Error('Admin only.');if(safety){const state=(await getDocFromServer(stateRef)).data();if(!state.previous)throw Error('No recovery copy is available yet.');const data={};for(const t of ['members','payments','attendance','settings','audit'])data[t]=await rows(state.previous,t);data.staff=(await getDocsFromServer(collection(db,'users'))).docs.map(d=>({...d.data(),uid:d.id}));return {format:'raji-fitness-backup',version:1,createdAt:nowISO(),data};}const current=await getData();return {format:'raji-fitness-backup',version:1,createdAt:nowISO(),data:{members:current.members,payments:current.payments,attendance:current.attendance,settings:current.settings,staff:current.staff,audit:current.allAudit}};}
async function sendOnline(b){
 const me=await operator(),user=requireUser();const id=b.operationId||crypto.randomUUID(),now=b.capturedAt||nowISO(),captured=timestamp(now),by=me.name+' ('+me.email+')';
 if(b.action==='backup')return backup(!!b.safety);
 if(b.action==='restore-preview'||b.action==='restore'){
  if(me.role!=='admin')throw Error('Admin only.');const data=validateBackup(b.backup),counts=Object.fromEntries(Object.entries(data).map(([k,v])=>[k,v.length]));
  if(b.action==='restore-preview')return {counts,createdAt:b.backup.createdAt};if(b.confirmation!=='RESTORE')throw Error('Type RESTORE to confirm.');
  const before=(await getDocFromServer(stateRef)).data(),g='restore-'+id;const pending=[];
  for(const t of ['members','payments','attendance','settings','audit'])for(const row of data[t]){
   const r={...row};if(t==='members'){r.expiresAt=timestamp(r.expires);r.openVisitId=data.attendance.find(a=>a.member===r.id&&!a.exited)?.id||null;r.lastPaymentId=null;}
   if(t==='attendance'){r.enteredAt=timestamp(r.entered);r.exitedAt=r.exited?timestamp(r.exited):null;}
   if(t==='payments'&&r.period_end)r.periodEndAt=timestamp(r.period_end);
   pending.push([record(g,t,String(r.id)),r]);
  }
  // Import into a separate generation. The current records remain active until all writes succeed.
  let size=0,chunk=[];async function flush(){if(!chunk.length)return;const batch=writeBatch(db);for(const [ref,row] of chunk)batch.set(ref,row);await batch.commit();chunk=[];size=0;}
  for(const pair of pending){const bytes=new TextEncoder().encode(JSON.stringify(pair[1])).length;if(chunk.length>=100||size+bytes>4000000)await flush();chunk.push(pair);size+=bytes;}await flush();
  await runTransaction(db,async tx=>{const current=(await tx.get(stateRef)).data();if(current.active!==before.active||current.revision!==before.revision)throw Error('Records changed during restore. Please retry so newer payments are not lost.');tx.set(record(g,'audit',id),{id,created:now,by,action:'Restored backup from '+b.backup.createdAt+'; previous generation retained',createdBy:user.uid,capturedAt:captured,recordedAt:serverTimestamp()});tx.update(stateRef,{active:g,previous:current.active,revision:current.revision+1});});return {ok:true,counts};
 }
 if(b.action==='staff'){
  if(me.role!=='admin')throw Error('Admin only.');const uid=text(b.uid,128);if(!uid||uid.includes('/')||uid===OWNER_UID||uid===user.uid)throw Error('Enter another Firebase user’s valid UID.');if(!['admin','secretary'].includes(b.role)||!text(b.name)||!/^\S+@\S+\.\S+$/.test(b.email))throw Error('Enter a valid name, email and role.');
  const batch=writeBatch(db);batch.set(doc(db,'users',uid),{uid,name:text(b.name,100),email:text(b.email).toLowerCase(),role:b.role,active:true});const state=(await getDocFromServer(stateRef)).data();batch.set(record(state.active,'audit',id),{id,created:now,by,action:'Updated staff access for '+b.email,createdBy:user.uid,capturedAt:captured,recordedAt:serverTimestamp()});await batch.commit();return {ok:true};
 }
 if(b.action==='setup'){
  if(user.uid!==OWNER_UID)throw Error('Only the configured owner can activate the gym.');if(!text(b.name))throw Error('Enter your name.');await runTransaction(db,async tx=>{const s=await tx.get(stateRef);if(s.exists())throw Error('Setup is already complete.');tx.set(stateRef,{active:'live',previous:null,revision:0});tx.set(record('live','settings','1'),{id:1,registration:400,monthly:150,walkin:10});tx.set(doc(db,'users',user.uid),{uid:user.uid,name:text(b.name,100),email:user.email.toLowerCase(),role:'admin',active:true});});return {ok:true};
 }
 await runTransaction(db,async tx=>{
  const state=(await tx.get(stateRef)).data();if(!state)throw Error('Please complete admin setup.');const g=state.active;if(b.expectedDataset&&b.expectedDataset!==g)throw Error('The database was restored while this entry was pending. Export and review it before re-entering it.');
  const markerTable=b.action==='register'?'members':['renew','walkin'].includes(b.action)?'payments':b.action==='checkin'?'attendance':null;
  if(markerTable){const existing=await tx.get(record(g,markerTable,id));if(existing.exists()){if(existing.data().createdBy!==user.uid)throw Error('Entry identifier conflict.');return;}}
  const cfg=(await tx.get(record(g,'settings','1'))).data();
  if(b.capturedAt&&(!Number.isFinite(Date.parse(now))||Date.parse(now)>Date.now()+120000||Date.parse(now)<Date.now()-7*86400000))throw Error('Offline entry is older than 7 days or its device time is incorrect. Review it before recording it again.');
  const feeKey={register:'registration',renew:'monthly',walkin:'walkin'}[b.action];if(b.expectedFee!=null&&feeKey&&cfg[feeKey]!==b.expectedFee)throw Error('The fee changed while offline. Export this pending entry and review it before recording it again.');
  const audit=action=>tx.set(record(g,'audit',id),{id,created:now,by,action,createdBy:user.uid,capturedAt:captured,recordedAt:serverTimestamp()});
  if(['register','renew','walkin'].includes(b.action)&&!methods.includes(b.method))throw Error('Choose a payment method.');
  const payment=(pid,member,name,kind,amount,end=null,visitId=null)=>tx.set(record(g,'payments',pid),{id:pid,member,name,kind,amount,method:b.method,created:now,by,period_end:end,periodEndAt:end?timestamp(end):null,visitId,createdBy:user.uid,capturedAt:captured,recordedAt:serverTimestamp()});
  if(b.action==='register'){
   const name=text(b.name,100),phone=text(b.phone,30),photo=text(b.photo,350000);if(!name||phone.replace(/\D/g,'').length<9)throw Error('Enter a name and valid phone number.');if(photo&&!/^data:image\/(jpeg|png|webp);base64,/.test(photo))throw Error('Invalid client photo.');const end=plus30(now),pid=id+'-payment';tx.set(record(g,'members',id),{id,name,phone,emergency:text(b.emergency,100),notes:text(b.notes,1000),photo,created:now,expires:end,expiresAt:timestamp(end),lastPaymentId:pid,openVisitId:null,createdBy:user.uid,capturedAt:captured,recordedAt:serverTimestamp()});payment(pid,id,name,'Registration',cfg.registration,end);audit('Registered '+name+' — GH₵'+cfg.registration);
  }else if(b.action==='renew'){
   const ref=record(g,'members',text(b.member)),s=await tx.get(ref);if(!s.exists())throw Error('Client not found.');const m=s.data(),old=m.expiresAt.toDate().toISOString(),end=plus30(old>now?old:now);tx.update(ref,{expires:end,expiresAt:timestamp(end),lastPaymentId:id});payment(id,m.id,m.name,'Renewal',cfg.monthly,end);audit('Renewed '+m.name+' — GH₵'+cfg.monthly);
  }else if(b.action==='walkin'){
   const name=text(b.name,100);if(!name)throw Error('Enter visitor name.');const visitId=id+'-visit';payment(id,null,name,'Walk-in',cfg.walkin,null,visitId);tx.set(record(g,'attendance',visitId),{id:visitId,member:null,name,type:'Walk-in',entered:now,enteredAt:serverTimestamp(),capturedAt:captured,exited:null,exitedAt:null,by,createdBy:user.uid,paymentId:id});audit('Walk-in: '+name+' — GH₵'+cfg.walkin);
  }else if(b.action==='checkin'){
   const ref=record(g,'members',text(b.member)),s=await tx.get(ref);if(!s.exists())throw Error('Client not found.');const m=s.data();if(m.expiresAt.toMillis()<=Date.parse(now))throw Error('Membership has expired. Renew before check-in.');if(m.openVisitId)throw Error('This client is already checked in.');tx.set(record(g,'attendance',id),{id,member:m.id,name:m.name,type:'Member',entered:now,enteredAt:serverTimestamp(),capturedAt:captured,exited:null,exitedAt:null,by,createdBy:user.uid,paymentId:null});tx.update(ref,{openVisitId:id});audit('Checked in '+m.name);
  }else if(b.action==='checkout'){
   const ref=record(g,'attendance',text(b.visit)),s=await tx.get(ref);if(!s.exists())throw Error('Visit not found.');if(s.data().exitedAt){if(b.offlineEntry)return;throw Error('Visit is already closed.');}const a=s.data();if(a.member){const mref=record(g,'members',a.member),m=await tx.get(mref);if(m.data()?.openVisitId!==a.id)throw Error('Attendance changed. Please refresh.');tx.update(mref,{openVisitId:null});}if(now<s.data().entered)throw Error('Check-out time is before check-in. Check this device’s clock.');tx.update(ref,{exited:now,exitedAt:serverTimestamp(),exitCapturedAt:captured});audit('Checked out '+a.name);
  }else if(b.action==='settings'){
   if(me.role!=='admin')throw Error('Admin only.');const values={id:1};for(const k of ['registration','monthly','walkin']){values[k]=Number(b[k]);if(!Number.isInteger(values[k])||values[k]<1||values[k]>100000)throw Error('Use whole cedi fees between 1 and 100,000.');}tx.set(record(g,'settings','1'),values);audit('Updated membership fees');
  }else throw Error('Unknown action.');
  tx.update(stateRef,{revision:state.revision+1});
 });return {ok:true};
}

export async function getData(){const uid=requireUser().uid;if(!online()){const cached=await cachedData(uid);if(!cached)throw Error('Open this app and sign in online once on this device before using it offline.');return {...cached.data,offline:true,cachedAt:cached.savedAt};}try{let timeout;const data=await Promise.race([getOnlineData(),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Object.assign(Error('Connection unavailable.'),{code:'unavailable'})),8000)})]).finally(()=>clearTimeout(timeout));await cacheData(uid,data);return {...data,offline:false,cachedAt:nowISO()};}catch(e){if(e.code==='permission-denied'||e.code==='unauthenticated'){await clearCache(uid);throw e;}if(['unavailable','deadline-exceeded'].includes(e.code)){const cached=await cachedData(uid);if(cached)return {...cached.data,offline:true,cachedAt:cached.savedAt};}throw e;}}
const queuedActions=['register','renew','walkin','checkin','checkout'];
export async function api(payload){
 const uid=requireUser().uid;
 if(!queuedActions.includes(payload.action)){if(!online())throw Error('This action requires an internet connection.');if(payload.action==='restore'&&(await queueEntries(uid)).length)throw Error('Sync pending entries before restoring a backup.');return sendOnline(payload);}
 if(!globalThis.indexedDB){if(!online())throw Error('Offline storage is unavailable. Reconnect to save this entry.');return sendOnline(payload);}
 const cached=await cachedData(uid);if(!cached||cached.data.setup)throw Error('Complete setup and load your records online first.');
 const entries=await queueEntries(uid);if(['checkin','checkout','renew'].includes(payload.action)&&entries.some(r=>r.payload.action===payload.action&&(r.payload.member||r.payload.visit)===(payload.member||payload.visit)))throw Error('This entry is already waiting to sync.');
 if(['register','walkin'].includes(payload.action)&&!text(payload.name))throw Error('Enter the client name.');if(payload.action==='register'&&text(payload.phone).replace(/\D/g,'').length<9)throw Error('Enter a valid phone number.');
 const feeKey={register:'registration',renew:'monthly',walkin:'walkin'}[payload.action];if(feeKey&&!methods.includes(payload.method))throw Error('Select a payment method.');
 const row=await enqueue(uid,{...payload,expectedDataset:cached.data.datasetId},feeKey?cached.data.settings[0][feeKey]:null);
 if(online())syncPending().catch(()=>notify());return {ok:true,pending:true};
}
let syncing;
export async function syncPending(){if(!online()||!auth.currentUser)return;if(syncing)return syncing;const uid=auth.currentUser.uid;if(!(await queueEntries(uid)).length)return;const run=()=>flushQueue(uid,async b=>{if(auth.currentUser?.uid!==uid)throw Error('Sign in with the account that recorded these entries.');return sendOnline(b)});syncing=(typeof navigator!=='undefined'&&navigator.locks?navigator.locks.request('raji-sync-'+uid,run):run()).finally(()=>{syncing=null;notify()});return syncing;}
export async function signOut(){const uid=auth.currentUser?.uid;if(uid&&(await queueEntries(uid)).length)throw Error('Sync or export and remove pending entries before signing out.');if(uid)await clearCache(uid);return firebaseSignOut(auth);}
export {queueEntries};

export async function createStaffLogin(payload){
 if(!online())throw Error('Connect to the internet to create staff logins.');
 const me=await operator();if(me.role!=='admin')throw Error('Admin only.');
 const name=text(payload.name,100),email=text(payload.email).toLowerCase(),role=payload.role,password=payload.password;
 if(!name||!/^\S+@\S+\.\S+$/.test(email)||!['admin','secretary'].includes(role))throw Error('Enter the staff name, valid email and role.');
 if(typeof password!=='string'||password.length<(payload.accountMode==='existing'?6:8)||password.length>128)throw Error(payload.accountMode==='existing'?'Enter the existing account password (at least 6 characters).':'Use a password between 8 and 128 characters.');
 const secondary=initializeApp(firebaseConfig,'raji-staff-'+crypto.randomUUID()),staffAuth=getAuth(secondary);
 let created=null;
 try{
  await setPersistence(staffAuth,inMemoryPersistence);
  const credential=payload.accountMode==='existing'?await signInWithEmailAndPassword(staffAuth,email,password):await createUserWithEmailAndPassword(staffAuth,email,password);
  if(payload.accountMode!=='existing')created=credential.user;
  await sendOnline({action:'staff',uid:credential.user.uid,name,email,role});
  return {ok:true,staffCreated:true};
 }catch(e){
  if(created){try{const saved=await getDocFromServer(doc(db,'users',created.uid));if(saved.exists()&&saved.data().role===role&&saved.data().email===email)return {ok:true,staffCreated:true};}catch{}try{await deleteUser(created)}catch{throw Error('The login was created, but access could not be saved. Reconnect and choose Existing login with the same email and password to finish setup.');}}
  const messages={'auth/email-already-in-use':'This email already has a login. Select Existing login and enter its current password to link it automatically.','auth/invalid-credential':'The existing email or password is incorrect. The staff member can use Forgot password on the login page.','auth/weak-password':'Firebase rejected this password. Choose a stronger one that meets your project’s password policy.','auth/invalid-password':'Choose a stronger password that meets your Firebase password policy.','auth/password-does-not-meet-requirements':'Choose a stronger password that meets your Firebase password policy.','auth/invalid-email':'Enter a valid staff email address.','auth/operation-not-allowed':'Enable Email/Password in Firebase Authentication first.','auth/network-request-failed':'Connection interrupted. Reconnect and try again.','auth/too-many-requests':'Too many attempts. Please wait and try again.'};
  throw Error(messages[e.code]||e.message||'Staff login could not be created.');
 }finally{
  try{await firebaseSignOut(staffAuth)}catch{}try{await deleteApp(secondary)}catch{}
 }
}
