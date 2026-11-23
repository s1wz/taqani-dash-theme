/* TAQANI phase 1. No device commands, credentials or customer data. */
export const VERSION = '0.1.0';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function areaOrder(area, labels) {
  for (const id of area.labels || []) {
    const match = labels.find(l => l.label_id === id)?.name.match(/^ترتيب:\s*(\d+)$/u);
    if (match) return Number(match[1]);
  }
  return Number.MAX_SAFE_INTEGER;
}
export function groupsFromRegistry(floors, areas, labels = []) {
  const sort = (a,b) => areaOrder(a,labels)-areaOrder(b,labels) || a.name.localeCompare(b.name,'ar');
  const groups = [...floors].sort((a,b)=>(a.level??0)-(b.level??0)||a.name.localeCompare(b.name,'ar'))
    .map(f => ({id:f.floor_id,name:f.name,areas:areas.filter(a=>a.floor_id===f.floor_id).sort(sort)}));
  const loose=areas.filter(a=>!floors.some(f=>f.floor_id===a.floor_id)).sort(sort);
  if(loose.length) groups.push({id:'unassigned',name:'مساحات لم تُسند إلى دور',areas:loose});
  return groups;
}
const SERVICES=[['cameras','المراقبة','mdi:cctv'],['entry','الدخول الذكي','mdi:doorbell-video'],['lights','الإضاءة','mdi:lightbulb-group'],['climate','التكييف','mdi:air-conditioner']];
const PLACEHOLDERS=['المساحات الخارجية','الدور الأرضي','الدور الأول — المعيشة','دور الملحق'];
class TaqaniShell extends HTMLElement {
  constructor(){super();this.attachShadow({mode:'open'});this.page='home';this.registry=null;this.unsubs=[];this.boundRoute=()=>this.readRoute();}
  setConfig(config){this.config=config;this.render();}
  set hass(hass){this._hass=hass;if(this.isConnected&&!this.loading&&!this.registry)this.load();}
  connectedCallback(){window.addEventListener('popstate',this.boundRoute);window.addEventListener('hashchange',this.boundRoute);this.readRoute();if(this._hass)this.load();}
  disconnectedCallback(){window.removeEventListener('popstate',this.boundRoute);window.removeEventListener('hashchange',this.boundRoute);this.unsubs.splice(0).forEach(fn=>fn());}
  getCardSize(){return 12;}
  readRoute(){try{this.page=decodeURIComponent(location.hash.slice(1)||'home');}catch{this.page='home';}this.render();}
  navigate(page){history.pushState(null,'','#'+encodeURIComponent(page));this.page=page;this.render();this.scrollIntoView({block:'start'});}
  async load(){
    if(this.loading)return;this.loading=true;
    try {
      const [floors,areas,labels]=await Promise.all(['floor','area','label'].map(kind=>this._hass.callWS({type:`config/${kind}_registry/list`})));
      if(!this.isConnected)return;
      this.registry={floors,areas,labels};this.error=null;
      if(!this.unsubs.length)for(const kind of ['floor','area','label']){
        const unsub=await this._hass.connection.subscribeEvents(()=>this.load(),`${kind}_registry_updated`);
        if(this.isConnected)this.unsubs.push(unsub);else unsub();
      }
    }catch(error){this.error='تعذر تحميل المساحات. أعد المحاولة.';}
    finally{this.loading=false;this.render();}
  }
  tile(title,subtitle='غير مهيأ',icon='mdi:circle-outline',page=null){return `<button ${page?'data-page="'+esc(page)+'"':'disabled'} class="tile"><ha-icon icon="${esc(icon)}"></ha-icon><strong>${esc(title)}</strong><small>${esc(subtitle)}</small></button>`;}
  notice(text){return `<p class="notice">${esc(text)}</p>`;}
  section(title,body){return `<section><h2>${esc(title)}</h2>${body}</section>`;}
  home(){
    let out=this.section('الوصول السريع',`<div class="grid two">${this.tile('تشغيل الكل','غير مهيأ حتى ربط الأجهزة','mdi:power')}${this.tile('إيقاف الكل','غير مهيأ حتى ربط الأجهزة','mdi:power-off')}</div>`);
    out+=this.section('خدمات المنزل',`<div class="grid">${SERVICES.map(([id,name,icon])=>this.tile(name,'عرض التفاصيل',icon,id)).join('')}</div>`);
    out+=this.section('ملخص المنزل',`<div class="grid summaries">${['الإنارات العاملة','المكيفات العاملة','حرارة الداخل','حرارة الخارج'].map(n=>`<article><span>${n}</span><strong>غير مربوط</strong></article>`).join('')}</div>`);
    out+=this.section('اختصاراتك اليومية',`<div class="grid">${['وصلت البيت','الضيوف','النوم','إغلاق الكل','فتح الستائر','إغلاق الستائر'].map(n=>this.tile(n)).join('')}</div>`);
    if(this.error)out+=this.notice(this.error)+'<button data-reload>إعادة تحميل المساحات</button>';
    else if(!this.registry)out+=this.notice('جارٍ تحميل المساحات…');
    else {
      const groups=groupsFromRegistry(this.registry.floors,this.registry.areas,this.registry.labels);
      if(!groups.length)out+=PLACEHOLDERS.map(n=>this.section(n,this.notice('لا توجد مساحات مضافة. تُخصص الأدوار والمساحات من الإدارة.'))).join('');
      else out+=groups.map(g=>this.section(g.name,g.areas.length?`<div class="grid">${g.areas.map(a=>this.tile(a.name,'فتح المساحة',a.icon||'mdi:floor-plan','area:'+a.area_id)).join('')}</div>`:this.notice('لا توجد مساحات مضافة لهذا الدور.'))).join('');
    }
    if(this._hass?.user?.is_admin)out+=this.section('الإدارة',this.tile('إدارة المنزل','أدوات Home Assistant','mdi:cog','admin'));
    return out;
  }
  detail(){
    const service=SERVICES.find(s=>s[0]===this.page);
    if(service)return this.section(service[1],this.notice({cameras:'كاميرات المراقبة المنزلية غير مربوطة. لا تُستخدم كاميرات الشاشات هنا.',entry:'الدخول الذكي غير مربوط. لا يوجد أمر فتح باب مهيأ.',lights:'لم تُعتمد أجهزة الإنارة بعد.',climate:'لم تُعتمد أجهزة التكييف بعد.'}[this.page]));
    if(this.page==='admin'){
      if(!this._hass?.user?.is_admin)return this.notice('هذه الأدوات مخصصة لحساب الإدارة.');
      return this.section('إدارة المنزل',`<div class="admin"><a href="/config/areas/dashboard">الأدوار والمساحات والتسميات</a><a href="/config/devices/dashboard">الأجهزة والتكاملات</a></div>`+this.notice('الأسماء وتبعية الأدوار من سجلات Home Assistant. لترتيب المساحات أضف لها تسمية مثل «ترتيب: 10». تظهر التغييرات تلقائيًا. صلاحيات الإدارة يفرضها Home Assistant؛ إخفاء هذا المدخل ليس حاجز أمان.')+this.notice('واجهة إدارة تقني المخصصة وربط أدوار الأجهزة مؤجلان لمرحلة لاحقة.'));
    }
    const area=this.registry?.areas.find(a=>'area:'+a.area_id===this.page);
    if(!area)return this.notice('المساحة غير موجودة أو لم يكتمل تحميلها.');
    return this.section(area.name,`<div class="grid two">${this.tile('تشغيل الكل','غير مهيأ لهذه المساحة','mdi:power')}${this.tile('إيقاف الكل','غير مهيأ لهذه المساحة','mdi:power-off')}</div>`)+this.section('أجهزة المساحة',this.notice('لم تُعتمد أجهزة لهذه المساحة بعد.'))+this.section('سيناريوهات المساحة',this.notice('لا توجد سيناريوهات مهيأة.'));
  }
  render(){
    if(!this.shadowRoot)return;
    this.shadowRoot.innerHTML=`<style>
    :host{display:block;direction:rtl;color:#ecf1fc;font-family:var(--paper-font-body1_-_font-family,system-ui);background:#101a2c;border-radius:24px;min-height:95vh}*{box-sizing:border-box}.shell{max-width:1200px;margin:auto;padding:28px;background:radial-gradient(ellipse at top right,#26345b70,transparent 55%)}header{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:10px 0 24px;border-bottom:1px solid #ffffff18}.brand{font-size:32px;font-weight:750;letter-spacing:1px}.tag{color:#afbed5;margin-top:6px;font-size:15px}nav{display:flex;gap:10px;flex-wrap:wrap}button,a{font:inherit;border:1px solid #c3d5ff30;border-radius:18px;background:#263650;color:inherit;min-height:52px;padding:12px 20px;cursor:pointer;text-decoration:none}button:focus-visible,a:focus-visible{outline:3px solid #80d8ff;outline-offset:3px}section{margin:30px 0}h2{font-size:20px;font-weight:600;margin:0 0 16px}.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}.two{grid-template-columns:repeat(2,minmax(0,1fr))}.tile{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;min-height:132px;background:linear-gradient(145deg,#33446b99,#1b283f);text-align:center}.tile strong{font-size:18px}.tile small{font-size:14px;color:#b6c4da}.tile ha-icon{--mdc-icon-size:32px;color:#b9cef4}.tile:disabled{cursor:default;border-style:dashed;background:#1b273a;color:#d0d7e5}.summaries article{padding:20px;background:#1c2a41;border-radius:18px;display:flex;flex-direction:column;gap:16px}.summaries strong{color:#b5c4d8;font-size:17px}.notice{background:#1c293e;padding:20px;border-radius:16px;line-height:1.9;color:#bfcbe0}.admin{display:flex;gap:12px;flex-wrap:wrap}.admin a{display:flex;align-items:center}@media(max-width:700px){.shell{padding:18px}.grid{grid-template-columns:repeat(2,minmax(0,1fr))}header{align-items:flex-start;flex-wrap:wrap}.brand{font-size:28px}.tile{min-height:120px}}@media(prefers-reduced-motion:no-preference){button:not(:disabled):hover{background:#3a4e76}}
    </style><main class="shell" dir="rtl"><header><div><div class="brand">الذكاء التقني</div><div class="tag">منزلك، ببساطة</div></div>${this.page==='home'?'':`<nav><button data-page="home">الرئيسية</button><button data-back>رجوع</button></nav>`}</header>${this.page==='home'?this.home():this.detail()}</main>`;
    this.shadowRoot.querySelectorAll('[data-page]').forEach(b=>b.onclick=()=>this.navigate(b.dataset.page));
    const back=this.shadowRoot.querySelector('[data-back]');if(back)back.onclick=()=>this.navigate('home');
    const reload=this.shadowRoot.querySelector('[data-reload]');if(reload)reload.onclick=()=>this.load();
  }
}
if(!customElements.get('taqani-shell'))customElements.define('taqani-shell',TaqaniShell);
if (typeof window !== 'undefined') {
  window.customCards = window.customCards || [];
  if (!window.customCards.some(card => card.type === 'taqani-shell')) {
    window.customCards.push({type:'taqani-shell',name:'الذكاء التقني',description:'واجهة تقني — المساحات من سجلات Home Assistant',preview:false});
  }
}
