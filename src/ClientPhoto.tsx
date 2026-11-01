import {useEffect,useRef,useState} from 'react';
import {Camera,RefreshCw,Upload,X} from 'lucide-react';
// Keep photos small enough for registration, Firestore and the offline outbox.
export function compressPhoto(source:CanvasImageSource,width:number,height:number){
 if(!width||!height)throw Error('The camera image is not ready. Please try again.');
 const canvas=document.createElement('canvas');let scale=Math.min(1,720/Math.max(width,height));
 for(let round=0;round<4;round++){
  canvas.width=Math.max(1,Math.round(width*scale));canvas.height=Math.max(1,Math.round(height*scale));
  const ctx=canvas.getContext('2d');if(!ctx)throw Error('Photo processing is unavailable. Please choose another browser.');ctx.drawImage(source,0,0,canvas.width,canvas.height);
  for(const quality of [.85,.7,.55,.4]){const data=canvas.toDataURL('image/jpeg',quality);if(data.startsWith('data:image/jpeg;base64,')&&(data.length-data.indexOf(',')-1)*.75<=250000)return data;}
  scale*=.7;
 }
 throw Error('This photo is too large. Try a simpler background or choose another photo.');
}
export default function ClientPhoto({photo,onChange}:{photo:string,onChange:(value:string)=>void}){
 const video=useRef<HTMLVideoElement>(null),stream=useRef<MediaStream|null>(null),generation=useRef(0),mounted=useRef(true);
 const [cameraOpen,setCameraOpen]=useState(false),[ready,setReady]=useState(false),[working,setWorking]=useState(false),[facing,setFacing]=useState<'user'|'environment'>('user'),[error,setError]=useState('');
 const gallery=useRef<HTMLInputElement>(null),phoneCamera=useRef<HTMLInputElement>(null);
 function stopCamera(){generation.current++;stream.current?.getTracks().forEach(t=>t.stop());stream.current=null;if(video.current)video.current.srcObject=null;setCameraOpen(false);setReady(false);setWorking(false);}
 useEffect(()=>{if(cameraOpen&&!working&&video.current&&stream.current){video.current.srcObject=stream.current;video.current.play().catch(()=>setError('Tap the video or reopen the camera if the preview does not start.'));}},[cameraOpen,working]);
 useEffect(()=>()=>{mounted.current=false;generation.current++;stream.current?.getTracks().forEach(t=>t.stop());stream.current=null},[]);
 async function startCamera(direction=facing){stopCamera();const token=++generation.current;setError('');if(!navigator.mediaDevices?.getUserMedia){phoneCamera.current?.click();return;}setCameraOpen(true);setWorking(true);
  try{const next=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:direction},width:{ideal:1280},height:{ideal:960}},audio:false});
   if(!mounted.current||generation.current!==token){next.getTracks().forEach(t=>t.stop());return;}stream.current=next;setFacing(direction);if(video.current){video.current.srcObject=next;await video.current.play();}setWorking(false);
  }catch(e:any){if(!mounted.current||generation.current!==token)return;stopCamera();setError(e.name==='NotAllowedError'?'Camera permission was denied. Allow camera access in your browser, or use the phone camera / upload buttons below.':e.name==='NotFoundError'?'No camera was found. Connect a webcam or choose a photo below.':e.name==='NotReadableError'?'The camera is in use by another app. Close that app and try again.':'The camera could not open. Try the phone camera button or upload a photo.');}
 }
 function capture(){if(!ready||!video.current)return;try{const value=compressPhoto(video.current,video.current.videoWidth,video.current.videoHeight);onChange(value);stopCamera();setError('');}catch(e:any){setError(e.message)}}
 async function selectFile(file?:File){if(!file)return;stopCamera();setWorking(true);setError('');let url='';try{if(!['image/jpeg','image/png','image/webp','image/heic','image/heif'].includes(file.type)&&!/^image\//.test(file.type))throw Error('Choose an image file.');if(file.size>20*1024*1024)throw Error('Choose a photo smaller than 20 MB.');url=URL.createObjectURL(file);const image=new Image();await new Promise<void>((resolve,reject)=>{image.onload=()=>resolve();image.onerror=()=>reject(Error('This photo format cannot be opened. Please take a new photo or use JPEG, PNG or WebP.'));image.src=url});const result=compressPhoto(image,image.naturalWidth,image.naturalHeight);if(mounted.current)onChange(result);}catch(e:any){if(mounted.current)setError(e.message)}finally{if(url)URL.revokeObjectURL(url);if(mounted.current)setWorking(false)}}
 return <section className="client-photo" aria-label="Client registration photo"><div className="photo-label">Client photo <span>(optional)</span></div><p>Take a clear photo with the client’s permission. Photos are automatically resized for storage.</p>
 {cameraOpen?<div className="camera-box"><video ref={video} autoPlay playsInline muted onLoadedMetadata={()=>setReady(true)} aria-label="Live camera preview"/><span className="camera-hint">{working?'Opening camera…':'Position the client in the frame'}</span><div className="camera-controls"><button type="button" className="primary" disabled={!ready||working} onClick={capture}><Camera size={19}/>Take photo</button><button type="button" className="secondary" disabled={working} onClick={()=>startCamera(facing==='user'?'environment':'user')}><RefreshCw size={18}/>Switch camera</button><button type="button" className="secondary" onClick={stopCamera}>Cancel camera</button></div></div>:photo?<div className="client-photo-preview"><img src={photo} alt="Client photo preview"/><div><b>Photo ready</b><p>This photo will be saved with the client.</p><button type="button" className="link" onClick={()=>onChange('')}><X size={18}/>Remove photo</button></div></div>:null}
 {!cameraOpen&&<div className="button-row"><button type="button" className="secondary" disabled={working} onClick={()=>startCamera()}><Camera size={19}/>{photo?'Retake photo':'Open camera'}</button><button type="button" className="secondary" disabled={working} onClick={()=>phoneCamera.current?.click()}><Camera size={18}/>Phone camera</button><button type="button" className="secondary" disabled={working} onClick={()=>gallery.current?.click()}><Upload size={18}/>{photo?'Replace photo':'Upload photo'}</button></div>}
 <input ref={gallery} type="file" accept="image/*" aria-label="Choose client photo" hidden onChange={e=>{const f=e.target.files?.[0];e.target.value='';selectFile(f)}}/><input ref={phoneCamera} type="file" accept="image/*" capture="user" aria-label="Take client photo with phone camera" hidden onChange={e=>{const f=e.target.files?.[0];e.target.value='';selectFile(f)}}/>
 {working&&!cameraOpen&&<p role="status">Preparing photo…</p>}{error&&<p className="photo-error" role="alert">{error}</p>}</section>
}
