'use strict';

const SECRET_KEY=/^(?:api[_-]?key|password|secret|access[_-]?token|refresh[_-]?token|authorization|bearer|private[_-]?key|client[_-]?secret|token)$/i;

function redactText(value,secrets=[]){
  let text=String(value??'');
  for(const secret of secrets){
    const s=String(secret||'');
    if(s.length>=6) text=text.split(s).join('[REDACTED]');
  }
  text=text.replace(/-----BEGIN ([A-Z0-9 ]*PRIVATE KEY)-----[\s\S]*?-----END \1-----/g,'[REDACTED PRIVATE KEY]');
  text=text.replace(/\bBearer\s+[A-Za-z0-9._~+\/-]{8,}={0,2}\b/gi,'Bearer [REDACTED]');
  text=text.replace(/\b(?:sk-[A-Za-z0-9_-]{8,}|github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/g,'[REDACTED]');
  text=text.replace(/\b(api[_-]?key|password|secret|access[_-]?token|refresh[_-]?token|client[_-]?secret)\s*([:=])\s*["']?([^\s"',;]{6,})["']?/gi,(_m,key,sep)=>`${key}${sep}[REDACTED]`);
  text=text.replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi,'$1[REDACTED]@');
  return text;
}

function redactSensitive(value,{secrets=[]}={},seen=new WeakSet()){
  if(value==null||typeof value==='number'||typeof value==='boolean') return value;
  if(typeof value==='string') return redactText(value,secrets);
  if(typeof value==='bigint') return String(value);
  if(Buffer.isBuffer(value)) return `[BINARY ${value.length} bytes]`;
  if(value instanceof Date) return value.toISOString();
  if(value instanceof Error) return {name:redactText(value.name,secrets),message:redactText(value.message,secrets),code:value.code||null};
  if(typeof value!=='object') return String(value);
  if(seen.has(value)) return '[CIRCULAR]';
  seen.add(value);
  if(Array.isArray(value)){
    const out=value.map(item=>redactSensitive(item,{secrets},seen));
    seen.delete(value);
    return out;
  }
  const out={};
  for(const [key,item] of Object.entries(value)){
    if(SECRET_KEY.test(key) && typeof item==='string' && item.length){
      out[key]='[REDACTED]';
    }else{
      out[key]=redactSensitive(item,{secrets},seen);
    }
  }
  seen.delete(value);
  return out;
}

module.exports={SECRET_KEY,redactText,redactSensitive};
