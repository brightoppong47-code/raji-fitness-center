import {initializeApp} from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js';
import {getAuth,onAuthStateChanged,signInWithEmailAndPassword,sendPasswordResetEmail,sendEmailVerification,signOut} from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js';
import {getFirestore,doc,collection,getDocFromServer,getDocsFromServer,runTransaction,writeBatch,Timestamp,serverTimestamp} from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js';
import {firebaseConfig,OWNER_UID} from './config';
import {validateBackup} from './backup';
const app=initializeApp(firebaseConfig);export const auth=getAuth(app);const db=getFirestore(app);
export {onAuthStateChanged,signInWithEmailAndPassword,sendPasswordResetEmail,sendEmailVerification,signOut};
const stateRef=doc(db,'system','state');
const record=(generation,table,id)=>doc(db,'datasets',generation,table,id);
const text=(value,max=200)=>typeof value==='string'?value.trim().slice(0,max):'';
const methods=['Cash','Mobile Money','Bank transfer'];
const nowISO=()=>new Date().toISOString();
const timestamp=s=>Timestamp.fromDate(new Date(s));
const plus30=s=>new Date(new Date(s).getTime()+30*86400000).toISOString();
function requireUser(){if(!auth.currentUser)throw Error('Please sign in.');return auth.currentUser;}
async function operator(){const user=requireUser();const s=await getDocFromServer(doc(db,'users',user.uid));if(user.uid===OWNER_UID)return {uid:user.uid,email:user.email.toLowerCase(),name:s.data()?.name||user.displayName||'Administrator',role:'admin',active:true};if(!s.exists()||s.data().active!==true)throw Error('Your account has not been enabled by the admin.');return {...s.data(),uid:user.uid};}
function readable(row){const r={...row};for(const [stored,display] of [['recordedAt','created'],['expiresAt','expires'],['enteredAt','entered'],['exitedAt','exited'],['periodEndAt','period_end']])if(r[stored]?.toDate)r[display]=r[stored].toDate().toISOString();for(const k of ['recordedAt','expiresAt','enteredAt','exitedAt','periodEndAt'])delete r[k];return r;}
async function rows(g,t){return (await getDocsFromServer(collection(db,'datasets',g,t))).docs.map(d=>readable({...d.data(),id:t==='settings'?1:d.id}));}
export async function getData(attempt=0){const me=await operator(),s=await getDocFromServer(stateRef);if(!s.exists()){if(me.uid===OWNER_UID)return {setup:true,email:me.email};throw Error('The admin has not activated this gym yet.');}const state=s.data();const [members,payments,attendance,settings,audit]=await Promise.all(['members','payments','attendance','settings','audit'].map(t=>t==='audit'&&me.role!=='admin'?Promise.resolve([]):rows(state.active,t)));const end=(await getDocFromServer(stateRef)).data();if(end.revision!==state.revision||end.active!==state.active){if(attempt<2)return getData(attempt+1);throw Error('Records changed while loading. Please refresh.');}const staff=me.role==='admin'?(await getDocsFromServer(collection(db,'users'))).docs.map(d=>({...d.data(),uid:d.id})):[];return {me,email:me.email,members,payments,attendance,settings,staff,audit:me.role==='admin'?audit.sort((a,b)=>b.created.localeCompare(a.created)).slice(0,100):[],allAudit:audit};}
async function backup(safety=false){const me=await operator();if(me.role!=='admin')throw Error('Admin only.');if(safety){const state=(await getDocFromServer(stateRef)).data();if(!state.previous)throw Error('No recovery copy is available yet.');const data={};for(const t of ['members','payments','attendance','settings','audit'])data[t]=await rows(state.previous,t);data.staff=(await getDocsFromServer(collection(db,'users'))).docs.map(d=>({...d.data(),uid:d.id}));return {format:'raji-fitness-backup',version:1,createdAt:nowISO(),data};}const current=await getData();return {format:'raji-fitness-backup',version:1,createdAt:nowISO(),data:{members:current.members,payments:current.payments,attendance:current.attendance,settings:current.settings,staff:current.staff,audit:current.allAudit}};}
export async function api(b){
 const me=await operator(),user=requireUser();const id=crypto.randomUUID(),now=nowISO(),by=me.name+' ('+me.email+')';
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
  await runTransaction(db,async tx=>{const current=(await tx.get(stateRef)).data();if(current.active!==before.active||current.revision!==before.revision)throw Error('Records changed during restore. Please retry so newer payments are not lost.');tx.set(record(g,'audit',id),{id,created:now,by,action:'Restored backup from '+b.backup.createdAt+'; previous generation retained',createdBy:user.uid,recordedAt:serverTimestamp()});tx.update(stateRef,{active:g,previous:current.active,revision:current.revision+1});});return {ok:true,counts};
 }
 if(b.action==='staff'){
  if(me.role!=='admin')throw Error('Admin only.');const uid=text(b.uid,128);if(!uid||uid.includes('/')||uid===OWNER_UID||uid===user.uid)throw Error('Enter another Firebase user’s valid UID.');if(!['admin','secretary'].includes(b.role)||!text(b.name)||!/^\S+@\S+\.\S+$/.test(b.email))throw Error('Enter a valid name, email and role.');
  const batch=writeBatch(db);batch.set(doc(db,'users',uid),{uid,name:text(b.name,100),email:text(b.email).toLowerCase(),role:b.role,active:true});const state=(await getDocFromServer(stateRef)).data();batch.set(record(state.active,'audit',id),{id,created:now,by,action:'Updated staff access for '+b.email,createdBy:user.uid,recordedAt:serverTimestamp()});await batch.commit();return {ok:true};
 }
 if(b.action==='setup'){
  if(user.uid!==OWNER_UID)throw Error('Only the configured owner can activate the gym.');if(!text(b.name))throw Error('Enter your name.');await runTransaction(db,async tx=>{const s=await tx.get(stateRef);if(s.exists())throw Error('Setup is already complete.');tx.set(stateRef,{active:'live',previous:null,revision:0});tx.set(record('live','settings','1'),{id:1,registration:400,monthly:150,walkin:10});tx.set(doc(db,'users',user.uid),{uid:user.uid,name:text(b.name,100),email:user.email.toLowerCase(),role:'admin',active:true});});return {ok:true};
 }
 await runTransaction(db,async tx=>{
  const state=(await tx.get(stateRef)).data();if(!state)throw Error('Please complete admin setup.');const g=state.active;const cfg=(await tx.get(record(g,'settings','1'))).data();
  const audit=action=>tx.set(record(g,'audit',id),{id,created:now,by,action,createdBy:user.uid,recordedAt:serverTimestamp()});
  if(['register','renew','walkin'].includes(b.action)&&!methods.includes(b.method))throw Error('Choose a payment method.');
  const payment=(pid,member,name,kind,amount,end=null,visitId=null)=>tx.set(record(g,'payments',pid),{id:pid,member,name,kind,amount,method:b.method,created:now,by,period_end:end,periodEndAt:end?timestamp(end):null,visitId,createdBy:user.uid,recordedAt:serverTimestamp()});
  if(b.action==='register'){
   const name=text(b.name,100),phone=text(b.phone,30),photo=text(b.photo,350000);if(!name||phone.replace(/\D/g,'').length<9)throw Error('Enter a name and valid phone number.');if(photo&&!/^data:image\/(jpeg|png|webp);base64,/.test(photo))throw Error('Invalid client photo.');const end=plus30(now),pid=crypto.randomUUID();tx.set(record(g,'members',id),{id,name,phone,emergency:text(b.emergency,100),notes:text(b.notes,1000),photo,created:now,expires:end,expiresAt:timestamp(end),lastPaymentId:pid,openVisitId:null,createdBy:user.uid,recordedAt:serverTimestamp()});payment(pid,id,name,'Registration',cfg.registration,end);audit('Registered '+name+' — GH₵'+cfg.registration);
  }else if(b.action==='renew'){
   const ref=record(g,'members',text(b.member)),s=await tx.get(ref);if(!s.exists())throw Error('Client not found.');const m=s.data(),old=m.expiresAt.toDate().toISOString(),end=plus30(old>now?old:now);tx.update(ref,{expires:end,expiresAt:timestamp(end),lastPaymentId:id});payment(id,m.id,m.name,'Renewal',cfg.monthly,end);audit('Renewed '+m.name+' — GH₵'+cfg.monthly);
  }else if(b.action==='walkin'){
   const name=text(b.name,100);if(!name)throw Error('Enter visitor name.');const visitId=crypto.randomUUID();payment(id,null,name,'Walk-in',cfg.walkin,null,visitId);tx.set(record(g,'attendance',visitId),{id:visitId,member:null,name,type:'Walk-in',entered:now,enteredAt:serverTimestamp(),exited:null,exitedAt:null,by,createdBy:user.uid,paymentId:id});audit('Walk-in: '+name+' — GH₵'+cfg.walkin);
  }else if(b.action==='checkin'){
   const ref=record(g,'members',text(b.member)),s=await tx.get(ref);if(!s.exists())throw Error('Client not found.');const m=s.data();if(m.expiresAt.toMillis()<=Date.now())throw Error('Membership has expired. Renew before check-in.');if(m.openVisitId)throw Error('This client is already checked in.');tx.set(record(g,'attendance',id),{id,member:m.id,name:m.name,type:'Member',entered:now,enteredAt:serverTimestamp(),exited:null,exitedAt:null,by,createdBy:user.uid,paymentId:null});tx.update(ref,{openVisitId:id});audit('Checked in '+m.name);
  }else if(b.action==='checkout'){
   const ref=record(g,'attendance',text(b.visit)),s=await tx.get(ref);if(!s.exists()||s.data().exitedAt)throw Error('Visit is already closed.');const a=s.data();if(a.member){const mref=record(g,'members',a.member),m=await tx.get(mref);if(m.data()?.openVisitId!==a.id)throw Error('Attendance changed. Please refresh.');tx.update(mref,{openVisitId:null});}tx.update(ref,{exited:now,exitedAt:serverTimestamp()});audit('Checked out '+a.name);
  }else if(b.action==='settings'){
   if(me.role!=='admin')throw Error('Admin only.');const values={id:1};for(const k of ['registration','monthly','walkin']){values[k]=Number(b[k]);if(!Number.isInteger(values[k])||values[k]<1||values[k]>100000)throw Error('Use whole cedi fees between 1 and 100,000.');}tx.set(record(g,'settings','1'),values);audit('Updated membership fees');
  }else throw Error('Unknown action.');
  tx.update(stateRef,{revision:state.revision+1});
 });return {ok:true};
}
