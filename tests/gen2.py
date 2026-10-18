import json,random,math
from PIL import Image, ImageFilter, ImageDraw
random.seed(7)
OUT='samples'
truth=json.load(open('truth_partial.json'))
tr6=truth['inv3_base']
# 退化
base=Image.open(f'{OUT}/inv3_base.png').convert('RGB')
# a 斜拍+噪点+阴影+模糊
def photo(img,angle,blur,noise,shadow):
    bg=Image.new('RGB',(img.width+300,img.height+300),(120,110,100))
    r=img.rotate(angle,expand=True,fillcolor=(120,110,100),resample=Image.BICUBIC)
    bg.paste(r,((bg.width-r.width)//2,(bg.height-r.height)//2))
    if shadow:
        g=Image.linear_gradient('L').resize(bg.size).rotate(30)
        bg=Image.composite(bg,Image.new('RGB',bg.size,(40,40,40)),g.point(lambda v:int(v*0.5+128)))
    bg=bg.filter(ImageFilter.GaussianBlur(blur))
    px=bg.load()
    for _ in range(int(bg.width*bg.height*noise)):
        x,y=random.randrange(bg.width),random.randrange(bg.height);v=random.randint(-60,60);c=px[x,y];px[x,y]=tuple(max(0,min(255,k+v)) for k in c)
    return bg
photo(base,6,1.0,0.02,False).save(f'{OUT}/inv3_skew6.jpg',quality=82); truth['inv3_skew6']=tr6
photo(base,12,1.4,0.04,True).save(f'{OUT}/inv3_skew12_shadow.jpg',quality=70); truth['inv3_skew12_shadow']=tr6
# b 低分辨率
lo=base.resize((base.width//3,base.height//3),Image.LANCZOS); lo.save(f'{OUT}/inv3_lowres.png'); truth['inv3_lowres']=tr6
# c 盖章遮挡：红色圆章压在销售方名称和金额附近
st=base.copy().convert('RGBA'); ov=Image.new('RGBA',st.size,(0,0,0,0)); d=ImageDraw.Draw(ov)
W,H=st.size
def stamp(cx,cy,r,col=(200,30,30,170)):
    d.ellipse([cx-r,cy-r,cx+r,cy+r],outline=col,width=7); d.ellipse([cx-r+14,cy-r+14,cx+r-14,cy+r-14],outline=col,width=3)
    for k in range(12):
        a=k/12*2*math.pi; d.line([cx+(r-30)*math.cos(a),cy+(r-30)*math.sin(a),cx+(r-8)*math.cos(a),cy+(r-8)*math.sin(a)],fill=col,width=4)
stamp(int(W*0.78),int(H*0.30),150); stamp(int(W*0.62),int(H*0.66),130)
Image.alpha_composite(st,ov).convert('RGB').save(f'{OUT}/inv3_stamp.png'); truth['inv3_stamp']=tr6
# d 扫描件 PDF（纯图片）
base.convert('RGB').save(f'{OUT}/inv3_scanned.pdf',resolution=110); truth['inv3_scanned']=tr6
json.dump(truth,open('truth.json','w'),ensure_ascii=False,indent=1)
print(len(truth),'samples')
