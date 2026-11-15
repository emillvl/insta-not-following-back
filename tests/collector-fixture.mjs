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
  const following=size===0?[]:[...(options.followingEnd||options.mixedLinks||options.splitAccountLabels||options.reconcile ? followers.slice(0,113) : mutual),'missing'];
  const reconcileList=options.reconcileList||'following';
  const omitted=(reconcileList==='following'?following:followers).slice(20,options.reconcile==='inactive'?21:23);
  if(options.reconcile==='targeted')followers.unshift('fan_only','deactivated_name');
  window.__clicks=[];window.__scrolls=0;window.__alerts=[];window.__progress=[];window.__added=0;
  window.__actions=[];window.__waits=[];window.__followingEndVisits=0;window.__comparisonCreated=false;
  window.__retryAt=0;
  window.__searches=[];
  let limitedListOpens=0;
  new MutationObserver(records=>{
    for(const record of records)for(const node of record.addedNodes){
      if(node.nodeType===1&&node.querySelector('#closeF4FBox'))window.__comparisonCreated=true;
    }
  }).observe(document.body,{childList:true,subtree:true});
  const nativeTimeout=window.setTimeout;
  window.setTimeout=(fn,ms,...args)=>{__waits.push(ms);return nativeTimeout(fn,ms,...args)};
  window.alert=text=>__alerts.push(text);
  const controls=[...document.querySelectorAll('[data-list]')];
  for(const control of controls){
    const type=control.dataset.list,names=type==='following'?following:followers;
    control.textContent=(type==='followers'&&options.rounded?'1K':names.length)+' '+type;
    if(type==='followers'&&options.smallerTotal)control.textContent=(names.length-(typeof options.smallerTotal==='number'?options.smallerTotal:1))+' '+type;
    if(type==='followers'&&options.exactTitle)control.title=String(names.length);
    if(options.hiddenControls){
      const hidden=control.cloneNode(false);
      hidden.hidden=true;hidden.textContent='2 '+type;control.before(hidden);
      const stale=document.createElement('span');
      stale.style.display='none';stale.textContent='2';control.append(stale);
    }
    control.onclick=event=>{
      event.preventDefault();__clicks.push('open:'+type);__actions.push({type:'open',list:type,at:Date.now()});
      if(options.listRoute)history.replaceState(null,'',control.href);
      const limitingList=options.cooldownOnOpen&&type===(options.limitedList||'following');
      const limitedOpening=limitingList&&++limitedListOpens===1;
      if(limitedOpening){
        __retryAt=Date.now()+options.cooldownOnOpen;
        if(!options.emptyShell) return;
      }
      let dialog=document.createElement('div');dialog.setAttribute('role','dialog');
      let host=document.body;
      if(options.replaceWrapper){host=document.createElement('section');document.body.append(host);}
      window.__listOpenedAt=Date.now();
      const close=document.createElement('button');close.setAttribute('aria-label','Close');
      close.onclick=()=>{__clicks.push('close:'+type);__actions.push({type:'close',list:type,at:Date.now()});
        if(options.hideDialog)dialog.hidden=true;else dialog.remove();
        if(options.listRoute)history.replaceState(null,'','/me/');
        if(type==='followers'&&options.changedCount)control.textContent=(names.length+1)+' followers';};
      if(limitedOpening||(limitingList&&options.staysEmpty)){
        if(options.busyShell)dialog.setAttribute('aria-busy','true');
        dialog.append(close);host.append(dialog);return;
      }
      let list=document.createElement(options.semanticScroller&&type==='followers'?'section':'div');list.className='scroller';
      list.style.cssText='position:relative;height:'+(options.viewport??320)+'px;overflow-y:auto';
      if(options.hiddenScroller&&type==='followers')list.style.overflowY='hidden';
      const inner=options.nestedScroller&&type==='followers'?document.createElement('div'):null;
      if(inner){inner.style.overflowY='auto';list.append(inner);}
      const makeRow=name=>{const row=document.createElement('a');row.setAttribute('role','link');
        row.href='/'+name+'/';row.textContent=name;row.style.cssText='display:block;height:20px';
        if(options.mixedLinks&&type==='following'){
          if(name===names.at(-2))row.href='https://www.instagram.com/'+name+'/?source=fixture';
          if(name===names.at(-1))row.removeAttribute('role');
        }
        if(options.splitAccountLabels&&type==='following'&&names.slice(-6).includes(name)){
          row.removeAttribute('role');
          row.innerHTML='<span>@'+name+'</span><span>Display name</span>';
        }
        return row;};
      const relationshipRow=(name,label)=>{
        const row=document.createElement('div'),button=document.createElement('button');
        button.textContent=label;row.append(makeRow(name),button);return row;
      };
      const followerLabels=options.reconcile==='targeted'?
        {fan_only:'Follow Back',deactivated_name:'Deactivated account',[omitted[0]]:'Following'}:{};
      const append=(node,values)=>{
        const target=inner&&node===list?inner:node;
        for(const name of values){
          let label=type==='followers'&&(followerLabels[name]||
            (options.reconcile==='reverse'&&omitted.includes(name)?'Following':''));
          if(options.reconcile==='inactive'&&type!==reconcileList){
            if(omitted.includes(name)||(type==='following'&&name==='missing'))label='Deactivated';
            else if(type==='followers'&&name===followers.at(-1))label='Follow Back';
          }
          target.append(label?relationshipRow(name,label):makeRow(name));
        }
      };
      if(type===reconcileList&&options.reconcile){
        const shown=names.filter(name=>!omitted.includes(name));
        append(list,[...shown,...shown.slice(0,omitted.length).map(name=>options.caseVariants?name.toUpperCase():name)]);
        if(options.reconcile!=='reverse'){
          const search=document.createElement('input');search.type='search';dialog.append(search);
          search.addEventListener('input',()=>{
            const value=search.value;__searches.push({list:type,value,at:Date.now()});
            const positive=names.includes(value)&&!(options.reconcile==='invalid'&&value===omitted[1]);
            const label=type==='following'?'Following':'Remove';
            const render=()=>{
              dialog.removeAttribute('aria-busy');
              list.replaceChildren(relationshipRow(value,positive?label:'Follow'),relationshipRow('unrelated',label));
            };
            if(options.searchDelay){
              dialog.setAttribute('aria-busy','true');
              setTimeout(render,options.searchDelay);
            }else render();
          });
        }
      }else if(type==='following'&&options.followingEnd){
        let loaded=['deepReenter','rapidRecycle'].includes(options.followingEnd)?108:111;
        let leftPreloadZone=false;
        append(list,names.slice(0,loaded));
        const lastRow=list.lastElementChild;
        if(options.followingEnd==='rapidRecycle')lastRow.removeAttribute('role');
        const spacer=document.createElement('div');
        if(options.followingEnd==='spacer'){spacer.style.height='740px';list.append(spacer);}
        if(options.followingEnd==='footerLoader'){
          spacer.setAttribute('role','progressbar');spacer.style.height='8px';list.append(spacer);
        }
        const scrollProperty=Object.getOwnPropertyDescriptor(Element.prototype,'scrollTop');
        const addRows=(end=names.length)=>{append(list,names.slice(loaded,end));loaded=end;};
        Object.defineProperty(list,'scrollTop',{get(){return scrollProperty.get.call(this)},set(value){
          const before=scrollProperty.get.call(this);
          const wasAtEnd=before+this.clientHeight>=this.scrollHeight-2;
          scrollProperty.set.call(this,value);
          if(this.scrollTop===before)return;
          if(__followingEndVisits&&this.scrollTop===0)leftPreloadZone=true;
          __scrolls++;__actions.push({type:'scroll',list:type,at:Date.now()});
          const reachedEnd=this.scrollTop+this.clientHeight>=this.scrollHeight-2;
          if(loaded<names.length&&reachedEnd&&!wasAtEnd){
            __followingEndVisits++;
            if(options.followingEnd==='reenter'&&__followingEndVisits===2)addRows();
            if(options.followingEnd==='deepReenter'&&leftPreloadZone)addRows();
            if(options.followingEnd==='rapidRecycle'){
              for(const name of names.slice(loaded)){
                lastRow.href='/'+name+'/';lastRow.textContent=name;
              }
              loaded=names.length;
            }
            if(options.followingEnd==='multiple'&&__followingEndVisits%2===0)addRows(loaded+1);
            if(['spacer','footerLoader'].includes(options.followingEnd)){spacer.remove();addRows();}
            if(options.followingEnd==='limited'){
              if(__followingEndVisits===1) __retryAt=Date.now()+options.cooldown;
              else if(Date.now()>=__retryAt) addRows();
            }
            if(options.followingEnd==='pending'&&__followingEndVisits===1){
              const spinner=document.createElement('div');spinner.setAttribute('role','progressbar');
              spinner.style.height='8px';dialog.append(spinner);
              setTimeout(()=>{spinner.remove();addRows();},options.followingDelay??24000);
            }
          }
        }});
      }
      else if(type==='following'||mode==='all'){
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
      if(options.outsideLinks&&type==='following'){
        const post=makeRow('post'),hidden=makeRow('hidden_account');
        post.href='/p/fixture_photo/';hidden.hidden=true;
        list.append(post,hidden);
        setTimeout(()=>dialog.append(makeRow('suggested_account')),5500);
      }
      if(options.lateScrollArea&&type==='followers'){
        const shell=document.createElement('div');shell.style.cssText='height:140px;overflow-y:auto';
        list.replaceWith(shell);
        setTimeout(()=>dialog.append(list),7000);
      }
      if(options.openingPlaceholder&&type==='followers'){
        const placeholder=document.createElement('div');placeholder.setAttribute('role','dialog');
        const spinner=document.createElement('div');spinner.setAttribute('role','progressbar');
        spinner.style.height='8px';placeholder.append(spinner);host.append(placeholder);
        setTimeout(()=>{placeholder.remove();setTimeout(()=>host.append(dialog),options.replacementGap??0)},100);
      }else host.append(dialog);
      if(options.competingDialog){
        dialog.setAttribute('aria-label',type);
        const other=document.createElement('section');other.setAttribute('role','dialog');
        other.setAttribute('aria-label',type==='following'?'Followers':'Following');
        other.append(makeRow('wrong_list_account'));host.insertBefore(other,dialog);
        const closeList=close.onclick;close.onclick=()=>{closeList();other.remove();};
      }
      if(options.replaceDialog&&type==='followers')for(let i=0;i<(options.replaceTimes??1);i++)setTimeout(replaceDialog,(options.replaceAfter??100)+i*(options.replacementInterval??400));
      if(options.closeDuringLoad&&type==='followers')setTimeout(()=>dialog.remove(),500);
    };
  }
  window.F4FBridge={claimed:true,running:true,
    get retryAt(){return __retryAt;},
    progress:(list,collected,expected)=>__progress.push({list,collected,expected}),
    finish:(box,validation)=>{window.__done={heading:box.querySelector('h3').textContent,
      summary:box.querySelector('div').textContent.trim(),accounts:[...box.querySelectorAll('li a')].map(a=>a.textContent),validation};F4FBridge.running=false;},
    fail:error=>{window.__failed={message:error.message,reason:error.reason};F4FBridge.running=false;}
  };
  </script></body></html>`;
}
