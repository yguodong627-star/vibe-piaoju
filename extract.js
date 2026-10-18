/* 票据夹 · 规则提取（纯规则，无模型）。浏览器与 Node 通用。 */
(function(root){
'use strict';
const CJK='\\u2E80-\\u9FFF\\uFF00-\\uFFEF\\u3000-\\u303F';
const reCjkSp=new RegExp('[ \\t\\u00a0]+(?=['+CJK+'])|(?<=['+CJK+'])[ \\t\\u00a0]+','g');
function normLine(s){s=String(s).normalize('NFKC');return s.replace(reCjkSp,'').replace(/[ \t\u00a0]{2,}/g,'  ').trim();}

/* ---------- 中文大写金额 ---------- */
function parseCnAmount(s){
  const d={零:0,〇:0,壹:1,一:1,贰:2,二:2,两:2,叁:3,三:3,肆:4,四:4,伍:5,五:5,陆:6,六:6,柒:7,七:7,捌:8,八:8,玖:9,九:9};
  const u={拾:10,十:10,佰:100,百:100,仟:1000,千:1000};
  let m=s.match(/^(.*?)(?:圆|元)(.*)$/); let ip=m?m[1]:s, fp=m?m[2]:'';
  if(!m && !/[角分]/.test(s)) return null;
  function sec(str){let n=0,cur=0;for(const ch of str){if(ch in d)cur=d[ch];else if(ch in u){n+=(cur||(ch==='拾'||ch==='十'?1:0))*u[ch];cur=0;}}return n+cur;}
  let total=0; const yi=ip.split('亿'); let rest=ip;
  if(ip.includes('亿')){total+=sec(yi[0])*1e8;rest=yi.slice(1).join('亿');}
  if(rest.includes('万')){const w=rest.split('万');total+=sec(w[0])*1e4;rest=w.slice(1).join('万');}
  total+=sec(rest.replace(/[整正]/g,''));
  let jiao=0,fen=0;
  const mj=fp.match(/([零壹贰叁肆伍陆柒捌玖一二三四五六七八九])角/);if(mj)jiao=d[mj[1]];
  const mf=fp.match(/([零壹贰叁肆伍陆柒捌玖一二三四五六七八九])分/);if(mf)fen=d[mf[1]];
  return Math.round((total+jiao/10+fen/100)*100)/100;
}

/* ---------- 统一社会信用代码校验（GB 32100-2015） ---------- */
function checkUSCC(c){
  const chars='0123456789ABCDEFGHJKLMNPQRTUWXY';const w=[1,3,9,27,19,26,16,17,20,29,25,13,8,24,10,30,28];
  if(!/^[0-9A-HJ-NPQRTUWXY]{18}$/.test(c))return false;let s=0;
  for(let i=0;i<17;i++)s+=chars.indexOf(c[i])*w[i];
  return chars[(31-s%31)%31]===c[17];
}

function validDate(y,m,d){const dt=new Date(y,m-1,d);return dt.getFullYear()===y&&dt.getMonth()===m-1&&dt.getDate()===d;}
function pad(n){return String(n).padStart(2,'0');}
function fixDigits(s){return s.replace(/[Oo〇]/g,'0').replace(/[lI|]/g,'1');}

/* ---------- 主函数 ----------
 lines: [{t,c,b}]，c 为该行 OCR 置信度(0-100)；文本层 PDF 的 c=100
 返回 {text, fields:[{key,label,value,conf,rule,start,end,warn,note}], docType, warnings:[]} */
function extract(lines){
  const L=lines.map(l=>({t:normLine(l.t),c:l.c==null?80:l.c,b:l.b}));
  const offs=[];let text='';L.forEach((l,i)=>{offs.push(text.length);text+=l.t+(i<L.length-1?'\n':'');});
  const lineAt=o=>{let i=0;for(let k=0;k<offs.length;k++){if(offs[k]<=o)i=k;else break;}return i;};
  const ocrConfAt=(s,e)=>{const a=lineAt(s),b=lineAt(Math.max(s,e-1));let sum=0,n=0;for(let i=a;i<=b;i++){sum+=L[i].c;n++;}return n?sum/n:80;};
  const fields=[];const warnings=[];
  const mk=(key,label,value,rule,s,e,note,warn)=>{
    const oc=ocrConfAt(s,e);
    const conf=Math.max(0.05,Math.min(0.99,rule*(0.55+0.45*Math.min(1,oc/90))));
    return {key,label,value,conf:Math.round(conf*100)/100,rule:Math.round(rule*100)/100,ocr:Math.round(oc),start:s,end:e,note:note||'',warn:!!warn};
  };

  /* 文档类型 */
  let docType='其他';
  const kw=(re)=>(text.match(re)||[]).length;
  const sc={发票:kw(/发票|税额|价税合计|开票日期|纳税人识别号|增值税/g),
    合同:kw(/合同|协议|甲方|乙方|违约|签订|条款/g),
    收据:kw(/收据|收到|报销单|小票|收银|收款人|谢谢惠顾|找零/g),
    截图:kw(/支付成功|交易单号|商户全称|支付方式|订单号|转账|账单详情|付款方式|当前状态/g)};
  let best=0;for(const k in sc){if(sc[k]>best){best=sc[k];docType=k;}}
  if(best<1)docType='其他';

  /* 金额 */
  const cands=[];
  const KW=[[/价税合计/,0.92],[/(?:小写)/,0.9],[/(?:实付(?:款|金额)?|支付金额|付款金额|实收|应付(?:金额)?|订单金额|交易金额|合同总价|合同金额|总金额)/,0.82],[/(?:合计金额|金额合计|总计|共计|总价)/,0.74],[/合计/,0.45],[/(?:金额|价款|货款)/,0.5]];
  const numRe=/(?:[¥￥]|RMB|Y(?=\d)|羊(?=\d))?\s*(-?\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|-?\d+\.\d{1,2}|-?\d+)/g;
  L.forEach((line,i)=>{
    const t=line.t;
    for(const [re,w] of KW){
      const m=re.exec(t);if(!m)continue;let pushed=false;
      numRe.lastIndex=m.index+m[0].length;let nm;
      while((nm=numRe.exec(t))){
        const raw=nm[1];const hasSym=/^(?:[¥￥]|RMB|Y|羊)/.test(nm[0].trim());
        const v=parseFloat(raw.replace(/,/g,''));
        if(!isFinite(v)||v===0)continue;
        if(!/\./.test(raw)&&!hasSym&&raw.length>7)continue;
        if(!/\./.test(raw)&&!hasSym&&w<0.8)continue; // 无小数无货币符号只信强关键字
        const gap=nm.index-(m.index+m[0].length);
        if(gap>14)break;
        let r=w*(/\./.test(raw)?1:0.85)*(hasSym?1:0.93);
        const so=offs[i]+nm.index+nm[0].indexOf(raw);
        cands.push({v,rule:r,s:so,e:so+raw.length,kw:m[0],line:i});pushed=true;
        break;
      }
      if(pushed)break;
    }
  });
  // 下一行补充（关键字在行尾、数字在下一行）
  L.forEach((line,i)=>{
    if(i+1>=L.length)return;const t=line.t;
    if(/(?:价税合计|合计金额|总计|实付|支付金额|应付|小写)[^\d]*$/.test(t)){
      numRe.lastIndex=0;const nm=numRe.exec(L[i+1].t);
      if(nm&&nm.index<4){const raw=nm[1],v=parseFloat(raw.replace(/,/g,''));
        if(v>0&&/\./.test(raw)){const so=offs[i+1]+nm.index+nm[0].indexOf(raw);cands.push({v,rule:0.7,s:so,e:so+raw.length,kw:'(下一行)',line:i+1});}}
    }
  });
  // 独立成行的金额（如支付截图顶部 -38.50）
  L.forEach((line,i)=>{const m=/^[-+]?\s*[¥￥]?\s*(\d{1,3}(?:,\d{3})*\.\d{2}|\d+\.\d{2})\s*(?:元)?$/.exec(line.t.replace(/\s/g,''));
    if(m&&i<8){const so=offs[i]+line.t.indexOf(m[1]);cands.push({v:parseFloat(m[1].replace(/,/g,'')),rule:0.66,s:so,e:so+m[1].length,kw:'独立成行的金额',line:i});}});
  // 无关键字的 ¥ 金额
  L.forEach((line,i)=>{const re=/[¥￥]\s*(-?\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|-?\d+(?:\.\d{1,2})?)/g;let m;
    while((m=re.exec(line.t))){const v=parseFloat(m[1].replace(/,/g,''));if(!(v>0))continue;const so=offs[i]+m.index+m[0].indexOf(m[1]);
      if(!cands.some(c=>c.s===so))cands.push({v,rule:0.4,s:so,e:so+m[1].length,kw:'¥',line:i});}});
  // 大写金额
  let cnVal=null,cnPos=null;
  {const re=/[零壹贰叁肆伍陆柒捌玖拾佰仟万亿一二三四五六七八九十百千两〇]{1,24}[圆元][零壹贰叁肆伍陆柒捌玖一二三四五六七八九角分整正]{0,12}|[零壹贰叁肆伍陆柒捌玖]{1,2}[角分]整?/;
   const m=re.exec(text);if(m&&/[壹贰叁肆伍陆柒捌玖拾佰仟圆]/.test(m[0])||m&&/[圆元整]/.test(m[0])&&m[0].length>=3){const v=parseCnAmount(m[0]);if(v!=null&&v>0){cnVal=v;cnPos=[m.index,m.index+m[0].length];}}}
  let amount=null;
  if(cands.length){
    if(cnVal!=null){const hit=cands.filter(c=>Math.abs(c.v-cnVal)<0.005);
      if(hit.length){hit.forEach(c=>c.rule=Math.min(0.98,Math.max(c.rule,0.8)+0.15));}}
    cands.sort((a,b)=>b.rule-a.rule||b.v-a.v);
    const c=cands[0];
    let note='依据关键字“'+c.kw+'”';let warn=false,rule=c.rule;
    if(cnVal!=null){
      if(Math.abs(c.v-cnVal)<0.005)note+='；与大写金额一致 ✓';
      else{note+='；⚠ 与大写金额（'+cnVal.toFixed(2)+'）不一致，请核对';warn=true;rule=Math.min(rule,0.35);warnings.push('小写金额 '+c.v.toFixed(2)+' 与大写金额 '+cnVal.toFixed(2)+' 不一致，OCR 可能识错数字。');}
    }
    const alts=cands.filter(x=>x.v!==c.v).slice(0,3).map(x=>x.v.toFixed(2));
    if(alts.length)note+='；其他候选：'+[...new Set(alts)].join('、');
    amount=mk('amount','金额（元）',c.v.toFixed(2),rule,c.s,c.e,note,warn);
    // 金额+税额
    const mj=text.match(/合计[^\n]*?[¥￥]?\s*(\d+\.\d{2})[^\n\d]{0,12}[¥￥]?\s*(\d+\.\d{2})/);
    if(mj&&Math.abs(parseFloat(mj[1])+parseFloat(mj[2])-c.v)<0.015){amount.note+='；不含税+税额=价税合计 ✓';amount.conf=Math.min(0.99,amount.conf+0.03);}
  }else if(cnVal!=null){
    amount=mk('amount','金额（元）',cnVal.toFixed(2),0.6,cnPos[0],cnPos[1],'仅识别到大写金额，已换算为数字',false);
  }
  fields.push(amount||{key:'amount',label:'金额（元）',value:'',conf:0,rule:0,ocr:0,start:-1,end:-1,note:'未找到金额，请手动填写',warn:true});

  /* 日期 */
  const dc=[];
  {const re=/((?:19|20)\d{2})\s*[年\-/.]\s*(\d{1,2})\s*[月\-/.]\s*(\d{1,2})\s*[日号]?/g;let m;
   while((m=re.exec(text))){const y=+m[1],mo=+m[2],d=+m[3];if(!validDate(y,mo,d))continue;
     const before=text.slice(Math.max(0,m.index-12),m.index);let r=0.55;let k='';
     if(/开票日期|开票时间/.test(before)){r=0.95;k='开票日期';}
     else if(/交易时间|支付时间|付款时间|创建时间|下单时间|订单时间|日期|时间/.test(before)){r=0.82;k=(before.match(/交易时间|支付时间|付款时间|创建时间|下单时间|订单时间|日期|时间/)||[''])[0];}
     else if(/签订|签署|签约/.test(before+text.slice(m.index,m.index+8))){r=0.8;k='签订';}
     if(/有效期|截止|至|到期|止/.test(before.slice(-5)))r*=0.5;
     dc.push({y,mo,d,rule:r,s:m.index,e:m.index+m[0].replace(/\s+$/,'').length,k});}
   const re2=/(?:开票日期|日期)[:：\s]*((?:19|20)\d{2})(\d{2})(\d{2})(?!\d)/g;
   while((m=re2.exec(text))){if(validDate(+m[1],+m[2],+m[3]))dc.push({y:+m[1],mo:+m[2],d:+m[3],rule:0.8,s:m.index,e:m.index+m[0].length,k:'日期'});}
  }
  if(dc.length){dc.sort((a,b)=>b.rule-a.rule||a.s-b.s);const c=dc[0];const v=c.y+'-'+pad(c.mo)+'-'+pad(c.d);
    let note=c.k?'依据“'+c.k+'”':'未见日期关键字，取文中首个合法日期';let warn=false,rule=c.rule;
    const now=new Date();if(new Date(c.y,c.mo-1,c.d)>new Date(now.getTime()+864e5)){note+='；⚠ 日期在未来';warn=true;rule=Math.min(rule,0.3);}
    const others=[...new Set(dc.slice(1).map(x=>x.y+'-'+pad(x.mo)+'-'+pad(x.d)))].filter(x=>x!==v).slice(0,3);
    if(others.length)note+='；其他日期：'+others.join('、');
    fields.push(mk('date','日期',v,rule,c.s,c.e,note,warn));
  }else fields.push({key:'date',label:'日期',value:'',conf:0,rule:0,ocr:0,start:-1,end:-1,note:'未找到合法日期，请手动填写',warn:true});

  /* 发票号码 / 代码 / 单号 */
  let no=null;
  {let m=/发票号码[:：;；,，.\s]*([0-9OolI]{8,20})/.exec(text);
   if(m){const raw=m[1],v=fixDigits(raw);const so=m.index+m[0].indexOf(raw);
     let rule=0.93,note='依据“发票号码”';let warn=false;
     if(v.length===20||v.length===8){note+='；位数 '+v.length+' ✓';}else{note+='；⚠ 位数为 '+v.length+'（应为 8 或 20 位），疑似漏识/多识';rule=0.45;warn=true;}
     if(v!==raw)note+='；已将字母 O/l 纠为数字';
     no=mk('invoiceNo','发票号码',v,rule,so,so+raw.length,note,warn);}
   else if((m=/(?:No\.?|NO\.?|№|号码)[:：\s]*([0-9]{8,20})/.exec(text))){const so=m.index+m[0].indexOf(m[1]);no=mk('invoiceNo','发票号码',m[1],0.6,so,so+m[1].length,'依据“No./号码”，不确定是否为发票号码');}
   else if((m=/(?:交易单号|商户单号|商家订单号|订单号|流水号|单号)[:：\s]*([0-9A-Za-z]{10,40})/.exec(text))){const so=m.index+m[0].indexOf(m[1]);no=mk('invoiceNo','发票号码',m[1],0.75,so,so+m[1].length,'依据“'+m[0].replace(m[1],'').replace(/[:：\s]/g,'')+'”（订单/交易单号）');}
   else if((m=/(?:合同编号|合同号|协议编号|编号)[:：\s]*([A-Za-z0-9][A-Za-z0-9\-_/]{3,30})/.exec(text))){const so=m.index+m[0].indexOf(m[1]);no=mk('invoiceNo','发票号码',m[1],0.8,so,so+m[1].length,'依据“'+m[0].slice(0,m.index+m[0].indexOf(m[1])-m.index).replace(/[:：\s]/g,'')+'”（合同编号）');}
  }
  fields.push(no||{key:'invoiceNo',label:'发票号码 / 单号 / 合同编号',value:'',conf:0,rule:0,ocr:0,start:-1,end:-1,note:'未找到，可留空',warn:false});
  if(no)no.label='发票号码 / 单号 / 合同编号';
  {const m=/发票代码[:：;；,，.\s]*([0-9OolI]{10,12})/.exec(text);
   if(m){const v=fixDigits(m[1]);const so=m.index+m[0].indexOf(m[1]);
     const ok=v.length===10||v.length===12;fields.push(mk('invoiceCode','发票代码',v,ok?0.92:0.45,so,so+m[1].length,ok?'位数 '+v.length+' ✓':'⚠ 位数 '+v.length+'（应为 10 或 12 位）',!ok));}}

  /* 买卖方 */
  const names=[];
  {const re=/名称[:：;；]+\s*([^\s:：;；]{2,36})/g;let m;
   const STOP=/销售方|购买方|购货方|销货方|买方|卖方|购方|销方|名称|纳税人|统一社会|识别号|地址|电话|开户|税号|账号|甲方|乙方|备注|项目名称|规格/;
   while((m=re.exec(text))){re.lastIndex=m.index+3;let v=m[1];const st=v.search(STOP);if(st>0)v=v.slice(0,st);else if(st===0)continue;
     const gi=v.lastIndexOf('公司');if(gi>=1&&gi+2<v.length)v=v.slice(0,gi+2);
     if(v.length<2)continue;
     names.push({v,s:m.index+m[0].indexOf(m[1]),e:m.index+m[0].length,idx:m.index});}}
  const endOk=v=>/(公司|厂|店|中心|事务所|个体|研究院|研究所|学校|大学|医院|部|社|馆|行|局|院|站|商行|工作室|集团|委员会)$/.test(v);
  let buyer=null,seller=null;
  {const ev=[];
   const lab=/(购买方|购货方|买方|购方|付款方|甲方)(?:信息|[\s“”"'‘’·.,，。|丨])*(?=名称|\n|$|购买方|销售方|购货方|销货方|买方|卖方|购方|销方)|(销售方|销货方|卖方|销方|收款方|乙方)(?:信息|[\s“”"'‘’·.,，。|丨])*(?=名称|\n|$|购买方|销售方|购货方|销货方|买方|卖方|购方|销方)/g;let lm;
   while((lm=lab.exec(text)))ev.push({p:lm.index,label:lm[1]?'b':'s'});
   names.forEach(n=>ev.push({p:n.idx,name:n}));ev.sort((x,y)=>x.p-y.p);
   const q=[];let nl=ev.filter(e=>e.label).length,nn=names.length;for(const e of ev){if(e.label)q.push(e.label);else if(q.length){e.name.role=q.shift();if(nl>nn)e.name.ambig=true;}}}
  // 同行两个“名称”且都未判定：左买右卖
  names.forEach((n,i)=>{if(!n.role){const sameLine=names.filter(x=>lineAt(x.s)===lineAt(n.s));if(sameLine.length===2)n.role=sameLine[0]===n?'b':'s';}});
  names.forEach((n,i)=>{if(!n.role&&names.length>=2&&!names.some(x=>x.role)){n.role=i===0?'b':i===1?'s':null;n.guess=true;}});
  for(const n of names){
    const ok=endOk(n.v);
    if(n.role==='b'&&!buyer){buyer=mk('buyer','买方 / 购买方 / 甲方',n.v,(n.guess||n.ambig?0.4:0.85)*(ok?1:0.8),n.s,n.s+n.v.length,'依据“名称”及邻近“购买方”字样'+(n.guess?'（仅按出现顺序猜测）':'')+(n.ambig?'；⚠ 票面有买卖方两栏但只识别到一个名称，归属不确定':''));if(n.ambig)buyer.warn=true;}
    if(n.role==='s'&&!seller){seller=mk('seller','卖方 / 销售方 / 乙方',n.v,(n.guess||n.ambig?0.4:0.85)*(ok?1:0.8),n.s,n.s+n.v.length,'依据“名称”及邻近“销售方”字样'+(n.guess?'（仅按出现顺序猜测）':'')+(n.ambig?'；⚠ 票面有买卖方两栏但只识别到一个名称，归属不确定':''));if(n.ambig)seller.warn=true;}
  }
  if(!seller){const m=/(?:商户全称|商家名称|商户名称|收款方|收款商户|交易对象|商品说明|商家)[:：\s]*([^\s:：]{2,30})/.exec(text);
    if(m){const so=m.index+m[0].indexOf(m[1]);seller=mk('seller','卖方 / 销售方 / 乙方',m[1],0.78,so,so+m[1].length,'依据“'+m[0].replace(m[1],'').replace(/[:：\s]/g,'')+'”');}}
  if(!seller&&(docType==='收据'||docType==='截图')){const first=L.find(l=>l.t.trim());
    if(first&&first.t.length<=24&&/(公司|店|超市|商行|餐厅|面馆|馆|工作室|中心|部|厂|药房|市场|商场|便利)$/.test(first.t)){const so=offs[L.indexOf(first)];seller=mk('seller','卖方 / 销售方 / 乙方',first.t,0.5,so,so+first.t.length,'无明确标签，取首行店名（猜测）');}}
  if(!buyer||!seller){
    const pa=/甲\s*方[（(][^）)]{0,6}[）)]?[:：;；]\s*([^\s:：;；]{2,30})/.exec(text)||/甲方[:：;；]\s*([^\s:：;；]{2,30})/.exec(text);
    const pb=/乙\s*方[（(][^）)]{0,6}[）)]?[:：;；]\s*([^\s:：;；]{2,30})/.exec(text)||/乙方[:：;；]\s*([^\s:：;；]{2,30})/.exec(text);
    if(!buyer&&pa){const so=pa.index+pa[0].indexOf(pa[1]);buyer=mk('buyer','买方 / 购买方 / 甲方',pa[1],0.55,so,so+pa[1].length,'依据“甲方”；甲方不一定是买方，请人工确认');}
    if(!seller&&pb){const so=pb.index+pb[0].indexOf(pb[1]);seller=mk('seller','卖方 / 销售方 / 乙方',pb[1],0.55,so,so+pb[1].length,'依据“乙方”；乙方不一定是卖方，请人工确认');}
  }
  const emptyP=(k,l)=>({key:k,label:l,value:'',conf:0,rule:0,ocr:0,start:-1,end:-1,note:'未找到，可留空',warn:false});
  fields.push(buyer||emptyP('buyer','买方 / 购买方 / 甲方'));
  fields.push(seller||emptyP('seller','卖方 / 销售方 / 乙方'));

  /* 税号 */
  {const ids=[];const re=/(?<![0-9A-Za-z])[0-9A-Z]{18}(?![0-9A-Za-z])/g;let m;
   while((m=re.exec(text))){let v=m[0],fixed=false,ok=checkUSCC(v);
     if(!ok){const f=v.replace(/I/g,'1').replace(/O/g,'0');if(f!==v&&checkUSCC(f)){v=f;ok=true;fixed=true;}}
     if(ok||/^\d{8}[0-9A-Z]{10}$/.test(v)&&/[A-Z]/.test(v.slice(8)))ids.push({v,s:m.index,ok,fixed});}
   if(ids.length){const good=ids.filter(x=>x.ok);
     const f=mk('taxIds','统一社会信用代码',ids.map(x=>x.v).join(' / '),good.length===ids.length?0.9:0.4,ids[0].s,ids[0].s+18,ids.map(x=>x.v.slice(0,6)+'…'+(x.ok?' 校验位 ✓'+(x.fixed?'（已把 I/O 纠为 1/0）':''):' ⚠ 校验位不符，疑似识错')).join('；'),good.length!==ids.length);
     fields.push(f);if(good.length!==ids.length)warnings.push('统一社会信用代码校验位不符，说明该号码有字符被识错。');}}

  return {text,lines:L,fields,docType,warnings,lineAt};
}
const api={extract,parseCnAmount,checkUSCC,normLine};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.PJX=api;
})(typeof self!=='undefined'?self:this);
