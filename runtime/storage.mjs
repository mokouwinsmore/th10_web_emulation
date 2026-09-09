export async function openNativeStorage(language='jp'){
  const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('th10-1.00a-'+language,1);request.onupgradeneeded=()=>request.result.createObjectStore('files');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  const transaction=(mode,callback)=>new Promise((resolve,reject)=>{const tx=db.transaction('files',mode);let result;callback(tx.objectStore('files'),value=>result=value);tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});
  return {load:()=>transaction('readonly',(store,done)=>{const entries=[];store.openCursor().onsuccess=event=>{const cursor=event.target.result;if(cursor){entries.push([cursor.key,cursor.value]);cursor.continue();}else done(entries);};}),save:(name,data)=>transaction('readwrite',store=>store.put(data,name))};
}
