import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
 const page=await browser.newPage({viewport:{width:1200,height:850}});
 await page.goto('http://localhost:5173/tools/mech-preview.html');
 const nav=page.getByRole('navigation',{name:'드론 모델 선택'});
 assert.equal(await nav.getByRole('link',{name:'워커',exact:true}).getAttribute('aria-current'),'page');
 await nav.getByRole('link',{name:'플라이어',exact:true}).click();await page.waitForURL('**/flyer-preview.html');await page.waitForFunction(()=>window.flyerReview);
 assert.equal(await nav.getByRole('link',{name:'플라이어',exact:true}).getAttribute('aria-current'),'page');
 await page.screenshot({path:'build/mech-review/drone-menu.jpg',type:'jpeg'});
 await nav.getByRole('link',{name:'워커',exact:true}).click();await page.waitForURL('**/mech-preview.html');
 await page.route('**/models/index.json',async route=>{const response=await route.fetch();const data=await response.json();data.assets.push({id:'future-test',name:'신규 드론',preview:'/tools/future-test.html'});await route.fulfill({json:data});});
 await page.reload();await nav.getByRole('link',{name:'신규 드론'}).waitFor();
 await page.setViewportSize({width:390,height:844});await page.waitForFunction(()=>document.documentElement.scrollWidth===390);
 assert.equal(await nav.getByRole('link',{name:'신규 드론'}).getAttribute('href'),'/tools/future-test.html');
 console.log('PASS walker/flyer navigation, active page, registry extension and mobile layout');
}finally{await browser.close();}
