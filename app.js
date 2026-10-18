(()=>{
'use strict';
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const abs=p=>new URL(p,location.href).href;
const CATS=['发票','合同','收据','截图','其他'];
const fmt=n=>(Math.round(n*100)/100).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,8);
function toast(m,ms=2600){const t=$('#toast');t.textContent=m;t.hidden=false;clearTimeout(toast.t);toast.t=setTimeout(()=>t.hidden=true,ms);}

/* ---------- IndexedDB ---------- */
let db;
function openDB(){return new Promise((res,rej)=>{const r=indexedDB.open('piaoju',1);
  r.onupgradeneeded=()=>{const d=r.result;d.createObjectStore('docs',{keyPath:'id'});d.createObjectStore('blobs',{keyPath:'id'});};
  r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});}
const tx=(st,mode,fn)=>new Promise((res,rej)=>{const t=db.transaction(st,mode);let out;const r=fn(...[].concat(st).map(s=>t.objectStore(s)));if(r)r.onsuccess=()=>out=r.result;t.oncomplete=()=>res(out);t.onerror=t.onabort=()=>rej(t.error);});
const dbAll=st=>tx(st,'readonly',s=>s.getAll());
const dbGet=(st,id)=>tx(st,'readonly',s=>s.get(id));
const dbPut=(st,v)=>tx(st,'readwrite',s=>s.put(v));
const dbDel=(st,id)=>tx(st,'readwrite',s=>s.delete(id));

/* ---------- 状态 ---------- */
let docs=[];            // 全部（pending + saved）
const procs=new Map();  // 正在处理: id -> {name,pct,msg,err}
let mini=null;
const thumbURL=new Map();
const saved=()=>docs.filter(d=>d.status==='saved');
const pend=()=>docs.filter(d=>d.status==='pending');

/* ---------- 搜索（MiniSearch + 中文二元切词） ---------- */
function tokenize(s){
  s=String(s||'').toLowerCase();const out=[];
  const re=/[\u3400-\u9fff]+|[a-z0-9]+(?:[.\-][a-z0-9]+)*/g;let m;
  while((m=re.exec(s))){const w=m[0];
    if(/^[\u3400-\u9fff]/.test(w)){for(let i=0;i<w.length;i++){out.push(w[i]);if(i+1<w.length)out.push(w.slice(i,i+2));}}
    else{out.push(w);if(w.length>3)for(let i=0;i+3<=w.length;i++)out.push(w.slice(i,i+3));}}
  return out;
}
function qTokens(s){ // 查询：中文只用二元（单字则单字），字母数字整词
  s=String(s||'').toLowerCase();const out=[];const re=/[\u3400-\u9fff]+|[a-z0-9]+(?:[.\-][a-z0-9]+)*/g;let m;
  while((m=re.exec(s))){const w=m[0];
    if(/^[\u3400-\u9fff]/.test(w)){if(w.length===1)out.push(w);else for(let i=0;i+2<=w.length;i++)out.push(w.slice(i,i+2));}
    else out.push(w.length>3?w:w);}
  return out;
}
function docIndexText(d){const f=d.f||{};return [d.name,d.category,(d.tags||[]).join(' '),d.note,f.amount,f.date,f.invoiceNo,f.invoiceCode,f.buyer,f.seller,d.text].join('\n');}
function buildIndex(){
  mini=new MiniSearch({fields:['body'],storeFields:[],tokenize,searchOptions:{tokenize:qTokens,combineWith:'AND',prefix:false,fuzzy:false}});
  mini.addAll(saved().map(d=>({id:d.id,body:docIndexText(d)})));
}
function search(q){
  q=q.trim();if(!q)return null;
  const terms=qTokens(q);if(!terms.length)return new Map();
  const r=mini.search(q,{tokenize:qTokens,combineWith:'AND'});
  const m=new Map();r.forEach(x=>m.set(x.id,x.score));
  // 兜底：整串子串匹配（MiniSearch 二元切词可能漏掉跨标点的查询）
  const ql=q.toLowerCase();
  saved().forEach(d=>{if(!m.has(d.id)&&docIndexText(d).toLowerCase().includes(ql))m.set(d.id,0.5);});
  return m;
}
function snippet(d,q){
  const t=(d.text||'').replace(/\n+/g,' ');const ql=q.toLowerCase();let i=t.toLowerCase().indexOf(ql);
  if(i<0){const ts=qTokens(q);for(const w of ts){i=t.toLowerCase().indexOf(w);if(i>=0){break;}}}
  if(i<0)return '';
  const s=Math.max(0,i-24),e=Math.min(t.length,i+q.length+48);
  let seg=esc(t.slice(s,e));
  const parts=[q,...qTokens(q)].filter(Boolean).sort((a,b)=>b.length-a.length);
  for(const p of parts){const re=new RegExp(esc(p).replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'gi');seg=seg.replace(re,m=>'\u0001'+m+'\u0002');}
  return (s>0?'…':'')+seg.replace(/\u0001/g,'<mark>').replace(/\u0002/g,'</mark>')+(e<t.length?'…':'');
}

/* ---------- 图像预处理 ---------- */
function mkCanvas(w,h){const c=document.createElement('canvas');c.width=Math.max(1,Math.round(w));c.height=Math.max(1,Math.round(h));return c;}
function scaleTo(src,maxEdge,minEdge){
  const w=src.width,h=src.height,long=Math.max(w,h);let k=1;
  if(long>maxEdge)k=maxEdge/long;else if(long<minEdge)k=Math.min(2.5,minEdge/long);
  if(k===1&&src instanceof HTMLCanvasElement)return src;
  const c=mkCanvas(w*k,h*k);const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,c.width,c.height);x.imageSmoothingQuality='high';x.drawImage(src,0,0,c.width,c.height);return c;
}
function estimateSkew(cv){
  const k=Math.min(1,520/cv.width);const c=mkCanvas(cv.width*k,cv.height*k);const x=c.getContext('2d');x.drawImage(cv,0,0,c.width,c.height);
  const id=x.getImageData(0,0,c.width,c.height).data;const W=c.width,Hh=c.height;const g=new Float32Array(W*Hh);
  for(let i=0,j=0;i<id.length;i+=4,j++)g[j]=id[i]*.3+id[i+1]*.59+id[i+2]*.11;
  // 积分图求局部均值：比局部均值明显更暗的像素视为“墨迹”（对阴影、深色背景更稳）
  const I=new Float64Array((W+1)*(Hh+1));
  for(let y=0;y<Hh;y++){let row=0;for(let xx=0;xx<W;xx++){row+=g[y*W+xx];I[(y+1)*(W+1)+xx+1]=I[y*(W+1)+xx+1]+row;}}
  const R=9;const pts=[];const mean=0;
  for(let y=0;y<Hh;y++)for(let xx=0;xx<W;xx++){const x0=Math.max(0,xx-R),x1=Math.min(W,xx+R+1),y0=Math.max(0,y-R),y1=Math.min(Hh,y+R+1);
    const m=(I[y1*(W+1)+x1]-I[y0*(W+1)+x1]-I[y1*(W+1)+x0]+I[y0*(W+1)+x0])/((x1-x0)*(y1-y0));
    if(g[y*W+xx]<m-28)pts.push(xx,y);}
  const n=pts.length/2;if(window.__skewDbg)console.log('pts',n,g.length,mean);if(n<250||n>g.length*0.3)return 0;
  const step=Math.max(1,Math.floor(n/25000));
  const score=a=>{const s=Math.sin(a),co=Math.cos(a);const H=new Float32Array(c.height*2+c.width+10);const off=c.width;
    for(let i=0;i<n;i+=step){const y=-pts[2*i]*s+pts[2*i+1]*co;H[(y+off)|0]++;}let sc=0;for(let i=1;i<H.length;i++){const d=H[i]-H[i-1];sc+=d*d;}return sc;};
  let best=0,bs=score(0);
  for(let d=-15;d<=15;d+=.5){const a=d*Math.PI/180,s=score(a);if(s>bs){bs=s;best=d;}}
  for(let d=best-.5;d<=best+.5;d+=.1){const a=d*Math.PI/180,s=score(a);if(s>bs){bs=s;best=d;}}
  if(window.__skewDbg)console.log('skew',n,g.length,best,bs,score(0));
  if(Math.abs(best)<0.4||bs<score(0)*1.06)return 0;
  return best;
}
function rotateCanvas(cv,deg){
  const a=deg*Math.PI/180,s=Math.abs(Math.sin(a)),c=Math.abs(Math.cos(a));
  const W=cv.width*c+cv.height*s,H=cv.width*s+cv.height*c;const o=mkCanvas(W,H);const x=o.getContext('2d');
  x.fillStyle='#fff';x.fillRect(0,0,o.width,o.height);x.translate(o.width/2,o.height/2);x.rotate(a);x.drawImage(cv,-cv.width/2,-cv.height/2);return o;
}
function grayEnhance(cv){
  const o=mkCanvas(cv.width,cv.height);const x=o.getContext('2d');x.drawImage(cv,0,0);
  const im=x.getImageData(0,0,o.width,o.height),d=im.data;const hist=new Uint32Array(256);
  for(let i=0;i<d.length;i+=4){const g=(d[i]*.3+d[i+1]*.59+d[i+2]*.11)|0;d[i]=g;hist[g]++;}
  const tot=d.length/4;let a=0,lo=0,hi=255;for(let i=0;i<256;i++){a+=hist[i];if(a>tot*.01){lo=i;break;}}a=0;for(let i=255;i>=0;i--){a+=hist[i];if(a>tot*.01){hi=i;break;}}
  const sc=hi>lo+20?255/(hi-lo):1;
  for(let i=0;i<d.length;i+=4){let g=(d[i]-lo)*sc;g=g<0?0:g>255?255:g;d[i]=d[i+1]=d[i+2]=g;}
  x.putImageData(im,0,0);return o;
}
const toBlob=(cv,type='image/jpeg',q=.86)=>new Promise(r=>cv.toBlob(r,type,q));
async function makeThumb(cv){const k=Math.min(1,220/cv.width);const c=mkCanvas(cv.width*k,cv.height*k);c.getContext('2d').drawImage(cv,0,0,c.width,c.height);return toBlob(c,'image/jpeg',.7);}

