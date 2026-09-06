/* ตัวช่วยฝั่งเซิร์ฟเวอร์: คุยกับ Supabase ผ่าน REST (PostgREST) + ตรวจรหัสผ่าน
   ไม่มี dependency ใด ๆ ใช้ fetch กับ node:crypto ที่มีอยู่แล้ว
   anon key ถูกเก็บไว้ที่เซิร์ฟเวอร์เท่านั้น ไม่ถูกส่งลงไปในหน้าเว็บ */
import crypto from "node:crypto";

const SB_URL = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/,"");
const SB_KEY = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
               process.env.SUPABASE_KEY || "";
/* ชื่อผู้ใช้/รหัสผ่านร่วม — เปลี่ยนได้โดยตั้งตัวแปร APP_USER / APP_PASSWORD ที่ Vercel แล้ว Redeploy */
const USER  = process.env.APP_USER || "raot";
const PW    = process.env.APP_PASSWORD || "1234";
export const hasDB = !!(SB_URL && SB_KEY);
export const hasPW = !!(USER && PW);

export const T_ITEMS = "b491_items", T_META = "b491_meta", T_LOG = "b491_log";
export const COLLS = ["orgs", "cats", "budgets", "expenses"];

/* ---------- Supabase REST ---------- */
async function sb(path, opts){
  if(!hasDB) throw new Error("ยังไม่ได้เชื่อมฐานข้อมูล (ไม่พบ SUPABASE_URL / SUPABASE_ANON_KEY)");
  const o = opts || {};
  const res = await fetch(SB_URL+"/rest/v1/"+path, {
    method: o.method || "GET",
    headers: Object.assign({
      apikey: SB_KEY,
      Authorization: "Bearer "+SB_KEY,
      "Content-Type": "application/json",
      Accept: "application/json"
    }, o.headers || {}),
    body: o.body
  });
  const txt = await res.text();
  if(!res.ok){
    let msg = txt.slice(0,400);
    try{ const j=JSON.parse(txt); msg = j.message || j.hint || j.details || msg;
      if(/relation .* does not exist|Could not find the table/i.test(msg))
        msg = "ยังไม่ได้สร้างตารางในฐานข้อมูล — ให้รันไฟล์ supabase.sql ใน SQL Editor ของ Supabase ก่อน";
      else if(res.status===401 || res.status===403)
        msg = "Supabase ปฏิเสธการเข้าถึง — ตรวจ anon key และสิทธิ์ (RLS policy) ของตาราง";
    }catch(e){}
    throw new Error("ฐานข้อมูลตอบกลับ "+res.status+": "+msg);
  }
  if(!txt) return [];
  try{ return JSON.parse(txt); }catch(e){ return []; }
}
export const sbSelect = path=> sb(path);
/* เขียนทับรายการเดิมถ้ามีคีย์ซ้ำ (upsert) */
export const sbUpsert = (table, rows)=> sb(table+"?on_conflict="+(table===T_META? "k":"coll,id"), {
  method:"POST", headers:{ Prefer:"resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(rows) });
export const sbInsert = (table, rows)=> sb(table, {
  method:"POST", headers:{ Prefer:"return=minimal" }, body: JSON.stringify(rows) });
export const sbDelete = (table, query)=> sb(table+"?"+query, {
  method:"DELETE", headers:{ Prefer:"return=minimal" } });
/* ค่าที่ใส่ใน in.(...) ต้องครอบด้วยเครื่องหมายคำพูดและ escape */
export const inList = ids=> "in.("+ids.map(x=>'"'+String(x).replace(/"/g,'\\"')+'"').join(",")+")";

/* ---------- รหัสผ่านร่วม ---------- */
export const COOKIE = "b491s";
export function sessionToken(){
  return crypto.createHmac("sha256", USER+":"+PW+"|b491").update("session-v2").digest("hex").slice(0,40);
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
  const a = Buffer.from(c), b = Buffer.from(sessionToken());
  return a.length===b.length && crypto.timingSafeEqual(a,b);
}
const sameSecret = (a,b)=>{
  const x = Buffer.from(crypto.createHash("sha256").update(String(a)).digest());
  const y = Buffer.from(crypto.createHash("sha256").update(String(b)).digest());
  return crypto.timingSafeEqual(x,y);
};
/* ชื่อผู้ใช้ไม่สนตัวพิมพ์ใหญ่เล็กและช่องว่างหัวท้าย ส่วนรหัสผ่านตรงตัว */
export function checkLogin(username, password){
  if(!hasPW || typeof password!=="string") return false;
  const u = String(username==null? "" : username).trim().toLowerCase();
  return sameSecret(u, USER.trim().toLowerCase()) && sameSecret(password, PW);
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
  if(!hasDB){ json(res,500,{error:"ยังไม่ได้เชื่อมฐานข้อมูล Supabase กับโปรเจกต์นี้"}); return false; }
  if(!isAuthed(req)){ json(res,401,{error:"ยังไม่ได้เข้าสู่ระบบ"}); return false; }
  return true;
}
