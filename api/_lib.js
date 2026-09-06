/* ตัวช่วยฝั่งเซิร์ฟเวอร์: คุยกับ Upstash Redis ผ่าน REST + ตรวจรหัสผ่าน
   ไม่มี dependency ใด ๆ ใช้ fetch กับ node:crypto ที่มีอยู่แล้ว */
import crypto from "node:crypto";

const RURL  = process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL   || "";
const RTOK  = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";
const PW    = process.env.APP_PASSWORD || "";
export const hasDB = !!(RURL && RTOK);
export const hasPW = !!PW;

/* คอลเลกชันที่เก็บเป็น Redis hash (field = id ของรายการ) */
export const COLLS = ["orgs", "cats", "budgets", "expenses"];
const K = { orgs:"b491:orgs", cats:"b491:cats", budgets:"b491:budgets",
            expenses:"b491:expenses", config:"b491:config", log:"b491:log" };
export const keyOf = c=> K[c];

/* ---------- Redis REST (แบบ pipeline หลายคำสั่งในครั้งเดียว) ---------- */
export async function redis(cmds){
  if(!hasDB) throw new Error("ยังไม่ได้เชื่อมฐานข้อมูล (ไม่พบ KV_REST_API_URL / KV_REST_API_TOKEN)");
  const res = await fetch(RURL.replace(/\/$/,"") + "/pipeline", {
    method:"POST",
    headers:{ Authorization:"Bearer "+RTOK, "Content-Type":"application/json" },
    body: JSON.stringify(cmds)
  });
  const txt = await res.text();
  if(!res.ok) throw new Error("ฐานข้อมูลตอบกลับ "+res.status+": "+txt.slice(0,300));
  let out; try{ out = JSON.parse(txt); }catch(e){ throw new Error("อ่านคำตอบจากฐานข้อมูลไม่ได้"); }
  if(!Array.isArray(out)) out = [out];
  const bad = out.find(x=> x && x.error);
  if(bad) throw new Error("คำสั่งฐานข้อมูลผิดพลาด: "+bad.error);
  return out.map(x=> x? x.result : null);
}
/* HGETALL คืนมาเป็น array [field,value,field,value,...] หรือ object แล้วแต่เวอร์ชัน */
export function hashToArray(raw){
  const out=[];
  if(!raw) return out;
  const push = v=>{ try{ const o=JSON.parse(v); if(o && typeof o==="object") out.push(o); }catch(e){} };
  if(Array.isArray(raw)){ for(let i=1;i<raw.length;i+=2) push(raw[i]); }
  else if(typeof raw==="object"){ Object.keys(raw).forEach(k=> push(raw[k])); }
  return out;
}

/* ---------- รหัสผ่านร่วม ---------- */
export const COOKIE = "b491s";
export function sessionToken(){
  return crypto.createHmac("sha256", PW + "|b491").update("session-v1").digest("hex").slice(0,40);
}
export function readCookie(req, name){
  const raw = req.headers.cookie || "";
  for(const part of raw.split(";")){
    const i = part.indexOf("=");
    if(i>0 && part.slice(0,i).trim()===name) return decodeURIComponent(part.slice(i+1).trim());
  }
  return null;
}
export function isAuthed(req){
  if(!hasPW) return false;
  const c = readCookie(req, COOKIE);
  if(!c) return false;
  const want = sessionToken();
  const a = Buffer.from(c), b = Buffer.from(want);
  return a.length===b.length && crypto.timingSafeEqual(a,b);
}
export function checkPassword(input){
  if(!hasPW || typeof input!=="string") return false;
  const a = Buffer.from(crypto.createHash("sha256").update(input).digest());
  const b = Buffer.from(crypto.createHash("sha256").update(PW).digest());
  return crypto.timingSafeEqual(a,b);
}

/* ---------- ตัวช่วยตอบกลับ ---------- */
export function json(res, code, obj, cookie){
  res.statusCode = code;
  res.setHeader("Content-Type","application/json; charset=utf-8");
  res.setHeader("Cache-Control","no-store");
  if(cookie) res.setHeader("Set-Cookie", cookie);
  res.end(JSON.stringify(obj));
}
export async function readBody(req){
  if(req.body && typeof req.body==="object") return req.body;      /* Vercel แปลงให้แล้ว */
  const chunks=[]; for await (const c of req) chunks.push(c);
  const s = Buffer.concat(chunks).toString("utf8");
  if(!s) return {};
  try{ return JSON.parse(s); }catch(e){ throw new Error("รูปแบบข้อมูลที่ส่งมาไม่ถูกต้อง"); }
}
export function guard(req,res){
  if(!hasPW){ json(res,500,{error:"ยังไม่ได้ตั้งรหัสผ่าน (ตัวแปร APP_PASSWORD) ที่ Vercel"}); return false; }
  if(!hasDB){ json(res,500,{error:"ยังไม่ได้เชื่อมฐานข้อมูล Upstash Redis กับโปรเจกต์นี้"}); return false; }
  if(!isAuthed(req)){ json(res,401,{error:"ยังไม่ได้เข้าสู่ระบบ"}); return false; }
  return true;
}
