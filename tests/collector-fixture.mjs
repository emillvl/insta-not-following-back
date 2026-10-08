export function collectorFixture(options = {}) {
  return `<!doctype html><html><head><meta charset="utf-8"></head><body>
  <main><a href="/accounts/edit/">Edit profile</a><a href="/me/following/" data-list="following"></a>
  <a href="/me/followers/" data-list="followers"></a></main>
  <script>
  const options=${JSON.stringify(options)};
  const size=options.size??1000,batch=options.batch??100,mode=options.mode||'cumulative';
  const followers=Array.from({length:size},(_,i)=>'account_'+String(i).padStart(5,'0'));
  const mutual=size>=200?[...followers.slice(0,97),followers[Math.floor(size/2)],followers[size-1]]:
    followers.slice(0,Math.min(99,size));
  const following=size===0?[]:[...mutual,'missing'];
  window.__clicks=[];window.__scrolls=0;window.__alerts=[];window.__progress=[];window.__added=0;
  window.__actions=[];window.__waits=[];
  const nativeTimeout=window.setTimeout;
  window.setTimeout=(fn,ms,...args)=>{__waits.push(ms);return nativeTimeout(fn,ms,...args)};
  window.alert=text=>__alerts.push(text);
  const controls=[...document.querySelectorAll('[data-list]')];
  for(const control of controls){
    const type=control.dataset.list,names=type==='following'?following:followers;
    control.textContent=(type==='followers'&&options.rounded?'1K':names.length)+' '+type;
    if(type==='followers'&&options.smallerTotal)control.textContent=(names.length-(typeof options.smallerTotal==='number'?options.smallerTotal:1))+' '+type;
    if(type==='followers'&&options.exactTitle)control.title=String(names.length);
    control.onclick=event=>{
      event.preventDefault();__clicks.push('open:'+type);__actions.push({type:'open',list:type,at:Date.now()});
      let dialog=document.createElement('div');dialog.setAttribute('role','dialog');
      let host=document.body;
      if(options.replaceWrapper){host=document.createElement('section');document.body.append(host);}
      window.__listOpenedAt=Date.now();
      const close=document.createElement('button');close.setAttribute('aria-label','Close');
      close.onclick=()=>{__clicks.push('close:'+type);__actions.push({type:'close',list:type,at:Date.now()});dialog.remove();
        if(type==='followers'&&options.changedCount)control.textContent=(names.length+1)+' followers';};
      let list=document.createElement('div');list.className='scroller';
      list.style.cssText='position:relative;height:'+(options.viewport??320)+'px;overflow-y:auto';
      const makeRow=name=>{const row=document.createElement('a');row.setAttribute('role','link');
        row.href='/'+name+'/';row.textContent=name;row.style.cssText='display:block;height:20px';return row;};
      const append=(node,values)=>{for(const name of values)node.append(makeRow(name));};
      if(type==='following'||mode==='all'){
        append(list,names);
        const scrollProperty=Object.getOwnPropertyDescriptor(Element.prototype,'scrollTop');
        Object.defineProperty(list,'scrollTop',{get(){return scrollProperty.get.call(this)},set(value){
          __scrolls++;__actions.push({type:'scroll',list:type,at:Date.now()});scrollProperty.set.call(this,value);
        }});
      }
      else if(mode==='virtual'||mode==='recycled'){
        const spacer=document.createElement('div');spacer.style.height=(names.length*20)+'px';
        const windowBox=document.createElement('div');windowBox.style.cssText='position:absolute;top:0;left:0';
        list.append(spacer,windowBox);
        const render=()=>{const start=Math.max(0,Math.floor(list.scrollTop/20)-4);
          const values=names.slice(start,start+24);windowBox.style.top=(start*20)+'px';
          if(mode==='recycled'&&windowBox.children.length===values.length){
            for(let i=0;i<values.length;i++){windowBox.children[i].href='/'+values[i]+'/';windowBox.children[i].textContent=values[i];}
          }else{windowBox.replaceChildren();append(windowBox,values);}
        };render();
        const scrollProperty=Object.getOwnPropertyDescriptor(Element.prototype,'scrollTop');
        let pending=false;
        Object.defineProperty(list,'scrollTop',{get(){return scrollProperty.get.call(this)},set(value){
          scrollProperty.set.call(this,value);__scrolls++;
          __actions.push({type:'scroll',list:type,at:Date.now()});
          if(options.replaceAtScroll===__scrolls)replaceDialog();
          if(options.renderDelay){if(!pending){pending=true;setTimeout(()=>{render();pending=false},options.renderDelay)}}
          else render();
        }});
      }else{
        let loaded=Math.min(batch,names.length),busy=false;
        append(list,names.slice(0,loaded));
        const onScroll=()=>{
          __scrolls++;
          __actions.push({type:'scroll',list:type,at:Date.now()});
          if(options.jumpClock){const original=Date.now;Date.now=()=>original()+21*60*1000;}
          if(busy||loaded>=names.length||list.scrollTop+list.clientHeight<list.scrollHeight-2)return;
          busy=true;const spinner=document.createElement('div');spinner.setAttribute('role','progressbar');
          spinner.style.height='8px';list.append(spinner);
          if(mode==='stall')return;
          setTimeout(()=>{
            const next=Math.min(loaded+batch,names.length);spinner.remove();
            if(mode==='replace-container'){
              const replacement=list.cloneNode(false);append(replacement,names.slice(0,next));
              append(replacement,names.slice(next));list.replaceWith(replacement);list=replacement;loaded=names.length;
            }else{append(list,names.slice(loaded,next));loaded=next;}
            __added++;busy=false;
          },options.delay??50);
        };
        const scrollProperty=Object.getOwnPropertyDescriptor(Element.prototype,'scrollTop');
        Object.defineProperty(list,'scrollTop',{get(){return scrollProperty.get.call(this)},set(value){
          scrollProperty.set.call(this,value);onScroll();
        }});
      }
      function replaceDialog(){
        const old=dialog;
        if(options.replaceWrapper)host.remove();else old.remove();
        setTimeout(()=>{
          if(options.replaceWrapper){host=document.createElement('section');document.body.append(host);}
          dialog=old.cloneNode(false);dialog.append(...old.childNodes);host.append(dialog);
        },options.replacementGap??0);
      }
      dialog.append(close,list);
      if(options.openingPlaceholder&&type==='followers'){
        const placeholder=document.createElement('div');placeholder.setAttribute('role','dialog');
        const spinner=document.createElement('div');spinner.setAttribute('role','progressbar');
        spinner.style.height='8px';placeholder.append(spinner);host.append(placeholder);
        setTimeout(()=>{placeholder.remove();setTimeout(()=>host.append(dialog),options.replacementGap??0)},100);
      }else host.append(dialog);
      if(options.replaceDialog&&type==='followers')for(let i=0;i<(options.replaceTimes??1);i++)setTimeout(replaceDialog,(options.replaceAfter??100)+i*(options.replacementInterval??400));
      if(options.closeDuringLoad&&type==='followers')setTimeout(()=>dialog.remove(),500);
    };
  }
  window.F4FBridge={claimed:true,running:true,
    progress:(list,collected,expected)=>__progress.push({list,collected,expected}),
    finish:(box,validation)=>{window.__done={heading:box.querySelector('h3').textContent,
      summary:box.querySelector('div').textContent.trim(),accounts:[...box.querySelectorAll('li a')].map(a=>a.textContent),validation};F4FBridge.running=false;},
    fail:error=>{window.__failed={message:error.message,reason:error.reason};F4FBridge.running=false;}
  };
  </script></body></html>`;
}
