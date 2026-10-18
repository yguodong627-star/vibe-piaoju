// 用法: node ocr-eval.js  —— 起本地静态服务，在无头 Chrome 里对 samples/ 逐个跑完整流程，对比 truth.json
const {chromium}=require('/workspace/tools/node_modules/playwright-core');const fs=require('fs'),http=require('http'),path=require('path');
const ROOT=path.join(__dirname,'..');
const mt={'.js':'text/javascript','.html':'text/html','.css':'text/css','.wasm':'application/wasm','.gz':'application/gzip','.ttf':'font/ttf'};
const srv=http.createServer((q,r)=>{let p=decodeURIComponent(q.url.split('?')[0]);if(p==='/')p='/index.html';const f=path.join(ROOT,p);if(!fs.existsSync(f)){r.statusCode=404;return r.end();}r.setHeader('content-type',mt[path.extname(f)]||'application/octet-stream');r.end(fs.readFileSync(f));}).listen(0);const PORT=()=>srv.address().port;
const truth=JSON.parse(fs.readFileSync(path.join(__dirname,'truth.json')));
const dir=path.join(__dirname,'samples');
(async()=>{
const b=await chromium.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox','--disable-gpu']});process.on('unhandledRejection',e=>{console.log('ERR',e.message);process.exit(1)});
const pg=await b.newPage();pg.on('console',m=>{if(m.type()==='error')console.log('console.error',m.text())});pg.on('pageerror',e=>console.log('pageerror',e.message));
await new Promise(r=>srv.listening?r():srv.once('listening',r));await pg.goto('http://localhost:'+PORT()+'/');await pg.waitForFunction(()=>window.PJ);
let t0=Date.now();await pg.evaluate(()=>PJ.getWorker());console.log('引擎加载 ms',Date.now()-t0);
const keys=['amount','date','invoiceNo','buyer','seller','docType'];const res=[];const tot={};keys.forEach(k=>tot[k]=[0,0]);const lowconf={ok:[],bad:[]};
const only=process.argv[2];
for(const f of fs.readdirSync(dir).sort()){const name=f.replace(/\.[^.]+$/,'');if(!truth[name]||(only&&!name.includes(only)))continue;
  const data=fs.readFileSync(path.join(dir,f)).toString('base64');const mime=f.endsWith('.pdf')?'application/pdf':f.endsWith('.jpg')?'image/jpeg':'image/png';
  const t1=Date.now();
  const out=await pg.evaluate(async([n,d,m,f])=>{const bin=Uint8Array.from(atob(d),c=>c.charCodeAt(0));const file=new File([bin],f,{type:m});
    const doc=await PJ.processFile(file,'t_'+n,()=>{});return {text:doc.text,f:doc.f,ext:doc.ext.map(x=>({key:x.key,value:x.value,conf:x.conf})),cat:doc.category,mode:doc.ocrMode,conf:doc.ocrConf,notes:doc.notes};},[name,data,mime,f]);
  const ms=Date.now()-t1;const tr=truth[name];const row={name,ms,mode:out.mode,conf:out.conf,notes:out.notes.join(' '),r:{}};
  for(const k of keys){let got=k==='docType'?out.cat:(out.f[k]||'');const exp=tr[k]||'';const ok=got===exp;row.r[k]={got,exp,ok};
    if(exp){tot[k][1]++;if(ok)tot[k][0]++;}
    const e=out.ext.find(x=>x.key===k);if(e&&e.value&&exp){(ok?lowconf.ok:lowconf.bad).push(e.conf);}
    row.r[k].conf=e?e.conf:null;}
  res.push(row);
  console.log(name.padEnd(22),(ms/1000).toFixed(1)+'s',out.mode,'ocr='+out.conf,keys.map(k=>row.r[k].exp?(row.r[k].ok?'✓':'✗'):'-').join(' '),row.notes);
  for(const k of keys)if(row.r[k].exp&&!row.r[k].ok)console.log('     ',k,'期望',row.r[k].exp,'得到',row.r[k].got,'conf',row.r[k].conf);
  fs.writeFileSync(path.join(__dirname,'ocr-text-'+name+'.txt'),out.text);
}
console.log('\n字段正确率:');keys.forEach(k=>console.log(k,tot[k][0]+'/'+tot[k][1]));
const avg=a=>a.length?(a.reduce((x,y)=>x+y,0)/a.length).toFixed(2):'-';
console.log('正确字段平均置信度',avg(lowconf.ok),'错误字段平均置信度',avg(lowconf.bad),'错误字段数',lowconf.bad.length);
fs.writeFileSync(path.join(__dirname,'ocr-eval-result.json'),JSON.stringify({res,tot,okConf:avg(lowconf.ok),badConf:avg(lowconf.bad)},null,1));
await b.close();srv.close();})();
