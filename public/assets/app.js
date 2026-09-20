const menuBtn=document.querySelector('[data-menu]');
const mobileMenu=document.querySelector('[data-mobile-menu]');
if(menuBtn&&mobileMenu){menuBtn.addEventListener('click',()=>mobileMenu.classList.toggle('open'));mobileMenu.querySelectorAll('a').forEach(a=>a.addEventListener('click',()=>mobileMenu.classList.remove('open')))}

const form=document.querySelector('#downloadForm');
const urlInput=document.querySelector('#reelUrl');
const pasteBtn=document.querySelector('#pasteBtn');
const statusEl=document.querySelector('#status');
const result=document.querySelector('#result');
const closeResult=document.querySelector('[data-result-close]');
const submitBtn=form?.querySelector('.go-button');

function prettyBytes(bytes){if(!bytes)return'';const u=['B','KB','MB','GB'];let i=0,n=bytes;while(n>=1024&&i<u.length-1){n/=1024;i++}return`${n.toFixed(n>=10||i===0?0:1)} ${u[i]}`}
function prettyTime(seconds){if(!seconds)return'';const m=Math.floor(seconds/60),s=Math.round(seconds%60);return`${m}:${String(s).padStart(2,'0')}`}
function setStatus(text,state=''){if(!statusEl)return;statusEl.textContent=text;statusEl.dataset.state=state}
function setBusy(busy){if(!submitBtn)return;submitBtn.disabled=busy;const span=submitBtn.querySelector('span');if(span)span.textContent=busy?'Checking…':'Analyze'}
function validReelUrl(v){try{const u=new URL(v);const host=u.hostname.replace(/^www\./,'').toLowerCase();return host==='instagram.com'&&/^\/(reel|reels)\/[A-Za-z0-9_-]+\/?/.test(u.pathname)}catch{return false}}

if(pasteBtn&&urlInput){pasteBtn.addEventListener('click',async()=>{try{const text=await navigator.clipboard.readText();urlInput.value=text.trim();urlInput.focus();setStatus(validReelUrl(urlInput.value)?'Link pasted. Tap Analyze.':'Clipboard pasted — make sure it is a public Instagram Reel URL.')}catch{setStatus('Clipboard access is blocked. Paste the Reel URL manually.','error')}})}
if(closeResult&&result)closeResult.addEventListener('click',()=>result.classList.remove('visible'));

if(form){form.addEventListener('submit',async e=>{
  e.preventDefault();
  const url=urlInput.value.trim();
  if(!validReelUrl(url)){setStatus('Please paste a valid instagram.com/reel/... link.','error');urlInput.focus();return}
  setBusy(true);setStatus('Connecting to Instagram and reading the public Reel…');result?.classList.remove('visible');
  try{
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),65000);
    const response=await fetch('/api/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url}),signal:controller.signal});
    clearTimeout(timer);
    let data={};try{data=await response.json()}catch{}
    if(!response.ok){const err=new Error(data.error||'Analysis failed.');err.code=data.code;err.detail=data.detail;throw err}
    const thumb=result.querySelector('[data-thumb]'),title=result.querySelector('[data-title]'),meta=result.querySelector('[data-meta]'),qualities=result.querySelector('[data-qualities]');
    thumb.src=data.thumbnail||'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="400" height="600"%3E%3Crect width="100%25" height="100%25" fill="%23ded6d2"/%3E%3C/svg%3E';
    title.textContent=data.title||'Instagram Reel';meta.textContent=[data.uploader,prettyTime(data.duration),data.method].filter(Boolean).join(' · ');qualities.innerHTML='';
    const formats=data.formats?.length?data.formats:[{formatId:'best',height:null,ext:'mp4'}];
    formats.forEach((f,index)=>{const a=document.createElement('a');const label=f.height?`${f.height}p`:(index===0?'Best MP4':'MP4');const size=prettyBytes(f.filesize);a.className='quality-btn';a.textContent=`${label}${size?` · ${size}`:''}`;a.href=`/api/download?url=${encodeURIComponent(url)}&format=${encodeURIComponent(f.formatId||'best')}`;a.rel='nofollow';qualities.appendChild(a)});
    result.classList.add('visible');setStatus('Reel ready — choose an available quality.','ok');
  }catch(err){
    if(err.name==='AbortError'){setStatus('Instagram took too long to respond. Try again once.','error')}
    else if(err.code==='UPSTREAM_BLOCKED'){setStatus('Instagram blocked this server request. The Reel may still be public; try again later or redeploy after the backend update.','error')}
    else setStatus(err.message||'Could not analyze this Reel.','error');
  }finally{setBusy(false)}
})}
