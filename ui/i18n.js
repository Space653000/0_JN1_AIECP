'use strict';

const DICTIONARIES=Object.freeze({
  en:Object.freeze({
    'workspace.choose':'Choose Workspace',
    'mode.beginner':'Beginner',
    'mode.engineering':'Engineering',
    'providers':'Providers',
    'local':'LOCAL',
    'computer':'Computer',
    'workspace':'Workspace',
    'workspace.chooseFolder':'Choose folder',
    'open':'Open',
    'terminal':'Terminal',
    'repositories':'Repositories',
    'localTools':'Local tools',
    'controlPlane':'CONTROL PLANE',
    'start':'Start',
    'harness':'Harness',
    'board':'Board',
    'taskBoard':'Task Board',
    'taskPipeline':'Task Pipeline',
    'workspaceGraph':'Workspace Graph',
    'executionTrace':'Execution Trace',
    'controlPlane.title':'Control Plane',
    'workspace.bound':'Bound',
    'workspace.notSet':'Not set',
    'pipeline':'Pipeline',
    'goalLoop':'Goal Loop',
    'graph':'Graph',
    'trace':'Trace',
    'evidence':'Evidence',
    'agents':'AI AGENTS',
    'supervisorWorkers':'Supervisor & Workers',
    'officialChatGPT':'Official ChatGPT',
    'openOfficialChatGPT':'Open official ChatGPT',
    'detectWindows':'Detect windows',
    'dockLeft':'Dock left',
    'dockRight':'Dock right',
    'agentSwitcher':'Agent Switcher',
    'backup':'Local Backup',
    'exportBackup':'Export backup',
    'restoreBackup':'Restore backup',
    'settings.providers':'Intelligence providers',
    'provider.add':'Add optional provider',
    'saveProvider':'Save provider',
    'cancel':'Cancel',
    'language.toggle':'中文'
  }),
  'zh-TW':Object.freeze({
    'workspace.choose':'選擇工作區',
    'mode.beginner':'新手模式',
    'mode.engineering':'工程模式',
    'providers':'模型供應商',
    'local':'本機',
    'computer':'電腦',
    'workspace':'工作區',
    'workspace.chooseFolder':'選擇資料夾',
    'open':'開啟',
    'terminal':'終端機',
    'repositories':'程式庫',
    'localTools':'本機工具',
    'controlPlane':'控制平面',
    'start':'開始',
    'harness':'Harness',
    'board':'看板',
    'taskBoard':'任務看板',
    'taskPipeline':'任務流程',
    'workspaceGraph':'工作區關聯圖',
    'executionTrace':'執行追蹤',
    'controlPlane.title':'控制平面',
    'workspace.bound':'已綁定',
    'workspace.notSet':'未設定',
    'pipeline':'流程',
    'goalLoop':'目標迴圈',
    'graph':'關聯圖',
    'trace':'追蹤',
    'evidence':'證據',
    'agents':'AI AGENT',
    'supervisorWorkers':'主管與施工 Agent',
    'officialChatGPT':'官方 ChatGPT',
    'openOfficialChatGPT':'開啟官方 ChatGPT',
    'detectWindows':'偵測視窗',
    'dockLeft':'靠左排列',
    'dockRight':'靠右排列',
    'agentSwitcher':'Agent 切換',
    'backup':'本機備份',
    'exportBackup':'匯出備份',
    'restoreBackup':'還原備份',
    'settings.providers':'智慧模型供應商',
    'provider.add':'新增選用 Provider',
    'saveProvider':'儲存 Provider',
    'cancel':'取消',
    'language.toggle':'EN'
  })
});

function normalizeLocale(value){
  const raw=String(value||'').trim().toLowerCase();
  return raw.startsWith('zh')?'zh-TW':'en';
}

function createI18n({initialLocale,storage}={}){
  let locale=normalizeLocale(initialLocale||storage?.getItem?.('aecp-locale')||'en');
  const t=(key,fallback='')=>(DICTIONARIES[locale]?.[key] ?? DICTIONARIES.en[key] ?? fallback) || key;
  const apply=(root)=>{
    if(typeof document!=='undefined') document.documentElement.lang=locale;
    const scope=root||((typeof document!=='undefined')?document:null);
    if(!scope?.querySelectorAll)return locale;
    for(const node of scope.querySelectorAll('[data-i18n]')) node.textContent=t(node.dataset.i18n,node.textContent);
    for(const node of scope.querySelectorAll('[data-i18n-placeholder]')) node.setAttribute('placeholder',t(node.dataset.i18nPlaceholder,node.getAttribute('placeholder')||''));
    for(const node of scope.querySelectorAll('[data-i18n-aria]')) node.setAttribute('aria-label',t(node.dataset.i18nAria,node.getAttribute('aria-label')||''));
    return locale;
  };
  const setLocale=(value,root)=>{
    locale=normalizeLocale(value);
    storage?.setItem?.('aecp-locale',locale);
    apply(root);
    return locale;
  };
  return Object.freeze({t,apply,setLocale,getLocale:()=>locale,supported:Object.freeze(['en','zh-TW'])});
}

const api=createI18n({
  initialLocale:typeof navigator!=='undefined'?navigator.language:'en',
  storage:typeof localStorage!=='undefined'?localStorage:null
});

if(typeof window!=='undefined')window.AECPI18N=api;
if(typeof module!=='undefined'&&module.exports)module.exports={DICTIONARIES,normalizeLocale,createI18n};
