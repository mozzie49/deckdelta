import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { mkdir, writeFile } from 'node:fs/promises';
const C={navy:rgb(.07,.11,.20),muted:rgb(.39,.44,.50),lime:rgb(.81,.96,.43),paper:rgb(.96,.97,.94),blue:rgb(.29,.44,.9)};
async function make(version){
 const pdf=await PDFDocument.create(); const font=await pdf.embedFont(StandardFonts.Helvetica);const bold=await pdf.embedFont(StandardFonts.HelveticaBold);
 pdf.setTitle(`Aster Studio | ${version==='before'?'Original':'Revised'} fictional launch deck`);pdf.setAuthor('DeckDelta fictional sample');
 function slide(title,eyebrow='ASTER / STUDIO LAUNCH') {const p=pdf.addPage([960,540]);p.drawRectangle({x:0,y:0,width:960,height:540,color:C.paper});p.drawText(eyebrow,{x:60,y:480,size:12,font:bold,color:C.muted});p.drawText(title,{x:60,y:407,size:38,font:bold,color:C.navy});p.drawRectangle({x:60,y:383,width:52,height:5,color:C.lime});p.drawText('Original fictional sample. No real company or financial claims.',{x:60,y:28,size:10,font,color:C.muted});return p;}
 function text(p,s,x,y,size=22,color=C.navy){p.drawText(s,{x,y,size,font,color});}
 function cover(){const p=slide('A calmer place to make things.');text(p,'Aster Studio',60,300,50);text(p,'A workspace for independent creative teams.',60,242,24);text(p,version==='before'?'Launch / October 15, 2026':'Launch / October 29, 2026',60,155,18);p.drawCircle({x:802,y:236,size:95,color:C.lime});p.drawCircle({x:835,y:266,size:36,color:C.navy});}
 function roadmap(){const p=slide('Three milestones. One launch.');['01   Private beta - completed','02   Team spaces - in progress','03   Public release - next'].forEach((s,i)=>text(p,s,60,305-i*64,26));}
 function pricing(){const p=slide('One plan, room to grow.');text(p,version==='before'?'$39':'$49',60,264,86);text(p,'per workspace / month',60,217,22);text(p,'Unlimited projects. Five collaborators. No hidden add-ons.',60,145,22);}
 function adoption(){const p=slide('Small teams are finding their flow.');text(p,'Weekly active workspaces / illustrative data',60,345,18);const vals=version==='before'?[70,110,155,205]:[70,110,185,240];vals.forEach((v,i)=>{p.drawRectangle({x:100+i*183,y:103,width:106,height:v,color:i===3?C.blue:C.lime});text(p,['Week 1','Week 2','Week 3','Week 4'][i],112+i*183,73,15);});}
 function security(){const p=slide('Privacy belongs in the foundation.');['Export your work whenever you need it.','Project visibility is explicit.','Simple settings, clear ownership.'].forEach((s,i)=>text(p,s,60,304-i*65,25));}
 function retired(){const p=slide('Research questions for the pilot.');text(p,'Which rituals help a distributed team stay aligned?',60,288,25);text(p,'What gets lost between the draft and the decision?',60,224,25);}
 function next(){const p=slide('Next: make space for good work.');text(p,'Invite a team. Start one project. Share a first draft.',60,280,26);text(p,'A smaller toolchain. A clearer next step.',60,207,22);}
 function added(){const p=slide('A new launch checklist.');['Invite beta teams','Publish the migration guide','Open the community feedback board'].forEach((s,i)=>text(p,s,60,303-i*61,25));}
 function close(){const p=slide('Good work starts with a little space.');text(p,'Thank you.',60,264,54);text(p,'ASTER STUDIO / FICTIONAL DEMO',60,178,18);}
 function duplicate(){const p=slide('Workshop notes','ASTER / APPENDIX');text(p,'Use this slide to capture feedback from the team.',60,260,24);text(p,'This intentionally duplicated page needs a human match check.',60,194,18);}
 const order=version==='before'?[cover,roadmap,pricing,adoption,security,retired,next,close,duplicate,duplicate]:[cover,adoption,pricing,security,roadmap,next,added,close,duplicate,duplicate];order.forEach(f=>f());
 return pdf.save();
}
await mkdir('public/samples',{recursive:true});for(const v of ['before','after'])await writeFile(`public/samples/aster-${v}.pdf`,await make(v));
console.log('Wrote two original fictional 10-page PDF sample decks.');
