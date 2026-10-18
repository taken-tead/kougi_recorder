(() => {
'use strict';
const $ = id => document.getElementById(id);
const DB_NAME = 'kougi-recorder-v1', STORE = 'lectures';
let db, recorder, stream, recognition, chunks = [], activeId = null, startedAt = 0, elapsedBefore = 0, timerHandle = null;
let finalTranscript = '', interimTranscript = '', isPaused = false, isFinishing = false, speechWanted = false, speechRestartTimer = null;
const supportsSpeech = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
const supportsMedia = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
const nowDate = new Date(); $('lectureDate').value = `${nowDate.getFullYear()}-${String(nowDate.getMonth()+1).padStart(2,'0')}-${String(nowDate.getDate()).padStart(2,'0')}`;

function openDB(){ return new Promise((resolve,reject)=>{ const req=indexedDB.open(DB_NAME,1); req.onupgradeneeded=()=>req.result.createObjectStore(STORE,{keyPath:'id'}); req.onsuccess=()=>{db=req.result;resolve(db)}; req.onerror=()=>reject(req.error); }); }
function requestPromise(req){return new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
async function putLecture(item){await requestPromise(db.transaction(STORE,'readwrite').objectStore(STORE).put(item));}
async function getAll(){return (await requestPromise(db.transaction(STORE,'readonly').objectStore(STORE).getAll())).sort((a,b)=>b.updatedAt-a.updatedAt);}
async function getOne(id){return requestPromise(db.transaction(STORE,'readonly').objectStore(STORE).get(id));}
async function removeOne(id){return requestPromise(db.transaction(STORE,'readwrite').objectStore(STORE).delete(id));}
function fmt(ms){const s=Math.floor(ms/1000);return [Math.floor(s/3600),Math.floor(s%3600/60),s%60].map(n=>String(n).padStart(2,'0')).join(':');}
function elapsed(){return elapsedBefore + (startedAt ? Date.now()-startedAt : 0);}
function updateTimer(){ $('timer').textContent=fmt(elapsed()); }
function setStatus(text,kind=''){const el=$('recordStatus');el.textContent=text;el.className='status '+kind;}
function transcriptValue(){return finalTranscript + (interimTranscript ? (finalTranscript && !finalTranscript.endsWith('\n')?' ':'')+interimTranscript : '');}
function showTranscript(){ $('transcript').value=transcriptValue(); $('transcript').scrollTop=$('transcript').scrollHeight; }
function makeRecognition(){
 const SR=window.SpeechRecognition||window.webkitSpeechRecognition;if(!SR)return null;
 const r=new SR();r.lang='ja-JP';r.continuous=true;r.interimResults=true;
 r.onresult=e=>{for(let i=e.resultIndex;i<e.results.length;i++){const text=e.results[i][0].transcript;if(e.results[i].isFinal){finalTranscript+=text+' ';interimTranscript='';}else interimTranscript=text;}showTranscript();};
 r.onerror=e=>{if(e.error==='not-allowed'||e.error==='service-not-allowed'){speechWanted=false;setStatus('録音中（音声認識の権限エラー）','warn');}else if(e.error!=='no-speech'&&e.error!=='aborted'){setStatus('録音中（音声認識エラー：'+e.error+'）','warn');}};
 r.onend=()=>{if(speechWanted&&!isPaused&&!isFinishing){clearTimeout(speechRestartTimer);speechRestartTimer=setTimeout(()=>{try{r.start()}catch(_e){}},350);}};
 return r;
}
async function saveCurrent(status='recording'){
 if(!activeId)return;
 const item={id:activeId,title:$('lectureTitle').value.trim()||'名称未設定の講義',date:$('lectureDate').value||'',durationMs:elapsed(),transcript:$('transcript').value,updatedAt:Date.now(),status,blob:null,mimeType:recorder?.mimeType||'audio/webm'};
 try{const old=await getOne(activeId);if(old){item.blob=old.blob;item.mimeType=old.mimeType||item.mimeType;item.durationMs=elapsed();}await putLecture(item);}catch(e){setStatus('保存エラー：端末容量などを確認してください','warn');throw e;}
}
async function begin(){
 if(!supportsMedia){alert('このブラウザでは録音機能を利用できません。Android版Chromeの最新版をお試しください。');return;}
 if(!supportsSpeech){alert('このブラウザではWeb Speech APIが利用できません。録音だけの試作は未実装です。');return;}
 if(!$('consent').checked){alert('外部音声認識の可能性を確認し、チェックを入れてください。');return;}
 try{
  stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
  chunks=[];activeId=crypto.randomUUID?crypto.randomUUID():String(Date.now())+Math.random().toString(16).slice(2);
  finalTranscript='';interimTranscript='';$('transcript').value='';elapsedBefore=0;startedAt=Date.now();isPaused=false;isFinishing=false;
  const options={};const mime=['audio/webm;codecs=opus','audio/webm','audio/mp4'].find(t=>MediaRecorder.isTypeSupported(t));if(mime)options.mimeType=mime;
  recorder=new MediaRecorder(stream,options);
  recorder.ondataavailable=e=>{if(e.data&&e.data.size)chunks.push(e.data);};
  recorder.onerror=()=>setStatus('録音エラーが発生しました。終了して保存してください','warn');
  recorder.start(5000);
  recognition=makeRecognition();speechWanted=true;try{recognition.start()}catch(e){setStatus('録音中（音声認識の開始に失敗）','warn');}
  $('recordPanel').classList.remove('hidden');$('startBtn').classList.add('hidden');$('resumeBtn').classList.add('hidden');setStatus('録音中','live');
  timerHandle=setInterval(updateTimer,250);
  await saveCurrent('recording');await renderList();
 }catch(e){if(stream)stream.getTracks().forEach(t=>t.stop());stream=null;alert('マイクを開始できませんでした。\nHTTPS接続、マイク権限、他アプリの使用状況をご確認ください。\n'+(e.message||e));}
}
async function pause(){
 if(!recorder||recorder.state!=='recording')return;
 try{recorder.pause();elapsedBefore+=Date.now()-startedAt;startedAt=0;isPaused=true;speechWanted=false;clearTimeout(speechRestartTimer);try{recognition?.stop()}catch(_e){}$('pauseBtn').classList.add('hidden');$('resumeBtn').classList.remove('hidden');setStatus('一時停止中','warn');updateTimer();await saveCurrent('paused');}catch(e){setStatus('一時停止または保存に失敗しました','warn');}
}
async function resume(){
 if(!recorder||recorder.state!=='paused')return;
 try{recorder.resume();startedAt=Date.now();isPaused=false;speechWanted=true;try{recognition?.start()}catch(_e){}$('pauseBtn').classList.remove('hidden');$('resumeBtn').classList.add('hidden');setStatus('録音中','live');}catch(e){setStatus('再開できませんでした','warn');}
}
async function finish(){
 if(!recorder||isFinishing)return;isFinishing=true;speechWanted=false;clearTimeout(speechRestartTimer);clearInterval(timerHandle);
 if(startedAt){elapsedBefore+=Date.now()-startedAt;startedAt=0;}try{recognition?.stop()}catch(_e){}
 const rec=recorder;
 await new Promise(resolve=>{rec.addEventListener('stop',resolve,{once:true});try{if(rec.state!=='inactive')rec.stop();else resolve();}catch(_e){resolve();}});
 if(stream)stream.getTracks().forEach(t=>t.stop());stream=null;
 const blob=new Blob(chunks,{type:rec.mimeType||'audio/webm'});
 try{
  const item={id:activeId,title:$('lectureTitle').value.trim()||'名称未設定の講義',date:$('lectureDate').value||'',durationMs:elapsedBefore,transcript:$('transcript').value,updatedAt:Date.now(),status:'saved',blob,mimeType:blob.type};
  await putLecture(item);setStatus(`保存完了（音声 ${(blob.size/1024/1024).toFixed(1)} MB）`,'ok');
 }catch(e){alert('端末内への保存に失敗しました。空き容量を確認してください。音声データはまだページ内にある可能性があります。');}
 $('recordPanel').classList.add('hidden');$('startBtn').classList.remove('hidden');$('resumeBtn').classList.add('hidden');await renderList();recorder=null;recognition=null;activeId=null;chunks=[];isFinishing=false;
}
function downloadBlob(blob,name){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),3000);}
function safeName(s){return (s||'lecture').replace(/[\\/:*?"<>|]/g,'_').slice(0,80);}
function exportText(text,title,date){downloadBlob(new Blob([text||''],{type:'text/plain;charset=utf-8'}),`${safeName(title)}_${date||'日付未設定'}.txt`);}
async function renderList(){
 const root=$('lectureList');try{const items=await getAll();if(!items.length){root.innerHTML='<p class="small">保存した講義はまだありません。</p>';return;}
 root.innerHTML='';for(const x of items){const el=document.createElement('article');el.className='lecture';const h=document.createElement('h3');h.textContent=x.title;el.append(h);const p=document.createElement('p');p.className='small';p.textContent=`${x.date||'日付未設定'} ・ ${fmt(x.durationMs||0)} ・ ${x.blob? (x.blob.size/1024/1024).toFixed(1)+' MB':'音声未保存'} ・ ${x.status==='saved'?'保存済み':'未完了'}`;el.append(p);
 const row=document.createElement('div');row.className='row';
 const play=document.createElement('button');play.className='secondary';play.textContent='▶ 音声を再生';play.disabled=!x.blob;play.onclick=()=>{const url=URL.createObjectURL(x.blob);const w=window.open('','_blank');if(w){w.document.write('<title>録音再生</title><meta name="viewport" content="width=device-width,initial-scale=1"><p>講義音声</p><audio controls autoplay style="width:100%" src="'+url+'"></audio>');w.document.close();}else downloadBlob(x.blob,safeName(x.title)+'.webm');};row.append(play);
 const audio=document.createElement('button');audio.className='secondary';audio.textContent='音声を書き出す';audio.disabled=!x.blob;audio.onclick=()=>downloadBlob(x.blob,`${safeName(x.title)}_${x.date||'lecture'}.${x.mimeType&&x.mimeType.includes('mp4')?'mp4':'webm'}`);row.append(audio);
 const txt=document.createElement('button');txt.className='secondary';txt.textContent='テキストを書き出す';txt.onclick=()=>exportText(x.transcript,x.title,x.date);row.append(txt);
 const del=document.createElement('button');del.className='danger';del.textContent='削除';del.onclick=async()=>{if(confirm(`「${x.title}」の音声と文字起こしを削除しますか？`)){await removeOne(x.id);await renderList();}};row.append(del);el.append(row);
 const preview=document.createElement('p');preview.className='small';preview.textContent=(x.transcript||'文字起こしなし').slice(0,180);el.append(preview);root.append(el);}
 }catch(e){root.textContent='保存データを読み込めませんでした。ブラウザのサイトデータ設定をご確認ください。';}
}
$('startBtn').onclick=begin;$('pauseBtn').onclick=pause;$('resumeBtn').onclick=resume;$('finishBtn').onclick=()=>{if(confirm('録音を終了して、この端末に保存しますか？'))finish();};
$('exportCurrentText').onclick=()=>exportText($('transcript').value,$('lectureTitle').value,$('lectureDate').value);
$('clearText').onclick=()=>{if(confirm('現在の文字起こし表示を消去しますか？保存済みの講義データは削除されません。')){finalTranscript='';interimTranscript='';$('transcript').value='';}};
$('transcript').addEventListener('input',()=>{finalTranscript=$('transcript').value;interimTranscript='';});
(async()=>{try{await openDB();$('supportStatus').textContent=`録音：${supportsMedia?'対応':'非対応'} ／ 日本語音声認識：${supportsSpeech?'対応':'非対応'}。HTTPS接続とマイク権限が必要です。`;if(!supportsSpeech)$('supportStatus').className='status warn';await renderList();}catch(e){$('supportStatus').textContent='端末内データベースを利用できません：'+e.message;$('supportStatus').className='status warn';}})();
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('./sw.js').catch(()=>{});
window.addEventListener('beforeunload',e=>{if(recorder&&recorder.state!=='inactive'){e.preventDefault();e.returnValue='録音中です。ページを離れると録音が失われる可能性があります。';}});
})();