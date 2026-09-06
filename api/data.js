/* อ่าน/เขียนข้อมูลกลางบน Supabase
   GET  /api/data          -> ข้อมูลทั้งหมด
   POST /api/data {ops}    -> บันทึกเฉพาะรายการที่เปลี่ยน (แต่ละรายการเป็นคนละแถว จึงไม่ทับกัน)
   POST /api/data {seed}   -> ใส่ข้อมูลตั้งต้นครั้งแรก (ทำได้เฉพาะตอนฐานข้อมูลยังว่าง) */
import { COLLS, T_ITEMS, T_META, T_LOG, sbSelect, sbUpsert, sbInsert, sbDelete, inList,
         guard, json, readBody } from "./_lib.js";

const MAXOPS = 2000, CHUNK = 300;
const chunk = (a,n)=>{ const out=[]; for(let i=0;i<a.length;i+=n) out.push(a.slice(i,i+n)); return out; };

export default async function handler(req, res){
  if(!guard(req,res)) return;
  try{
    if(req.method==="GET")  return await getAll(res);
    if(req.method==="POST") return await write(req,res);
    return json(res, 405, {error:"ไม่รองรับวิธีเรียกนี้"});
  }catch(e){
    return json(res, 500, {error: e.message || "เกิดข้อผิดพลาดที่เซิร์ฟเวอร์"});
  }
}

async function getAll(res){
  /* ดึงทีละหน้า เผื่อรายการเกินขีดจำกัดของ PostgREST */
  const items = [];
  for(let page=0; page<50; page++){
    const rows = await sbSelect(T_ITEMS+"?select=coll,id,doc&order=coll.asc,id.asc"+
      "&offset="+(page*1000)+"&limit=1000");
    items.push(...rows);
    if(rows.length < 1000) break;
  }
  const data = {};
  COLLS.forEach(c=> data[c] = []);
  items.forEach(r=>{ if(data[r.coll] && r.doc && typeof r.doc==="object") data[r.coll].push(r.doc); });

  const meta = await sbSelect(T_META+"?k=eq.config&select=v");
  const config = (meta[0] && meta[0].v) || {};
  const logRows = await sbSelect(T_LOG+"?select=at,by,what&order=at.desc&limit=5");
  const log = logRows.map(l=>({ t: Date.parse(l.at)||Date.now(), by:l.by, what:l.what }));

  return json(res, 200, { data, config, log, empty: items.length===0, serverTime: Date.now() });
}

const logLine = (by, what)=> sbInsert(T_LOG, [{by:String(by).slice(0,60), what:String(what).slice(0,200)}]);

async function write(req,res){
  let body; try{ body = await readBody(req); }catch(e){ return json(res,400,{error:e.message}); }
  const by = String(body.by||"ไม่ระบุชื่อ").slice(0,60);
  const now = new Date().toISOString();

  /* --- ใส่ข้อมูลตั้งต้น: อนุญาตเฉพาะตอนฐานข้อมูลว่างจริง ๆ --- */
  if(body.seed){
    const some = await sbSelect(T_ITEMS+"?select=id&limit=1");
    if(some.length) return json(res, 409, {error:"ฐานข้อมูลมีข้อมูลอยู่แล้ว ไม่ใส่ข้อมูลตั้งต้นซ้ำ"});
    const rows = [];
    COLLS.forEach(c=>{
      (Array.isArray(body.seed[c])? body.seed[c] : []).forEach(r=>{
        if(r && r.id) rows.push({coll:c, id:String(r.id), doc:r, updated_at:now});
      });
    });
    for(const part of chunk(rows, CHUNK)) await sbUpsert(T_ITEMS, part);
    if(body.seed.config) await sbUpsert(T_META, [{k:"config", v:body.seed.config, updated_at:now}]);
    await logLine(by, "ใส่ข้อมูลตั้งต้น "+rows.length+" รายการ");
    return json(res, 200, {ok:true, seeded:rows.length});
  }

  /* --- บันทึกรายการที่เปลี่ยน --- */
  const ops = Array.isArray(body.ops)? body.ops : [];
  if(!ops.length) return json(res, 200, {ok:true, applied:0});
  if(ops.length > MAXOPS) return json(res, 413, {error:"ส่งข้อมูลมามากเกินไปในครั้งเดียว"});

  const puts = [], dels = {};
  let cfg = null;
  for(const op of ops){
    if(op && op.coll==="config" && op.data && typeof op.data==="object"){ cfg = op.data; continue; }
    if(!op || COLLS.indexOf(op.coll)<0 || !op.id) continue;
    if(op.type==="del") (dels[op.coll] = dels[op.coll] || []).push(String(op.id));
    else if(op.data && typeof op.data==="object")
      puts.push({coll:op.coll, id:String(op.id), doc:op.data, updated_at:now});
  }
  for(const part of chunk(puts, CHUNK)) await sbUpsert(T_ITEMS, part);
  for(const c of Object.keys(dels))
    for(const part of chunk(dels[c], 100))
      await sbDelete(T_ITEMS, "coll=eq."+encodeURIComponent(c)+"&id="+encodeURIComponent(inList(part)));
  if(cfg) await sbUpsert(T_META, [{k:"config", v:cfg, updated_at:now}]);

  const applied = puts.length + Object.keys(dels).reduce((s,c)=>s+dels[c].length,0);
  if(applied || cfg) await logLine(by, "แก้ไข "+applied+" รายการ"+(cfg? " · ปรับการตั้งค่า":""));
  return json(res, 200, {ok:true, applied:applied});
}
