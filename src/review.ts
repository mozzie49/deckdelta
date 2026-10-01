import {comparePair, type ComparisonRow} from './compare';
import type {LoadedDeck} from './pdf';
export const rowKey=(row:ComparisonRow)=>row.before?`before-${row.before.pageNumber}`:`after-${row.after!.pageNumber}`;
export function remapRows(rows:ComparisonRow[], before:LoadedDeck, after:LoadedDeck, beforePage:number, afterPage:number):ComparisonRow[] {
  const mapping=new Map<number,number>();
  rows.forEach(r=>{if(r.before && r.after) mapping.set(r.before.pageNumber,r.after.pageNumber);});
  const oldAfter=mapping.get(beforePage);
  const owner=[...mapping.entries()].find(([b,a])=>b!==beforePage && a===afterPage)?.[0];
  const touched=new Set([beforePage]);
  mapping.delete(beforePage);
  if(owner!==undefined) {mapping.delete(owner);touched.add(owner);if(oldAfter!==undefined)mapping.set(owner,oldAfter);}
  if(afterPage!==0)mapping.set(beforePage,afterPage);
  const used=new Set(mapping.values());
  const byAfter=new Map(after.pages.map(p=>[p.pageNumber,p]));
  const result=before.pages.map(p=>{
    const existing=rows.find(r=>r.before?.pageNumber===p.pageNumber);
    if(!touched.has(p.pageNumber)&&existing)return existing;
    return comparePair(p,byAfter.get(mapping.get(p.pageNumber)??0),{manual:true,uncertain:false});
  });
  after.pages.forEach(p=>{if(!used.has(p.pageNumber))result.push(comparePair(undefined,p,{manual:!!oldAfter && oldAfter===p.pageNumber}));});
  return result;
}
export function escapeHtml(value:unknown):string {return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));}

/** Preserve every note when a mapping changes; old-pair notes carry visible provenance. */
export function reconcileReviewState(previous:ComparisonRow[],next:ComparisonRow[],notes:Record<string,string>,reviewed:Set<string>,language:'en'|'zh'):{notes:Record<string,string>;reviewed:Set<string>} {
 const updated={...notes};
 const valid=new Set(next.map(rowKey));
 const checked=new Set([...reviewed].filter(key=>valid.has(key)));
 const context=(row:ComparisonRow)=>language==='zh'?`[先前配对的备注：修改前 ${row.before?.pageNumber??'—'} → 修改后 ${row.after?.pageNumber??'—'}。请根据新配对重新核对。]`:`[Note from previous pairing: Before ${row.before?.pageNumber??'—'} → After ${row.after?.pageNumber??'—'}. Recheck this note against the new pairing.]`;
 for(const row of next){const key=rowKey(row);const prior=previous.find(old=>rowKey(old)===key);if(prior?.after?.pageNumber!==row.after?.pageNumber){checked.delete(key);if(prior&&updated[key])updated[key]=context(prior)+'\n'+updated[key];}}
 // An added row disappears when its page acquires an original partner. Carry its note along.
 for(const prior of previous){const key=rowKey(prior);if(valid.has(key)||!updated[key])continue;const target=next.find(row=>prior.after&&row.after?.pageNumber===prior.after.pageNumber);if(target){const targetKey=rowKey(target);updated[targetKey]=[updated[targetKey],context(prior)+'\n'+updated[key]].filter(Boolean).join('\n\n');checked.delete(targetKey);delete updated[key];}}
 return {notes:updated,reviewed:checked};
}