/* ---------- OCR 引擎 ---------- */
let worker=null,workerP=null,curJob=null;
function setEngine(msg,pct){$('#engState').textContent=msg;if(pct!=null)$('#engBar').style.width=Math.round(pct*100)+'%';}
async function getWorker(){
  if(worker)return worker;
  if(workerP)return workerP;
  workerP=(async()=>{
    setEngine('正在加载识别引擎与中英文语言包（约 9 MB，本站本地文件，仅首次较慢）…',.05);
    const w=await Tesseract.createWorker(['chi_sim','eng'],1,{workerPath:abs('vendor/tess/worker.min.js'),corePath:abs('vendor/tess/'),langPath:abs('vendor/tess/'),gzip:true,
      logger:m=>{
        if(m.status==='recognizing text'){if(curJob)curJob(m.progress);}
        else if(/loading|initializ/.test(m.status))setEngine('引擎：'+({'loading tesseract core':'加载内核','initializing tesseract':'初始化','loading language traineddata':'加载语言包','initializing api':'初始化识别接口','loaded language traineddata':'语言包已加载'}[m.status]||m.status),.1+.8*(m.progress||0));
      }});
    worker=w;setEngine('引擎已就绪（中文简体 + 英文，本地运行）。',1);return w;
  })();
  try{return await workerP;}catch(e){workerP=null;setEngine('引擎加载失败：'+e.message,0);throw e;}
}

