const {chromium}=require('/workspace/tools/node_modules/playwright-core');const fs=require('fs'),http=require('http'),path=require('path');
const ROOT=path.join(__dirname,'..');const SH=path.join(ROOT,'screenshots');fs.mkdirSync(SH,{recursive:true});
const mt={'.js':'text/javascript','.html':'text/html','.css':'text/css','.wasm':'application/wasm','.ttf':'font/ttf'};
const srv=http.createServer((q,r)=>{let p=decodeURIComponent(q.url.split('?')[0]);if(p==='/')p='/index.html';const f=path.join(ROOT,p);if(!fs.existsSync(f)){r.statusCode=404;return r.end();}r.setHeader('content-type',mt[path.extname(f)]||'application/octet-stream');r.end(fs.readFileSync(f));}).listen(0);
const S=n=>path.join(__dirname,'samples',n);
const files=['inv1_clean.png','contract1.png','wechat1.png','receipt1.png','inv3_skew6.jpg','inv1_textlayer.pdf'].map(S);
async function run(tag,ctxOpts){
  const b=await chromium.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox','--disable-gpu']});
  const c=await b.newContext({...ctxOpts,acceptDownloads:true});const pg=await c.newPage();const errs=[];
  pg.on('pageerror',e=>errs.push(e.message));pg.on('console',m=>{if(m.type()==='error')errs.push(m.text())});
  pg.on('dialog',d=>d.accept('清空'));
  await new Promise(r=>srv.listening?r():srv.once('listening',r));
  await pg.goto('http://localhost:'+srv.address().port+'/');await pg.waitForFunction(()=>window.PJ);
  await pg.screenshot({path:`${SH}/${tag}-1-empty.png`});
  await pg.setInputFiles('#fileIn',files);
  await pg.waitForFunction(n=>PJ.docs().length>=n,files.length,{timeout:120000});
  await pg.waitForTimeout(500);await pg.screenshot({path:`${SH}/${tag}-2-queue.png`,fullPage:tag==='desktop'});
  // 校对第一份
  await pg.evaluate(()=>PJ.openReview(PJ.docs()[0].id));await pg.waitForTimeout(500);
  await pg.click('[data-show="amount"]');await pg.waitForTimeout(700);
  await pg.screenshot({path:`${SH}/${tag}-3-review.png`});
  await pg.evaluate(()=>document.querySelector('#rvClose').click());
  // 全部确认
  const n=await pg.evaluate(()=>PJ.docs().length);
  for(let i=0;i<n;i++){await pg.evaluate(i=>PJ.openReview(PJ.docs()[i].id),i);await pg.waitForTimeout(150);
    if(i===0){await pg.fill('#rvTagIn','报销');await pg.press('#rvTagIn','Enter');}
    if(i===1){await pg.fill('#rvTagIn','客户A');await pg.press('#rvTagIn','Enter');}
    await pg.check('#rvOk');await pg.click('#rvSave');await pg.waitForTimeout(250);}
  await pg.waitForTimeout(400);
  await pg.click(tag==='desktop'?'.nav [data-view=lib]':'#tabbar [data-view=lib]');
  await pg.fill('#q','衡远');await pg.waitForTimeout(400);
  const hit1=await pg.evaluate(()=>document.querySelectorAll('#libList .item').length);
  await pg.screenshot({path:`${SH}/${tag}-4-search.png`,fullPage:tag==='desktop'});
  await pg.fill('#q','青禾');const hit2=await pg.evaluate(()=>document.querySelectorAll('#libList .item').length);
  await pg.fill('#q','肉面');const hit3=await pg.evaluate(()=>document.querySelectorAll('#libList .item').length);
  await pg.fill('#q','zzzz不存在');const hit4=await pg.evaluate(()=>document.querySelectorAll('#libList .item').length);
  await pg.fill('#q','');
  await pg.screenshot({path:`${SH}/${tag}-5-library.png`,fullPage:tag==='desktop'});
  await pg.click(tag==='desktop'?'.nav [data-view=stats]':'#tabbar [data-view=stats]');await pg.waitForTimeout(300);
  await pg.screenshot({path:`${SH}/${tag}-6-stats.png`,fullPage:tag==='desktop'});
  await pg.click(tag==='desktop'?'.nav [data-view=backup]':'#tabbar [data-view=backup]');await pg.waitForTimeout(300);
  await pg.screenshot({path:`${SH}/${tag}-7-backup.png`,fullPage:tag==='desktop'});
  // 导出/导入
  const before=await pg.evaluate(()=>PJ.docs().map(d=>d.id+'|'+d.f.amount+'|'+d.f.seller+'|'+d.tags.join()).sort().join('\n'));
  const [dl]=await Promise.all([pg.waitForEvent('download'),pg.click('#bkExport')]);const jp=path.join(__dirname,'backup-test.json');await dl.saveAs(jp);
  const [dl2]=await Promise.all([pg.waitForEvent('download'),pg.click('#exCsv')]);await dl2.saveAs(path.join(__dirname,'export-test.csv'));
  const [dl3]=await Promise.all([pg.waitForEvent('download'),pg.click('#exZip')]);await dl3.saveAs(path.join(__dirname,'export-test.zip'));
  await pg.click('#wipe');await pg.waitForTimeout(500);const afterWipe=await pg.evaluate(()=>PJ.docs().length);
  await pg.setInputFiles('#bkFile',jp);await pg.waitForTimeout(1500);
  const after=await pg.evaluate(()=>PJ.docs().map(d=>d.id+'|'+d.f.amount+'|'+d.f.seller+'|'+d.tags.join()).sort().join('\n'));
  const origOK=await pg.evaluate(async()=>{const r=indexedDB.open('piaoju');return await new Promise(res=>{r.onsuccess=()=>{const t=r.result.transaction('blobs').objectStore('blobs').getAll();t.onsuccess=()=>res(t.result.every(x=>x.orig&&x.orig.size>0)&&t.result.length);}})});
  console.log(tag,{hit_衡远:hit1,hit_青禾:hit2,hit_肉面:hit3,hit_none:hit4,docs:n,afterWipe,roundtrip:before===after,blobsAfterImport:origOK,errs});
  await pg.screenshot({path:`${SH}/${tag}-8-after-import.png`});
  await b.close();
}
(async()=>{await run('desktop',{viewport:{width:1440,height:900}});await run('mobile',{viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});srv.close();})().catch(e=>{console.log('FAIL',e.message);process.exit(1)});
