'use strict';
// Tooling stays outside this static-site checkout. See HANDOFF_RECYCLE_BIN.md.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const toolsDir = process.env.SPLITEASY_TOOLS_DIR || '/workspace/setup-tools/p-split1/node_modules';
const babel = require(path.join(toolsDir, '@babel/standalone'));
let playwright;
try { playwright = require('playwright'); } catch { playwright = require(path.join(toolsDir, 'playwright')); }
const { chromium } = playwright;
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const source = html.match(/<script type="text\/babel"[^>]*>([\s\S]*?)<\/script>/)[1];
// Compile the full production module as well as the offline component harness.
babel.transform(source, { presets: ['react'], sourceType: 'module' });
const components = source.slice(source.indexOf('const COLLAB_ENTITY_ARRAY_KEYS'), source.indexOf('const App ='));
const harness = `
const {useState,useEffect,useRef}=React;
${components}
const Harness = ({type}) => {
 const initial = type === 'travel' ? {
  name:'旅遊',people:[{id:'a',name:'小明',payerId:'a'},{id:'b',name:'小美',payerId:'b'}],days:1,
  expenses:[{id:12,desc:'晚餐',amount:638,day:1,payers:{a:638},splitBetween:['a','b']}]
 } : {
  title:'聚餐',date:'2026-11-17',people:[{id:'a',name:'小明',payerId:'a'},{id:'b',name:'小美',payerId:'b'}],
  splitMode:'mixed',totalBill:0,serviceChargeType:'fixed',serviceChargeValue:0,
  customAmounts:{},billPayerId:'a',diningItems:[{id:12,name:'晚餐',amount:638,participantIds:['a','b']}]
 };
 const [data,setData]=useState(initial),[dialog,setDialog]=useState(null),[bin,setBin]=useState(false);
 window.testData=data;
 const request=item=>setDialog({type:'confirm',title:'移至回收桶',confirmText:'確認移至回收桶',message:item.desc||item.name,onConfirm:()=>setData(prev=>window.SplitEasyRecycleBin.moveToBin({type,data:prev},item,{uid:'a',displayName:'小明'},'token','2026-11-17T08:00:00Z'))});
 const props={projectData:data,onUpdate:next=>setData(next),showMessage:()=>{},onRequestDelete:request};
 return <><button onClick={()=>setBin(true)}>開啟回收桶</button>
 {type==='travel'?<TravelMode {...props} initialTab="expenses"/>:<DiningMode {...props} initialStep={3}/>}
 <DialogModal dialog={dialog} onClose={()=>setDialog(null)}/>
 {bin&&<RecycleBinModal entries={data.recycleBin||[]} busy={false} onClose={()=>setBin(false)} onRestore={token=>setData(prev=>window.SplitEasyRecycleBin.restore({type,data:prev},token))}/>}</>;
};
window.mountTest=type=>{window.testRoot?.unmount();window.testRoot=ReactDOM.createRoot(document.getElementById('root'));window.testRoot.render(<Harness type={type}/>);};`;
const compiled = babel.transform(harness, { presets: ['react'], sourceType: 'script' }).code;
(async () => {
 const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args:['--no-sandbox'] });
 try {
  for (const width of [390, 1280]) {
   const page = await browser.newPage({viewport:{width,height:844}});
   const errors=[], requests=[];
   page.on('pageerror',error=>errors.push(error.message));
   await page.route('**/*', route=>{requests.push(route.request().url());return route.abort();});
   await page.setContent('<html lang="zh-TW"><meta charset="utf-8"><body><div id="root"></div></body></html>');
   await page.addScriptTag({path:path.join(toolsDir,'react/umd/react.production.min.js')});
   await page.addScriptTag({path:path.join(toolsDir,'react-dom/umd/react-dom.production.min.js')});
   await page.addScriptTag({path:path.join(root,'entry-recycle-bin.js')});
   await page.addScriptTag({content:compiled});
   for (const type of ['travel','dining']) {
    await page.evaluate(type=>window.mountTest(type),type);
    const key=type==='travel'?'expenses':'diningItems';
    const deleteButton=page.getByRole('button',{name:type==='travel'?'刪除晚餐':'刪除品項 1',exact:true});
    await deleteButton.click();
    await page.getByRole('button',{name:'取消',exact:true}).click();
    assert.equal(await page.evaluate(key=>window.testData[key].length,key),1);
    await deleteButton.click();
    await page.getByRole('button',{name:'確認移至回收桶',exact:true}).click();
    await page.waitForFunction(key=>window.testData[key].length===0,key);
    await page.getByRole('button',{name:'開啟回收桶',exact:true}).click();
    const modal=page.getByRole('dialog',{name:'回收桶（1／50）',exact:true});
    await modal.waitFor();
    assert.match(await modal.innerText(),/小明/);
    // Focus stays within the recycle modal and Escape closes it.
    await page.getByRole('button',{name:'關閉',exact:true}).focus();
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('aria-label')),'還原晚餐');
    await page.getByRole('button',{name:'還原晚餐',exact:true}).click();
    await page.waitForFunction(key=>window.testData[key].length===1 && window.testData.recycleBin.length===0,key);
    assert.equal(await page.evaluate(key=>window.testData[key][0].amount,key),638);
    await page.getByText('目前沒有刪除的紀錄',{exact:true}).waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({state:'detached'});
    console.log('PASS browser cancel/delete/bin/restore/focus/Escape',type,width);
   }
   assert.deepEqual(errors,[]);
   assert.deepEqual(requests,[]);
   await page.close();
  }
 } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