/* ---------- 文件导入 ---------- */
async function loadImageSource(file){
  try{return await createImageBitmap(file);}catch(e){
    return await new Promise((res,rej)=>{const u=URL.createObjectURL(file);const im=new Image();im.onload=()=>res(im);im.onerror=()=>rej(new Error('无法解码该图片（HEIC 等格式部分浏览器不支持，请先转成 JPG/PNG）'));im.src=u;});
  }
}
function groupPdfItems(items,vp){
  // 将文本项按行聚合；返回[{t,c:100,b:[x0,y0,x1,y1]}]
  const its=items.filter(i=>i.str&&i.str.trim()).map(i=>{const tr=pdfjsLib.Util.transform(vp.transform,i.transform);const h=Math.hypot(tr[2],tr[3])||10;return {s:i.str,x:tr[4],y:tr[5],w:i.width*vp.scale,h};});
  its.sort((a,b)=>a.y-b.y||a.x-b.x);const lines=[];
  for(const it of its){const L=lines.find(l=>Math.abs(l.y-it.y)<Math.max(2,it.h*.4));if(L){L.items.push(it);}else lines.push({y:it.y,items:[it]});}
  lines.sort((a,b)=>a.y-b.y);
  return lines.map(l=>{l.items.sort((a,b)=>a.x-b.x);let t='',px=null;
    for(const it of l.items){if(px!=null&&it.x-px>it.h*.3)t+=' ';t+=it.s;px=it.x+it.w;}
    const x0=Math.min(...l.items.map(i=>i.x)),x1=Math.max(...l.items.map(i=>i.x+i.w)),h=Math.max(...l.items.map(i=>i.h));
    return {t,c:100,b:[x0,l.y-h*.85,x1,l.y+h*.25]};});
}
async function processFile(file,id,upd){
  const isPdf=file.type==='application/pdf'||/\.pdf$/i.test(file.name);
  let lines=[],imgW=0,imgH=0,mode='ocr',pages=1,preview=null,thumb=null,notes=[];
  if(isPdf){
    upd(.02,'读取 PDF…');pdfjsLib.GlobalWorkerOptions.workerSrc=abs('vendor/pdf.worker.min.js');
    const pdf=await pdfjsLib.getDocument({data:new Uint8Array(await file.arrayBuffer())}).promise;
    pages=pdf.numPages;const MAXP=10;const usedPages=Math.min(pages,MAXP);if(pages>MAXP)notes.push('PDF 共 '+pages+' 页，仅处理前 '+MAXP+' 页。');
    let usedOcr=false,usedText=false;
    for(let p=1;p<=usedPages;p++){
      upd(.05+.9*(p-1)/usedPages,'第 '+p+'/'+usedPages+' 页');
      const page=await pdf.getPage(p);const vp1=page.getViewport({scale:1});const sc=Math.min(2.4,Math.max(1.2,1800/vp1.width));const vp=page.getViewport({scale:sc});
      const tc=await page.getTextContent();const pl=groupPdfItems(tc.items,vp);const chars=pl.reduce((a,l)=>a+l.t.replace(/\s/g,'').length,0);
      const cv=mkCanvas(vp.width,vp.height);const cx=cv.getContext('2d');cx.fillStyle='#fff';cx.fillRect(0,0,cv.width,cv.height);
      await page.render({canvasContext:cx,viewport:vp}).promise;
      if(p===1){imgW=cv.width;imgH=cv.height;preview=await toBlob(cv,'image/jpeg',.88);thumb=await makeThumb(cv);}
      if(chars>=15){usedText=true;lines.push(...pl.map(l=>p===1?l:{t:l.t,c:100,b:null}));}
      else{usedOcr=true;const r=await ocrCanvas(cv,(f)=>upd(.05+.9*((p-1)+f)/usedPages,'第 '+p+'/'+usedPages+' 页 识别 '+Math.round(f*100)+'%'),false);
        lines.push(...r.lines.map(l=>p===1?l:{...l,b:null}));}
      if(p>1)lines.push({t:'',c:100,b:null});
    }
    mode=usedOcr?(usedText?'mixed':'ocr'):'textlayer';
    if(usedOcr)notes.push('该 PDF 含扫描页，已用 OCR。');
  }else{
    upd(.03,'读取图片…');const src=await loadImageSource(file);
    let work=scaleTo(src,2600,1500);let deg=0;
    try{deg=estimateSkew(work);if(deg)work=rotateCanvas(work,-deg);}catch(e){}
    if(deg)notes.push('已自动纠偏 '+(-deg).toFixed(1)+'°');
    imgW=work.width;imgH=work.height;preview=await toBlob(work,'image/jpeg',.88);thumb=await makeThumb(work);
    const r=await ocrCanvas(work,f=>upd(.05+.9*f,'识别 '+Math.round(f*100)+'%'),true);lines=r.lines;
  }
  const ex=PJX.extract(lines);
  const confs=ex.lines.filter(l=>l.t&&l.c!=null);const avg=confs.length?confs.reduce((a,l)=>a+l.c,0)/confs.length:0;
  const doc={id,status:'pending',name:file.name,mime:file.type,size:file.size,isPdf,pages,addedAt:Date.now(),ocrMode:mode,ocrConf:Math.round(avg),text:ex.text,lines:ex.lines.map(l=>({t:l.t,c:Math.round(l.c),b:l.b?l.b.map(Math.round):null})),imgW,imgH,
    ext:ex.fields,warnings:ex.warnings,notes,f:{},category:ex.docType,tags:[],note:'',previewDeskew:notes.some(n=>/纠偏/.test(n))};
  ex.fields.forEach(f=>doc.f[f.key]=f.value);
  await dbPut('blobs',{id,orig:file,preview,thumb});
  return doc;
}
async function ocrCanvas(cv,onp,enhance){
  const w=await getWorker();const g=enhance?grayEnhance(cv):cv;
  curJob=onp;const {data}=await w.recognize(g);curJob=null;
  const ls=(data.lines||[]).filter(l=>l.text&&l.text.trim()).map(l=>({t:l.text.replace(/\n/g,''),c:l.confidence,b:[l.bbox.x0,l.bbox.y0,l.bbox.x1,l.bbox.y1]}));
  return {lines:ls,raw:data};
}
let queue=Promise.resolve();
function enqueue(files){
  for(const file of files){
    if(!(file.type.startsWith('image/')||file.type==='application/pdf'||/\.(pdf|jpe?g|png|webp|bmp|gif|heic)$/i.test(file.name))){toast('已忽略不支持的文件：'+file.name);continue;}
    const id=uid();procs.set(id,{name:file.name,pct:0,msg:'排队中…'});renderQueue();
    queue=queue.then(async()=>{
      const p=procs.get(id);
      try{
        const doc=await processFile(file,id,(pct,msg)=>{p.pct=pct;p.msg=msg;renderQueue(true);});
        procs.delete(id);docs.push(doc);await dbPut('docs',doc);
      }catch(e){console.error(e);p.err=e.message||String(e);p.file=file;}
      renderAll();
    });
  }
  setView('inbox');
}

