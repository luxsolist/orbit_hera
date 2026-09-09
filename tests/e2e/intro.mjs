// Run against a Vite dev server: npm run dev, then node tests/e2e/intro.mjs.
import assert from "node:assert/strict";
import { chromium } from "playwright";
const base=process.env.INTRO_BASE_URL??"http://localhost:5173";
const browser=await chromium.launch({headless:true,args:["--no-sandbox","--use-angle=swiftshader","--enable-unsafe-swiftshader"]});
const page=await browser.newPage({viewport:{width:1280,height:720}});
const errors=[];
page.on("pageerror",e=>errors.push(e.message));
page.on("console",e=>{if(e.type()==="error")errors.push(e.text());});
try{
  await page.goto(base);
  await page.locator("#storyBtn").waitFor({state:"visible"});
  for(const method of ["Escape","click"]){
    await page.locator("#storyBtn").click();
    await page.locator(".sidepop__item").first().click();
    await page.locator(".cinematic").waitFor({state:"visible"});
    await page.waitForFunction(()=>document.querySelector(".cinematic__clock")?.textContent.includes("00:02"));
    assert.match(await page.locator(".cinematic__source").innerText(),/서울/);
    if(method==="Escape")await page.keyboard.press("Escape");
    else await page.mouse.click(640,360);
    await page.locator(".cinematic").waitFor({state:"detached"});
    await page.locator("#storyBtn").waitFor({state:"visible"});
    console.log("PASS intro launch / "+method+" / menu return");
  }
  await page.setViewportSize({width:390,height:844});
  await page.locator("#storyBtn").click();
  await page.locator(".sidepop__item").first().click();
  await page.locator(".cinematic").waitFor({state:"visible"});
  const bounds=await page.locator(".cinematic").boundingBox();
  assert.equal(bounds.width,390);
  assert.equal(bounds.y,0);
  assert.equal(bounds.height,844);
  await page.waitForFunction(()=>document.querySelector(".cinematic__subtitle")?.textContent.includes("평범한 동네"));
  const caption=await page.locator(".cinematic__subtitle").boundingBox();
  assert.ok(caption.y>=0 && caption.y+caption.height<=844, "caption stays inside the mobile viewport");
  assert.ok(caption.x>=0 && caption.x+caption.width<=390, "caption fits mobile width");
  await page.keyboard.press("Escape");
  await page.locator(".cinematic").waitFor({state:"detached"});
  assert.deepEqual(errors,[]);
  console.log("PASS mobile resize / repeated disposal / no browser errors");
}finally{await browser.close();}
