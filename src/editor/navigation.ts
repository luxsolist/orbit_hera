/** In-page confirmation: embedded browsers may suppress window.confirm(). */
export function confirmDiscard(message:string):Promise<boolean>{
 return new Promise(resolve=>{
  const dialog=document.createElement('dialog');dialog.className='discard-dialog';
  const text=document.createElement('p');text.textContent=message;
  const keep=document.createElement('button');keep.textContent='계속 편집';keep.type='button';
  const discard=document.createElement('button');discard.textContent='변경 버리고 이동';discard.type='button';
  const done=(answer:boolean)=>{dialog.close();dialog.remove();resolve(answer);};
  keep.onclick=()=>done(false);discard.onclick=()=>done(true);
  dialog.addEventListener('cancel',e=>{e.preventDefault();done(false);});
  dialog.append(text,keep,discard);document.body.append(dialog);dialog.showModal();keep.focus();
 });
}
export async function canNavigate(host:HTMLElement):Promise<boolean>{
 const pending:Promise<boolean>[]=[];
 const event=new CustomEvent('studio-before-navigate',{cancelable:true,detail:{pending}});
 if(!host.dispatchEvent(event))return false;
 return (await Promise.all(pending)).every(Boolean);
}