/* ---------- 渲染 ---------- */
function confClass(c){return c>=.8?'hi':c>=.55?'md':'lo';}
function monthKey(d){return d.f&&/^\d{4}-\d{2}/.test(d.f.date||'')?d.f.date.slice(0,7):'未填日期';}
const numOf=d=>{const v=parseFloat((d.f&&d.f.amount)||'');return isFinite(v)?v:0;};
function updateThumbURL(id,blob){if(thumbURL.has(id))return thumbURL.get(id);const u=URL.createObjectURL(blob);thumbURL.set(id,u);return u;}
async function thumbFor(id){if(thumbURL.has(id))return thumbURL.get(id);const b=await dbGet('blobs',id);if(b&&b.thumb)return updateThumbURL(id,b.thumb);return '';}
function hydrateThumbs(root){root.querySelectorAll('[data-th]').forEach(async el=>{const u=await thumbFor(el.dataset.th);if(u)el.innerHTML='<img alt="" src="'+u+'">';});}

function renderQueue(light){
  const el=$('#queue');
  const rows=[];
  for(const [id,p] of procs){
    rows.push(`<div class="row" data-p="${id}"><div class="th"><span>${p.err?'!':'…'}</span></div><div><h4>${esc(p.name)}</h4><div class="sub">${p.err?'<span class="chip warn">失败</span> '+esc(p.err):esc(p.msg)}</div>${p.err?'':'<div class="prog"><i style="width:'+Math.round(p.pct*100)+'%"></i></div>'}</div><div>${p.err?`<button class="pill sm ink" data-act="manual" data-id="${id}">仍手动录入</button> <button class="pill sm ghost" data-act="dismiss" data-id="${id}">移除</button>`:''}</div></div>`);
  }
  for(const d of pend().sort((a,b)=>b.addedAt-a.addedAt)){
    const am=d.ext.find(f=>f.key==='amount'),lowN=d.ext.filter(f=>f.value&&f.conf<.55).length;
    rows.push(`<div class="row" data-id="${d.id}"><div class="th" data-th="${d.id}"><span>…</span></div><div><h4>${esc(d.name)}</h4><div class="sub"><span class="chip">${esc(d.category)}</span><span class="chip">识别置信度均值 ${d.ocrMode==='textlayer'?'文本层 100%':d.ocrConf+'%'}</span>${lowN?`<span class="chip warn">${lowN} 项低置信度</span>`:''}<br>${am&&am.value?'金额 '+esc(am.value)+' 元':'金额未识别'} · ${esc(d.f.date||'日期未识别')}</div></div><div><button class="pill sm primary" style="background:var(--navy);color:#fff" data-act="review" data-id="${d.id}">去校对</button></div></div>`);
  }
  if(!rows.length)rows.push('<p class="empty">还没有待校对的文件。导入后，识别结果会停在这里，由你确认后才进入资料库。</p>');
  if(light&&el.querySelectorAll('[data-p]').length===procs.size&&!$$('#queue [data-p] .chip.warn').length){ // 仅更新进度
    for(const [id,p] of procs){const r=el.querySelector(`[data-p="${id}"]`);if(r){r.querySelector('.sub').textContent=p.msg;const b=r.querySelector('.prog i');if(b)b.style.width=Math.round(p.pct*100)+'%';}}return;}
  el.innerHTML=rows.join('');hydrateThumbs(el);
}
function allTags(){const m=new Map();saved().forEach(d=>(d.tags||[]).forEach(t=>m.set(t,(m.get(t)||0)+1)));return [...m.entries()].sort((a,b)=>b[1]-a[1]);}
function fillSelect(sel,first,opts,keep=true){const v=sel.value;sel.innerHTML=`<option value="">${first}</option>`+opts.map(o=>`<option value="${esc(o[0])}">${esc(o[1])}</option>`).join('');if(keep&&opts.some(o=>o[0]===v))sel.value=v;}
function renderFilters(){
  const s=saved();
  fillSelect($('#fCat'),'全部类别',CATS.map(c=>[c,c+' ('+s.filter(d=>d.category===c).length+')']));
  fillSelect($('#fTag'),'全部标签',allTags().map(([t,n])=>[t,t+' ('+n+')']));
  const ms=[...new Set(s.map(monthKey))].sort().reverse();
  fillSelect($('#fMonth'),'全部月份',ms.map(m=>[m,m]));fillSelect($('#exMonth'),'全部月份',ms.map(m=>[m,m]));
  $('#tagSug').innerHTML=allTags().map(([t])=>`<option value="${esc(t)}">`).join('');
}
function renderLib(){
  const q=$('#q').value,cat=$('#fCat').value,tag=$('#fTag').value,mon=$('#fMonth').value,sort=$('#fSort').value;
  const hits=search(q);let list=saved();
  if(hits)list=list.filter(d=>hits.has(d.id));
  if(cat)list=list.filter(d=>d.category===cat);if(tag)list=list.filter(d=>(d.tags||[]).includes(tag));if(mon)list=list.filter(d=>monthKey(d)===mon);
  list.sort((a,b)=>{if(hits&&sort==='date'&&!q)return 0;
    if(hits)return hits.get(b.id)-hits.get(a.id);
    if(sort==='amount')return numOf(b)-numOf(a);if(sort==='added')return b.addedAt-a.addedAt;
    return (b.f.date||'0').localeCompare(a.f.date||'0')||b.addedAt-a.addedAt;});
  const tot=list.reduce((a,d)=>a+numOf(d),0);
  $('#libCount').textContent=saved().length?`共 ${list.length} 份 · 合计 ${fmt(tot)} 元${q?'（按相关度排序）':''}`:'资料库还是空的。先去“导入与校对”添加几份票据。';
  $('#libList').innerHTML=list.map(d=>`<div class="item" data-open="${d.id}"><div class="th" data-th="${d.id}"><span>…</span></div><div><h4>${esc(d.f.seller||d.f.buyer||d.name)}</h4><div class="sub">${esc(d.f.date||'未填日期')} · ${esc(d.category)}${d.f.invoiceNo?' · No.'+esc(d.f.invoiceNo):''}${d.f.buyer&&d.f.seller?' · 买方 '+esc(d.f.buyer):''}</div><div>${(d.tags||[]).map(t=>`<span class="chip t">${esc(t)}</span>`).join('')}</div>${q?`<div class="snip">${snippet(d,q)}</div>`:''}</div><div class="amt">${d.f.amount?fmt(numOf(d)):'—'}<small>元</small></div></div>`).join('');
  hydrateThumbs($('#libList'));
}
function renderStats(){
  const s=saved();const by=new Map();s.forEach(d=>{const k=monthKey(d);const o=by.get(k)||{n:0,v:0};o.n++;o.v+=numOf(d);by.set(k,o);});
  const keys=[...by.keys()].sort().reverse();const mx=Math.max(1,...[...by.values()].map(o=>o.v));
  $('#statTable').innerHTML=keys.length?keys.map(k=>{const o=by.get(k);return `<div class="srow" data-month="${k}"><div class="m">${k}</div><div class="bg"><i style="width:${o.v/mx*100}%"></i></div><div class="v">${fmt(o.v)} 元</div><div class="n">${o.n} 份</div></div>`;}).join(''):'<p class="empty">暂无数据。</p>';
  const cat=new Map();s.forEach(d=>{const o=cat.get(d.category)||{n:0,v:0};o.n++;o.v+=numOf(d);cat.set(d.category,o);});
  $('#statCat').innerHTML=[...cat.entries()].map(([k,o])=>`<div class="srow"><div>${esc(k)}</div><div class="v">${fmt(o.v)}</div><div class="n">${o.n}</div></div>`).join('')||'<p class="empty">—</p>';
  const sl=new Map();s.forEach(d=>{const k=d.f.seller||'';if(!k)return;const o=sl.get(k)||{n:0,v:0};o.n++;o.v+=numOf(d);sl.set(k,o);});
  $('#statSeller').innerHTML=[...sl.entries()].sort((a,b)=>b[1].v-a[1].v).slice(0,8).map(([k,o])=>`<div class="srow"><div>${esc(k)}</div><div class="v">${fmt(o.v)}</div><div class="n">${o.n}</div></div>`).join('')||'<p class="empty">—</p>';
}
function renderHero(){
  const s=saved();const nowM=new Date().toISOString().slice(0,7);const lm=new Date();const cm=lm.getFullYear()+'-'+String(lm.getMonth()+1).padStart(2,'0');
  $('#sCount').textContent=s.length;$('#sPend').textContent=pend().length+procs.size;
  $('#sMonth').textContent=fmt(s.filter(d=>monthKey(d)===cm).reduce((a,d)=>a+numOf(d),0));$('#sAll').textContent=fmt(s.reduce((a,d)=>a+numOf(d),0));
  $('#nSaved').textContent=s.length;for(const id of ['#nPending','#nPending2']){const e=$(id);e.textContent=pend().length;e.hidden=!pend().length;}
}
async function renderStorage(){
  let t='存储：不可用';
  try{const e=await navigator.storage.estimate();const p=navigator.storage.persisted?await navigator.storage.persisted():false;
    t='已用 '+(e.usage/1048576).toFixed(1)+' MB';$('#storeInfo').textContent=t+(p?' · 持久':'');
    $('#storeDetail').textContent=`本站已用约 ${(e.usage/1048576).toFixed(1)} MB（浏览器给出的配额约 ${(e.quota/1048576).toFixed(0)} MB，仅估计）。持久存储：${p?'已授予':'未授予'}——未授予时，浏览器在空间紧张时可能清理本站数据。`;}
  catch(e){$('#storeInfo').textContent=t;$('#storeDetail').textContent='当前浏览器不提供存储用量信息。';}
}
function renderAll(){buildIndex();renderHero();renderQueue();renderFilters();renderLib();renderStats();renderStorage();}

