# Q Service Desk

เว็บจัดการคิวงาน T2 สำหรับ Service Desk ออกแบบให้ deploy ง่ายบน Netlify และใช้ Supabase สำหรับ login, database และ realtime update

## สิ่งที่มีในระบบ

- Login ผ่าน Supabase Auth
- Admin เพิ่ม profile ผู้ใช้ T1 และจัดการ T2
- แยกธุรกิจ KFC และ NonKFC
- เพิ่ม Ticket พร้อมระบุ T2 ที่รับงานและ T1 ที่ส่งงาน
- คิว T2 ตัดคนใกล้เลิกงาน 15 นาทีออกจากคิว
- T2 ที่เพิ่งกลับจากพักถูกดันลงท้ายคิว
- ตารางเวลางานใช้เวลา 24 ชั่วโมง ไม่มี AM/PM
- Dashboard ดูอันดับ T2 ที่รับงานมากที่สุด
- Filter รายการ Ticket
- ลบรายการที่เลือก / ล้างข้อมูล พร้อม popup ยืนยัน
- Export Excel เฉพาะข้อมูลเกี่ยวกับ T2
- Dark Mode
- Realtime update ให้ทุกคนเห็นพร้อมกัน

## ตั้งค่า Supabase

1. สร้าง project ที่ Supabase
2. เปิด SQL Editor แล้ววางโค้ดจาก `supabase/schema.sql`
3. ไปที่ Authentication แล้วสร้างผู้ใช้ admin คนแรก
4. คัดลอก user id ของ admin จาก Authentication > Users
5. ใน SQL Editor รันคำสั่งนี้ โดยเปลี่ยน user id, ชื่อ ให้เป็นของจริง

```sql
insert into public.profiles (id, name, role)
values ('ADMIN_USER_ID', 'Admin', 'admin');
```

6. ไปที่ Project Settings > API แล้วคัดลอก Project URL, anon public key และ service role key
7. สำหรับใช้งานบน Netlify ให้ไปที่ Netlify > Site configuration > Environment variables แล้วเพิ่มค่าเหล่านี้

```text
SUPABASE_URL=https://YOUR-PROJECT.supabase.co
SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR_SUPABASE_SERVICE_ROLE_KEY
```

ค่า service role key ต้องใส่เฉพาะใน Netlify Environment variables เท่านั้น ไม่ใส่ในไฟล์หน้าเว็บ

ถ้าต้องการเปิดจากไฟล์ในเครื่องแบบไม่ผ่าน Netlify ให้แก้ไฟล์ `public/config.js` แทน

```js
window.APP_CONFIG = {
  SUPABASE_URL: "https://YOUR-PROJECT.supabase.co",
  SUPABASE_ANON_KEY: "YOUR_SUPABASE_ANON_KEY"
};
```

## Deploy บน Netlify

1. อัปโหลดโฟลเดอร์นี้เข้า GitHub
2. เข้า Netlify แล้วเลือก Add new site > Import an existing project
3. เลือก repo นี้
4. Build command เว้นว่าง
5. Publish directory ใส่ `public`
6. Deploy

## การสร้าง User T1

1. เข้าเว็บ Q Service Desk ด้วยบัญชี Admin
2. ไปที่เมนูผู้ใช้งาน
3. ใส่อีเมล รหัสผ่าน ชื่อ และ Role
4. กดบันทึก ระบบจะสร้างบัญชีใน Supabase Auth และสร้าง profile ให้อัตโนมัติ

## หมายเหตุ

ระบบนี้เป็น static web app จึงเหมาะกับ Netlify มากกว่า Flask/SQLite บนคลาวน์ ข้อมูลจริงเก็บอยู่ใน Supabase ทำให้รองรับผู้ใช้หลายคนและอัปเดตพร้อมกันได้ดีกว่า
