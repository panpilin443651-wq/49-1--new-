/* อ่าน/เขียนข้อมูลกลาง
   GET  /api/data          -> ข้อมูลทั้งหมด
   POST /api/data {ops}    -> บันทึกเฉพาะรายการที่เปลี่ยน (แต่ละรายการเป็นคนละช่อง จึงไม่ทับกัน)
   POST /api/data {seed}   -> ใส่ข้อมูลตั้งต้นครั้งแรก (ทำได้เฉพาะตอนฐานข้อมูลยังว่าง) */
import { COLLS, keyOf, redis, hashToArray, guard, json, readBody } from "./_lib.js";

const MAXOPS = 2000;

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
  const out = await redis([
    ...COLLS.map(c=> ["HGETALL", keyOf(c)]),
    ["GET", keyOf("config")],
    ["LRANGE", keyOf("log"), 0, 4]
  ]);
  const data = {};
  COLLS.forEach((c,i)=> data[c] = hashToArray(out[i]));
  let config = {};
  try{ config = out[COLLS.length]? JSON.parse(out[COLLS.length]) : {}; }catch(e){}
  const log = (out[COLLS.length+1]||[]).map(s=>{ try{ return JSON.parse(s); }catch(e){ return null; } }).filter(Boolean);
  const empty = COLLS.every(c=> data[c].length===0);
  return json(res, 200, { data, config, log, empty, serverTime:Date.now() });
}

async function write(req,res){
  let body; try{ body = await readBody(req); }catch(e){ return json(res,400,{error:e.message}); }
  const by = String(body.by||"ไม่ระบุชื่อ").slice(0,60);
  const cmds = [];

  /* --- ใส่ข้อมูลตั้งต้น: อนุญาตเฉพาะตอนฐานข้อมูลว่างจริง ๆ --- */
  if(body.seed){
    const chk = await redis(COLLS.map(c=> ["HLEN", keyOf(c)]));
    if(chk.some(n=> Number(n)>0))
      return json(res, 409, {error:"ฐานข้อมูลมีข้อมูลอยู่แล้ว ไม่ใส่ข้อมูลตั้งต้นซ้ำ"});
    let n = 0;
    COLLS.forEach(c=>{
      const rows = Array.isArray(body.seed[c])? body.seed[c] : [];
      for(let i=0;i<rows.length;i+=200){
        const pairs = [];
        rows.slice(i,i+200).forEach(r=>{ if(r && r.id){ pairs.push(String(r.id), JSON.stringify(r)); n++; } });
        if(pairs.length) cmds.push(["HSET", keyOf(c), ...pairs]);
      }
    });
    if(body.seed.config) cmds.push(["SET", keyOf("config"), JSON.stringify(body.seed.config)]);
    cmds.push(["LPUSH", keyOf("log"), JSON.stringify({t:Date.now(), by:by, what:"ใส่ข้อมูลตั้งต้น "+n+" รายการ"})]);
    cmds.push(["LTRIM", keyOf("log"), 0, 199]);
    if(cmds.length) await redis(cmds);
    return json(res, 200, {ok:true, seeded:n});
  }

  /* --- บันทึกรายการที่เปลี่ยน --- */
  const ops = Array.isArray(body.ops)? body.ops : [];
  if(!ops.length) return json(res, 200, {ok:true, applied:0});
  if(ops.length > MAXOPS) return json(res, 413, {error:"ส่งข้อมูลมามากเกินไปในครั้งเดียว"});

  let applied = 0, cfg = 0;
  const putBy = {};                       /* รวม HSET ของคอลเลกชันเดียวกันเป็นคำสั่งเดียว */
  const delBy = {};
  for(const op of ops){
    if(op && op.coll==="config" && op.data && typeof op.data==="object"){
      cmds.push(["SET", keyOf("config"), JSON.stringify(op.data)]); cfg++; continue;
    }
    if(!op || COLLS.indexOf(op.coll)<0 || !op.id) continue;
    if(op.type==="del"){ (delBy[op.coll] = delBy[op.coll] || []).push(String(op.id)); applied++; }
    else if(op.data && typeof op.data==="object"){
      (putBy[op.coll] = putBy[op.coll] || []).push(String(op.id), JSON.stringify(op.data)); applied++;
    }
  }
  Object.keys(putBy).forEach(c=>{
    const p = putBy[c];
    for(let i=0;i<p.length;i+=400) cmds.push(["HSET", keyOf(c), ...p.slice(i,i+400)]);
  });
  Object.keys(delBy).forEach(c=>{
    const d = delBy[c];
    for(let i=0;i<d.length;i+=200) cmds.push(["HDEL", keyOf(c), ...d.slice(i,i+200)]);
  });
  if(applied || cfg){
    cmds.push(["LPUSH", keyOf("log"), JSON.stringify({t:Date.now(), by:by,
      what:"แก้ไข "+applied+" รายการ"+(cfg?" · ปรับการตั้งค่า":"")})]);
    cmds.push(["LTRIM", keyOf("log"), 0, 199]);
  }
  if(cmds.length) await redis(cmds);
  return json(res, 200, {ok:true, applied:applied});
}
