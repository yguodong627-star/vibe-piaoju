const {chromium}=require('/workspace/tools/node_modules/playwright-core');const fs=require('fs');
(async()=>{const b=await chromium.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']});
const man=JSON.parse(fs.readFileSync('html_holdout/manifest.json'));
for(const m of man){const p=await b.newPage({viewport:{width:m.kind==='page'?1100:420,height:800},deviceScaleFactor:m.kind==='page'?1.5:2});
 await p.goto('file://'+process.cwd()+'/html_holdout/'+m.name+'.html');await p.waitForTimeout(200);
 await p.locator(m.kind==='page'?'.page':'.p').screenshot({path:'samples_holdout/'+m.name+'.png'});
 if(m.name==='h_inv_a'){const q=await b.newPage();await q.goto('file://'+process.cwd()+'/html_holdout/'+m.name+'.html');await q.pdf({path:'samples_holdout/h_inv_a.pdf',width:'1100px',printBackground:true});}
}
await b.close();})();
