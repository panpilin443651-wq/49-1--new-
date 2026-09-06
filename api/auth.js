/* เข้าสู่ระบบด้วยรหัสร่วม / ตรวจสถานะ / ออกจากระบบ */
import { COOKIE, sessionToken, checkLogin, isAuthed, hasPW, hasDB, json, readBody } from "./_lib.js";

const cookieStr = (val, maxAge)=>
  COOKIE+"="+val+"; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age="+maxAge;

export default async function handler(req, res){
  if(req.method==="GET"){
    return json(res, 200, { authed:isAuthed(req), ready:(hasPW && hasDB),
      needPassword:!hasPW, needDatabase:!hasDB });
  }
  if(req.method==="DELETE"){
    return json(res, 200, {authed:false}, cookieStr("", 0));
  }
  if(req.method!=="POST") return json(res, 405, {error:"ไม่รองรับวิธีเรียกนี้"});

  if(!hasPW) return json(res, 500, {error:"ยังไม่ได้ตั้งรหัสผ่าน (ตัวแปร APP_PASSWORD) ที่ Vercel"});
  let body; try{ body = await readBody(req); }catch(e){ return json(res,400,{error:e.message}); }

  if(!checkLogin(body.username, body.password)){
    await new Promise(r=> setTimeout(r, 600));          /* หน่วงกันเดารหัสรัว ๆ */
    return json(res, 401, {error:"ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง"});
  }
  return json(res, 200, {authed:true}, cookieStr(sessionToken(), 60*60*24*30));
}