/* ---------- 视图 ---------- */
function setView(v){
  $$('.view').forEach(e=>e.classList.toggle('on',e.id==='v-'+v));
  $$('[data-view]').forEach(b=>b.classList.toggle('on',b.dataset.view===v));
  window.scrollTo({top:0});
  const hero=$('.hero');hero.classList.toggle('compact',v!=='inbox');
  if(!setView.orig){setView.orig=[$('#heroEy').innerHTML,$('#heroH').innerHTML];}
  const T={lib:['资料库 · 全文搜索','你的票据，<span>一搜即得</span>'],stats:['统计 · 按文档日期','每个月，<span>花在了哪里</span>'],backup:['备份 · 导入 · 说明','数据只在本机，<span>请记得备份</span>']};
  if(v==='inbox'){$('#heroEy').innerHTML=setView.orig[0];$('#heroH').innerHTML=setView.orig[1];}else{$('#heroEy').textContent=T[v][0];$('#heroH').innerHTML=T[v][1];}
  if(v==='lib')renderLib();
}
$$('[data-view]').forEach(b=>b.onclick=()=>setView(b.dataset.view));
$$('[data-go]').forEach(b=>b.onclick=()=>setView(b.dataset.go));
['q','fCat','fTag','fMonth','fSort'].forEach(id=>$('#'+id).addEventListener('input',renderLib));
$('#statTable').onclick=e=>{const r=e.target.closest('[data-month]');if(r){$('#fMonth').value=r.dataset.month;setView('lib');renderLib();}};
$('#libList').onclick=e=>{const r=e.target.closest('[data-open]');if(r)openReview(r.dataset.open);};
$('#queue').onclick=async e=>{const b=e.target.closest('[data-act]');if(!b)return;const id=b.dataset.id;
  if(b.dataset.act==='review')openReview(id);
  if(b.dataset.act==='dismiss'){procs.delete(id);renderAll();}
  if(b.dataset.act==='manual'){const p=procs.get(id);if(!p||!p.file)return;await manualDoc(p.file,id);procs.delete(id);renderAll();openReview(id);}};
async function manualDoc(file,id){
  const isPdf=/pdf/i.test(file.type);let preview=null,thumb=null;
  if(!isPdf){try{const s=await loadImageSource(file);const c=scaleTo(s,2000,100);preview=await toBlob(c);thumb=await makeThumb(c);}catch(e){}}
  const ex=PJX.extract([]);
  const doc={id,status:'pending',name:file.name,mime:file.type,size:file.size,isPdf,pages:1,addedAt:Date.now(),ocrMode:'manual',ocrConf:0,text:'',lines:[],imgW:0,imgH:0,ext:ex.fields,warnings:[],notes:['识别失败，按手动录入。'],f:{},category:'其他',tags:[],note:''};
  ex.fields.forEach(f=>doc.f[f.key]=f.value);docs.push(doc);await dbPut('docs',doc);await dbPut('blobs',{id,orig:file,preview,thumb});
}

