(function(root,factory){const api=factory();if(typeof module==="object"&&module.exports)module.exports=api;else root.SplitEasyDiningImport=api;})(typeof globalThis!=="undefined"?globalThis:this,function(){
 const norm=name=>String(name||'').normalize('NFKC').trim().replace(/\s+/g,' ');
 const key=id=>String(id);
 const own=(obj,id)=>Object.prototype.hasOwnProperty.call(obj||{},id);
 const fail=message=>{throw new Error(message);};
 const autoMap=(source,target)=>{
  const mapping={};
  (source.people||[]).forEach(p=>{
   const n=norm(p.name),matches=(target.people||[]).filter(t=>norm(t.name)===n);
   if(n&&matches.length===1&&(source.people||[]).filter(t=>norm(t.name)===n).length===1)mapping[p.id]=key(matches[0].id);
  });return mapping;
 };
 const financialData=d=>({
  title:d.title||'',date:d.date||'',people:(d.people||[]).map(p=>({id:p.id,name:p.name||''})),
  splitMode:d.splitMode||'even',totalBill:Number(d.totalBill)||0,
  serviceChargeType:d.serviceChargeType||'percent',serviceChargeValue:Number(d.serviceChargeValue)||0,
  customAmounts:d.customAmounts||{},diningItems:d.diningItems||[],
  billPayerId:d.billPayerId||d.people?.[0]?.id||null
 });
 // Firestore map keys may return in a different order; array order and values remain significant.
 const stableStringify=value=>JSON.stringify(value,(_,nested)=>nested&&typeof nested==='object'&&!Array.isArray(nested)?Object.fromEntries(Object.keys(nested).sort().map(key=>[key,nested[key]])):nested);
 const fingerprint=d=>stableStringify(financialData(d));
 // Keep day slots stable after deletion/restoration. This module deliberately does
 // not depend on EntryRecycleBin: browser script order and Node consumers vary.
 const activeDays=d=>{
  if(d.dayOrder!==undefined){
   if(!Array.isArray(d.dayOrder)||!d.dayOrder.length)fail('旅遊至少需要保留一天。');
   const order=d.dayOrder.map(Number);
   if(order.some(day=>!Number.isSafeInteger(day)||day<1)||new Set(order).size!==order.length)fail('旅遊天數資料異常，請重新確認日程。');
   return order;
  }
  const highest=Math.max(1,parseInt(d.days,10)||1,...(d.expenses||[]).map(e=>Math.max(1,parseInt(e.day,10)||1)));
  if(highest>100000)fail('旅遊天數資料異常，請重新確認日程。');
  return Array.from({length:highest},(_,index)=>index+1);
 };
 const targetFingerprint=d=>{
  const dayOrder=activeDays(d);
  return JSON.stringify({people:(d.people||[]).map(p=>({id:p.id,name:p.name||'',payerId:p.payerId||p.id})),
   days:Math.max(1,parseInt(d.days,10)||1),dayOrder,daySequence:Math.max(Number(d.daySequence)||0,...dayOrder)});
 };
 const hasImport=(trip,sourceId)=>(trip.expenses||[]).some(e=>e.diningImport?.sourceProjectId===sourceId);
 const build=(source,trip,options,calculation,rows)=>{
  const people=source.people||[],targets=trip.people||[],mapping=options.mapping||{};
  if(!options.sourceProjectId||!options.targetProjectId||options.sourceProjectId===options.targetProjectId)fail('請選擇有效的旅遊專案。');
  if(!people.length||!targets.length)fail('聚餐與旅遊都需要先建立成員。');
  if(new Set(people.map(p=>key(p.id))).size!==people.length||new Set(targets.map(p=>key(p.id))).size!==targets.length)fail('成員資料重複，請先確認成員設定。');
  if(hasImport(trip,options.sourceProjectId))fail('這筆聚餐已匯入此旅遊，不能重複新增。');
  const used=new Set(),splitAmounts={},shares=[];
  people.forEach(p=>{
   const target=targets.find(t=>own(mapping,p.id)&&key(t.id)===key(mapping[p.id]));
   if(!target)fail('請將每位聚餐成員對應到旅遊成員。');
   if(used.has(key(target.id)))fail('每位旅遊成員只能對應一次，請確認姓名。');
   used.add(key(target.id));
   const result=calculation.results.find(r=>key(r.id)===key(p.id));
   if(!result||!Number.isSafeInteger(result.amount))fail('個人負擔金額異常，請返回聚餐確認。');
   splitAmounts[target.id]=result.amount;
   shares.push({personId:target.id,name:target.name||'',sourceName:p.name||'',amount:result.amount});
  });
  const total=calculation.finalTotal;
  if(!Number.isSafeInteger(total)||total<=0||Object.values(splitAmounts).reduce((a,b)=>a+b,0)!==total)fail('個人負擔合計與聚餐總額不符，請返回聚餐確認。');
  if(source.splitMode==='mixed'){
   for(const item of source.diningItems||[]){
    if(!Number.isFinite(Number(item.amount)))fail('聚餐品項金額異常，請先修正。');
    if(Number(item.amount)&&(!(item.participantIds||[]).length||(item.participantIds||[]).some(id=>!people.some(p=>key(p.id)===key(id)))))fail('聚餐品項尚未指定有效的負擔人，請先修正。');
   }
  }
  const payer=targets.find(t=>key(t.id)===key(mapping[calculation.payerId]));
  if(!payer)fail('請確認聚餐付款人的成員對應。');
  const day=Number(options.day);
  if(!Number.isSafeInteger(day)||!activeDays(trip).includes(day))fail('請選擇旅遊中有效的天數。');
  if(!rows.length||Math.abs(rows.reduce((s,r)=>s+Number(r.amount),0)-total)>0.005)fail('費用明細合計異常，請返回聚餐確認。');
  return {
   id:options.expenseId,desc:source.title?.trim()||'未命名聚餐',amount:total,day,
   payers:{[payer.id]:total},splitBetween:shares.map(r=>r.personId),splitAmounts,
   diningImport:{sourceProjectId:options.sourceProjectId,sourceTitle:source.title?.trim()||'未命名聚餐',
    importedAt:options.importedAt,date:source.date||'',payerName:payer.name||'',shares,
    rows:rows.map(r=>({id:String(r.id),name:r.name,amount:Number(r.amount)})),
    sourceFingerprint:fingerprint(source),sourceData:financialData(source)}
  };
 };
 return {autoMap,fingerprint,targetFingerprint,hasImport,build};
});
