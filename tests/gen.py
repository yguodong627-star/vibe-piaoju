# 生成带中文文字的测试样本（HTML→截图/PDF，再用 PIL 做退化），并写出标准答案 truth.json
import json, random, math, subprocess, os
from PIL import Image, ImageFilter, ImageDraw, ImageEnhance
random.seed(7)
OUT='samples'
def uscc(base17):
    chars='0123456789ABCDEFGHJKLMNPQRTUWXY'; w=[1,3,9,27,19,26,16,17,20,29,25,13,8,24,10,30,28]
    s=sum(chars.index(c)*w[i] for i,c in enumerate(base17)); return base17+chars[(31-s%31)%31]
def cn(n):
    d='零壹贰叁肆伍陆柒捌玖'; u=['','拾','佰','仟']
    yuan=int(n); jf=round((n-yuan)*100); jiao,fen=jf//10,jf%10
    def sec(x):
        s='';z=False
        for i in range(3,-1,-1):
            v=(x//10**i)%10
            if v==0: z=bool(s) 
            else:
                if z: s+='零'; z=False
                s+=d[v]+u[i]
        return s
    ys=''
    yi,wan,ge=yuan//100000000,(yuan//10000)%10000,yuan%10000
    if yi: ys+=sec(yi)+'亿'
    if wan: ys+=sec(wan)+'万'
    elif yi and ge: ys+='零'
    if ge: 
        t=sec(ge)
        if (wan or yi) and ge<1000 and not t.startswith('零'): t='零'+t
        ys+=t
    if not ys: ys='零'
    ys+='圆'
    if jf==0: return ys+'整'
    r=ys
    if jiao: r+=d[jiao]+'角'
    elif fen: r+='零'
    if fen: r+=d[fen]+'分'
    else: r+='整' if False else ''
    return r
CSS="""body{margin:0;font-family:'Noto Sans CJK SC','Noto Serif CJK SC';color:#111;background:#fff}
.page{width:1100px;padding:40px 50px;box-sizing:border-box;background:#fff}
h1{text-align:center;font-size:34px;letter-spacing:6px;border-bottom:3px double #b22;color:#b22;margin:0 0 18px;padding-bottom:8px}
table{border-collapse:collapse;width:100%}td{border:1.5px solid #b22;padding:8px 10px;font-size:20px}
.k{color:#222}.row{display:flex;justify-content:space-between;font-size:21px;margin:8px 0}
"""
def invoice_side(no,date,buyer,buyer_id,seller,seller_id,items,total_ex,tax,code=None):
    tot=round(total_ex+tax,2)
    rows=''.join(f"<tr><td>{n}</td><td>{q}</td><td>{p:.2f}</td><td>{p*q:.2f}</td><td>13%</td><td>{p*q*0.13:.2f}</td></tr>" for n,q,p in items)
    return f"""<html><head><meta charset=utf-8><style>{CSS}</style></head><body><div class=page>
<h1>电子发票（普通发票）</h1>
<div class=row><span>发票号码：{no}</span><span>开票日期：{date}</span></div>
<table><tr><td style="width:50%"><b>购买方信息</b><br>名称：{buyer}<br>统一社会信用代码/纳税人识别号：{buyer_id}</td><td><b>销售方信息</b><br>名称：{seller}<br>统一社会信用代码/纳税人识别号：{seller_id}</td></tr></table>
<table style="margin-top:10px"><tr><td>项目名称</td><td>数量</td><td>单价</td><td>金额</td><td>税率</td><td>税额</td></tr>{rows}
<tr><td>合计</td><td></td><td></td><td>¥{total_ex:.2f}</td><td></td><td>¥{tax:.2f}</td></tr></table>
<table style="margin-top:10px"><tr><td>价税合计(大写)　<b>{cn(tot)}</b>　　（小写）<b>¥{tot:.2f}</b></td></tr></table>
<div class=row style="margin-top:14px"><span>备注：差旅与办公用品采购</span><span>开票人：王小明</span></div>
</div></body></html>""",tot
def invoice_stack(no,date,buyer,seller,amount):
    return f"""<html><head><meta charset=utf-8><style>{CSS}</style></head><body><div class=page>
<h1>增值税普通发票</h1>
<div class=row><span>发票代码：031002400111</span><span>发票号码：{no}</span></div>
<div class=row><span>开票日期：{date}</span></div>
<table><tr><td>购买方　名称：{buyer}</td></tr><tr><td>销售方　名称：{seller}</td></tr></table>
<table style="margin-top:10px"><tr><td>货物或应税劳务名称</td><td>金额</td></tr><tr><td>办公设备</td><td>{amount/1.13:.2f}</td></tr></table>
<div class=row style="margin-top:14px"><span>价税合计（大写）{cn(amount)}</span><span>（小写）￥{amount:.2f}</span></div>
</div></body></html>"""
def contract(no,date,a,b,total):
    return f"""<html><head><meta charset=utf-8><style>{CSS} p{{font-size:21px;line-height:1.9;margin:6px 0}}</style></head><body><div class=page>
<h1 style="color:#111;border-color:#111">软件开发服务合同</h1>
<p>合同编号：{no}</p>
<p>甲方：{a}</p><p>乙方：{b}</p>
<p>根据《中华人民共和国民法典》及相关法律规定，甲乙双方经友好协商，就软件开发服务事宜签订本合同。</p>
<p>第一条　乙方按甲方需求完成网站开发，验收合格后甲方支付全部款项。</p>
<p>第二条　合同总价：人民币 ¥{total:,.2f} 元（大写：{cn(total)}）。</p>
<p>第三条　任何一方违约，应向对方支付合同总价百分之十的违约金。</p>
<p>签订日期：{date}</p>
<p style="margin-top:40px">甲方（盖章）：　　　　　　　乙方（盖章）：</p>
</div></body></html>"""
def wechat(date,time,amount,shop,orderno):
    return f"""<html><head><meta charset=utf-8><style>body{{margin:0;background:#f5f5f5;font-family:'Noto Sans CJK SC'}}.p{{width:390px;background:#fff;padding:30px 20px;box-sizing:border-box;min-height:600px}}
.c{{text-align:center}}.amt{{font-size:40px;font-weight:600;margin:10px 0}}.r{{display:flex;justify-content:space-between;font-size:14px;margin:14px 0;color:#444}}.r span:first-child{{color:#888}}</style></head><body><div class=p>
<div class=c style="font-size:16px">{shop}</div><div class="c amt">-{amount:.2f}</div><div class=c style="font-size:14px;color:#888">交易成功</div><hr style="border:0;border-top:1px solid #eee;margin:20px 0">
<div class=r><span>当前状态</span><span>支付成功</span></div><div class=r><span>支付时间</span><span>{date} {time}</span></div><div class=r><span>支付方式</span><span>零钱</span></div>
<div class=r><span>商户全称</span><span>{shop}</span></div><div class=r><span>交易单号</span><span>{orderno}</span></div></div></body></html>"""
def receipt(date,items,total,shop):
    rows=''.join(f"<div class=r><span>{n}</span><span>{p:.2f}</span></div>" for n,p in items)
    return f"""<html><head><meta charset=utf-8><style>body{{margin:0;font-family:'Noto Sans CJK SC'}}.p{{width:420px;padding:26px;background:#fff}}.r{{display:flex;justify-content:space-between;font-size:18px;margin:6px 0}}h2{{text-align:center;margin:0 0 10px}}</style></head><body><div class=p>
<h2>{shop}</h2><div class=r><span>收款收据</span><span>日期：{date}</span></div><hr>{rows}<hr><div class=r style="font-size:22px"><b>合计：¥{total:.2f}</b></div><div class=r><span>收款人：李梅</span><span>谢谢惠顾</span></div></div></body></html>"""

truth={}
S=[]
# 1 干净发票（并排买卖方）
b1,s1=uscc('91110108MA01A2B3C'),uscc('91310115MA1H7D9K2')
h,t=invoice_side('24312000000012345678','2024年10月15日','北京云杉科技有限公司',b1,'上海衡远贸易有限公司',s1,[('笔记本电脑',1,4800.00),('无线鼠标',2,89.00)],4978.00,647.14)
S.append(('inv1_clean','page',h,{'amount':f'{t:.2f}','date':'2024-10-15','invoiceNo':'24312000000012345678','buyer':'北京云杉科技有限公司','seller':'上海衡远贸易有限公司','docType':'发票'}))
# 2 上下排版发票
h=invoice_stack('08765432','2025-03-28','杭州澄明设计工作室','苏州宏图办公用品有限公司',2260.00)
S.append(('inv2_stack','page',h,{'amount':'2260.00','date':'2025-03-28','invoiceNo':'08765432','buyer':'杭州澄明设计工作室','seller':'苏州宏图办公用品有限公司','docType':'发票'}))
# 3 合同
h=contract('HT-2026-0318','2026年3月18日','深圳星河网络科技有限公司','成都青禾软件服务有限公司',128000.00)
S.append(('contract1','page',h,{'amount':'128000.00','date':'2026-03-18','invoiceNo':'HT-2026-0318','buyer':'深圳星河网络科技有限公司','seller':'成都青禾软件服务有限公司','docType':'合同'}))
# 4 微信支付截图
h=wechat('2026-09-21','12:35:08',38.50,'瑞安路兰州牛肉面馆','4200002143202609217788990011')
S.append(('wechat1','phone',h,{'amount':'38.50','date':'2026-09-21','invoiceNo':'4200002143202609217788990011','buyer':'','seller':'瑞安路兰州牛肉面馆','docType':'截图'}))
# 5 收据
h=receipt('2026-08-05',[('A4复印纸 5包',125.00),('中性笔 20支',36.80),('文件夹 10个',48.00)],209.80,'晨光文具超市')
S.append(('receipt1','phone',h,{'amount':'209.80','date':'2026-08-05','invoiceNo':'','buyer':'','seller':'','docType':'收据'}))
# 6 另一张发票（用于退化：斜拍/低清/盖章）
b2,s2=uscc('91440300MA5F8Q2R1'),uscc('91330106MA2B9X4L7')
h,t=invoice_side('25442000000098765432','2025年12月02日','广州拾光文化传媒有限公司',b2,'杭州锐博印刷有限公司',s2,[('宣传册印刷',500,6.80),('展架',3,260.00)],4180.00,543.40)
tr6={'amount':f'{t:.2f}','date':'2025-12-02','invoiceNo':'25442000000098765432','buyer':'广州拾光文化传媒有限公司','seller':'杭州锐博印刷有限公司','docType':'发票'}
S.append(('inv3_base','page',h,tr6))

os.makedirs('html',exist_ok=True)
man=[]
for name,kind,html,tr in S:
    open(f'html/{name}.html','w').write(html); man.append({'name':name,'kind':kind}); truth[name]=tr
    if name=='inv1_clean': truth['inv1_textlayer']=tr
json.dump(man,open('html/manifest.json','w')); json.dump(truth,open('truth_partial.json','w'),ensure_ascii=False)