/* ---------- 导入入口 ---------- */
const drop=$('#drop');
drop.onclick=e=>{if(e.target.tagName!=='INPUT'){e.preventDefault();$('#fileIn').click();}};
$('#heroPick').onclick=()=>{setView('inbox');$('#fileIn').click();};
drop.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();$('#fileIn').click();}});
$('#fileIn').onchange=e=>{enqueue([...e.target.files]);e.target.value='';};
['dragenter','dragover'].forEach(ev=>document.addEventListener(ev,e=>{e.preventDefault();if(!$('#review').hidden)return;setView('inbox');drop.classList.add('over');}));
['dragleave','drop'].forEach(ev=>document.addEventListener(ev,e=>{e.preventDefault();if(ev==='dragleave'&&e.relatedTarget)return;drop.classList.remove('over');}));
document.addEventListener('drop',e=>{if(!$('#review').hidden)return;const fs=[...(e.dataTransfer?.files||[])];if(fs.length)enqueue(fs);});
document.addEventListener('paste',e=>{if(!$('#review').hidden)return;const fs=[...(e.clipboardData?.files||[])];if(fs.length){enqueue(fs);}});

/* ---------- 校对弹层 ---------- */
let cur=null,curBlobs=null,zoom=1,curField=null,imgURL=null,dirtyEdit=false;
function renderTagChips(){const box=$('#rvTags');box.querySelectorAll('.chip').forEach(c=>c.remove());const inp=$('#rvTagIn');cur.tags.forEach(t=>{const c=document.createElement('span');c.className='chip t';c.textContent=t;c.onclick=()=>{cur.tags=cur.tags.filter(x=>x!==t);renderTagChips();};box.insertBefore(c,inp);});}
async function openReview(id){
  cur=docs.find(d=>d.id===id);if(!cur)return;curField=null;zoom=1;dirtyEdit=false;
  curBlobs=await dbGet('blobs',id)||{};
  $('#review').hidden=false;document.body.style.overflow='hidden';
  $('#rvTitle').textContent=(cur.status==='pending'?'待校对 · ':'已入库 · ')+cur.name;
  if(imgURL)URL.revokeObjectURL(imgURL);
  const blob=curBlobs.preview||(!cur.isPdf?curBlobs.orig:null);
  $('#rvImg').src=blob?(imgURL=URL.createObjectURL(blob)):'';
  $('#imgNote').textContent=cur.previewDeskew?'预览为纠偏后的图，原件另存':(cur.isPdf?'PDF 第 1 页':'');
  setZoom(1);
  const modeTxt={ocr:'OCR 识别',textlayer:'直接读取 PDF 文字层（非 OCR，字符准确）',mixed:'文字层 + OCR 混合',manual:'手动录入（无识别结果）'}[cur.ocrMode];
  $('#ocrInfo').innerHTML=`<b>${esc(modeTxt)}</b>${cur.ocrMode==='ocr'||cur.ocrMode==='mixed'?'，行平均置信度 '+cur.ocrConf+'%':''}。置信度 = 规则匹配强度 × OCR 行置信度，仅是“可能出错的提示”，不是正确率保证。${cur.notes.length?'<br>'+esc(cur.notes.join(' ')):''}`;
  $('#rvWarn').innerHTML=(cur.warnings||[]).map(w=>`<div class="alert">⚠ ${esc(w)}</div>`).join('')+(cur.ocrMode==='ocr'&&cur.ocrConf<75?'<div class="alert info">整体识别置信度偏低（图片可能模糊、斜拍或有遮挡），请逐项对照原件。</div>':'');
  renderFields();
  const cs=$('#rvCat');cs.innerHTML=CATS.map(c=>`<option>${c}</option>`).join('');cs.value=cur.category;
  $('#rvNote').value=cur.note||'';renderTagChips();
  $('#rvOk').checked=cur.status==='saved';$('#rvOk').disabled=cur.status==='saved';$('#rvSave').disabled=cur.status!=='saved';
  $('#rvSave').textContent=cur.status==='saved'?'保存修改':'确认入库';$('#rvDel').textContent=cur.status==='saved'?'删除':'丢弃';
  $('#txtAct').hidden=true;$('#txtArea').hidden=true;$('#txtView').hidden=false;renderTxt();
  $('#rvSave').disabled=!$('#rvOk').checked;
  $('.m-form').scrollTop=0;
}
function renderFields(){
  const L=$('#fieldList');
  L.innerHTML=cur.ext.map(f=>{const v=cur.f[f.key]??'';const cl=f.conf?confClass(f.conf):'lo';
    return `<div class="f ${f.warn||(!v&&f.key!=='taxIds'&&f.key!=='invoiceCode')?'warn':''}" data-k="${f.key}"><div class="f-h"><label>${esc(f.label)}</label>${f.value?`<span class="cf ${cl}" title="规则 ${f.rule} · OCR ${f.ocr}%"><i style="--w:${Math.round(f.conf*100)}%"></i>置信度 ${Math.round(f.conf*100)}% · ${{hi:'较高',md:'中等',lo:'低，请重点核对'}[cl]}</span>`:'<span class="cf lo">未识别</span>'}</div><input class="f-in" data-k="${f.key}" value="${esc(v)}" ${f.key==='date'?'placeholder="YYYY-MM-DD"':''} ${f.key==='amount'?'inputmode="decimal"':''}><div class="f-note"><span>${esc(f.note)}</span>${f.start>=0?`<button class="link" data-show="${f.key}">看原文位置</button>`:''}</div></div>`;}).join('');
  L.querySelectorAll('.f-in').forEach(i=>{i.oninput=()=>{cur.f[i.dataset.k]=i.value.trim();};i.onfocus=()=>showField(i.dataset.k);});
  L.querySelectorAll('[data-show]').forEach(b=>b.onclick=()=>showField(b.dataset.show,true));
}
function renderTxt(){
  const t=cur.text||'';if(!t){$('#txtView').innerHTML='<span class="hint">（无识别文本）</span>';return;}
  const marks=cur.ext.filter(f=>f.start>=0).map(f=>({s:f.start,e:f.end,k:f.key})).sort((a,b)=>a.s-b.s);
  let out='',p=0;for(const m of marks){if(m.s<p)continue;out+=esc(t.slice(p,m.s))+`<mark data-k="${m.k}" class="${m.k===curField?'cur':''}">${esc(t.slice(m.s,m.e))}</mark>`;p=m.e;}
  out+=esc(t.slice(p));$('#txtView').innerHTML=out;
}
function lineIdxAt(off){let acc=0;for(let i=0;i<cur.lines.length;i++){const l=cur.lines[i].t.length;if(off<=acc+l)return i;acc+=l+1;}return cur.lines.length-1;}
function showField(k,scroll){
  curField=k;renderTxt();const f=cur.ext.find(x=>x.key===k);const hl=$('#hl');hl.innerHTML='';
  if(!f||f.start<0||dirtyEdit)return;
  const a=lineIdxAt(f.start),b=lineIdxAt(Math.max(f.start,f.end-1));
  for(let i=a;i<=b;i++){const ln=cur.lines[i];if(!ln||!ln.b||!cur.imgW)continue;const [x0,y0,x1,y1]=ln.b;
    const e=document.createElement('i');e.style.cssText=`left:${x0/cur.imgW*100}%;top:${y0/cur.imgH*100}%;width:${(x1-x0)/cur.imgW*100}%;height:${(y1-y0)/cur.imgH*100}%`;hl.appendChild(e);
    if(scroll||true){const sc=$('#imgScroll');const wrap=$('#imgWrap');const y=y0/cur.imgH*wrap.offsetHeight;sc.scrollTo({top:Math.max(0,y-sc.clientHeight/3),behavior:'smooth'});}}
  if(scroll){const m=$('#txtView mark.cur');if(m){$('#txtBox').open=true;m.scrollIntoView({block:'nearest'});}}
}
function setZoom(z){zoom=Math.max(.5,Math.min(3,z));$('#imgWrap').style.width=(zoom*100)+'%';$('#zVal').textContent=Math.round(zoom*100)+'%';}
$('#zIn').onclick=()=>setZoom(zoom+.25);$('#zOut').onclick=()=>setZoom(zoom-.25);
$('#zDl').onclick=()=>{if(curBlobs&&curBlobs.orig)download(curBlobs.orig,cur.name);};
function closeReview(){$('#review').hidden=true;document.body.style.overflow='';cur=null;renderAll();}
$('#rvClose').onclick=closeReview;
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('#review').hidden)closeReview();});
$('#rvOk').onchange=()=>$('#rvSave').disabled=!$('#rvOk').checked;
$('#rvCat').onchange=()=>cur.category=$('#rvCat').value;
$('#rvNote').oninput=()=>cur.note=$('#rvNote').value;
$('#rvTagIn').addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===','||e.key==='，'){e.preventDefault();const v=e.target.value.trim().replace(/^#/,'');if(v&&!cur.tags.includes(v))cur.tags.push(v);e.target.value='';renderTagChips();}});
$('#rvTagIn').addEventListener('blur',e=>{const v=e.target.value.trim().replace(/^#/,'');if(v&&!cur.tags.includes(v)){cur.tags.push(v);e.target.value='';renderTagChips();}});
$('#txtEdit').onclick=e=>{e.preventDefault();$('#txtBox').open=true;$('#txtArea').value=cur.text;$('#txtArea').hidden=false;$('#txtView').hidden=true;$('#txtAct').hidden=false;};
$('#txtApply').onclick=()=>{
  const lines=$('#txtArea').value.split('\n').map(t=>({t,c:100,b:null}));const ex=PJX.extract(lines);
  cur.text=ex.text;cur.lines=ex.lines.map(l=>({t:l.t,c:100,b:null}));cur.ext=ex.fields;cur.warnings=ex.warnings;ex.fields.forEach(f=>cur.f[f.key]=f.value);dirtyEdit=true;
  cur.notes=(cur.notes||[]).filter(n=>!/已手动改过原文/.test(n)).concat('已手动改过原文，置信度仅反映规则匹配，图片高亮不可用。');
  $('#txtArea').hidden=true;$('#txtView').hidden=false;$('#txtAct').hidden=true;$('#hl').innerHTML='';renderFields();renderTxt();toast('已按新原文重新提取');
};
$('#rvSave').onclick=async()=>{
  const a=cur.f.amount||'';if(a&&!/^-?\d+(\.\d{1,2})?$/.test(a.replace(/,/g,''))){toast('金额格式不对，请填写如 1234.56');return;}
  cur.f.amount=a.replace(/,/g,'');
  const d=cur.f.date||'';if(d&&!/^\d{4}-\d{2}-\d{2}$/.test(d)){toast('日期请按 YYYY-MM-DD 填写');return;}
  if(d){const [y,m,dd]=d.split('-').map(Number);const t=new Date(y,m-1,dd);if(t.getMonth()!==m-1||t.getDate()!==dd){toast('日期不存在，请检查');return;}}
  const was=cur.status;cur.status='saved';cur.confirmedAt=Date.now();
  await dbPut('docs',cur);toast(was==='pending'?'已入库':'已保存');closeReview();if(was==='pending')setView('lib');
};
$('#rvDel').onclick=async()=>{
  if(!confirm(cur.status==='saved'?'删除这份资料（含原件）？此操作不可撤销。':'丢弃这份待校对文件？'))return;
  await dbDel('docs',cur.id);await dbDel('blobs',cur.id);docs=docs.filter(d=>d.id!==cur.id);thumbURL.delete(cur.id);toast('已删除');closeReview();
};

/* ---------- 导出 / 导入 ---------- */
function download(blob,name){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},4000);}
const b64=blob=>new Promise(r=>{const f=new FileReader();f.onload=()=>r(f.result);f.readAsDataURL(blob);});
const unb64=s=>fetch(s).then(r=>r.blob());
function csvCell(v){v=String(v??'');return /[",\n\r]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v;}
function csvOf(list){
  const head=['日期','类别','金额(元)','买方/甲方','卖方/乙方','发票号码/单号/合同编号','发票代码','标签','备注','原文件名','入库时间'];
  const rows=list.map(d=>[d.f.date,d.category,d.f.amount,d.f.buyer,d.f.seller,d.f.invoiceNo,d.f.invoiceCode,(d.tags||[]).join(';'),d.note,d.name,new Date(d.confirmedAt||d.addedAt).toLocaleString('zh-CN')]);
  return '\ufeff'+[head,...rows].map(r=>r.map(csvCell).join(',')).join('\r\n');
}
const monthList=()=>{const m=$('#exMonth').value;return saved().filter(d=>!m||monthKey(d)===m).sort((a,b)=>(a.f.date||'').localeCompare(b.f.date||''));};
$('#exCsv').onclick=()=>{const l=monthList();if(!l.length)return toast('没有可导出的资料');download(new Blob([csvOf(l)],{type:'text/csv;charset=utf-8'}),'票据夹_'+($('#exMonth').value||'全部')+'.csv');};
$('#exZip').onclick=async()=>{
  const l=monthList();if(!l.length)return toast('没有可导出的资料');toast('正在打包…',8000);
  const files=[{name:'清单.csv',data:csvOf(l)}];
  for(const d of l){const b=await dbGet('blobs',d.id);if(b&&b.orig){const ext=(d.name.match(/\.[^.]+$/)||[''])[0];files.push({name:'原件/'+(d.f.date||'无日期')+'_'+(d.f.amount||'0')+'_'+(d.f.seller||'').replace(/[\\/:*?"<>|]/g,'')+'_'+d.id.slice(-4)+ext,data:b.orig});}}
  download(await MiniZip.makeZip(files),'票据夹_'+($('#exMonth').value||'全部')+'_原件包.zip');toast('已导出');
};
$('#bkExport').onclick=async()=>{
  const withFiles=$('#bkFiles').checked;const list=docs.filter(d=>d.status==='saved'||d.status==='pending');if(!list.length)return toast('还没有数据可备份');toast('正在生成备份…',10000);
  const parts=['{"app":"piaoju","version":1,"exportedAt":'+JSON.stringify(new Date().toISOString())+',"withFiles":'+withFiles+',"docs":['];
  for(let i=0;i<list.length;i++){const d={...list[i]};if(withFiles){const b=await dbGet('blobs',d.id)||{};d._files={orig:b.orig?await b64(b.orig):null,preview:b.preview?await b64(b.preview):null,thumb:b.thumb?await b64(b.thumb):null,origType:b.orig?b.orig.type:''};}
    parts.push((i?',':'')+JSON.stringify(d));}
  parts.push(']}');download(new Blob(parts,{type:'application/json'}),'票据夹备份_'+new Date().toISOString().slice(0,10)+'.json');toast('备份已导出');
};
$('#bkImport').onclick=()=>$('#bkFile').click();
$('#bkFile').onchange=async e=>{
  const f=e.target.files[0];e.target.value='';if(!f)return;
  try{
    const j=JSON.parse(await f.text());if(j.app!=='piaoju'||!Array.isArray(j.docs))throw new Error('这不是票据夹的备份文件');
    let add=0,skip=0;const exist=new Set(docs.map(d=>d.id));
    for(const d of j.docs){if(exist.has(d.id)){skip++;continue;}const fl=d._files;delete d._files;
      if(fl){const o=fl.orig?await unb64(fl.orig):null,p=fl.preview?await unb64(fl.preview):null,t=fl.thumb?await unb64(fl.thumb):null;await dbPut('blobs',{id:d.id,orig:o,preview:p,thumb:t});}
      await dbPut('docs',d);docs.push(d);add++;}
    renderAll();toast(`导入完成：新增 ${add} 份，跳过已存在 ${skip} 份`,4000);
  }catch(err){alert('导入失败：'+err.message);}
};
$('#persist').onclick=async()=>{try{const ok=await navigator.storage.persist();toast(ok?'已授予持久存储':'浏览器未授予（可能需要先把本站加入书签/常用）');renderStorage();}catch(e){toast('当前浏览器不支持');}};
$('#wipe').onclick=async()=>{
  if(!confirm('将删除本站保存的全部票据数据（含原件），不可撤销。建议先导出备份。继续？'))return;
  const t=prompt('请输入“清空”确认');if(t!=='清空')return;
  await tx(['docs','blobs'],'readwrite',(a,b)=>{a.clear();b.clear();});docs=[];thumbURL.clear();renderAll();toast('已清空');
};

/* ---------- 说明 ---------- */
$('#limits').innerHTML=[
['识别引擎','tesseract.js（LSTM，简体中文 + 英文，best_int 小模型）在你的浏览器里运行。清晰的正面印刷体较准；斜拍、阴影、手写、小字、盖章遮挡、表格线密集时会明显变差，甚至整行识错。'],
['提取规则','金额/日期/号码/买卖方来自公开的关键字与正则规则（见 extract.js），不是理解语义。版式不常见、关键字缺失或被识错时会漏提或误提；多金额/多日期时只给“最可能的一个”并列出其他候选。'],
['置信度','= 规则匹配强度 × OCR 行置信度。它是“这里可能错”的提示，不是正确率；高置信度也可能错，所以入库前必须由你核对。'],
['可校验项','小写金额与中文大写金额是否一致；不含税金额+税额是否等于价税合计；发票号码位数（8/20）、发票代码位数（10/12）；统一社会信用代码校验位。不一致会标红。'],
['PDF','有文字层的 PDF 直接读取文字（不经过 OCR，字符准确，但仍可能被规则漏提）；扫描件逐页渲染后 OCR，最多处理前 10 页。'],
['数据与隐私','全部存于本浏览器 IndexedDB，不上传，无统计。清理站点数据/隐私模式/换设备会丢，请用“备份与导入”。'],
['不是什么','不是财务凭证、不做验真查验、不对接税务系统、不做汇率换算。金额合计仅供个人整理参考，报销与入账以原件和财务规定为准。'],
['免费','没有付费版、授权码、条数/页数/空间限制（受浏览器存储配额约束）。']
].map(([a,b])=>`<div><b>${a}</b><span>${b}</span></div>`).join('');

/* ---------- 启动 ---------- */
(async()=>{
  try{db=await openDB();docs=await dbAll('docs');}catch(e){alert('无法打开浏览器本地数据库：'+e.message+'\n（隐私模式下可能不可用）');docs=[];}
  renderAll();
  window.PJ={estimateSkew,scaleTo,loadImageSource,docs:()=>docs,processFile,getWorker,extract:PJX.extract,enqueue,renderAll,openReview};
})();
})();
