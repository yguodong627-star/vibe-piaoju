# 留出集：规则调完之后才生成的新样本（不同字体/内容/金额），只评测不调规则
import json,os,random
src=open('gen.py').read(); exec(src[:src.index('truth={}')])
random.seed(99)
CSS=CSS.replace("'Noto Sans CJK SC','Noto Serif CJK SC'","'Noto Serif CJK SC'")
os.makedirs('html_holdout',exist_ok=True)
S=[];tr={}
def add(name,kind,html,t):
    open(f'html_holdout/{name}.html','w').write(html);S.append({'name':name,'kind':kind});tr[name]=t
b,s=uscc('91510100MA6CD3E4F'),uscc('91330200MA2KQ8R5T')
h,t=invoice_side('26510000001234567890','2026年02月09日','成都云岫文化创意有限公司',b,'宁波远帆包装材料有限公司',s,[('包装盒',1200,3.25),('封箱胶带',40,6.50)],4160.00,540.80)
add('h_inv_a','page',h,{'amount':f'{t:.2f}','date':'2026-02-09','invoiceNo':'26510000001234567890','buyer':'成都云岫文化创意有限公司','seller':'宁波远帆包装材料有限公司','docType':'发票'})
h,t=invoice_side('31220000007654321098','2026年07月23日','武汉澜桥信息技术有限公司',uscc('91420100MA4KX1Y2W'),'西安秦风软件有限公司',uscc('91610131MA6U3W4X5'),[('技术服务费',1,18800.00)],18800.00,1128.00)
add('h_inv_b','page',h,{'amount':f'{t:.2f}','date':'2026-07-23','invoiceNo':'31220000007654321098','buyer':'武汉澜桥信息技术有限公司','seller':'西安秦风软件有限公司','docType':'发票'})
add('h_stack','page',invoice_stack('19283746','2026-05-17','南京听雨轩茶艺馆','无锡新润食品贸易有限公司',12850.50),{'amount':'12850.50','date':'2026-05-17','invoiceNo':'19283746','buyer':'南京听雨轩茶艺馆','seller':'无锡新润食品贸易有限公司','docType':'发票'})
add('h_contract','page',contract('SZ-2025-0912','2025年9月12日','长沙知行教育科技有限公司','合肥拓海广告传媒有限公司',56800.00),{'amount':'56800.00','date':'2025-09-12','invoiceNo':'SZ-2025-0912','buyer':'长沙知行教育科技有限公司','seller':'合肥拓海广告传媒有限公司','docType':'合同'})
add('h_wechat','phone',wechat('2026-10-03','19:08:44',268.00,'青岛海之味海鲜酒楼','4200001987202610031122334455'),{'amount':'268.00','date':'2026-10-03','invoiceNo':'4200001987202610031122334455','buyer':'','seller':'青岛海之味海鲜酒楼','docType':'截图'})
add('h_receipt','phone',receipt('2026-06-18',[('打印纸 2箱',186.00),('墨盒 3个',297.00)],483.00,'东方办公用品商行'),{'amount':'483.00','date':'2026-06-18','invoiceNo':'','buyer':'','seller':'东方办公用品商行','docType':'收据'})
json.dump(S,open('html_holdout/manifest.json','w'));json.dump(tr,open('truth_holdout.json','w'),ensure_ascii=False,indent=1)
