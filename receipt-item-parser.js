(function(root){
'use strict';
const money=/(?:NT\$|NTD|TWD|\$)?\s*([+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)\s*(?:元|圓)?\s*$/i;
const qty=/^(.*?)\s*(?:[xX×*＊]\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(?:碗|份|個|杯|盤|瓶|包|盒|顆|串|片|塊|條|支|套)|數量\s*(\d+(?:\.\d+)?))$/;
const total=/^(?:總計|合計|總額|帳單總額|消費總額|應付(?:金額)?|應收(?:金額)?|實付(?:金額)?|實收(?:金額)?|合計金額|結帳金額|grand\s+total|total)\s*[:：]?\s*$/i;
const ignore=/^(?:小計|現金|找零|找回|信用卡|刷卡|支付方式|付款方式|稅額|營業稅|subtotal|cash|change)(?:\s|[:：]|$)/i;
const meta=/^(?:日期|時間|電話|TEL|統編|統一編號|發票號碼|交易序號|訂單編號|桌號|收銀員|店員|地址|收據|電子發票|購買明細|消費明細)(?:\s|[:：]|$)/i;
const header=/^(?:品名|品項|商品名稱|項目|單價|數量|金額|QTY|ITEM|DESCRIPTION)(?:\s|$)/i;
const clean=s=>s.trim().replace(/[:：]+$/,'').trim();
function quantity(s){const m=s.match(qty);if(!m)return null;const name=clean(m[1]),n=Number(m[2]||m[3]||m[4]);return name&&n>0&&Number.isFinite(n)?{name,quantity:n}:null;}
function parse(text){
const out={items:[],unresolved:[],ignored:[],total:null};let rank=0;
String(text==null?'':text).split(/\r?\n/).forEach(rawLine=>{
const line=rawLine.replace(/[０-９]/g,c=>String.fromCharCode(c.charCodeAt(0)-65248)).replace(/＄/g,'$').replace(/－/g,'-').replace(/＋/g,'+').replace(/，/g,',').replace(/．/g,'.').replace(/\u3000/g,' ').trim();
if(!line)return;
if(meta.test(line)||header.test(line)||/^\d{2,4}[-/]\d{1,2}[-/]\d{1,2}(?:\s|$)/.test(line)||/^(?:0\d[- ]?\d{3,4}[- ]?\d{4}|0\d{2}[- ]?\d{3}[- ]?\d{3})$/.test(line)||/^[-_=—─]+$/.test(line)){out.ignored.push(rawLine);return;}
const m=line.match(money);let prefix=m?line.slice(0,m.index).trim():'';
if(m&&/[.,]$/.test(prefix)){out.unresolved.push(rawLine);return;}
const amount=m?Number(m[1].replace(/,/g,'')):null;
if(m&&total.test(prefix)){const next=/^(?:實付|實收)/.test(prefix)?2:1;if(next>=rank){out.total=amount;rank=next;}out.ignored.push(rawLine);return;}
if(ignore.test(line)||(!m&&total.test(line))){out.ignored.push(rawLine);return;}
if(!m||!Number.isFinite(amount)){out.unresolved.push(rawLine);return;}
let count=1,value=amount;
if(/(?:單價|@)\s*$/.test(prefix)){
const q=quantity(prefix.replace(/(?:單價|@)\s*$/,'').trim());
if(!q){out.unresolved.push(rawLine);return;}prefix=q.name;count=q.quantity;value=Math.round(amount*count*100)/100;
}else{
const columns=prefix.match(/^(.+?)\s+(\d+(?:\.\d+)?)\s+(?:單價\s*|@\s*)?((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)$/),q=quantity(prefix);
if(columns){prefix=clean(columns[1]);count=Number(columns[2]);}
else if(q){prefix=q.name;count=q.quantity;}
else if(/(?:\s|^)\d+(?:\.\d+)?$/.test(prefix)){out.unresolved.push(rawLine);return;}
}
const name=clean(prefix);
if(!name||count<=0||!Number.isFinite(count)||!/[A-Za-z\u3400-\u9fff]/.test(name)){out.unresolved.push(rawLine);return;}
const kind=value<0||/(?:折扣|優惠|折讓|折價|折抵|discount|coupon)/i.test(name)?'discount':/(?:服務費|service\s*charge)/i.test(name)?'service':'item';
if(kind==='discount')value=-Math.abs(value);
out.items.push({name,quantity:count,amount:value,kind,rawLine});
});return out;}
root.SplitEasyReceiptItems={parse};if(typeof module==='object'&&module.exports)module.exports=root.SplitEasyReceiptItems;
})(typeof window!=='undefined'?window:globalThis);
