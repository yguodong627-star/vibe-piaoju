const {chromium}=require('/workspace/tools/node_modules/playwright-core');const fs=require('fs');
(async()=>{const b=await chromium.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']});
const man=JSON.parse(fs.readFileSync('html/manifest.json'));
for(const m of man){const p=await b.newPage({viewport:{width:m.kind==='page'?1100:420,height:800},deviceScaleFactor:m.kind==='page'?1.5:2});
 await p.goto('file://'+process.cwd()+'/html/'+m.name+'.html');await p.waitForTimeout(200);
 await p.locator(m.kind==='page'?'.page':'.p').screenshot({path:'samples/'+m.name+'.png'});
 if(m.name==='inv1_clean'){const q=await b.newPage();await q.goto('file://'+process.cwd()+'/html/'+m.name+'.html');await q.pdf({path:'samples/inv1_textlayer.pdf',width:'1100px',printBackground:true});}
}
await b.close();})();
